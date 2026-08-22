import dotenv from "dotenv";
import mongoose, { ClientSession, Types } from "mongoose";

import {
  assertOfficial2026FixtureManifestIntegrity,
  normalizeOfficial2026Name,
  OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
  OFFICIAL_2026_FIXTURES,
  OFFICIAL_2026_SOURCE_BYTE_LENGTH,
  OFFICIAL_2026_SOURCE_SHA256,
  OFFICIAL_2026_TEAMS,
  OFFICIAL_2026_VENUES,
  Official2026TeamKey,
  Official2026VenueKey,
} from "@/data/official-2026-fixture-manifest";
import CompetitionBracket from "@/models/competition-bracket.model";
import CompetitionDraw from "@/models/competition-draw.model";
import CompetitionOperation, {
  CompetitionOperationStatus,
} from "@/models/competition-operation.model";
import Match, {
  MatchFixtureSource,
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from "@/models/match.model";
import Player from "@/models/player.model";
import PlayerStats from "@/models/player-stats.model";
import Standings from "@/models/standings.model";
import Team from "@/models/team.model";
import TournamentEntry, {
  TournamentEntrySource,
  TournamentEntryStatus,
} from "@/models/tournament-entry.model";
import TournamentRosterEntry from "@/models/tournament-roster-entry.model";
import Tournament, {
  CompetitionDrawMode,
  CompetitionWorkflowState,
  FIXED_V2_COMPETITION_RULES,
  TournamentFormat,
  TournamentStatus,
} from "@/models/tournament.model";
import Venue from "@/models/venue.model";
import { fenceTeamLifecycles } from "@/services/team-lifecycle.service";
import { fenceActiveVenueNames } from "@/services/venue-lifecycle.service";
import {
  assertOfficial2026CommittedMatchesMatchManifest,
  assertOfficial2026LegacyTournamentIsPristine,
  buildOfficial2026LegacyTournamentCasFilter,
  buildOfficial2026MigrationPublicationPlan,
  buildOfficial2026SafeBackupReference,
  Official2026CommittedMatchLike,
  Official2026SafeBackupReference,
} from "@/utils/official-2026-migration.util";
import { buildTournamentRosterSnapshotRows } from "@/utils/roster.util";

dotenv.config();

const MIGRATION_OPERATION = "official_2026_physical_fixture_migration";
const MIGRATION_CONFIRMATION = "APPLY-OFFICIAL-2026-PHYSICAL-FIXTURES";
const EXPECTED_LEGACY_FIXTURE_COUNT = 42;
const EXPECTED_LEGACY_STANDING_COUNT = 14;

interface MigrationOptions {
  execute: boolean;
  tournamentId?: string;
  confirmedTournamentId?: string;
  confirmedTournamentName?: string;
  confirmedDatabase?: string;
  confirmation?: string;
  backupReference?: string;
  backupSha256?: string;
}

interface TournamentSnapshot {
  _id: Types.ObjectId;
  __v?: number;
  name: string;
  season: string;
  startDate: Date;
  endDate?: Date;
  status: TournamentStatus;
  currentStage: MatchStage;
  leagueRounds: number;
  fixturesGenerated: boolean;
  formatVersion?: 1 | 2;
  format?: TournamentFormat;
  workflowState?: CompetitionWorkflowState;
  workflowRevision?: number;
  entryIdentityRevision?: number;
  rosterIdentityRevision?: number;
  standingsRevision?: number;
  scheduleRevision?: number;
  competitionTieResolutions?: unknown[];
  qualificationSnapshot?: unknown[];
  qualificationFinalizedAt?: Date;
  championTeamId?: Types.ObjectId;
  runnerUpTeamId?: Types.ObjectId;
  thirdPlaceTeamId?: Types.ObjectId;
  competitionCompletedAt?: Date;
  isDeleted: boolean;
}

interface TeamSnapshot {
  _id: Types.ObjectId;
  name: string;
  logo?: string;
  registrationStatus: string;
}

interface PlayerSnapshot {
  _id: Types.ObjectId;
  teamId: Types.ObjectId;
  name: string;
  position: string;
  jerseyNumber: number;
  nationality: string;
  passportPic?: string;
  competitionRosterRevision?: number;
}

interface VenueSnapshot {
  _id: Types.ObjectId;
  __v?: number;
  name: string;
  isDeleted: boolean;
}

interface LegacyMatchSnapshot {
  _id: Types.ObjectId;
  homeTeam: Types.ObjectId;
  awayTeam: Types.ObjectId;
  homeScore?: number;
  awayScore?: number;
  status: MatchStatus;
  stage: MatchStage;
  events?: unknown[];
  isDeleted?: boolean;
  fixtureKey?: string;
  fixtureSource?: string;
  fixturePublicationHash?: string;
  officialFixtureNumber?: number;
  drawId?: Types.ObjectId;
  bracketId?: Types.ObjectId;
  bracketNodeKey?: string;
  bracketSlot?: number;
  winner?: Types.ObjectId;
  isExtraTime?: boolean;
  shootoutScore?: { home?: number; away?: number };
  resultLockedAt?: Date;
  resultLockReason?: string;
  deletedEventIds?: Types.ObjectId[];
}

interface StandingSnapshot {
  teamId: Types.ObjectId;
  tournamentEntryId?: Types.ObjectId;
  groupKey?: string;
  rank?: number;
  revision?: number;
  played?: number;
  won?: number;
  drawn?: number;
  lost?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  goalDifference?: number;
  points?: number;
  fairPlayPoints?: number;
}

interface ResolvedTeam {
  definition: (typeof OFFICIAL_2026_TEAMS)[number];
  document: TeamSnapshot;
}

interface ResolvedVenue {
  definition: (typeof OFFICIAL_2026_VENUES)[number];
  document: VenueSnapshot;
  renameRequired: boolean;
}

interface MigrationInspection {
  tournament: TournamentSnapshot;
  teamsByKey: Map<Official2026TeamKey, ResolvedTeam>;
  venuesByKey: Map<Official2026VenueKey, ResolvedVenue>;
  players: PlayerSnapshot[];
  rosterPlayerCount: number;
}

const readOption = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
};

const parseOptions = (): MigrationOptions => ({
  execute: process.argv.includes("--execute"),
  tournamentId: readOption("tournament-id"),
  confirmedTournamentId: readOption("confirm-tournament-id"),
  confirmedTournamentName: readOption("confirm-tournament-name"),
  confirmedDatabase: readOption("confirm-db"),
  confirmation: readOption("confirm"),
  backupReference: readOption("backup-reference"),
  backupSha256: readOption("backup-sha256"),
});

const requireTournamentId = (options: MigrationOptions): Types.ObjectId => {
  if (!options.tournamentId || !Types.ObjectId.isValid(options.tournamentId)) {
    throw new Error(
      "Pass one valid target with --tournament-id=<exact-object-id>.",
    );
  }
  return new Types.ObjectId(options.tournamentId);
};

const assertExecutionAuthorized = (
  options: MigrationOptions,
  databaseName: string,
  tournament: TournamentSnapshot,
): void => {
  if (!options.execute) return;
  if (process.env.OFFICIAL_2026_MIGRATION_ALLOW_EXECUTE !== "true") {
    throw new Error(
      "Set OFFICIAL_2026_MIGRATION_ALLOW_EXECUTE=true for this one approved migration run.",
    );
  }
  if (options.confirmedDatabase !== databaseName) {
    throw new Error(
      `Pass --confirm-db=${databaseName}; it must exactly match the connected database.`,
    );
  }
  if (options.confirmedTournamentId !== tournament._id.toString()) {
    throw new Error(
      `Pass --confirm-tournament-id=${tournament._id.toString()} to confirm the exact target.`,
    );
  }
  if (options.confirmedTournamentName !== tournament.name) {
    throw new Error(
      "Pass --confirm-tournament-name with the exact current tournament name returned by the plan.",
    );
  }
  if (options.confirmation !== MIGRATION_CONFIRMATION) {
    throw new Error(
      `Pass --confirm=${MIGRATION_CONFIRMATION} after reviewing the plan.`,
    );
  }
  if (!options.backupReference) {
    throw new Error("Pass --backup-reference=<verified-restorable-backup-id>.");
  }
  if (!options.backupSha256 || !/^[0-9a-fA-F]{64}$/.test(options.backupSha256)) {
    throw new Error(
      "Pass --backup-sha256=<independently-computed-backup-artifact-sha256>.",
    );
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.OFFICIAL_2026_MIGRATION_ALLOW_PRODUCTION !== "true"
  ) {
    throw new Error(
      "Production migration is blocked unless OFFICIAL_2026_MIGRATION_ALLOW_PRODUCTION=true is set for the maintenance window.",
    );
  }
};

const resolveTeams = (
  teams: TeamSnapshot[],
): Map<Official2026TeamKey, ResolvedTeam> => {
  if (teams.length !== OFFICIAL_2026_TEAMS.length) {
    throw new Error(
      `Migration refused: expected exactly 14 active teams, found ${teams.length}.`,
    );
  }

  const definitionByDatabaseName = new Map(
    OFFICIAL_2026_TEAMS.map((definition) => [
      normalizeOfficial2026Name(definition.databaseName),
      definition,
    ]),
  );
  const resolved = new Map<Official2026TeamKey, ResolvedTeam>();
  const unknownNames: string[] = [];

  for (const team of teams) {
    const definition = definitionByDatabaseName.get(
      normalizeOfficial2026Name(team.name),
    );
    if (!definition) {
      unknownNames.push(team.name);
      continue;
    }
    if (resolved.has(definition.key)) {
      throw new Error(
        `Migration refused: team identity ${definition.databaseName} is ambiguous.`,
      );
    }
    if (team.registrationStatus !== "registered") {
      throw new Error(`Migration refused: ${team.name} is not registered.`);
    }
    resolved.set(definition.key, { definition, document: team });
  }

  if (unknownNames.length > 0) {
    throw new Error(
      `Migration refused: active team names do not match the pinned 2026 inventory: ${unknownNames.join(", ")}.`,
    );
  }
  const missing = OFFICIAL_2026_TEAMS.filter((team) => !resolved.has(team.key));
  if (missing.length > 0 || resolved.size !== OFFICIAL_2026_TEAMS.length) {
    throw new Error(
      `Migration refused: missing exact team identities: ${missing
        .map((team) => team.databaseName)
        .join(", ")}.`,
    );
  }
  return resolved;
};

const resolveVenues = (
  activeVenues: VenueSnapshot[],
  allVenues: VenueSnapshot[],
): Map<Official2026VenueKey, ResolvedVenue> => {
  if (activeVenues.length !== OFFICIAL_2026_VENUES.length) {
    throw new Error(
      `Migration refused: expected exactly three active venues, found ${activeVenues.length}.`,
    );
  }

  const resolved = new Map<Official2026VenueKey, ResolvedVenue>();
  for (const venue of activeVenues) {
    const normalizedName = normalizeOfficial2026Name(venue.name);
    const matches = OFFICIAL_2026_VENUES.filter((definition) =>
      definition.acceptedDatabaseNames.some(
        (accepted) => normalizeOfficial2026Name(accepted) === normalizedName,
      ),
    );
    if (matches.length !== 1) {
      throw new Error(
        `Migration refused: venue ${venue.name} does not resolve unambiguously to the pinned venue inventory.`,
      );
    }
    const definition = matches[0];
    if (resolved.has(definition.key)) {
      throw new Error(
        `Migration refused: venue identity ${definition.documentName} is ambiguous.`,
      );
    }
    resolved.set(definition.key, {
      definition,
      document: venue,
      renameRequired: venue.name !== definition.documentName,
    });
  }

  if (resolved.size !== OFFICIAL_2026_VENUES.length) {
    throw new Error(
      "Migration refused: one or more official venues are missing.",
    );
  }
  for (const item of resolved.values()) {
    const targetName = normalizeOfficial2026Name(item.definition.documentName);
    const conflicting = allVenues.find(
      (venue) =>
        venue._id.toString() !== item.document._id.toString() &&
        normalizeOfficial2026Name(venue.name) === targetName,
    );
    if (conflicting) {
      throw new Error(
        `Migration refused: ${item.definition.documentName} already belongs to another venue record.`,
      );
    }
  }
  return resolved;
};

const assertLegacyMatchesAreUntouched = (
  matches: LegacyMatchSnapshot[],
  teamsByKey: Map<Official2026TeamKey, ResolvedTeam>,
): void => {
  if (matches.length !== EXPECTED_LEGACY_FIXTURE_COUNT) {
    throw new Error(
      `Migration refused: expected exactly 42 legacy fixtures, found ${matches.length}.`,
    );
  }
  const allowedTeamIds = new Set(
    [...teamsByKey.values()].map(({ document }) => document._id.toString()),
  );
  const matchesPerTeam = new Map(
    [...allowedTeamIds].map((teamId) => [teamId, 0]),
  );
  const pairs = new Set<string>();

  for (const match of matches) {
    const homeTeamId = match.homeTeam.toString();
    const awayTeamId = match.awayTeam.toString();
    if (
      !allowedTeamIds.has(homeTeamId) ||
      !allowedTeamIds.has(awayTeamId) ||
      homeTeamId === awayTeamId
    ) {
      throw new Error(
        "Migration refused: a legacy fixture has an unknown or invalid team pair.",
      );
    }
    if (
      match.isDeleted ||
      match.stage !== MatchStage.LEAGUE ||
      match.status !== MatchStatus.SCHEDULED ||
      (match.homeScore ?? 0) !== 0 ||
      (match.awayScore ?? 0) !== 0 ||
      (match.events?.length ?? 0) !== 0 ||
      match.winner ||
      match.resultLockedAt ||
      match.resultLockReason !== undefined ||
      match.isExtraTime ||
      match.shootoutScore !== undefined ||
      (match.deletedEventIds?.length ?? 0) > 0
    ) {
      throw new Error(
        "Migration refused: a legacy fixture is live, completed, deleted, scored, eventful, or result-locked.",
      );
    }
    if (
      match.fixtureKey !== undefined ||
      match.officialFixtureNumber !== undefined ||
      match.fixturePublicationHash ||
      (match.fixtureSource &&
        match.fixtureSource !== MatchFixtureSource.SYSTEM_LEGACY) ||
      match.drawId ||
      match.bracketId ||
      match.bracketNodeKey ||
      match.bracketSlot !== undefined
    ) {
      throw new Error(
        "Migration refused: a fixture already contains official, draw, bracket, or non-legacy provenance.",
      );
    }

    matchesPerTeam.set(homeTeamId, (matchesPerTeam.get(homeTeamId) ?? 0) + 1);
    matchesPerTeam.set(awayTeamId, (matchesPerTeam.get(awayTeamId) ?? 0) + 1);
    const pairKey = [homeTeamId, awayTeamId].sort().join(":");
    if (pairs.has(pairKey)) {
      throw new Error(
        "Migration refused: the legacy generator produced a duplicate team pair.",
      );
    }
    pairs.add(pairKey);
  }

  if (
    pairs.size !== 42 ||
    [...matchesPerTeam.values()].some((count) => count !== 6)
  ) {
    throw new Error(
      "Migration refused: legacy fixture pair or per-team counts differ from the expected six-round generator output.",
    );
  }
};

const assertLegacyStandingsAreZero = (
  standings: StandingSnapshot[],
  teamsByKey: Map<Official2026TeamKey, ResolvedTeam>,
): void => {
  if (standings.length !== EXPECTED_LEGACY_STANDING_COUNT) {
    throw new Error(
      `Migration refused: expected exactly 14 legacy standings, found ${standings.length}.`,
    );
  }
  const expectedTeamIds = new Set(
    [...teamsByKey.values()].map(({ document }) => document._id.toString()),
  );
  const actualTeamIds = new Set<string>();
  const numericFields: Array<keyof StandingSnapshot> = [
    "revision",
    "played",
    "won",
    "drawn",
    "lost",
    "goalsFor",
    "goalsAgainst",
    "goalDifference",
    "points",
    "fairPlayPoints",
  ];

  for (const standing of standings) {
    const teamId = standing.teamId.toString();
    if (!expectedTeamIds.has(teamId) || actualTeamIds.has(teamId)) {
      throw new Error(
        "Migration refused: legacy standings team identities are incomplete or duplicated.",
      );
    }
    actualTeamIds.add(teamId);
    if (
      standing.tournamentEntryId ||
      standing.groupKey ||
      standing.rank !== undefined ||
      numericFields.some((field) => Number(standing[field] ?? 0) !== 0)
    ) {
      throw new Error(
        "Migration refused: standings already contain group or result state.",
      );
    }
  }
  if (actualTeamIds.size !== expectedTeamIds.size) {
    throw new Error(
      "Migration refused: legacy standings do not cover the exact 14 teams.",
    );
  }
};

const inspectMigrationTarget = async (
  tournamentId: Types.ObjectId,
  session?: ClientSession,
): Promise<MigrationInspection> => {
  assertOfficial2026FixtureManifestIntegrity();

  const tournament = (await Tournament.findById(tournamentId)
    .select("+rosterIdentityRevision")
    .session(session ?? null)
    .lean()) as unknown as TournamentSnapshot | null;
  if (!tournament) throw new Error("Target tournament not found.");
  assertOfficial2026LegacyTournamentIsPristine(tournament);

  const teams = (await Team.find({ isDeleted: false })
    .select("name logo registrationStatus")
    .session(session ?? null)
    .lean()) as unknown as TeamSnapshot[];
  const teamsByKey = resolveTeams(teams);
  const teamIds = [...teamsByKey.values()].map(({ document }) => document._id);

  const players = (await Player.find({
    teamId: { $in: teamIds },
    isDeleted: false,
  })
    .select(
      "+competitionRosterRevision name position jerseyNumber nationality passportPic teamId",
    )
    .session(session ?? null)
    .lean()) as unknown as PlayerSnapshot[];
  const outsideRosterCount = await Player.countDocuments({
    teamId: { $nin: teamIds },
    isDeleted: false,
  }).session(session ?? null);
  if (outsideRosterCount !== 0) {
    throw new Error(
      "Migration refused: active players exist outside the exact 14-team inventory.",
    );
  }
  const playerCountByTeam = new Map<string, number>();
  for (const player of players) {
    const teamId = player.teamId.toString();
    playerCountByTeam.set(teamId, (playerCountByTeam.get(teamId) ?? 0) + 1);
  }
  const overLimit = [...playerCountByTeam.entries()].filter(
    ([, count]) => count > FIXED_V2_COMPETITION_RULES.maxRosterPlayers,
  );
  if (overLimit.length > 0) {
    throw new Error(
      "Migration refused: at least one team exceeds the 10-player roster limit.",
    );
  }

  const allVenues = (await Venue.find({})
    .select("name isDeleted __v")
    .session(session ?? null)
    .lean()) as unknown as VenueSnapshot[];
  const venuesByKey = resolveVenues(
    allVenues.filter((venue) => !venue.isDeleted),
    allVenues,
  );

  for (const { document, definition, renameRequired } of venuesByKey.values()) {
    if (!renameRequired) continue;
    const outsideUsage = await Match.countDocuments({
      tournamentId: { $ne: tournamentId },
      isDeleted: false,
      venue: {
        $regex: `^${document.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        $options: "i",
      },
    }).session(session ?? null);
    if (outsideUsage > 0) {
      throw new Error(
        `Migration refused: ${document.name} is used by matches outside the target and cannot be safely renamed to ${definition.documentName}.`,
      );
    }
  }

  const matches = (await Match.find({ tournamentId })
    .select("+deletedEventIds")
    .session(session ?? null)
    .lean()) as unknown as LegacyMatchSnapshot[];
  assertLegacyMatchesAreUntouched(matches, teamsByKey);

  const standings = (await Standings.find({ tournamentId })
    .session(session ?? null)
    .lean()) as unknown as StandingSnapshot[];
  assertLegacyStandingsAreZero(standings, teamsByKey);

  const targetEntryCount = await TournamentEntry.countDocuments({
    tournamentId,
  }).session(session ?? null);
  const targetRosterCount = await TournamentRosterEntry.countDocuments({
    tournamentId,
  }).session(session ?? null);
  const drawCount = await CompetitionDraw.countDocuments({
    tournamentId,
  }).session(session ?? null);
  const bracketCount = await CompetitionBracket.countDocuments({
    tournamentId,
  }).session(session ?? null);
  const operationCount = await CompetitionOperation.countDocuments({
    tournamentId,
  }).session(session ?? null);
  const playerStatsCount = await PlayerStats.countDocuments({
    tournamentId,
  }).session(session ?? null);
  if (
    targetEntryCount !== 0 ||
    targetRosterCount !== 0 ||
    drawCount !== 0 ||
    bracketCount !== 0 ||
    operationCount !== 0 ||
    playerStatsCount !== 0
  ) {
    throw new Error(
      "Migration refused: tournament entries, roster snapshots, draws, bracket, operations, or player statistics already exist.",
    );
  }

  if (FIXED_V2_COMPETITION_RULES.drawMode !== CompetitionDrawMode.MANUAL) {
    throw new Error(
      "Migration refused: deployed v2 rules are not configured for a physical manual draw.",
    );
  }

  return {
    tournament,
    teamsByKey,
    venuesByKey,
    players,
    rosterPlayerCount: players.length,
  };
};

const applyMigration = async (
  inspection: MigrationInspection,
  session: ClientSession,
  backupReference: Official2026SafeBackupReference,
): Promise<{
  rosterPlayerCount: number;
  tournamentStatus: TournamentStatus;
}> => {
  const { tournament, teamsByKey, venuesByKey, players } = inspection;
  const tournamentId = tournament._id;
  const nextWorkflowRevision = (tournament.workflowRevision ?? 0) + 1;
  const nextEntryRevision = (tournament.entryIdentityRevision ?? 0) + 1;
  const nextRosterRevision = (tournament.rosterIdentityRevision ?? 0) + 1;
  const nextStandingsRevision = (tournament.standingsRevision ?? 0) + 1;
  const migratedAt = new Date();

  const fencedTeams = await fenceTeamLifecycles(
    [...teamsByKey.values()].map(({ document }) => document._id),
    session,
    { registrationStatus: "registered" },
  );
  if ([...fencedTeams.values()].some((team) => !team)) {
    throw new Error(
      "A target team changed while lifecycle fences were acquired.",
    );
  }

  const entryIdByTeamKey = new Map<Official2026TeamKey, Types.ObjectId>(
    OFFICIAL_2026_TEAMS.map((team) => [team.key, new Types.ObjectId()]),
  );
  const entryDocs = OFFICIAL_2026_TEAMS.map((definition) => {
    const resolved = teamsByKey.get(definition.key)!;
    const fenced = fencedTeams.get(resolved.document._id.toString())!;
    return {
      _id: entryIdByTeamKey.get(definition.key)!,
      tournamentId,
      teamId: resolved.document._id,
      status: TournamentEntryStatus.ACTIVE,
      source: TournamentEntrySource.LEGACY_IMPORT,
      groupKey: definition.groupKey,
      groupSlot: definition.groupSlot,
      teamNameSnapshot: fenced!.name,
      ...(fenced!.logo ? { teamLogoSnapshot: fenced!.logo } : {}),
      isDeleted: false,
    };
  });

  const rosterRows = buildTournamentRosterSnapshotRows(
    tournamentId.toString(),
    nextRosterRevision,
    OFFICIAL_2026_TEAMS.map((definition) => ({
      id: entryIdByTeamKey.get(definition.key)!.toString(),
      teamId: teamsByKey.get(definition.key)!.document._id.toString(),
    })),
    players.map((player) => ({
      id: player._id.toString(),
      teamId: player.teamId.toString(),
      name: player.name,
      position: player.position,
      jerseyNumber: player.jerseyNumber,
      nationality: player.nationality,
      ...(player.passportPic ? { photo: player.passportPic } : {}),
    })),
    migratedAt,
  );
  const publicationPlan = buildOfficial2026MigrationPublicationPlan({
    startDate: tournament.startDate,
    migratedAt,
    nextWorkflowRevision,
    nextEntryRevision,
    nextRosterRevision,
    nextStandingsRevision,
    rosterPlayerCount: rosterRows.length,
    backupReference,
  });

  const deletedMatches = await Match.deleteMany({ tournamentId }, { session });
  if (deletedMatches.deletedCount !== EXPECTED_LEGACY_FIXTURE_COUNT) {
    throw new Error(
      "Legacy fixture deletion count changed inside the transaction.",
    );
  }
  const deletedStandings = await Standings.deleteMany(
    { tournamentId },
    { session },
  );
  if (deletedStandings.deletedCount !== EXPECTED_LEGACY_STANDING_COUNT) {
    throw new Error(
      "Legacy standings deletion count changed inside the transaction.",
    );
  }

  for (const { definition, document, renameRequired } of venuesByKey.values()) {
    if (!renameRequired) continue;
    const result = await Venue.updateOne(
      {
        _id: document._id,
        name: document.name,
        isDeleted: false,
        __v: document.__v ?? 0,
      },
      { $set: { name: definition.documentName }, $inc: { __v: 1 } },
      { session, runValidators: true },
    );
    if (result.modifiedCount !== 1) {
      throw new Error(`Venue ${document.name} changed concurrently.`);
    }
  }
  await fenceActiveVenueNames(
    OFFICIAL_2026_FIXTURES.flatMap((fixture) =>
      fixture.venueName ? [fixture.venueName] : [],
    ),
    session,
  );

  await TournamentEntry.insertMany(entryDocs, { session, ordered: true });
  if (players.length > 0) {
    const rosterLock = await Player.bulkWrite(
      players.map((player) => {
        const revision = player.competitionRosterRevision ?? 0;
        return {
          updateOne: {
            filter: {
              _id: player._id,
              teamId: player.teamId,
              isDeleted: false,
              $or:
                revision === 0
                  ? [
                      { competitionRosterRevision: 0 },
                      { competitionRosterRevision: { $exists: false } },
                    ]
                  : [{ competitionRosterRevision: revision }],
            },
            update: { $inc: { competitionRosterRevision: 1 } },
          },
        };
      }),
      { session },
    );
    if (rosterLock.modifiedCount !== players.length) {
      throw new Error(
        "A player changed while the official roster snapshot was captured.",
      );
    }
    await TournamentRosterEntry.insertMany(rosterRows, {
      session,
      ordered: true,
    });
  }

  await Standings.insertMany(
    OFFICIAL_2026_TEAMS.map((definition) => ({
      tournamentId,
      tournamentEntryId: entryIdByTeamKey.get(definition.key)!,
      teamId: teamsByKey.get(definition.key)!.document._id,
      groupKey: definition.groupKey,
      revision: nextStandingsRevision,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      fairPlayPoints: 0,
    })),
    { session, ordered: true },
  );

  await Match.insertMany(
    OFFICIAL_2026_FIXTURES.map((fixture) => {
      const homeTeam = teamsByKey.get(fixture.homeTeamKey)!.document;
      const awayTeam = teamsByKey.get(fixture.awayTeamKey)!.document;
      return {
        tournamentId,
        homeTeam: homeTeam._id,
        awayTeam: awayTeam._id,
        homeScore: 0,
        awayScore: 0,
        status: MatchStatus.SCHEDULED,
        stage: MatchStage.GROUP_STAGE,
        groupKey: fixture.groupKey,
        leg: 1,
        fixtureKey: `${tournamentId.toString()}:group_stage:official:${fixture.officialNumber}`,
        scheduleStatus:
          fixture.scheduleStatus === "confirmed"
            ? MatchScheduleStatus.CONFIRMED
            : MatchScheduleStatus.PENDING,
        officialFixtureNumber: fixture.officialNumber,
        fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
        fixturePublicationHash: OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
        fixtureSourceReference: `docx-sha256:${OFFICIAL_2026_SOURCE_SHA256}`,
        fixturePublishedAt: migratedAt,
        ...(fixture.kickoffAt ? { date: new Date(fixture.kickoffAt) } : {}),
        ...(fixture.venueName ? { venue: fixture.venueName } : {}),
        events: [],
        isDeleted: false,
      };
    }),
    { session, ordered: true },
  );

  const tournamentUpdate = await Tournament.updateOne(
    buildOfficial2026LegacyTournamentCasFilter(tournamentId, tournament),
    {
      $set: publicationPlan.tournamentSet,
      $inc: { __v: 1 },
    },
    { session, runValidators: true },
  );
  if (tournamentUpdate.modifiedCount !== 1) {
    throw new Error(
      "Tournament changed concurrently while the migration was applied.",
    );
  }

  await CompetitionOperation.create(
    [
      {
        tournamentId,
        operation: MIGRATION_OPERATION,
        idempotencyKey: `v1:${OFFICIAL_2026_SOURCE_SHA256}`,
        requestHash: OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
        status: CompetitionOperationStatus.COMPLETED,
        result: publicationPlan.auditResult,
      },
    ],
    { session },
  );

  return {
    rosterPlayerCount: rosterRows.length,
    tournamentStatus: publicationPlan.status,
  };
};

const printPlan = (
  inspection: MigrationInspection,
  databaseName: string,
): void => {
  console.log(`Connected database: ${databaseName}`);
  console.log(
    `Target tournament: ${inspection.tournament.name} (${inspection.tournament._id.toString()})`,
  );
  console.log(
    `Pinned source: sha256=${OFFICIAL_2026_SOURCE_SHA256}, bytes=${OFFICIAL_2026_SOURCE_BYTE_LENGTH}`,
  );
  console.log(
    `Fixture publication hash: ${OFFICIAL_2026_FIXTURE_PUBLICATION_HASH}`,
  );
  console.table(
    OFFICIAL_2026_TEAMS.map((team) => ({
      group: team.groupKey,
      sourcePot: team.sourcePot,
      groupSlot: team.groupSlot,
      databaseTeam: inspection.teamsByKey.get(team.key)!.document.name,
    })),
  );
  console.table(
    OFFICIAL_2026_VENUES.map((venue) => {
      const resolved = inspection.venuesByKey.get(venue.key)!;
      return {
        currentVenue: resolved.document.name,
        officialVenue: venue.documentName,
        action: resolved.renameRequired ? "rename" : "keep",
      };
    }),
  );
  console.log(
    `Plan verified: replace 42 untouched legacy fixtures and 14 zero standings; create 14 entries, ${inspection.rosterPlayerCount} roster snapshots, 14 zero group standings, and 42 physical official fixtures (41 confirmed, 1 pending).`,
  );
};

const verifyCommittedMigration = async (
  tournamentId: Types.ObjectId,
  expectedRosterCount: number,
  expectedTournamentStatus: TournamentStatus,
  expectedBackupReference: Official2026SafeBackupReference,
): Promise<void> => {
  const storedMatches = (await Match.find({ tournamentId })
    .select(
      "homeTeam awayTeam homeScore awayScore date venue status stage groupKey leg fixtureKey scheduleStatus officialFixtureNumber fixtureSource fixturePublicationHash fixtureSourceReference fixturePublishedAt events isDeleted drawId bracketId bracketNodeKey winner resultLockedAt",
    )
    .sort({ officialFixtureNumber: 1, _id: 1 })
    .lean()) as unknown as Official2026CommittedMatchLike[];
  const storedEntries = (await TournamentEntry.find({ tournamentId })
    .select("teamId groupKey groupSlot status isDeleted")
    .lean()) as unknown as Array<{
    teamId: Types.ObjectId;
    groupKey?: string;
    groupSlot?: number;
    status: TournamentEntryStatus;
    isDeleted: boolean;
  }>;
  if (
    storedEntries.length !== OFFICIAL_2026_TEAMS.length ||
    new Set(storedEntries.map((entry) => entry.teamId.toString())).size !==
      OFFICIAL_2026_TEAMS.length ||
    storedEntries.some(
      (entry) =>
        entry.status !== TournamentEntryStatus.ACTIVE || entry.isDeleted !== false,
    )
  ) {
    throw new Error(
      "Post-commit tournament entries do not match the approved 14-team inventory.",
    );
  }
  const teamIdsByKey = new Map<Official2026TeamKey, string>();
  for (const definition of OFFICIAL_2026_TEAMS) {
    const entry = storedEntries.find(
      (candidate) =>
        candidate.groupKey === definition.groupKey &&
        candidate.groupSlot === definition.groupSlot,
    );
    if (!entry) {
      throw new Error(
        "Post-commit tournament entries do not preserve the pinned group slots.",
      );
    }
    teamIdsByKey.set(definition.key, entry.teamId.toString());
  }

  const marker = (await CompetitionOperation.findOne({
    tournamentId,
    operation: MIGRATION_OPERATION,
    requestHash: OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
    status: CompetitionOperationStatus.COMPLETED,
  }).lean()) as unknown as
    | {
        result?: {
          migratedAt?: Date | string;
          tournamentStatus?: TournamentStatus;
          backupReference?: Official2026SafeBackupReference;
          fixtureCount?: number;
          confirmedFixtureCount?: number;
          pendingFixtureCount?: number;
          sourceSha256?: string;
          fixturePublicationHash?: string;
        };
      }
    | null;
  const operationCount = await CompetitionOperation.countDocuments({ tournamentId });
  const markerMigratedAt = marker?.result?.migratedAt
    ? new Date(marker.result.migratedAt)
    : new Date(Number.NaN);
  if (
    operationCount !== 1 ||
    !marker ||
    Number.isNaN(markerMigratedAt.getTime()) ||
    marker.result?.tournamentStatus !== expectedTournamentStatus ||
    marker.result?.fixtureCount !== 42 ||
    marker.result?.confirmedFixtureCount !== 41 ||
    marker.result?.pendingFixtureCount !== 1 ||
    marker.result?.sourceSha256 !== OFFICIAL_2026_SOURCE_SHA256 ||
    marker.result?.fixturePublicationHash !==
      OFFICIAL_2026_FIXTURE_PUBLICATION_HASH ||
    marker.result?.backupReference?.basename !==
      expectedBackupReference.basename ||
    marker.result?.backupReference?.sha256 !== expectedBackupReference.sha256
  ) {
    throw new Error(
      "Post-commit audit marker does not match the approved migration and backup reference.",
    );
  }
  assertOfficial2026CommittedMatchesMatchManifest(
    tournamentId.toString(),
    storedMatches,
    teamIdsByKey,
    markerMigratedAt,
  );

  const rosterCount = await TournamentRosterEntry.countDocuments({
    tournamentId,
  });
  const standingCount = await Standings.countDocuments({ tournamentId });
  const tournamentCount = await Tournament.countDocuments({
    _id: tournamentId,
    formatVersion: 2,
    format: TournamentFormat.TWO_GROUP_KNOCKOUT,
    workflowState: CompetitionWorkflowState.GROUP_STAGE,
    currentStage: MatchStage.GROUP_STAGE,
    fixturesGenerated: true,
    leagueRounds: 7,
    scheduleRevision: 0,
    status: expectedTournamentStatus,
    "competitionRules.drawMode": CompetitionDrawMode.MANUAL,
    "competitionRules.thirdPlaceMatch": false,
  });
  if (
    rosterCount !== expectedRosterCount ||
    standingCount !== 14 ||
    tournamentCount !== 1
  ) {
    throw new Error(
      "Post-commit migration verification did not match the approved manifest.",
    );
  }
};

const sanitizeErrorMessage = (error: unknown): string => {
  const raw =
    error instanceof Error ? error.message : "Unknown migration error";
  const uri = process.env.MONGODB_URI;
  const withoutExactUri = uri
    ? raw.replaceAll(uri, "[redacted MongoDB URI]")
    : raw;
  return withoutExactUri.replace(
    /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
    "mongodb://[redacted]@",
  );
};

const run = async (): Promise<void> => {
  const options = parseOptions();
  const tournamentId = requireTournamentId(options);
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. No database connection was attempted.",
    );
  }

  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  const database = mongoose.connection.db;
  if (!database)
    throw new Error("MongoDB connected without an available database handle.");

  const inspection = await inspectMigrationTarget(tournamentId);
  printPlan(inspection, database.databaseName);
  if (!options.execute) {
    console.log(
      `Dry run only: no records changed. After a verified backup, rerun with --execute, exact database/tournament confirmations, and --confirm=${MIGRATION_CONFIRMATION}.`,
    );
    return;
  }

  assertExecutionAuthorized(
    options,
    database.databaseName,
    inspection.tournament,
  );
  const safeBackupReference = buildOfficial2026SafeBackupReference(
    options.backupReference!,
    options.backupSha256!,
  );
  const session = await mongoose.startSession();
  let result:
    | { rosterPlayerCount: number; tournamentStatus: TournamentStatus }
    | undefined;
  try {
    result = await session.withTransaction(
      async () => {
        const transactionInspection = await inspectMigrationTarget(
          tournamentId,
          session,
        );
        if (
          transactionInspection.tournament.name !== inspection.tournament.name
        ) {
          throw new Error("Tournament name changed after the approved plan.");
        }
        return applyMigration(
          transactionInspection,
          session,
          safeBackupReference,
        );
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      },
    );
  } finally {
    await session.endSession();
  }
  if (!result)
    throw new Error(
      "MongoDB transaction completed without a migration result.",
    );

  await verifyCommittedMigration(
    tournamentId,
    result.rosterPlayerCount,
    result.tournamentStatus,
    safeBackupReference,
  );
  console.log(
    `Migration committed and verified: 42 official fixtures, 14 entries, 14 zero standings, ${result.rosterPlayerCount} roster snapshots, and one immutable audit marker.`,
  );
};

run()
  .catch((error: unknown) => {
    console.error(
      `Official 2026 migration stopped: ${sanitizeErrorMessage(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
