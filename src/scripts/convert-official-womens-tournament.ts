import { createHash } from "crypto";
import dotenv from "dotenv";
import mongoose, { ClientSession, Types } from "mongoose";
import CompetitionBracket from "@/models/competition-bracket.model";
import CompetitionDraw from "@/models/competition-draw.model";
import CompetitionOperation from "@/models/competition-operation.model";
import Match from "@/models/match.model";
import PlayerStats from "@/models/player-stats.model";
import Player from "@/models/player.model";
import Standings from "@/models/standings.model";
import Team from "@/models/team.model";
import TournamentEntry from "@/models/tournament-entry.model";
import TournamentRosterEntry from "@/models/tournament-roster-entry.model";
import Tournament from "@/models/tournament.model";
import WomensCompetitionFinal from "@/models/womens-competition-final.model";
import {
  assertOfficialWomensConversionInventory,
  assertVerifiedBackupEvidence,
  buildOfficialWomensEntryCasFilter,
  buildOfficialWomensTeamCasFilter,
  buildOfficialWomensTournamentCasFilter,
  buildOfficialWomensTournamentUpdate,
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
import { CompetitionDivision } from "@/models/competition-division";

dotenv.config();

interface Options {
  execute: boolean;
  confirmedDatabase?: string;
  confirmedTournament?: string;
  confirmedTournamentName?: string;
  confirmedMensSha256?: string;
  backupArtifact?: string;
  backupSha256?: string;
}

interface MensStateEvidence {
  tournamentId: string;
  algorithm: string;
  sha256: string;
  counts: Record<string, number>;
}

interface TransactionEvidence {
  alreadyConverted: boolean;
  changedTeamIds: string[];
  changedEntryIds: string[];
  tournamentChanged: boolean;
  transactionPreWriteSnapshot: OfficialWomensConversionInventory;
  transactionPostWriteSnapshot: OfficialWomensConversionInventory;
  mensStateBefore: MensStateEvidence;
  mensStateAfter: MensStateEvidence;
}

const readOption = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
};

const parseOptions = (): Options => ({
  execute: process.argv.includes("--execute"),
  confirmedDatabase: readOption("confirm-db"),
  confirmedTournament: readOption("confirm-tournament"),
  confirmedTournamentName: readOption("confirm-tournament-name"),
  confirmedMensSha256: readOption("confirm-men-sha256")?.toLowerCase(),
  backupArtifact: readOption("backup-artifact"),
  backupSha256: readOption("backup-sha256"),
});

const authorizeExecution = (
  options: Options,
  databaseName: string,
): VerifiedBackupEvidence => {
  if (process.env.WOMENS_TOURNAMENT_CONVERSION_ALLOW_EXECUTE !== "true") {
    throw new Error(
      "Set WOMENS_TOURNAMENT_CONVERSION_ALLOW_EXECUTE=true for this one conversion run.",
    );
  }
  if (process.env.WOMENS_TOURNAMENT_CONVERSION_INVENTORY_VERIFIED !== "true") {
    throw new Error(
      "Set WOMENS_TOURNAMENT_CONVERSION_INVENTORY_VERIFIED=true only after reviewing a fresh dry-run inventory.",
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
  if (!/^[a-f0-9]{64}$/.test(options.confirmedMensSha256 ?? "")) {
    throw new Error(
      "Pass --confirm-men-sha256=<exact-dry-run-men-state-sha256>.",
    );
  }
  if (process.env.WOMENS_TOURNAMENT_CONVERSION_BACKUP_VERIFIED !== "true") {
    throw new Error(
      "Execution is blocked until WOMENS_TOURNAMENT_CONVERSION_BACKUP_VERIFIED=true confirms the independent backup was restored or otherwise verified.",
    );
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.WOMENS_TOURNAMENT_CONVERSION_ALLOW_PRODUCTION !== "true"
  ) {
    throw new Error(
      "Production execution is blocked unless WOMENS_TOURNAMENT_CONVERSION_ALLOW_PRODUCTION=true.",
    );
  }
  return assertVerifiedBackupEvidence(
    options.backupArtifact,
    options.backupSha256,
  );
};

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

const loadTournament = async (
  session?: ClientSession,
): Promise<RawOfficialWomensTournament | undefined> => {
  const raw = await Tournament.collection.findOne(
    { _id: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID) },
    { ...queryOptions(session), projection: tournamentProjection },
  );
  return raw as unknown as RawOfficialWomensTournament | undefined;
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
    .toArray() as unknown as Promise<RawOfficialWomensTeam[]>;

const countTeamDependencies = async (
  teamId: string,
  session?: ClientSession,
): Promise<{ playerCount: number; tournamentEntryCount: number }> => {
  const objectId = new Types.ObjectId(teamId);
  const playerCount = await Player.collection.countDocuments(
    { teamId: objectId },
    queryOptions(session),
  );
  const tournamentEntryCount = await TournamentEntry.collection.countDocuments(
    { teamId: objectId },
    queryOptions(session),
  );
  return { playerCount, tournamentEntryCount };
};

const countTournamentResources = async (
  session?: ClientSession,
): Promise<OfficialWomensTournamentResourceCounts> => {
  const tournamentId = new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID);
  const filter = { tournamentId };
  // MongoDB does not support parallel operations on one transaction session.
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

const inspectInventory = async (
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
  const resources = await countTournamentResources(session);
  return { tournament, entries, teams, resources };
};

const canonicalize = (value: unknown): unknown => {
  if (value === undefined) return "__undefined__";
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(canonicalize);
  if ("toHexString" in value && typeof value.toHexString === "function") {
    return value.toHexString();
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
};

const MEN_STATE_HASH_ALGORITHM =
  "sha256:canonical-json-v1:official-men-tournament-scope";

const sortedDocuments = async (
  collection: mongoose.mongo.Collection,
  filter: mongoose.mongo.Filter<mongoose.mongo.Document>,
  session?: ClientSession,
): Promise<mongoose.mongo.WithId<mongoose.mongo.Document>[]> =>
  collection.find(filter, queryOptions(session)).sort({ _id: 1 }).toArray();

/**
 * This checksum is internally pinned by the receipt (before versus after); it
 * intentionally does not claim compatibility with historical ad-hoc hashes.
 */
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
    teams:
      teamIds.length > 0
        ? await sortedDocuments(
            Team.collection,
            { _id: { $in: teamIds } },
            session,
          )
        : [],
    players:
      teamIds.length > 0
        ? await sortedDocuments(
            Player.collection,
            { teamId: { $in: teamIds } },
            session,
          )
        : [],
  };
  const counts = Object.fromEntries(
    Object.entries(state).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.length : value ? 1 : 0,
    ]),
  );
  const serialized = JSON.stringify(canonicalize(state));
  return {
    tournamentId: OFFICIAL_MENS_TOURNAMENT_ID,
    algorithm: MEN_STATE_HASH_ALGORITHM,
    sha256: createHash("sha256").update(serialized).digest("hex"),
    counts,
  };
};

const migrateInsideTransaction = async (
  session: ClientSession,
  migratedAt: Date,
  confirmedMensSha256: string,
): Promise<TransactionEvidence> => {
  const preWrite = await inspectInventory(session);
  const alreadyConverted = assertOfficialWomensConversionInventory(
    preWrite,
    migratedAt,
  );
  const mensStateBefore = await computeMensStateEvidence(session);
  if (mensStateBefore.sha256 !== confirmedMensSha256) {
    throw new Error(
      "Men’s state no longer matches --confirm-men-sha256; the transaction was aborted before any write.",
    );
  }
  const changedTeamIds: string[] = [];
  const changedEntryIds: string[] = [];
  let tournamentChanged = false;

  if (!alreadyConverted) {
    const rawTeams = new Map(preWrite.teams.map((row) => [row.id, row.raw!]));
    for (const target of [...OFFICIAL_WOMENS_ENTRY_TARGETS].sort(
      (left, right) => left.teamId.localeCompare(right.teamId),
    )) {
      const team = rawTeams.get(target.teamId)!;
      const result = await Team.collection.updateOne(
        buildOfficialWomensTeamCasFilter(team),
        {
          $set: { division: CompetitionDivision.WOMEN },
          $inc: { lifecycleRevision: 1 },
        },
        { session },
      );
      if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
        throw new Error(
          `Team ${target.teamId} changed while acquiring its lifecycle fence.`,
        );
      }
      changedTeamIds.push(target.teamId);
    }

    const entriesById = new Map(
      preWrite.entries.map((entry) => [String(entry._id), entry]),
    );
    for (const target of OFFICIAL_WOMENS_ENTRY_TARGETS) {
      const entry = entriesById.get(target.entryId)!;
      const result = await TournamentEntry.collection.updateOne(
        buildOfficialWomensEntryCasFilter(entry),
        {
          $set: { groupKey: "A", groupSlot: target.tableSlot },
          $inc: { __v: 1 },
        },
        { session },
      );
      if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
        throw new Error(
          `Entry ${target.entryId} changed while assigning its table slot.`,
        );
      }
      changedEntryIds.push(target.entryId);
    }

    const tournament = preWrite.tournament!;
    const result = await Tournament.collection.updateOne(
      buildOfficialWomensTournamentCasFilter(tournament),
      {
        ...buildOfficialWomensTournamentUpdate(tournament, migratedAt),
        $inc: { __v: 1 },
      },
      { session },
    );
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
      throw new Error(
        "Tournament changed while acquiring its exact workflow lifecycle fence.",
      );
    }
    tournamentChanged = true;
  }

  const postWrite = await inspectInventory(session);
  if (!assertOfficialWomensConversionInventory(postWrite, migratedAt)) {
    throw new Error(
      "Transaction verification did not reach the exact women’s v3 target state.",
    );
  }
  const mensStateAfter = await computeMensStateEvidence(session);
  if (mensStateBefore.sha256 !== mensStateAfter.sha256) {
    throw new Error(
      "Men’s tournament state changed inside the women-only transaction.",
    );
  }

  return {
    alreadyConverted,
    changedTeamIds,
    changedEntryIds,
    tournamentChanged,
    transactionPreWriteSnapshot: preWrite,
    transactionPostWriteSnapshot: postWrite,
    mensStateBefore,
    mensStateAfter,
  };
};

const printInventorySummary = (
  inventory: OfficialWomensConversionInventory,
): void => {
  const tournament = inventory.tournament;
  console.table([
    {
      tournamentId: tournament ? String(tournament._id) : "(missing)",
      name: tournament?.name,
      season: tournament?.season,
      startDate: tournament?.startDate?.toISOString(),
      endDate: tournament?.endDate?.toISOString(),
      formatVersion: tournament?.formatVersion,
      format: tournament?.format,
      division: tournament?.division ?? "(missing => men)",
      workflowState: tournament?.workflowState,
      workflowRevision: tournament?.workflowRevision,
    },
  ]);
  console.table(
    OFFICIAL_WOMENS_ENTRY_TARGETS.map((target) => {
      const entry = inventory.entries.find(
        (candidate) => String(candidate._id) === target.entryId,
      );
      const team = inventory.teams.find(
        (candidate) => candidate.id === target.teamId,
      );
      return {
        tableSlot: target.tableSlot,
        entryId: target.entryId,
        teamId: target.teamId,
        teamName: target.teamName,
        entryStatus: entry?.status,
        entrySource: entry?.source,
        groupKey: entry?.groupKey ?? "(unassigned)",
        groupSlot: entry?.groupSlot ?? "(unassigned)",
        teamDivision: team?.raw?.division ?? "(missing => men)",
        playerCount: team?.playerCount,
        allTournamentEntriesForTeam: team?.tournamentEntryCount,
      };
    }),
  );
  console.table([inventory.resources]);
};

const run = async (): Promise<void> => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set.");
  const options = parseOptions();
  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  const databaseName = mongoose.connection.db?.databaseName;
  if (!databaseName)
    throw new Error("MongoDB connected without a database name.");

  const dryRunInventory = await inspectInventory();
  console.log(`Connected database: ${databaseName}`);
  printInventorySummary(dryRunInventory);
  const inventoryReadAt = new Date();
  const alreadyConverted = assertOfficialWomensConversionInventory(
    dryRunInventory,
    inventoryReadAt,
  );
  const mensStateBeforeExecution = await computeMensStateEvidence();
  console.log(
    JSON.stringify(
      { readOnlyMensStateEvidence: mensStateBeforeExecution },
      null,
      2,
    ),
  );

  if (!options.execute) {
    console.log(
      alreadyConverted
        ? "Dry run only: the exact women’s v3 tournament is already present; execution would be a verified no-op."
        : "Dry run only: no document was changed. Review this exact inventory and independently verify a restorable backup before execution.",
    );
    return;
  }
  const backup = authorizeExecution(options, databaseName);
  if (mensStateBeforeExecution.sha256 !== options.confirmedMensSha256) {
    throw new Error(
      "Men’s state does not match --confirm-men-sha256; execution was blocked before starting the transaction.",
    );
  }
  const migratedAt = new Date();
  const session = await mongoose.startSession();
  let transactionEvidence: TransactionEvidence | undefined;
  try {
    await session.withTransaction(
      async () => {
        transactionEvidence = await migrateInsideTransaction(
          session,
          migratedAt,
          options.confirmedMensSha256!,
        );
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      },
    );
  } finally {
    await session.endSession();
  }
  if (!transactionEvidence)
    throw new Error("Conversion transaction did not commit.");

  let postCommitSnapshot: OfficialWomensConversionInventory | undefined;
  let mensStateAfterExecution: MensStateEvidence | undefined;
  const postCommitReadErrors: string[] = [];
  let postCommitValidationError: string | undefined;
  try {
    postCommitSnapshot = await inspectInventory();
  } catch (error) {
    postCommitReadErrors.push(
      `Women state read: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
  }
  if (postCommitSnapshot) {
    try {
      if (
        !assertOfficialWomensConversionInventory(postCommitSnapshot, new Date())
      ) {
        postCommitValidationError =
          "Post-commit verification did not find the exact women’s v3 state.";
      }
    } catch (error) {
      postCommitValidationError =
        error instanceof Error
          ? error.message
          : "Unknown post-commit validation failure.";
    }
  }
  try {
    mensStateAfterExecution = await computeMensStateEvidence();
  } catch (error) {
    postCommitReadErrors.push(
      `Men state read: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
  }
  const postCommitMensStateUnchanged =
    mensStateAfterExecution?.sha256 === options.confirmedMensSha256;
  const receipt = {
    receiptType: "official-womens-tournament-v3-conversion",
    receiptVersion: 1,
    databaseName,
    tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
    committedAt: migratedAt.toISOString(),
    backup,
    alreadyConverted: transactionEvidence.alreadyConverted,
    changedTeamIds: transactionEvidence.changedTeamIds,
    changedEntryIds: transactionEvidence.changedEntryIds,
    tournamentChanged: transactionEvidence.tournamentChanged,
    transactionPreWriteSnapshot:
      transactionEvidence.transactionPreWriteSnapshot,
    transactionPostWriteSnapshot:
      transactionEvidence.transactionPostWriteSnapshot,
    postCommitSnapshot: postCommitSnapshot ?? null,
    mensStateEvidence: {
      transactionBefore: transactionEvidence.mensStateBefore,
      transactionAfter: transactionEvidence.mensStateAfter,
      postCommit: mensStateAfterExecution ?? null,
      transactionUnchanged:
        transactionEvidence.mensStateBefore.sha256 ===
        transactionEvidence.mensStateAfter.sha256,
      externalWindowUnchanged:
        Boolean(mensStateAfterExecution) &&
        mensStateBeforeExecution.sha256 === mensStateAfterExecution?.sha256,
    },
    verification: {
      postCommitReadsComplete: postCommitReadErrors.length === 0,
      postCommitReadErrors,
      postCommitTargetStateValid:
        Boolean(postCommitSnapshot) && !postCommitValidationError,
      postCommitTargetStateError:
        postCommitValidationError ??
        (postCommitSnapshot
          ? undefined
          : "Not verified because the post-commit women state read failed."),
      postCommitMensStateUnchanged,
    },
  };
  console.log(JSON.stringify(receipt, null, 2));
  if (postCommitSnapshot) printInventorySummary(postCommitSnapshot);
  if (postCommitReadErrors.length > 0) {
    throw new Error(
      "The conversion transaction committed, but post-commit evidence reads failed. Retain the receipt and inspect live state before any retry.",
    );
  }
  if (postCommitValidationError) {
    throw new Error(postCommitValidationError);
  }
  if (!postCommitMensStateUnchanged) {
    throw new Error(
      "Post-commit men’s state does not match the explicitly confirmed pre-conversion checksum.",
    );
  }
  console.log(
    transactionEvidence.alreadyConverted
      ? "Verified idempotent no-op: the exact women’s v3 state was already present."
      : "Verified women-only conversion: tournament metadata and entry snapshots were preserved; the men’s transaction checksum was unchanged.",
  );
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
