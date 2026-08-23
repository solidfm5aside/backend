import { ClientSession, Types } from 'mongoose';
import Match, {
  MatchFixtureSource,
  MatchStage,
  MatchStatus,
} from '@/models/match.model';
import Player, { IPlayer } from '@/models/player.model';
import Tournament, {
  CompetitionWorkflowState,
  FIXED_WOMENS_COMPETITION_RULES,
  TournamentFormat,
} from '@/models/tournament.model';
import TournamentEntry, {
  TournamentEntryStatus,
} from '@/models/tournament-entry.model';
import TournamentRosterEntry, {
  ITournamentRosterEntry,
} from '@/models/tournament-roster-entry.model';
import { CompetitionDivision } from '@/models/competition-division';

export class WomensLateRosterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'WomensLateRosterError';
  }
}

export interface WomensLateRosterEnrollmentResult {
  enrolledTournamentIds: string[];
  alreadyEnrolledTournamentIds: string[];
  excludedTournamentIds: string[];
}

const playerRevisionFilter = (revision: number) =>
  revision === 0
    ? {
        $or: [
          { competitionRosterRevision: 0 },
          { competitionRosterRevision: { $exists: false } },
        ],
      }
    : { competitionRosterRevision: revision };

const sameOptionalString = (left?: string, right?: string): boolean =>
  (left?.trim() ?? '') === (right?.trim() ?? '');

const snapshotMatchesPlayer = (
  snapshot: ITournamentRosterEntry,
  player: IPlayer,
  tournamentEntryId: string,
  teamId: string
): boolean =>
  snapshot.tournamentEntryId.toString() === tournamentEntryId &&
  snapshot.teamId.toString() === teamId &&
  snapshot.playerId.toString() === player._id.toString() &&
  snapshot.playerNameSnapshot === player.name &&
  snapshot.positionSnapshot === player.position &&
  snapshot.jerseyNumberSnapshot === player.jerseyNumber &&
  snapshot.nationalitySnapshot === player.nationality &&
  sameOptionalString(snapshot.photoSnapshot, player.passportPic);

/**
 * Adds a newly-created or just-transferred player to an already-published
 * women's v3 league roster while the destination team has not begun play.
 *
 * The caller must already hold the destination Team lifecycle fence. Match
 * scheduled->live takes the same fence, so the match-start check and snapshot
 * insertion cannot race. Men and legacy competitions are deliberately absent
 * from every query in this function.
 */
export const enrollPlayerInUnstartedWomensCompetitions = async (
  playerId: string | Types.ObjectId,
  teamId: string | Types.ObjectId,
  expectedPlayerVersion: number,
  session: ClientSession
): Promise<WomensLateRosterEnrollmentResult> => {
  const normalizedTeamId = teamId.toString();
  const player = await Player.findOne({
    _id: playerId,
    teamId,
    isDeleted: false,
    __v: expectedPlayerVersion,
  })
    .select(
      '+competitionRosterRevision name position jerseyNumber nationality passportPic teamId __v'
    )
    .session(session);
  if (!player) {
    throw new WomensLateRosterError(
      'The player changed before tournament eligibility could be captured. Refresh and retry.',
      409,
      'PLAYER_ROSTER_STATE_CHANGED'
    );
  }

  const candidateEntries = await TournamentEntry.find({
    teamId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
  })
    .select('tournamentId teamId')
    .sort({ tournamentId: 1, _id: 1 })
    .session(session)
    .lean();
  if (candidateEntries.length === 0) {
    return {
      enrolledTournamentIds: [],
      alreadyEnrolledTournamentIds: [],
      excludedTournamentIds: [],
    };
  }

  const enrolledTournamentIds: string[] = [];
  const alreadyEnrolledTournamentIds: string[] = [];
  const excludedTournamentIds: string[] = [];

  for (const entry of candidateEntries) {
    const tournamentId = entry.tournamentId.toString();
    const tournament = await Tournament.findOne({
      _id: entry.tournamentId,
      formatVersion: 3,
      format: TournamentFormat.SINGLE_TABLE_FINAL,
      division: CompetitionDivision.WOMEN,
      fixturesGenerated: true,
      workflowState: CompetitionWorkflowState.GROUP_STAGE,
      isDeleted: false,
    })
      .select('+rosterIdentityRevision workflowRevision competitionRules __v')
      .session(session);
    // This is not a published, open women-v3 league. It must retain the
    // existing future-only behavior and must never affect a men's roster.
    if (!tournament) continue;

    const maxRosterPlayers = tournament.competitionRules?.maxRosterPlayers;
    if (maxRosterPlayers !== FIXED_WOMENS_COMPETITION_RULES.maxRosterPlayers) {
      excludedTournamentIds.push(tournamentId);
      continue;
    }

    const existingSnapshot = await TournamentRosterEntry.findOne({
      tournamentId: entry.tournamentId,
      playerId,
    }).session(session);
    if (existingSnapshot) {
      if (
        !snapshotMatchesPlayer(
          existingSnapshot,
          player,
          entry._id.toString(),
          normalizedTeamId
        )
      ) {
        throw new WomensLateRosterError(
          'An incompatible tournament roster snapshot already exists for this player.',
          409,
          'WOMENS_ROSTER_SNAPSHOT_CONFLICT'
        );
      }
      alreadyEnrolledTournamentIds.push(tournamentId);
      continue;
    }

    const teamMatches = await Match.find({
      tournamentId: entry.tournamentId,
      isDeleted: false,
      $or: [{ homeTeam: teamId }, { awayTeam: teamId }],
    })
      .select(
        'stage status fixtureSource fixtureKey officialFixtureNumber leg homeTeam awayTeam homeScore awayScore events winner resultLockedAt resultLockReason'
      )
      .sort({ officialFixtureNumber: 1, _id: 1 })
      .session(session)
      .lean();
    const officialNumbers = teamMatches.map((match) => match.officialFixtureNumber);
    const intactUnstartedLeague =
      teamMatches.length === 2 &&
      new Set(officialNumbers).size === 2 &&
      teamMatches.every(
        (match) =>
          match.stage === MatchStage.LEAGUE &&
          match.fixtureSource === MatchFixtureSource.PHYSICAL_OFFICIAL &&
          Number.isInteger(match.officialFixtureNumber) &&
          match.officialFixtureNumber! >= 1 &&
          match.officialFixtureNumber! <= 3 &&
          match.fixtureKey ===
            `${tournamentId}:league:official:${match.officialFixtureNumber}` &&
          match.leg === 1 &&
          match.homeScore === 0 &&
          match.awayScore === 0 &&
          Array.isArray(match.events) &&
          match.events.length === 0 &&
          !match.winner &&
          !match.resultLockedAt &&
          !match.resultLockReason &&
          (match.status === MatchStatus.SCHEDULED ||
            match.status === MatchStatus.CANCELLED)
      );
    if (!intactUnstartedLeague) {
      excludedTournamentIds.push(tournamentId);
      continue;
    }

    const rosterCount = await TournamentRosterEntry.countDocuments({
      tournamentId: entry.tournamentId,
      teamId,
    }).session(session);
    if (rosterCount >= maxRosterPlayers) {
      excludedTournamentIds.push(tournamentId);
      continue;
    }

    const currentRosterIdentityRevision = tournament.rosterIdentityRevision ?? 0;
    const fencedTournament = await Tournament.findOneAndUpdate(
      {
        _id: tournament._id,
        formatVersion: 3,
        format: TournamentFormat.SINGLE_TABLE_FINAL,
        division: CompetitionDivision.WOMEN,
        fixturesGenerated: true,
        workflowState: CompetitionWorkflowState.GROUP_STAGE,
        workflowRevision: tournament.workflowRevision,
        rosterIdentityRevision: currentRosterIdentityRevision,
        __v: tournament.__v ?? 0,
        isDeleted: false,
      },
      { $inc: { rosterIdentityRevision: 1, __v: 1 } },
      { new: true, session, projection: { _id: 1 } }
    );
    if (!fencedTournament) {
      throw new WomensLateRosterError(
        'The women’s tournament changed while player eligibility was being captured.',
        409,
        'WOMENS_ROSTER_STATE_CHANGED'
      );
    }

    await TournamentRosterEntry.create(
      [
        {
          tournamentId: entry.tournamentId,
          tournamentEntryId: entry._id,
          teamId,
          playerId,
          playerNameSnapshot: player.name,
          positionSnapshot: player.position,
          jerseyNumberSnapshot: player.jerseyNumber,
          nationalitySnapshot: player.nationality,
          ...(player.passportPic ? { photoSnapshot: player.passportPic } : {}),
          publicationRevision: tournament.workflowRevision,
          capturedAt: new Date(),
        },
      ],
      { session }
    );
    enrolledTournamentIds.push(tournamentId);
  }

  if (enrolledTournamentIds.length > 0) {
    const revision = player.competitionRosterRevision ?? 0;
    const playerFence = await Player.updateOne(
      {
        _id: playerId,
        teamId,
        isDeleted: false,
        __v: expectedPlayerVersion,
        ...playerRevisionFilter(revision),
      },
      { $inc: { competitionRosterRevision: 1 } },
      { session }
    );
    if (playerFence.modifiedCount !== 1) {
      throw new WomensLateRosterError(
        'The player changed while tournament eligibility was being captured. Refresh and retry.',
        409,
        'PLAYER_ROSTER_STATE_CHANGED'
      );
    }
  }

  return {
    enrolledTournamentIds,
    alreadyEnrolledTournamentIds,
    excludedTournamentIds,
  };
};
