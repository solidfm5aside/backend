import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import dotenv from "dotenv";
import mongoose, { ClientSession, Types } from "mongoose";

import {
  assertOfficialWomensFixtureManifestIntegrity,
  OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY,
  OFFICIAL_WOMENS_FIXTURE_INPUTS,
  OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH,
  OFFICIAL_WOMENS_EXPECTED_PLAN_HASH,
  OFFICIAL_WOMENS_FIXTURE_SOURCE,
  OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE,
  OFFICIAL_WOMENS_FIXTURE_TEAMS,
  OFFICIAL_WOMENS_NORMALIZED_FIXTURES,
  OFFICIAL_WOMENS_RAW_FIXTURE_ROWS,
} from "@/data/official-womens-fixture-manifest";
import Admin, { AdminRole } from "@/models/admin.model";
import CompetitionBracket from "@/models/competition-bracket.model";
import CompetitionDraw from "@/models/competition-draw.model";
import CompetitionOperation, {
  CompetitionOperationStatus,
} from "@/models/competition-operation.model";
import { CompetitionDivision } from "@/models/competition-division";
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
import TournamentEntry from "@/models/tournament-entry.model";
import TournamentRosterEntry from "@/models/tournament-roster-entry.model";
import Tournament, {
  CompetitionWorkflowState,
  FIXED_WOMENS_COMPETITION_RULES,
  TournamentFormat,
  TournamentStatus,
} from "@/models/tournament.model";
import Venue from "@/models/venue.model";
import WomensCompetitionFinal, {
  WomensFinalStatus,
} from "@/models/womens-competition-final.model";
import {
  previewWomensLeagueFixtures,
  publishWomensLeagueFixturesInSession,
  WomensLeaguePublicationResult,
} from "@/services/womens-competition.service";
import {
  assertOfficialWomensConversionInventory,
  OFFICIAL_MENS_TOURNAMENT_ID,
  OFFICIAL_WOMENS_ENTRY_TARGETS,
  OFFICIAL_WOMENS_TOURNAMENT_ID,
  OFFICIAL_WOMENS_TOURNAMENT_IDENTITY,
  OfficialWomensConversionInventory,
  OfficialWomensTeamInventoryRow,
  OfficialWomensTournamentResourceCounts,
  RawOfficialWomensEntry,
  RawOfficialWomensTeam,
  RawOfficialWomensTournament,
  VerifiedBackupEvidence,
} from "@/utils/official-womens-conversion.util";
import {
  assertOfficialWomensCommittedMatchesMatchManifest,
  assertOfficialWomensImmutablePublishedMatchIdentity,
  assertOfficialWomensImportConfirmationHashes,
  assertOfficialWomensSourceEvidence,
  assertOfficialWomensStableIdempotencyIdentity,
  buildOfficialWomensImportBackupEvidence,
  hashOfficialWomensImportEvidence,
  OfficialWomensCommittedMatchLike,
  OfficialWomensSourceEvidence,
} from "@/utils/official-womens-fixture-import.util";
import { competitionLocalCalendarDay } from "@/utils/official-fixture.util";

dotenv.config();

const IMPORT_OPERATION = "import_official_womens_league_fixtures";
const IMPORT_CONFIRMATION = "IMPORT-OFFICIAL-WOMENS-2026-FIXTURES";
const EXPECTED_WORKFLOW_REVISION = 4;
const POST_PUBLICATION_WORKFLOW_REVISION = 5;
const MEN_STATE_HASH_ALGORITHM =
  "sha256:canonical-json-v1:official-men-tournament-scope";
const SHA256_HEX = /^[a-f0-9]{64}$/;
const MEN_STATE_COUNT_KEYS = Object.freeze([
  "tournament",
  "entries",
  "matches",
  "rosters",
  "standings",
  "operations",
  "draws",
  "brackets",
  "playerStats",
  "womensFinals",
  "teams",
  "players",
] as const);

interface ImportOptions {
  execute: boolean;
  sourceFile?: string;
  publisherAdminId?: string;
  confirmedPublisherAdminId?: string;
  confirmedDatabase?: string;
  confirmedTournament?: string;
  confirmedTournamentName?: string;
  confirmedSourceSha256?: string;
  confirmedInventorySha256?: string;
  confirmedMensSha256?: string;
  confirmedPlanSha256?: string;
  confirmation?: string;
  backupArtifact?: string;
  backupSha256?: string;
}

interface PublisherEvidence {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  isVerified: boolean;
  isDeleted: boolean;
}

interface MensStateEvidence {
  tournamentId: string;
  algorithm: string;
  sha256: string;
  counts: Record<string, number>;
}

interface WomensImportReceipt {
  importerVersion: 1;
  operation: typeof IMPORT_OPERATION;
  idempotencyKey: string;
  fixtureManifestHash: string;
  source: OfficialWomensSourceEvidence;
  sourceReference: string;
  databaseName: string;
  tournamentId: string;
  tournamentName: string;
  publisher: Pick<PublisherEvidence, "id" | "name" | "email" | "role">;
  backup: VerifiedBackupEvidence;
  approvedInventorySha256: string;
  planHash: string;
  publication: WomensLeaguePublicationResult;
  rosterSnapshot: {
    count: number;
    rowIds: string[];
    playerIds: string[];
    strictSha256: string;
    immutableSha256: string;
  };
  publishedAt: Date;
  mensStateBefore: MensStateEvidence;
  mensStateAfter: MensStateEvidence;
}

interface ImportInspection {
  mode: "ready" | "already_published";
  conversionInventory: OfficialWomensConversionInventory;
  publisher: PublisherEvidence;
  rosterCounts: Array<{
    entryId: string;
    teamId: string;
    teamName: string;
    activePlayerCount: number;
  }>;
  inventorySha256: string;
  planHash: string;
  receipt?: WomensImportReceipt;
  currentPublishedFixtures?: Array<{
    officialNumber?: number;
    status?: string;
    scheduleStatus?: string;
    kickoffAt: string | null;
    venue: string | null;
    homeScore?: number;
    awayScore?: number;
    eventCount: number;
  }>;
}

const readOption = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
};

const parseOptions = (): ImportOptions => ({
  execute: process.argv.includes("--execute"),
  sourceFile: readOption("source-file"),
  publisherAdminId: readOption("publisher-admin-id"),
  confirmedPublisherAdminId: readOption("confirm-publisher-admin-id"),
  confirmedDatabase: readOption("confirm-db"),
  confirmedTournament: readOption("confirm-tournament"),
  confirmedTournamentName: readOption("confirm-tournament-name"),
  confirmedSourceSha256: readOption("confirm-source-sha256")?.toLowerCase(),
  confirmedInventorySha256: readOption(
    "confirm-inventory-sha256",
  )?.toLowerCase(),
  confirmedMensSha256: readOption("confirm-men-sha256")?.toLowerCase(),
  confirmedPlanSha256: readOption("confirm-plan-sha256")?.toLowerCase(),
  confirmation: readOption("confirm"),
  backupArtifact: readOption("backup-artifact"),
  backupSha256: readOption("backup-sha256"),
});

const queryOptions = (session?: ClientSession) =>
  session ? { session } : undefined;

const tournamentProjection = {
  _id: 1,
  name: 1,
  season: 1,
  startDate: 1,
  endDate: 1,
  status: 1,
  division: 1,
  currentStage: 1,
  leagueRounds: 1,
  fixturesGenerated: 1,
  formatVersion: 1,
  format: 1,
  workflowState: 1,
  workflowRevision: 1,
  entryIdentityRevision: 1,
  rosterIdentityRevision: 1,
  standingsRevision: 1,
  scheduleRevision: 1,
  competitionRules: 1,
  competitionTieResolutions: 1,
  qualificationSnapshot: 1,
  qualificationFinalizedAt: 1,
  championTeamId: 1,
  runnerUpTeamId: 1,
  thirdPlaceTeamId: 1,
  competitionCompletedAt: 1,
  isDeleted: 1,
  createdAt: 1,
  updatedAt: 1,
  __v: 1,
} as const;

const teamProjection = {
  _id: 1,
  name: 1,
  registrationStatus: 1,
  division: 1,
  lifecycleRevision: 1,
  isDeleted: 1,
  createdAt: 1,
  updatedAt: 1,
  __v: 1,
} as const;

const entryProjection = {
  _id: 1,
  tournamentId: 1,
  teamId: 1,
  status: 1,
  source: 1,
  groupKey: 1,
  groupSlot: 1,
  teamNameSnapshot: 1,
  teamLogoSnapshot: 1,
  createdBy: 1,
  isDeleted: 1,
  createdAt: 1,
  updatedAt: 1,
  __v: 1,
} as const;

const sortedDocuments = async (
  collection: mongoose.mongo.Collection,
  filter: mongoose.mongo.Filter<mongoose.mongo.Document>,
  session?: ClientSession,
  projection?: mongoose.mongo.Document,
): Promise<mongoose.mongo.WithId<mongoose.mongo.Document>[]> =>
  collection
    .find(filter, {
      ...queryOptions(session),
      ...(projection ? { projection } : {}),
    })
    .sort({ _id: 1 })
    .toArray();

const readSourceEvidence = async (
  sourceFile?: string,
): Promise<OfficialWomensSourceEvidence> => {
  if (!sourceFile) {
    throw new Error(
      `Pass --source-file=<path-to-${OFFICIAL_WOMENS_FIXTURE_SOURCE.fileName}>; the importer never trusts a filename alone.`,
    );
  }
  const sourceStat = await stat(sourceFile);
  if (!sourceStat.isFile())
    throw new Error("The supplied women fixture source is not a file.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(sourceFile)) hash.update(chunk);
  return assertOfficialWomensSourceEvidence({
    fileName: basename(sourceFile),
    byteLength: sourceStat.size,
    sha256: hash.digest("hex"),
  });
};

const loadTournament = async (
  session?: ClientSession,
): Promise<RawOfficialWomensTournament | undefined> => {
  const value = await Tournament.collection.findOne(
    { _id: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID) },
    { ...queryOptions(session), projection: tournamentProjection },
  );
  return value as unknown as RawOfficialWomensTournament | undefined;
};

const loadEntries = async (
  session?: ClientSession,
): Promise<RawOfficialWomensEntry[]> =>
  TournamentEntry.collection
    .find(
      { tournamentId: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID) },
      { ...queryOptions(session), projection: entryProjection },
    )
    .sort({ createdAt: 1, _id: 1 })
    .toArray() as unknown as Promise<RawOfficialWomensEntry[]>;

const loadRawTeams = async (
  session?: ClientSession,
): Promise<RawOfficialWomensTeam[]> =>
  Team.collection
    .find(
      {
        _id: {
          $in: OFFICIAL_WOMENS_ENTRY_TARGETS.map(
            ({ teamId }) => new Types.ObjectId(teamId),
          ),
        },
      },
      { ...queryOptions(session), projection: teamProjection },
    )
    .sort({ _id: 1 })
    .toArray() as unknown as Promise<RawOfficialWomensTeam[]>;

const countTeamDependencies = async (
  teamId: string,
  session?: ClientSession,
): Promise<{ playerCount: number; tournamentEntryCount: number }> => {
  const objectId = new Types.ObjectId(teamId);
  return {
    playerCount: await Player.collection.countDocuments(
      { teamId: objectId },
      queryOptions(session),
    ),
    tournamentEntryCount: await TournamentEntry.collection.countDocuments(
      { teamId: objectId },
      queryOptions(session),
    ),
  };
};

const countTournamentResources = async (
  session?: ClientSession,
): Promise<OfficialWomensTournamentResourceCounts> => {
  const filter = {
    tournamentId: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID),
  };
  return {
    entries: await TournamentEntry.collection.countDocuments(
      filter,
      queryOptions(session),
    ),
    matches: await Match.collection.countDocuments(
      filter,
      queryOptions(session),
    ),
    standings: await Standings.collection.countDocuments(
      filter,
      queryOptions(session),
    ),
    rosters: await TournamentRosterEntry.collection.countDocuments(
      filter,
      queryOptions(session),
    ),
    draws: await CompetitionDraw.collection.countDocuments(
      filter,
      queryOptions(session),
    ),
    brackets: await CompetitionBracket.collection.countDocuments(
      filter,
      queryOptions(session),
    ),
    operations: await CompetitionOperation.collection.countDocuments(
      filter,
      queryOptions(session),
    ),
    playerStats: await PlayerStats.collection.countDocuments(
      filter,
      queryOptions(session),
    ),
    womensFinals: await WomensCompetitionFinal.collection.countDocuments(
      filter,
      queryOptions(session),
    ),
  };
};

const inspectConversionInventory = async (
  session?: ClientSession,
): Promise<OfficialWomensConversionInventory> => {
  const tournament = await loadTournament(session);
  const entries = await loadEntries(session);
  const rawTeams = await loadRawTeams(session);
  const teamsById = new Map(rawTeams.map((team) => [String(team._id), team]));
  const teams: OfficialWomensTeamInventoryRow[] = [];
  for (const target of OFFICIAL_WOMENS_ENTRY_TARGETS) {
    teams.push({
      id: target.teamId,
      expectedName: target.teamName,
      found: teamsById.has(target.teamId),
      raw: teamsById.get(target.teamId),
      ...(await countTeamDependencies(target.teamId, session)),
    });
  }
  return {
    tournament,
    entries,
    teams,
    resources: await countTournamentResources(session),
  };
};

const loadPublisher = async (
  publisherAdminId: string | undefined,
  session?: ClientSession,
): Promise<PublisherEvidence> => {
  if (!publisherAdminId || !Types.ObjectId.isValid(publisherAdminId)) {
    throw new Error(
      "Pass --publisher-admin-id=<exact active admin ObjectId> for the audit trail.",
    );
  }
  const query = Admin.findOne({ _id: publisherAdminId })
    .select("name email role isVerified isDeleted")
    .lean();
  if (session) query.session(session);
  const admin = await query;
  if (
    !admin ||
    admin.isDeleted ||
    !admin.isVerified ||
    ![AdminRole.ADMIN, AdminRole.SUPER_ADMIN].includes(admin.role)
  ) {
    throw new Error(
      "The publisher must remain a verified, active admin or super admin.",
    );
  }
  return {
    id: admin._id.toString(),
    name: admin.name,
    email: admin.email,
    role: admin.role,
    isVerified: admin.isVerified,
    isDeleted: admin.isDeleted,
  };
};

const loadRosterCounts = async (
  session?: ClientSession,
): Promise<ImportInspection["rosterCounts"]> => {
  const result: ImportInspection["rosterCounts"] = [];
  for (const team of OFFICIAL_WOMENS_FIXTURE_TEAMS) {
    const activePlayerCount = await Player.collection.countDocuments(
      { teamId: new Types.ObjectId(team.teamId), isDeleted: false },
      queryOptions(session),
    );
    if (activePlayerCount > FIXED_WOMENS_COMPETITION_RULES.maxRosterPlayers) {
      throw new Error(
        `${team.databaseName} exceeds the maximum 10-player women roster.`,
      );
    }
    result.push({
      entryId: team.entryId,
      teamId: team.teamId,
      teamName: team.databaseName,
      activePlayerCount,
    });
  }
  return result;
};

const buildInventoryEvidence = async (
  conversionInventory: OfficialWomensConversionInventory,
  publisher: PublisherEvidence,
  rosterCounts: ImportInspection["rosterCounts"],
  session?: ClientSession,
): Promise<{ sha256: string; evidence: unknown }> => {
  const teamIds = OFFICIAL_WOMENS_FIXTURE_TEAMS.map(
    ({ teamId }) => new Types.ObjectId(teamId),
  );
  const confirmedScheduleProjection = {
    _id: 1,
    tournamentId: 1,
    homeTeam: 1,
    awayTeam: 1,
    date: 1,
    venue: 1,
    scheduleStatus: 1,
    isDeleted: 1,
  };
  const evidence = {
    conversionInventory,
    publisher,
    rosterCounts,
    players: await sortedDocuments(
      Player.collection,
      { teamId: { $in: teamIds } },
      session,
    ),
    tribuVenue: await sortedDocuments(
      Venue.collection,
      { name: "Tribu Arena" },
      session,
    ),
    confirmedSchedules: await sortedDocuments(
      Match.collection,
      {
        isDeleted: false,
        scheduleStatus: MatchScheduleStatus.CONFIRMED,
        date: { $exists: true },
      },
      session,
      confirmedScheduleProjection,
    ),
  };
  return { evidence, sha256: hashOfficialWomensImportEvidence(evidence) };
};

const computeMensStateEvidence = async (
  session?: ClientSession,
): Promise<MensStateEvidence> => {
  const tournamentId = new Types.ObjectId(OFFICIAL_MENS_TOURNAMENT_ID);
  const tournament = await Tournament.collection.findOne(
    { _id: tournamentId },
    queryOptions(session),
  );
  const filter = { tournamentId };
  const entries = await sortedDocuments(
    TournamentEntry.collection,
    filter,
    session,
  );
  if (!tournament || entries.length !== 14) {
    throw new Error(
      "The pinned official men tournament or its 14-entry inventory is missing.",
    );
  }
  const teamIds = [
    ...new Set(entries.map((entry) => String(entry.teamId)).filter(Boolean)),
  ].map((id) => new Types.ObjectId(id));
  const state = {
    tournament,
    entries,
    matches: await sortedDocuments(Match.collection, filter, session),
    rosters: await sortedDocuments(
      TournamentRosterEntry.collection,
      filter,
      session,
    ),
    standings: await sortedDocuments(Standings.collection, filter, session),
    operations: await sortedDocuments(
      CompetitionOperation.collection,
      filter,
      session,
    ),
    draws: await sortedDocuments(CompetitionDraw.collection, filter, session),
    brackets: await sortedDocuments(
      CompetitionBracket.collection,
      filter,
      session,
    ),
    playerStats: await sortedDocuments(PlayerStats.collection, filter, session),
    womensFinals: await sortedDocuments(
      WomensCompetitionFinal.collection,
      filter,
      session,
    ),
    teams: await sortedDocuments(
      Team.collection,
      { _id: { $in: teamIds } },
      session,
    ),
    players: await sortedDocuments(
      Player.collection,
      { teamId: { $in: teamIds } },
      session,
    ),
  };
  const counts = Object.fromEntries(
    Object.entries(state).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.length : value ? 1 : 0,
    ]),
  );
  return {
    tournamentId: OFFICIAL_MENS_TOURNAMENT_ID,
    algorithm: MEN_STATE_HASH_ALGORITHM,
    sha256: hashOfficialWomensImportEvidence(state),
    counts,
  };
};

const assertActiveTribuVenue = (inventoryEvidence: unknown): void => {
  const evidence = inventoryEvidence as {
    tribuVenue?: Array<{ isDeleted?: boolean }>;
  };
  if (
    !Array.isArray(evidence.tribuVenue) ||
    evidence.tribuVenue.length !== 1 ||
    evidence.tribuVenue[0].isDeleted !== false
  ) {
    throw new Error(
      "The exact active Tribu Arena venue identity is required for all three fixtures.",
    );
  }
};

const assertNoGlobalScheduleCollisionsReadOnly = async (): Promise<void> => {
  const existingMatches = await Match.find({
    isDeleted: false,
    scheduleStatus: MatchScheduleStatus.CONFIRMED,
    date: { $exists: true },
  })
    .select("homeTeam awayTeam date venue")
    .lean();
  for (const fixture of OFFICIAL_WOMENS_NORMALIZED_FIXTURES) {
    const kickoff = new Date(fixture.kickoffAt);
    const localDay = competitionLocalCalendarDay(
      kickoff,
      OFFICIAL_WOMENS_FIXTURE_SOURCE.timeZone,
    );
    const participantIds = new Set<string>([
      fixture.homeTeamId,
      fixture.awayTeamId,
    ]);
    for (const existing of existingMatches) {
      if (!existing.date) continue;
      if (
        existing.venue?.trim().toLocaleLowerCase() ===
          fixture.venue.toLocaleLowerCase() &&
        existing.date.getTime() === kickoff.getTime()
      ) {
        throw new Error(
          `Fixture ${fixture.officialNumber} conflicts with an existing match at ${fixture.venue}.`,
        );
      }
      if (
        (participantIds.has(existing.homeTeam.toString()) ||
          participantIds.has(existing.awayTeam.toString())) &&
        competitionLocalCalendarDay(
          existing.date,
          OFFICIAL_WOMENS_FIXTURE_SOURCE.timeZone,
        ) === localDay
      ) {
        throw new Error(
          `Fixture ${fixture.officialNumber} conflicts with another match for the same team on ${localDay}.`,
        );
      }
    }
  }
};

const receiptFilter = {
  tournamentId: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID),
  operation: IMPORT_OPERATION,
  idempotencyKey: OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY,
};

const loadImportOperation = async (session?: ClientSession) => {
  const query = CompetitionOperation.findOne(receiptFilter).lean();
  if (session) query.session(session);
  return query;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const objectIdString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value)
    return String(value);
  return "";
};

const validDateValue = (value: unknown): Date | undefined => {
  if (
    !(value instanceof Date) &&
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const isExactMensCountEvidence = (
  value: unknown,
): value is Record<string, number> => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...MEN_STATE_COUNT_KEYS].sort();
  return (
    JSON.stringify(keys) === JSON.stringify(expectedKeys) &&
    keys.every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isInteger(value[key]) &&
        value[key] >= 0,
    ) &&
    value.tournament === 1 &&
    value.entries === 14 &&
    value.teams === 14
  );
};

const isMensStateEvidence = (value: unknown): value is MensStateEvidence =>
  isRecord(value) &&
  value.tournamentId === OFFICIAL_MENS_TOURNAMENT_ID &&
  value.algorithm === MEN_STATE_HASH_ALGORITHM &&
  typeof value.sha256 === "string" &&
  SHA256_HEX.test(value.sha256) &&
  isExactMensCountEvidence(value.counts);

export const assertReceiptIdentity = (
  operation: Awaited<ReturnType<typeof loadImportOperation>>,
  expectedDatabaseName: string,
): WomensImportReceipt => {
  const rawReceipt = operation?.result;
  if (
    !operation ||
    objectIdString(operation.tournamentId) !== OFFICIAL_WOMENS_TOURNAMENT_ID ||
    operation.operation !== IMPORT_OPERATION ||
    operation.idempotencyKey !== OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY ||
    operation.status !== CompetitionOperationStatus.COMPLETED ||
    operation.requestHash !== OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH ||
    !isRecord(rawReceipt)
  ) {
    throw new Error(
      "The existing women fixture import receipt is incomplete or does not match.",
    );
  }
  const rawSource = rawReceipt.source;
  const rawPublisher = rawReceipt.publisher;
  const rawBackup = rawReceipt.backup;
  const rawPublication = rawReceipt.publication;
  const rawRosterSnapshot = rawReceipt.rosterSnapshot;
  if (
    !isRecord(rawSource) ||
    !isRecord(rawPublisher) ||
    !isRecord(rawBackup) ||
    !isRecord(rawPublication) ||
    !isRecord(rawRosterSnapshot) ||
    typeof rawSource.fileName !== "string" ||
    typeof rawSource.sha256 !== "string" ||
    typeof rawSource.byteLength !== "number" ||
    typeof rawPublisher.id !== "string" ||
    typeof rawPublisher.name !== "string" ||
    typeof rawPublisher.email !== "string" ||
    typeof rawPublisher.role !== "string" ||
    typeof rawBackup.artifact !== "string" ||
    typeof rawBackup.sha256 !== "string" ||
    typeof rawReceipt.approvedInventorySha256 !== "string" ||
    typeof rawReceipt.planHash !== "string" ||
    typeof rawPublication.planHash !== "string" ||
    typeof rawRosterSnapshot.strictSha256 !== "string" ||
    typeof rawRosterSnapshot.immutableSha256 !== "string" ||
    !isMensStateEvidence(rawReceipt.mensStateBefore) ||
    !isMensStateEvidence(rawReceipt.mensStateAfter)
  ) {
    throw new Error(
      "The existing women fixture import receipt is incomplete or does not match.",
    );
  }
  const receipt = rawReceipt as unknown as WomensImportReceipt;
  let normalizedBackup: VerifiedBackupEvidence | undefined;
  try {
    normalizedBackup = buildOfficialWomensImportBackupEvidence(
      receipt.backup.artifact,
      receipt.backup.sha256,
    );
  } catch {
    normalizedBackup = undefined;
  }
  const publishedAt = validDateValue(receipt.publishedAt);
  const mensCountsMatch =
    hashOfficialWomensImportEvidence(receipt.mensStateBefore.counts) ===
    hashOfficialWomensImportEvidence(receipt.mensStateAfter.counts);
  if (
    receipt.importerVersion !== 1 ||
    receipt.operation !== IMPORT_OPERATION ||
    receipt.idempotencyKey !== OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY ||
    receipt.fixtureManifestHash !== OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH ||
    receipt.source?.fileName !== OFFICIAL_WOMENS_FIXTURE_SOURCE.fileName ||
    receipt.source?.sha256 !== OFFICIAL_WOMENS_FIXTURE_SOURCE.sha256 ||
    receipt.source?.byteLength !== OFFICIAL_WOMENS_FIXTURE_SOURCE.byteLength ||
    receipt.sourceReference !== OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE ||
    receipt.databaseName !== expectedDatabaseName ||
    receipt.tournamentId !== OFFICIAL_WOMENS_TOURNAMENT_ID ||
    receipt.tournamentName !== OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.name ||
    !Types.ObjectId.isValid(receipt.publisher.id) ||
    !receipt.publisher.name?.trim() ||
    !receipt.publisher.email?.trim() ||
    ![AdminRole.ADMIN, AdminRole.SUPER_ADMIN].includes(
      receipt.publisher.role,
    ) ||
    receipt.planHash !== OFFICIAL_WOMENS_EXPECTED_PLAN_HASH ||
    receipt.publication.planHash !== receipt.planHash ||
    receipt.publication.tournamentId !== OFFICIAL_WOMENS_TOURNAMENT_ID ||
    receipt.publication.workflowRevision !==
      POST_PUBLICATION_WORKFLOW_REVISION ||
    receipt.publication.fixtureCount !== 3 ||
    receipt.publication.confirmedCount !== 3 ||
    receipt.publication.pendingCount !== 0 ||
    !Number.isInteger(receipt.rosterSnapshot.count) ||
    receipt.rosterSnapshot.count < 0 ||
    receipt.rosterSnapshot.count > 30 ||
    receipt.publication.rosterPlayerCount !== receipt.rosterSnapshot.count ||
    !Array.isArray(receipt.rosterSnapshot.rowIds) ||
    receipt.rosterSnapshot.rowIds.length !== receipt.rosterSnapshot.count ||
    new Set(receipt.rosterSnapshot.rowIds).size !==
      receipt.rosterSnapshot.rowIds.length ||
    receipt.rosterSnapshot.rowIds.some(
      (id) => typeof id !== "string" || !Types.ObjectId.isValid(id),
    ) ||
    !Array.isArray(receipt.rosterSnapshot.playerIds) ||
    receipt.rosterSnapshot.playerIds.length !== receipt.rosterSnapshot.count ||
    new Set(receipt.rosterSnapshot.playerIds).size !==
      receipt.rosterSnapshot.playerIds.length ||
    receipt.rosterSnapshot.playerIds.some(
      (id) => typeof id !== "string" || !Types.ObjectId.isValid(id),
    ) ||
    !SHA256_HEX.test(receipt.rosterSnapshot.strictSha256) ||
    !SHA256_HEX.test(receipt.rosterSnapshot.immutableSha256) ||
    !SHA256_HEX.test(receipt.approvedInventorySha256) ||
    !publishedAt ||
    !normalizedBackup ||
    receipt.backup.artifact !== normalizedBackup.artifact ||
    receipt.backup.sha256 !== normalizedBackup.sha256 ||
    receipt.mensStateBefore.sha256 !== receipt.mensStateAfter.sha256 ||
    !mensCountsMatch
  ) {
    throw new Error(
      "The existing women fixture import receipt is incomplete or does not match.",
    );
  }
  return receipt;
};

const inspectImportTarget = async (
  publisherAdminId: string | undefined,
  databaseName: string,
  session?: ClientSession,
): Promise<ImportInspection> => {
  const conversionInventory = await inspectConversionInventory(session);
  const publisher = await loadPublisher(publisherAdminId, session);
  const rosterCounts = await loadRosterCounts(session);
  const inventory = await buildInventoryEvidence(
    conversionInventory,
    publisher,
    rosterCounts,
    session,
  );
  const operation = await loadImportOperation(session);
  if (conversionInventory.resources.matches === 0 && !operation) {
    assertActiveTribuVenue(inventory.evidence);
    const converted =
      assertOfficialWomensConversionInventory(conversionInventory);
    if (!converted) {
      throw new Error(
        "Convert the audited women tournament to format v3 before importing fixtures.",
      );
    }
    return {
      mode: "ready",
      conversionInventory,
      publisher,
      rosterCounts,
      inventorySha256: inventory.sha256,
      planHash: "",
    };
  }

  if (!operation) {
    throw new Error(
      "Women competition resources exist without the exact completed fixture-import receipt.",
    );
  }
  const receipt = assertReceiptIdentity(operation, databaseName);
  const currentPublishedFixtures = (await loadCommittedMatches(session)).map(
    (match) => {
      const kickoff = match.date ? new Date(match.date) : null;
      return {
        officialNumber: match.officialFixtureNumber,
        status: match.status,
        scheduleStatus: match.scheduleStatus,
        kickoffAt:
          kickoff && !Number.isNaN(kickoff.getTime())
            ? kickoff.toISOString()
            : null,
        venue: match.venue ?? null,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        eventCount: Array.isArray(match.events) ? match.events.length : 0,
      };
    },
  );
  return {
    mode: "already_published",
    conversionInventory,
    publisher,
    rosterCounts,
    inventorySha256: inventory.sha256,
    planHash: receipt.planHash,
    receipt,
    currentPublishedFixtures,
  };
};

const loadCommittedMatches = async (
  session?: ClientSession,
): Promise<OfficialWomensCommittedMatchLike[]> => {
  const query = Match.find({
    tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
    stage: MatchStage.LEAGUE,
  })
    .select(
      "homeTeam awayTeam homeScore awayScore date venue scheduleStatus status stage round groupKey leg fixtureKey officialFixtureNumber fixtureSource fixturePublicationHash fixtureSourceReference fixturePublishedBy fixturePublishedAt events isDeleted drawId bracketId bracketNodeKey womensFinalId winner",
    )
    .sort({ officialFixtureNumber: 1, _id: 1 })
    .lean();
  if (session) query.session(session);
  return (await query) as unknown as OfficialWomensCommittedMatchLike[];
};

const loadRosterSnapshotEvidence = async (
  session?: ClientSession,
  exactRowIds?: string[],
) => {
  const rows = await sortedDocuments(
    TournamentRosterEntry.collection,
    {
      tournamentId: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID),
      ...(exactRowIds
        ? { _id: { $in: exactRowIds.map((id) => new Types.ObjectId(id)) } }
        : {}),
    },
    session,
  );
  const immutableRows = rows.map((row) => ({
    _id: row._id,
    tournamentId: row.tournamentId,
    tournamentEntryId: row.tournamentEntryId,
    teamId: row.teamId,
    playerId: row.playerId,
    publicationRevision: row.publicationRevision,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
  }));
  return {
    count: rows.length,
    rowIds: rows.map((row) => String(row._id)),
    playerIds: rows.map((row) => String(row.playerId)),
    strictSha256: hashOfficialWomensImportEvidence(rows),
    immutableSha256: hashOfficialWomensImportEvidence(immutableRows),
  };
};

const assertEvolvedWomensPublicationInvariants = async (
  inventory: OfficialWomensConversionInventory,
  receipt: WomensImportReceipt,
  session?: ClientSession,
): Promise<void> => {
  const tournament = inventory.tournament;
  const allowedWorkflowStates = new Set<CompetitionWorkflowState>([
    CompetitionWorkflowState.GROUP_STAGE,
    CompetitionWorkflowState.QUALIFICATION_FINALIZED,
    CompetitionWorkflowState.KNOCKOUT_STAGE,
    CompetitionWorkflowState.COMPLETED,
  ]);
  if (
    !tournament ||
    String(tournament._id) !== OFFICIAL_WOMENS_TOURNAMENT_ID ||
    !tournament.name?.trim() ||
    !tournament.season?.trim() ||
    !(tournament.startDate instanceof Date) ||
    tournament.startDate.toISOString() !==
      OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.startDate ||
    !(tournament.endDate instanceof Date) ||
    tournament.endDate.toISOString() !==
      OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.endDate ||
    tournament.formatVersion !== 3 ||
    tournament.format !== TournamentFormat.SINGLE_TABLE_FINAL ||
    tournament.division !== CompetitionDivision.WOMEN ||
    !tournament.workflowState ||
    !allowedWorkflowStates.has(tournament.workflowState) ||
    !Number.isInteger(tournament.workflowRevision) ||
    (tournament.workflowRevision ?? -1) < POST_PUBLICATION_WORKFLOW_REVISION ||
    !Number.isInteger(tournament.standingsRevision) ||
    (tournament.standingsRevision ?? -1) < POST_PUBLICATION_WORKFLOW_REVISION ||
    !Number.isInteger(tournament.scheduleRevision) ||
    (tournament.scheduleRevision ?? -1) < 1 ||
    tournament.fixturesGenerated !== true ||
    tournament.leagueRounds !== 3 ||
    ![
      TournamentStatus.UPCOMING,
      TournamentStatus.ONGOING,
      TournamentStatus.COMPLETED,
    ].includes(tournament.status as TournamentStatus) ||
    hashOfficialWomensImportEvidence(tournament.competitionRules) !==
      hashOfficialWomensImportEvidence(FIXED_WOMENS_COMPETITION_RULES) ||
    tournament.thirdPlaceTeamId != null ||
    tournament.isDeleted !== false
  ) {
    throw new Error(
      "The evolved women tournament no longer retains its immutable v3 identity.",
    );
  }

  const entriesById = new Map(
    inventory.entries.map((entry) => [String(entry._id), entry]),
  );
  if (inventory.entries.length !== 3 || entriesById.size !== 3) {
    throw new Error(
      "The evolved women tournament no longer has its exact three pinned entries.",
    );
  }
  for (const target of OFFICIAL_WOMENS_ENTRY_TARGETS) {
    const entry = entriesById.get(target.entryId);
    if (
      !entry ||
      String(entry.tournamentId) !== OFFICIAL_WOMENS_TOURNAMENT_ID ||
      String(entry.teamId) !== target.teamId ||
      entry.status !== "active" ||
      entry.source !== "admin" ||
      entry.groupKey !== "A" ||
      entry.groupSlot !== target.tableSlot ||
      String(entry.createdBy) !== target.createdBy ||
      entry.isDeleted !== false
    ) {
      throw new Error(
        `The evolved women entry ${target.entryId} lost its pinned identity.`,
      );
    }
  }

  const teamsById = new Map(inventory.teams.map((row) => [row.id, row.raw]));
  for (const target of OFFICIAL_WOMENS_ENTRY_TARGETS) {
    const team = teamsById.get(target.teamId);
    if (
      !team ||
      String(team._id) !== target.teamId ||
      !team.name?.trim() ||
      team.registrationStatus !== "registered" ||
      team.division !== CompetitionDivision.WOMEN ||
      team.isDeleted !== false
    ) {
      throw new Error(
        `The evolved women team ${target.teamId} lost its pinned identity.`,
      );
    }
  }

  const standingsQuery = Standings.find({
    tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
  })
    .select("tournamentEntryId teamId groupKey revision")
    .lean();
  if (session) standingsQuery.session(session);
  const standings = await standingsQuery;
  const standingByTeamId = new Map(
    standings.map((row) => [row.teamId.toString(), row]),
  );
  if (standings.length !== 3 || standingByTeamId.size !== 3) {
    throw new Error(
      "The evolved women tournament no longer has exactly three standings rows.",
    );
  }
  for (const target of OFFICIAL_WOMENS_ENTRY_TARGETS) {
    const row = standingByTeamId.get(target.teamId);
    if (
      !row ||
      row.tournamentEntryId?.toString() !== target.entryId ||
      row.groupKey != null ||
      !Number.isInteger(row.revision) ||
      row.revision < POST_PUBLICATION_WORKFLOW_REVISION
    ) {
      throw new Error(
        `The evolved women standing for ${target.teamId} lost its pinned identity.`,
      );
    }
  }

  const resources = inventory.resources;
  if (
    resources.entries !== 3 ||
    resources.matches < 3 ||
    resources.matches > 4 ||
    resources.standings !== 3 ||
    resources.rosters < receipt.rosterSnapshot.count ||
    resources.rosters > 30 ||
    resources.draws !== 0 ||
    resources.brackets !== 0 ||
    resources.operations < 1 ||
    resources.womensFinals > 1
  ) {
    throw new Error(
      "The evolved women resource inventory violates the single-table/final format.",
    );
  }

  const nonLeagueMatchQuery = Match.find({
    tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
    stage: { $ne: MatchStage.LEAGUE },
  })
    .select(
      "tournamentId homeTeam awayTeam date venue scheduleStatus status stage round groupKey leg fixtureKey officialFixtureNumber fixtureSource fixturePublicationHash fixtureSourceReference fixturePublishedBy fixturePublishedAt isDeleted drawId bracketId bracketNodeKey womensFinalId winner",
    )
    .sort({ _id: 1 })
    .lean();
  const finalStateQuery = WomensCompetitionFinal.find({
    tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
  })
    .sort({ _id: 1 })
    .lean();
  if (session) {
    nonLeagueMatchQuery.session(session);
    finalStateQuery.session(session);
  }
  // MongoDB does not support parallel operations on one transaction session.
  const nonLeagueMatches = await nonLeagueMatchQuery;
  const finalStates = await finalStateQuery;
  if (
    nonLeagueMatches.length !== resources.matches - 3 ||
    finalStates.length !== resources.womensFinals
  ) {
    throw new Error(
      "The evolved women final resources do not match their counted inventory.",
    );
  }

  const normalizeQualifiers = (
    value: unknown,
    label: string,
  ): Array<{ rank: 1 | 2; tournamentEntryId: string; teamId: string }> => {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error(
        `${label} must contain the exact rank-1 and rank-2 qualifiers.`,
      );
    }
    const qualifiers = value
      .map((candidate) => {
        if (
          !isRecord(candidate) ||
          (candidate.rank !== 1 && candidate.rank !== 2)
        ) {
          throw new Error(`${label} contains an invalid qualification rank.`);
        }
        const rank: 1 | 2 = candidate.rank;
        const tournamentEntryId = objectIdString(candidate.tournamentEntryId);
        const teamId = objectIdString(candidate.teamId);
        const target = OFFICIAL_WOMENS_ENTRY_TARGETS.find(
          (entry) =>
            entry.entryId === tournamentEntryId && entry.teamId === teamId,
        );
        if (!target)
          throw new Error(
            `${label} contains an unpinned women entry/team identity.`,
          );
        return { rank, tournamentEntryId, teamId };
      })
      .sort((left, right) => left.rank - right.rank);
    if (
      qualifiers[0].rank !== 1 ||
      qualifiers[1].rank !== 2 ||
      qualifiers[0].tournamentEntryId === qualifiers[1].tournamentEntryId ||
      qualifiers[0].teamId === qualifiers[1].teamId
    ) {
      throw new Error(
        `${label} does not identify two distinct ordered qualifiers.`,
      );
    }
    return qualifiers;
  };

  const workflowState = tournament.workflowState!;
  if (
    workflowState === CompetitionWorkflowState.GROUP_STAGE ||
    workflowState === CompetitionWorkflowState.QUALIFICATION_FINALIZED
  ) {
    const expectedStage =
      workflowState === CompetitionWorkflowState.GROUP_STAGE
        ? MatchStage.LEAGUE
        : MatchStage.FINAL;
    if (
      tournament.currentStage !== expectedStage ||
      tournament.status === TournamentStatus.COMPLETED ||
      nonLeagueMatches.length !== 0 ||
      finalStates.length !== 0 ||
      resources.matches !== 3 ||
      resources.womensFinals !== 0
    ) {
      throw new Error(
        "The evolved pre-final women workflow/resources are incoherent.",
      );
    }
    if (
      tournament.championTeamId != null ||
      tournament.runnerUpTeamId != null ||
      tournament.competitionCompletedAt != null
    ) {
      throw new Error(
        "The women tournament records a champion before its final is completed.",
      );
    }
    if (workflowState === CompetitionWorkflowState.GROUP_STAGE) {
      if (
        !Array.isArray(tournament.qualificationSnapshot) ||
        tournament.qualificationSnapshot.length !== 0 ||
        tournament.qualificationFinalizedAt != null
      ) {
        throw new Error(
          "The women qualification snapshot exists before qualification is finalized.",
        );
      }
    } else {
      normalizeQualifiers(
        tournament.qualificationSnapshot,
        "The women qualification snapshot",
      );
      if (!validDateValue(tournament.qualificationFinalizedAt)) {
        throw new Error(
          "The finalized women qualification timestamp is missing or invalid.",
        );
      }
    }
    return;
  }

  if (
    ![
      CompetitionWorkflowState.KNOCKOUT_STAGE,
      CompetitionWorkflowState.COMPLETED,
    ].includes(workflowState) ||
    tournament.currentStage !== MatchStage.FINAL ||
    nonLeagueMatches.length !== 1 ||
    finalStates.length !== 1 ||
    resources.matches !== 4 ||
    resources.womensFinals !== 1
  ) {
    throw new Error(
      "The evolved women final workflow/resources are incoherent.",
    );
  }

  const finalState = finalStates[0];
  const finalMatch = nonLeagueMatches[0];
  const snapshotQualifiers = normalizeQualifiers(
    tournament.qualificationSnapshot,
    "The women qualification snapshot",
  );
  if (!validDateValue(tournament.qualificationFinalizedAt)) {
    throw new Error(
      "The women final is missing its qualification-finalized timestamp.",
    );
  }
  const finalQualifiers = normalizeQualifiers(
    finalState.qualifiers,
    "The durable women final qualifiers",
  );
  const finalPublishedAt = validDateValue(finalState.publishedAt);
  const matchPublishedAt = validDateValue(finalMatch.fixturePublishedAt);
  const finalPublisherId = objectIdString(finalState.publishedBy);
  const matchPublisherId = objectIdString(finalMatch.fixturePublishedBy);
  if (
    hashOfficialWomensImportEvidence(finalQualifiers) !==
      hashOfficialWomensImportEvidence(snapshotQualifiers) ||
    objectIdString(finalState.tournamentId) !== OFFICIAL_WOMENS_TOURNAMENT_ID ||
    objectIdString(finalMatch.tournamentId) !== OFFICIAL_WOMENS_TOURNAMENT_ID ||
    objectIdString(finalState.matchId) !== objectIdString(finalMatch._id) ||
    objectIdString(finalMatch.womensFinalId) !==
      objectIdString(finalState._id) ||
    objectIdString(finalMatch.homeTeam) !== finalQualifiers[0].teamId ||
    objectIdString(finalMatch.awayTeam) !== finalQualifiers[1].teamId ||
    finalMatch.stage !== MatchStage.FINAL ||
    finalMatch.groupKey != null ||
    finalMatch.leg !== 1 ||
    finalMatch.officialFixtureNumber !== 4 ||
    finalMatch.fixtureKey !==
      `${OFFICIAL_WOMENS_TOURNAMENT_ID}:final:official:4` ||
    finalMatch.fixtureSource !== MatchFixtureSource.PHYSICAL_OFFICIAL ||
    typeof finalState.planHash !== "string" ||
    !SHA256_HEX.test(finalState.planHash) ||
    finalMatch.fixturePublicationHash !== finalState.planHash ||
    (finalState.sourceReference ?? null) !==
      (finalMatch.fixtureSourceReference ?? null) ||
    !finalPublishedAt ||
    !matchPublishedAt ||
    finalPublishedAt.getTime() !== matchPublishedAt.getTime() ||
    finalPublisherId !== matchPublisherId ||
    finalMatch.isDeleted !== false ||
    finalMatch.drawId != null ||
    finalMatch.bracketId != null ||
    finalMatch.bracketNodeKey != null ||
    !Number.isInteger(finalState.revision) ||
    finalState.revision !== tournament.workflowRevision ||
    !Number.isInteger(finalState.qualificationRevision) ||
    finalState.qualificationRevision < POST_PUBLICATION_WORKFLOW_REVISION ||
    finalState.qualificationRevision >= finalState.revision
  ) {
    throw new Error(
      "The durable women final no longer matches its rank-1/rank-2 identity.",
    );
  }

  if (workflowState === CompetitionWorkflowState.KNOCKOUT_STAGE) {
    if (
      tournament.status !== TournamentStatus.ONGOING ||
      finalState.status !== WomensFinalStatus.PUBLISHED ||
      tournament.championTeamId != null ||
      tournament.runnerUpTeamId != null ||
      tournament.competitionCompletedAt != null ||
      finalState.championTeamId != null ||
      finalState.runnerUpTeamId != null ||
      finalState.championDecidedAt != null
    ) {
      throw new Error(
        "The published women final workflow status is incoherent.",
      );
    }
    return;
  }

  const championTeamId = objectIdString(finalState.championTeamId);
  const runnerUpTeamId = objectIdString(finalState.runnerUpTeamId);
  const competitionCompletedAt = validDateValue(
    tournament.competitionCompletedAt,
  );
  const championDecidedAt = validDateValue(finalState.championDecidedAt);
  if (
    tournament.status !== TournamentStatus.COMPLETED ||
    finalState.status !== WomensFinalStatus.CHAMPION_DECIDED ||
    finalMatch.status !== MatchStatus.COMPLETED ||
    !championTeamId ||
    !runnerUpTeamId ||
    championTeamId === runnerUpTeamId ||
    championTeamId !== objectIdString(tournament.championTeamId) ||
    runnerUpTeamId !== objectIdString(tournament.runnerUpTeamId) ||
    objectIdString(finalMatch.winner) !== championTeamId ||
    !competitionCompletedAt ||
    !championDecidedAt ||
    competitionCompletedAt.getTime() !== championDecidedAt.getTime() ||
    !finalQualifiers.some((qualifier) => qualifier.teamId === championTeamId) ||
    !finalQualifiers.some((qualifier) => qualifier.teamId === runnerUpTeamId)
  ) {
    throw new Error("The completed women final/champion state is incoherent.");
  }
};

const verifyImmutablePublicationHistory = async (
  receipt: WomensImportReceipt,
  session?: ClientSession,
): Promise<void> => {
  const evolvedInventory = await inspectConversionInventory(session);
  await assertEvolvedWomensPublicationInvariants(
    evolvedInventory,
    receipt,
    session,
  );
  const matches = await loadCommittedMatches(session);
  const matchEvidence = assertOfficialWomensImmutablePublishedMatchIdentity(
    OFFICIAL_WOMENS_TOURNAMENT_ID,
    matches,
    receipt.planHash,
    receipt.publisher.id,
  );
  if (
    matchEvidence.publishedAt.getTime() !==
    new Date(receipt.publishedAt).getTime()
  ) {
    throw new Error(
      "Historical fixture publication time no longer matches the receipt.",
    );
  }
  const originalRosterSnapshot = await loadRosterSnapshotEvidence(
    session,
    receipt.rosterSnapshot.rowIds,
  );
  if (
    originalRosterSnapshot.count !== receipt.rosterSnapshot.count ||
    originalRosterSnapshot.immutableSha256 !==
      receipt.rosterSnapshot.immutableSha256 ||
    JSON.stringify(originalRosterSnapshot.rowIds) !==
      JSON.stringify(receipt.rosterSnapshot.rowIds) ||
    JSON.stringify(originalRosterSnapshot.playerIds) !==
      JSON.stringify(receipt.rosterSnapshot.playerIds)
  ) {
    throw new Error(
      "The immutable original roster snapshot no longer matches the receipt.",
    );
  }
  const operation = await loadImportOperation(session);
  assertReceiptIdentity(operation, receipt.databaseName);
};

const verifyExactInitialPublication = async (
  receipt: WomensImportReceipt,
  session?: ClientSession,
): Promise<void> => {
  const matches = await loadCommittedMatches(session);
  const matchEvidence = assertOfficialWomensCommittedMatchesMatchManifest(
    OFFICIAL_WOMENS_TOURNAMENT_ID,
    matches,
    receipt.planHash,
    receipt.publisher.id,
  );
  if (
    matchEvidence.publishedAt.getTime() !==
    new Date(receipt.publishedAt).getTime()
  ) {
    throw new Error(
      "The receipt publication time does not match the committed fixtures.",
    );
  }

  const standingsQuery = Standings.find({
    tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
  })
    .sort({ teamId: 1 })
    .lean();
  if (session) standingsQuery.session(session);
  const standings = await standingsQuery;
  if (standings.length !== 3) {
    throw new Error(
      "Post-publication verification requires exactly three women standings rows.",
    );
  }
  const expectedEntries = new Map<string, string>(
    OFFICIAL_WOMENS_FIXTURE_TEAMS.map((team) => [team.teamId, team.entryId]),
  );
  if (
    standings.some(
      (row) =>
        expectedEntries.get(row.teamId.toString()) !==
          row.tournamentEntryId?.toString() ||
        row.groupKey != null ||
        row.rank != null ||
        row.revision !== POST_PUBLICATION_WORKFLOW_REVISION ||
        row.played !== 0 ||
        row.won !== 0 ||
        row.drawn !== 0 ||
        row.lost !== 0 ||
        row.goalsFor !== 0 ||
        row.goalsAgainst !== 0 ||
        row.goalDifference !== 0 ||
        row.points !== 0 ||
        row.fairPlayPoints !== 0,
    )
  ) {
    throw new Error(
      "Post-publication women standings do not match the zero-table manifest.",
    );
  }

  const rosterSnapshot = await loadRosterSnapshotEvidence(session);
  if (
    rosterSnapshot.count !== receipt.rosterSnapshot.count ||
    rosterSnapshot.strictSha256 !== receipt.rosterSnapshot.strictSha256 ||
    rosterSnapshot.immutableSha256 !== receipt.rosterSnapshot.immutableSha256 ||
    JSON.stringify(rosterSnapshot.rowIds) !==
      JSON.stringify(receipt.rosterSnapshot.rowIds) ||
    JSON.stringify(rosterSnapshot.playerIds) !==
      JSON.stringify(receipt.rosterSnapshot.playerIds)
  ) {
    throw new Error(
      "The exact committed women roster snapshot does not match the receipt.",
    );
  }

  const emptyResourceCounts = [
    await CompetitionDraw.collection.countDocuments(
      { tournamentId: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID) },
      queryOptions(session),
    ),
    await CompetitionBracket.collection.countDocuments(
      { tournamentId: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID) },
      queryOptions(session),
    ),
    await WomensCompetitionFinal.collection.countDocuments(
      { tournamentId: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID) },
      queryOptions(session),
    ),
    await PlayerStats.collection.countDocuments(
      { tournamentId: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID) },
      queryOptions(session),
    ),
  ];
  if (emptyResourceCounts.some((count) => count !== 0)) {
    throw new Error(
      "Fixture import unexpectedly created draw, bracket, final, or stats resources.",
    );
  }

  const tournamentQuery = Tournament.findOne({
    _id: OFFICIAL_WOMENS_TOURNAMENT_ID,
    formatVersion: 3,
    format: TournamentFormat.SINGLE_TABLE_FINAL,
    division: CompetitionDivision.WOMEN,
    workflowState: CompetitionWorkflowState.GROUP_STAGE,
    workflowRevision: POST_PUBLICATION_WORKFLOW_REVISION,
    currentStage: MatchStage.LEAGUE,
    fixturesGenerated: true,
    leagueRounds: 3,
    standingsRevision: POST_PUBLICATION_WORKFLOW_REVISION,
    scheduleRevision: 1,
    status: { $in: [TournamentStatus.UPCOMING, TournamentStatus.ONGOING] },
    isDeleted: false,
  });
  if (session) tournamentQuery.session(session);
  if (!(await tournamentQuery)) {
    throw new Error(
      "The women tournament did not reach the exact post-publication workflow state.",
    );
  }

  const operation = await loadImportOperation(session);
  assertReceiptIdentity(operation, receipt.databaseName);
  const operationCount = await CompetitionOperation.collection.countDocuments(
    { tournamentId: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID) },
    queryOptions(session),
  );
  if (operationCount !== 1) {
    throw new Error(
      "Post-publication verification found an unexpected women operation count.",
    );
  }
};

export const assertApprovedInventoryConfirmation = (
  confirmedSha256: string | undefined,
  currentSha256: string,
  historicalApprovedSha256?: string,
): void => {
  const confirmed = confirmedSha256?.toLowerCase();
  const accepted = new Set(
    [currentSha256, historicalApprovedSha256]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toLowerCase()),
  );
  if (!SHA256_HEX.test(confirmed ?? "") || !accepted.has(confirmed!)) {
    throw new Error(
      "The confirmed inventory SHA-256 matches neither the fresh state nor the exact original publication receipt.",
    );
  }
};

const authorizeExecution = (
  options: ImportOptions,
  databaseName: string,
  source: OfficialWomensSourceEvidence,
  inspection: ImportInspection,
  mensState: MensStateEvidence,
): VerifiedBackupEvidence => {
  if (process.env.WOMENS_FIXTURE_IMPORT_ALLOW_EXECUTE !== "true") {
    throw new Error(
      "Set WOMENS_FIXTURE_IMPORT_ALLOW_EXECUTE=true for this approved run only.",
    );
  }
  if (process.env.WOMENS_FIXTURE_IMPORT_INVENTORY_VERIFIED !== "true") {
    throw new Error(
      "Set WOMENS_FIXTURE_IMPORT_INVENTORY_VERIFIED=true only after reviewing a fresh dry-run inventory.",
    );
  }
  if (process.env.WOMENS_FIXTURE_IMPORT_ALLOW_PRODUCTION !== "true") {
    throw new Error(
      "Every execution requires WOMENS_FIXTURE_IMPORT_ALLOW_PRODUCTION=true because the MongoDB URI may target production regardless of NODE_ENV.",
    );
  }
  if (options.confirmedDatabase !== databaseName) {
    throw new Error(`Pass --confirm-db=${databaseName} exactly.`);
  }
  if (options.confirmedTournament !== OFFICIAL_WOMENS_TOURNAMENT_ID) {
    throw new Error(
      `Pass --confirm-tournament=${OFFICIAL_WOMENS_TOURNAMENT_ID} exactly.`,
    );
  }
  if (
    options.confirmedTournamentName !== OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.name
  ) {
    throw new Error(
      `Pass --confirm-tournament-name="${OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.name}" exactly.`,
    );
  }
  if (
    options.confirmedPublisherAdminId !== inspection.publisher.id ||
    options.publisherAdminId !== inspection.publisher.id
  ) {
    throw new Error(
      `Pass --confirm-publisher-admin-id=${inspection.publisher.id} exactly.`,
    );
  }
  if (options.confirmation !== IMPORT_CONFIRMATION) {
    throw new Error(
      `Pass --confirm=${IMPORT_CONFIRMATION} after reviewing the plan.`,
    );
  }
  assertOfficialWomensSourceEvidence(source, options.confirmedSourceSha256);
  assertApprovedInventoryConfirmation(
    options.confirmedInventorySha256,
    inspection.inventorySha256,
    inspection.receipt?.approvedInventorySha256,
  );
  assertOfficialWomensImportConfirmationHashes({
    confirmedInventorySha256: inspection.inventorySha256,
    actualInventorySha256: inspection.inventorySha256,
    confirmedMensSha256: options.confirmedMensSha256,
    actualMensSha256: mensState.sha256,
    confirmedPlanSha256: options.confirmedPlanSha256,
    actualPlanSha256: inspection.planHash,
  });
  if (inspection.mode === "already_published") {
    return inspection.receipt!.backup;
  }
  if (process.env.WOMENS_FIXTURE_IMPORT_BACKUP_VERIFIED !== "true") {
    throw new Error(
      "First publication requires WOMENS_FIXTURE_IMPORT_BACKUP_VERIFIED=true after independently verifying the backup.",
    );
  }
  return buildOfficialWomensImportBackupEvidence(
    options.backupArtifact,
    options.backupSha256,
  );
};

const printPlan = (
  databaseName: string,
  source: OfficialWomensSourceEvidence,
  inspection: ImportInspection,
  mensState: MensStateEvidence,
): void => {
  console.log(`Connected database: ${databaseName}`);
  console.log(
    JSON.stringify(
      {
        mode: inspection.mode,
        source,
        tournament: {
          id: OFFICIAL_WOMENS_TOURNAMENT_ID,
          name: OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.name,
          expectedWorkflowRevision: EXPECTED_WORKFLOW_REVISION,
        },
        currentOperator: inspection.publisher,
        historicalPublisher: inspection.receipt?.publisher ?? null,
        historicalBackup: inspection.receipt?.backup ?? null,
        inventorySha256: inspection.inventorySha256,
        planSha256: inspection.planHash,
        fixtureManifestHash: OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH,
        idempotencyKey: OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY,
        mensState,
        currentWomenState: {
          name: inspection.conversionInventory.tournament?.name,
          season: inspection.conversionInventory.tournament?.season,
          workflowState:
            inspection.conversionInventory.tournament?.workflowState,
          workflowRevision:
            inspection.conversionInventory.tournament?.workflowRevision,
          scheduleRevision:
            inspection.conversionInventory.tournament?.scheduleRevision,
          standingsRevision:
            inspection.conversionInventory.tournament?.standingsRevision,
          resources: inspection.conversionInventory.resources,
        },
      },
      null,
      2,
    ),
  );
  console.table(inspection.rosterCounts);
  if (inspection.rosterCounts.some((row) => row.activePlayerCount === 0)) {
    console.warn(
      "ROSTER NOTICE: one or more teams currently have zero active players. Publication is allowed and records zero snapshots; the women-only late-enrollment/live-start guard controls subsequent eligibility.",
    );
  }
  if (inspection.mode === "already_published") {
    console.warn(
      "IDEMPOTENT REPLAY NOTICE: immutable original publication identity is intact. Current workflow/resource counts and persisted league rows are reported separately and are deliberately not overwritten.",
    );
    console.log("CURRENT PERSISTED WOMEN LEAGUE ROWS (read-only):");
    console.table(inspection.currentPublishedFixtures ?? []);
  }
  console.log(
    "PINNED ORIGINAL OFFICIAL MANIFEST (provenance; not current mutable state):",
  );
  console.table(
    OFFICIAL_WOMENS_NORMALIZED_FIXTURES.map((fixture, index) => ({
      officialNumber: fixture.officialNumber,
      rawFixture: OFFICIAL_WOMENS_RAW_FIXTURE_ROWS[index].fixtureCell,
      rawDate: OFFICIAL_WOMENS_RAW_FIXTURE_ROWS[index].dateCell,
      rawVenue: OFFICIAL_WOMENS_RAW_FIXTURE_ROWS[index].venueCell,
      rawTime: OFFICIAL_WOMENS_RAW_FIXTURE_ROWS[index].timeCell,
      kickoffWAT: `${fixture.localDate} ${fixture.localKickoffTime}`,
      kickoffUtc: fixture.kickoffAt,
      venue: fixture.venue,
    })),
  );
};

const sanitizeErrorMessage = (error: unknown): string => {
  const raw =
    error instanceof Error
      ? error.message
      : "Unknown women fixture import error";
  const uri = process.env.MONGODB_URI;
  const withoutExactUri = uri
    ? raw.replaceAll(uri, "[redacted MongoDB URI]")
    : raw;
  return withoutExactUri.replace(
    /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
    "mongodb://[redacted]@",
  );
};

const isDuplicateKeyError = (error: unknown): boolean =>
  isRecord(error) && error.code === 11000;

const run = async (): Promise<void> => {
  assertOfficialWomensFixtureManifestIntegrity();
  assertOfficialWomensStableIdempotencyIdentity();
  const options = parseOptions();
  const source = await readSourceEvidence(options.sourceFile);
  const uri = process.env.MONGODB_URI;
  if (!uri)
    throw new Error(
      "MONGODB_URI is not set. No database connection was attempted.",
    );

  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  const databaseName = mongoose.connection.db?.databaseName;
  if (!databaseName)
    throw new Error("MongoDB connected without a database name.");

  const inspection = await inspectImportTarget(
    options.publisherAdminId,
    databaseName,
  );
  if (inspection.mode === "ready") {
    await assertNoGlobalScheduleCollisionsReadOnly();
    const plan = await previewWomensLeagueFixtures(
      OFFICIAL_WOMENS_TOURNAMENT_ID,
      {
        expectedRevision: EXPECTED_WORKFLOW_REVISION,
        sourceReference: OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE,
        fixtures: OFFICIAL_WOMENS_FIXTURE_INPUTS.map((fixture) => ({
          ...fixture,
        })),
      },
    );
    inspection.planHash = plan.planHash;
    if (
      plan.planHash !== OFFICIAL_WOMENS_EXPECTED_PLAN_HASH ||
      plan.confirmedCount !== 3 ||
      plan.pendingCount !== 0
    ) {
      throw new Error(
        "The production preview did not match the pinned women plan hash and three confirmed rows.",
      );
    }
  } else {
    await verifyImmutablePublicationHistory(inspection.receipt!);
  }
  const mensState = await computeMensStateEvidence();
  printPlan(databaseName, source, inspection, mensState);

  if (!options.execute) {
    console.log(
      inspection.mode === "ready"
        ? `Dry run only: no records changed. After reviewing the exact source, inventory, plan, publisher, roster counts, men checksum, and verified backup, rerun with --execute and --confirm=${IMPORT_CONFIRMATION}.`
        : `Dry run only: no records changed. This is a verified historical replay; review the current operator, current state, original receipt, and fresh men checksum before an optional verification-only --execute run.`,
    );
    return;
  }

  const backup = authorizeExecution(
    options,
    databaseName,
    source,
    inspection,
    mensState,
  );
  const session = await mongoose.startSession();
  let transactionResult:
    | { receipt: WomensImportReceipt; replayed: boolean; runMensSha256: string }
    | undefined;
  let transactionError: unknown;
  try {
    try {
      transactionResult = await session.withTransaction(
        async () => {
          const transactionMensBefore = await computeMensStateEvidence(session);
          if (transactionMensBefore.sha256 !== options.confirmedMensSha256) {
            throw new Error(
              "The men state changed after authorization; no women write was committed.",
            );
          }

          const transactionInspection = await inspectImportTarget(
            options.publisherAdminId,
            databaseName,
            session,
          );
          if (
            transactionInspection.publisher.id !==
            options.confirmedPublisherAdminId
          ) {
            throw new Error(
              "The approved replay operator changed after authorization.",
            );
          }
          assertApprovedInventoryConfirmation(
            options.confirmedInventorySha256,
            transactionInspection.inventorySha256,
            transactionInspection.receipt?.approvedInventorySha256,
          );

          const existingOperation = await loadImportOperation(session);
          if (existingOperation) {
            if (transactionInspection.mode !== "already_published") {
              throw new Error(
                "An import receipt exists without the exact published fixture state.",
              );
            }
            const existingReceipt = assertReceiptIdentity(
              existingOperation,
              databaseName,
            );
            await verifyImmutablePublicationHistory(existingReceipt, session);
            const transactionMensAfter =
              await computeMensStateEvidence(session);
            if (transactionMensAfter.sha256 !== transactionMensBefore.sha256) {
              throw new Error(
                "The men state changed during idempotent women verification.",
              );
            }
            return {
              receipt: existingReceipt,
              replayed: true,
              runMensSha256: transactionMensBefore.sha256,
            };
          }

          if (transactionInspection.mode !== "ready") {
            throw new Error(
              "The women fixture state is no longer ready for first publication.",
            );
          }

          await CompetitionOperation.create(
            [
              {
                tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
                operation: IMPORT_OPERATION,
                idempotencyKey: OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY,
                requestHash: OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH,
                status: CompetitionOperationStatus.PENDING,
              },
            ],
            { session },
          );

          const publication = await publishWomensLeagueFixturesInSession(
            OFFICIAL_WOMENS_TOURNAMENT_ID,
            {
              expectedRevision: EXPECTED_WORKFLOW_REVISION,
              sourceReference: OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE,
              fixtures: OFFICIAL_WOMENS_FIXTURE_INPUTS.map((fixture) => ({
                ...fixture,
              })),
              planHash: options.confirmedPlanSha256!,
            },
            session,
            transactionInspection.publisher.id,
          );
          const committedMatches = await loadCommittedMatches(session);
          const { publishedAt } =
            assertOfficialWomensCommittedMatchesMatchManifest(
              OFFICIAL_WOMENS_TOURNAMENT_ID,
              committedMatches,
              publication.planHash,
              transactionInspection.publisher.id,
            );
          const rosterSnapshot = await loadRosterSnapshotEvidence(session);
          if (rosterSnapshot.count !== publication.rosterPlayerCount) {
            throw new Error(
              "The new roster snapshot count does not match publication output.",
            );
          }
          const transactionMensAfter = await computeMensStateEvidence(session);
          if (transactionMensAfter.sha256 !== transactionMensBefore.sha256) {
            throw new Error(
              "The men tournament changed inside the women-only transaction.",
            );
          }

          const receipt: WomensImportReceipt = {
            importerVersion: 1,
            operation: IMPORT_OPERATION,
            idempotencyKey: OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY,
            fixtureManifestHash: OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH,
            source,
            sourceReference: OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE,
            databaseName,
            tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
            tournamentName: OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.name,
            publisher: {
              id: transactionInspection.publisher.id,
              name: transactionInspection.publisher.name,
              email: transactionInspection.publisher.email,
              role: transactionInspection.publisher.role,
            },
            backup,
            approvedInventorySha256: transactionInspection.inventorySha256,
            planHash: publication.planHash,
            publication,
            rosterSnapshot,
            publishedAt,
            mensStateBefore: transactionMensBefore,
            mensStateAfter: transactionMensAfter,
          };
          const receiptUpdate = await CompetitionOperation.updateOne(
            receiptFilter,
            {
              $set: {
                status: CompetitionOperationStatus.COMPLETED,
                result: receipt,
              },
            },
            { session },
          );
          if (
            receiptUpdate.matchedCount !== 1 ||
            receiptUpdate.modifiedCount !== 1
          ) {
            throw new Error(
              "The women fixture import receipt could not be completed atomically.",
            );
          }
          await verifyExactInitialPublication(receipt, session);
          return {
            receipt,
            replayed: false,
            runMensSha256: transactionMensBefore.sha256,
          };
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
          readPreference: "primary",
        },
      );
    } catch (error) {
      transactionError = error;
    }
  } finally {
    await session.endSession();
  }
  if (transactionError) {
    if (!isDuplicateKeyError(transactionError)) throw transactionError;
    const convergedInspection = await inspectImportTarget(
      options.publisherAdminId,
      databaseName,
    );
    if (
      convergedInspection.mode !== "already_published" ||
      convergedInspection.publisher.id !== options.confirmedPublisherAdminId ||
      !convergedInspection.receipt
    ) {
      throw transactionError;
    }
    assertApprovedInventoryConfirmation(
      options.confirmedInventorySha256,
      convergedInspection.inventorySha256,
      convergedInspection.receipt.approvedInventorySha256,
    );
    await verifyImmutablePublicationHistory(convergedInspection.receipt);
    const convergedMensState = await computeMensStateEvidence();
    if (convergedMensState.sha256 !== options.confirmedMensSha256) {
      throw new Error(
        "The men state changed while converging an idempotent women import race.",
      );
    }
    transactionResult = {
      receipt: convergedInspection.receipt,
      replayed: true,
      runMensSha256: convergedMensState.sha256,
    };
  }
  if (!transactionResult) {
    throw new Error(
      "MongoDB transaction completed without a women fixture import result.",
    );
  }

  if (transactionResult.replayed) {
    await verifyImmutablePublicationHistory(transactionResult.receipt);
  } else {
    await verifyExactInitialPublication(transactionResult.receipt);
  }
  const postCommitMensState = await computeMensStateEvidence();
  if (postCommitMensState.sha256 !== transactionResult.runMensSha256) {
    throw new Error(
      "Post-commit men checksum no longer matches the guarded transaction receipt.",
    );
  }
  console.log(
    JSON.stringify(
      {
        outcome: transactionResult.replayed
          ? "verified_idempotent_replay"
          : "committed_and_verified",
        receipt: transactionResult.receipt,
        postCommitMensState,
      },
      null,
      2,
    ),
  );
};

if (require.main === module) {
  run()
    .catch((error: unknown) => {
      console.error(
        `Official women fixture import stopped: ${sanitizeErrorMessage(error)}`,
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
