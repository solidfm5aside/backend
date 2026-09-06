import dotenv from 'dotenv';
import mongoose from 'mongoose';

import Player from '@/models/player.model';
import Tournament, {
  CompetitionWorkflowState,
  TournamentFormat,
} from '@/models/tournament.model';
import TournamentEntry, {
  TournamentEntryStatus,
} from '@/models/tournament-entry.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import { CompetitionDivision } from '@/models/competition-division';
import { enrollPlayerInOpenPublishedCompetitions } from '@/services/open-published-late-roster.service';
import { fenceTeamLifecycle } from '@/services/team-lifecycle.service';

dotenv.config();

const ENROLL_CONFIRMATION = 'ENROLL-OPEN-PUBLISHED-LATE-ROSTER';

interface CandidatePlayer {
  playerId: string;
  playerName: string;
  jerseyNumber: number;
  teamId: string;
  teamName: string;
  tournamentId: string;
  tournamentName: string;
  currentRosterCount: number;
  maxRosterPlayers: number;
  playerVersion: number;
}

const parseOptions = () => {
  const args = process.argv.slice(2);
  return {
    execute: args.includes('--execute'),
    confirmation: args.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length),
  };
};

const isProductionUri = (uri: string): boolean =>
  /mongodb\+srv:\/\//i.test(uri) || /atlas/i.test(uri);

const inspectMissingRosterPlayers = async (): Promise<CandidatePlayer[]> => {
  const tournaments = await Tournament.find({
    fixturesGenerated: true,
    workflowState: { $ne: CompetitionWorkflowState.COMPLETED },
    isDeleted: false,
    $or: [
      {
        formatVersion: 2,
        format: TournamentFormat.TWO_GROUP_KNOCKOUT,
        division: { $ne: CompetitionDivision.WOMEN },
      },
      {
        formatVersion: 3,
        format: TournamentFormat.SINGLE_TABLE_FINAL,
        division: CompetitionDivision.WOMEN,
      },
    ],
  })
    .select('name season competitionRules formatVersion format division workflowState')
    .sort({ _id: 1 })
    .lean();

  const candidates: CandidatePlayer[] = [];

  for (const tournament of tournaments) {
    const maxRosterPlayers = tournament.competitionRules?.maxRosterPlayers ?? 10;
    const entries = await TournamentEntry.find({
      tournamentId: tournament._id,
      status: TournamentEntryStatus.ACTIVE,
      isDeleted: false,
    })
      .populate('teamId', 'name')
      .sort({ teamId: 1, _id: 1 })
      .lean();

    for (const entry of entries) {
      const team = entry.teamId as unknown as { _id: mongoose.Types.ObjectId; name: string };
      const teamId = team._id.toString();
      const rosteredIds = await TournamentRosterEntry.find({
        tournamentId: tournament._id,
        teamId: team._id,
      }).distinct('playerId');
      const rosteredIdSet = new Set(rosteredIds.map((id) => id.toString()));
      const players = await Player.find({ teamId: team._id, isDeleted: false })
        .select('+competitionRosterRevision name jerseyNumber __v')
        .sort({ jerseyNumber: 1, name: 1, _id: 1 })
        .lean();

      const missing = players.filter((player) => !rosteredIdSet.has(player._id.toString()));
      const remainingSlots = Math.max(0, maxRosterPlayers - rosteredIdSet.size);
      for (const player of missing.slice(0, remainingSlots)) {
        candidates.push({
          playerId: player._id.toString(),
          playerName: player.name,
          jerseyNumber: player.jerseyNumber,
          teamId,
          teamName: team.name,
          tournamentId: tournament._id.toString(),
          tournamentName: tournament.name,
          currentRosterCount: rosteredIdSet.size,
          maxRosterPlayers,
          playerVersion: player.__v ?? 0,
        });
      }
    }
  }

  return candidates;
};

const printPlan = (candidates: CandidatePlayer[], databaseName: string): void => {
  console.log(`Database: ${databaseName}`);
  console.log(`Players missing from an open published tournament roster: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log('Nothing to enroll.');
    return;
  }
  for (const candidate of candidates) {
    console.log(
      `  ${candidate.tournamentName} | ${candidate.teamName} | #${String(candidate.jerseyNumber).padStart(2, '0')} ${candidate.playerName} | roster ${candidate.currentRosterCount}/${candidate.maxRosterPlayers} | ${candidate.playerId}`
    );
  }
};

const enrollCandidate = async (
  candidate: CandidatePlayer
): Promise<{ enrolled: string[]; alreadyEnrolled: string[]; excluded: string[] }> => {
  const session = await mongoose.startSession();
  try {
    let enrolled: string[] = [];
    let alreadyEnrolled: string[] = [];
    let excluded: string[] = [];
    await session.withTransaction(async () => {
      const team = await fenceTeamLifecycle(candidate.teamId, session);
      if (!team) {
        throw new Error(`Team ${candidate.teamId} is unavailable.`);
      }
      const latest = await Player.findOne({
        _id: candidate.playerId,
        teamId: candidate.teamId,
        isDeleted: false,
      })
        .select('__v')
        .session(session);
      if (!latest) {
        throw new Error(`Player ${candidate.playerId} is no longer on ${candidate.teamName}.`);
      }
      const result = await enrollPlayerInOpenPublishedCompetitions(
        candidate.playerId,
        candidate.teamId,
        latest.__v ?? 0,
        session
      );
      enrolled = result.enrolledTournamentIds;
      alreadyEnrolled = result.alreadyEnrolledTournamentIds;
      excluded = result.excludedTournamentIds;
    });
    return { enrolled, alreadyEnrolled, excluded };
  } finally {
    await session.endSession();
  }
};

const run = async (): Promise<void> => {
  const options = parseOptions();
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. No database connection was attempted.');
  }

  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error('MongoDB connected without an available database handle.');
  }

  const candidates = await inspectMissingRosterPlayers();
  printPlan(candidates, database.databaseName);

  if (!options.execute) {
    console.log(
      `Dry run only: no records changed. After review, rerun with --execute and --confirm=${ENROLL_CONFIRMATION}.`
    );
    return;
  }

  if (options.confirmation !== ENROLL_CONFIRMATION) {
    throw new Error(`Refusing to execute without --confirm=${ENROLL_CONFIRMATION}.`);
  }
  if (process.env.LATE_ROSTER_ALLOW_EXECUTE !== 'true') {
    throw new Error('Refusing to execute without LATE_ROSTER_ALLOW_EXECUTE=true.');
  }
  if (isProductionUri(uri) && process.env.LATE_ROSTER_ALLOW_PRODUCTION !== 'true') {
    throw new Error('Refusing to write a production database without LATE_ROSTER_ALLOW_PRODUCTION=true.');
  }

  let enrolledCount = 0;
  for (const candidate of candidates) {
    const result = await enrollCandidate(candidate);
    if (result.enrolled.includes(candidate.tournamentId)) {
      enrolledCount += 1;
      console.log(`Enrolled ${candidate.playerName} on ${candidate.tournamentName}.`);
    } else if (result.alreadyEnrolled.includes(candidate.tournamentId)) {
      console.log(`Already on roster: ${candidate.playerName} on ${candidate.tournamentName}.`);
    } else if (result.excluded.includes(candidate.tournamentId)) {
      console.log(`Excluded ${candidate.playerName} on ${candidate.tournamentName} (roster full or ineligible).`);
    } else {
      console.log(
        `Did not match ${candidate.playerName} to ${candidate.tournamentName} (tournament filter missed).`
      );
    }
  }

  const remaining = await inspectMissingRosterPlayers();
  console.log(`Enrollment finished. Newly enrolled: ${enrolledCount}. Still missing: ${remaining.length}.`);
};

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
