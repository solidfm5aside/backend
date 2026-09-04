import { createHash } from "node:crypto";

import dotenv from "dotenv";
import mongoose, { ClientSession, Types } from "mongoose";

import {
  assertOfficial2026FixtureManifestIntegrity,
  OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
  OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE,
  OFFICIAL_2026_FIXTURES,
  OFFICIAL_2026_MASTER_RESCHEDULE,
  OFFICIAL_2026_SOURCE_BYTE_LENGTH,
  OFFICIAL_2026_SOURCE_SHA256,
  OFFICIAL_2026_TEAMS,
  Official2026TeamKey,
  resolveOfficial2026TeamDefinition,
} from "@/data/official-2026-fixture-manifest";
import CompetitionOperation, {
  CompetitionOperationStatus,
} from "@/models/competition-operation.model";
import Match, {
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from "@/models/match.model";
import Team from "@/models/team.model";
import Tournament, {
  TournamentFormat,
  TournamentStatus,
} from "@/models/tournament.model";
import { fenceTeamLifecycles } from "@/services/team-lifecycle.service";
import { fenceActiveVenueNames } from "@/services/venue-lifecycle.service";
import {
  OFFICIAL_MENS_TOURNAMENT_ID,
  OFFICIAL_WOMENS_TOURNAMENT_ID,
} from "@/utils/official-womens-conversion.util";
import {
  assertOfficial2026RescheduledMatchesMatchManifest,
  buildOfficial2026ReschedulePlan,
  Official2026RescheduleMatchLike,
} from "@/utils/official-2026-reschedule.util";
import { buildOfficial2026SafeBackupReference } from "@/utils/official-2026-migration.util";

dotenv.config();

const RESCHEDULE_OPERATION = "reschedule_official_2026_master_fixtures";
const RESCHEDULE_CONFIRMATION = "APPLY-OFFICIAL-2026-MASTER-RESCHEDULE";
const IDEMPOTENCY_KEY = `master-sheet:${OFFICIAL_2026_FIXTURE_PUBLICATION_HASH}`;

interface RescheduleOptions {
  execute: boolean;
  tournamentId?: string;
  confirmedTournamentId?: string;
  confirmedTournamentName?: string;
  confirmedDatabase?: string;
  confirmation?: string;
  backupReference?: string;
  backupSha256?: string;
}

interface StoredMatch {
  _id: Types.ObjectId;
  __v?: number;
  homeTeam: Types.ObjectId;
  awayTeam: Types.ObjectId;
  homeScore?: number;
  awayScore?: number;
  date?: Date;
  venue?: string;
  status: string;
  stage: string;
  groupKey?: string;
  leg?: number;
  fixtureKey?: string;
  scheduleStatus?: string;
  officialFixtureNumber?: number;
  fixtureSource?: string;
  fixturePublicationHash?: string;
  fixtureSourceReference?: string;
  fixturePublishedAt?: Date;
  events?: unknown[];
  isDeleted?: boolean;
  resultLockedAt?: Date;
  winner?: Types.ObjectId;
}

const readOption = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
};

const parseOptions = (): RescheduleOptions => ({
  execute: process.argv.includes("--execute"),
  tournamentId: readOption("tournament-id"),
  confirmedTournamentId: readOption("confirm-tournament-id"),
  confirmedTournamentName: readOption("confirm-tournament-name"),
  confirmedDatabase: readOption("confirm-db"),
  confirmation: readOption("confirm"),
  backupReference: readOption("backup-reference"),
  backupSha256: readOption("backup-sha256"),
});

const sanitizeErrorMessage = (error: unknown): string => {
  const raw =
    error instanceof Error ? error.message : "Unknown reschedule error";
  const uri = process.env.MONGODB_URI;
  const withoutExactUri = uri
    ? raw.replaceAll(uri, "[redacted MongoDB URI]")
    : raw;
  return withoutExactUri.replace(
    /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
    "mongodb://[redacted]@",
  );
};

const toPlanMatch = (match: StoredMatch): Official2026RescheduleMatchLike => ({
  homeTeam: match.homeTeam.toString(),
  awayTeam: match.awayTeam.toString(),
  homeScore: match.homeScore,
  awayScore: match.awayScore,
  date: match.date,
  venue: match.venue,
  status: match.status,
  stage: match.stage,
  groupKey: match.groupKey,
  leg: match.leg,
  fixtureKey: match.fixtureKey,
  scheduleStatus: match.scheduleStatus,
  officialFixtureNumber: match.officialFixtureNumber,
  fixtureSource: match.fixtureSource,
  fixturePublicationHash: match.fixturePublicationHash,
  fixtureSourceReference: match.fixtureSourceReference,
  fixturePublishedAt: match.fixturePublishedAt,
  events: match.events ?? [],
  isDeleted: match.isDeleted ?? false,
  resultLockedAt: match.resultLockedAt,
  winner: match.winner,
});

const fingerprintMatches = (matches: StoredMatch[]): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        [...matches]
          .map((match) => ({
            id: match._id.toString(),
            officialNumber: match.officialFixtureNumber ?? null,
            status: match.status,
            home: match.homeTeam.toString(),
            away: match.awayTeam.toString(),
            homeScore: match.homeScore ?? 0,
            awayScore: match.awayScore ?? 0,
            date: match.date?.toISOString() ?? null,
            venue: match.venue ?? null,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      ),
    )
    .digest("hex");

const loadGroupMatches = async (
  tournamentId: Types.ObjectId,
  session?: ClientSession,
): Promise<StoredMatch[]> => {
  const query = Match.find({
    tournamentId,
    stage: MatchStage.GROUP_STAGE,
    isDeleted: false,
  }).sort({ officialFixtureNumber: 1, _id: 1 });
  if (session) query.session(session);
  return (await query.lean()) as StoredMatch[];
};

const inspectTarget = async (session?: ClientSession) => {
  assertOfficial2026FixtureManifestIntegrity();
  const tournamentQuery = Tournament.findOne({
    _id: OFFICIAL_MENS_TOURNAMENT_ID,
    isDeleted: false,
  });
  if (session) tournamentQuery.session(session);
  const tournament = await tournamentQuery.lean();
  if (!tournament) {
    throw new Error("The pinned men's 2026 tournament was not found.");
  }
  if (
    tournament.format !== TournamentFormat.TWO_GROUP_KNOCKOUT ||
    tournament.formatVersion !== 2 ||
    tournament.currentStage !== MatchStage.GROUP_STAGE ||
    tournament.fixturesGenerated !== true ||
    tournament.status === TournamentStatus.COMPLETED
  ) {
    throw new Error(
      "Reschedule refused: the men's tournament is not the published 2026 group-stage competition.",
    );
  }

  const matches = await loadGroupMatches(
    new Types.ObjectId(OFFICIAL_MENS_TOURNAMENT_ID),
    session,
  );
  const teamIds = [
    ...new Set(
      matches.flatMap((match) => [
        match.homeTeam.toString(),
        match.awayTeam.toString(),
      ]),
    ),
  ];
  const teamQuery = Team.find({
    _id: { $in: teamIds },
    isDeleted: false,
  }).select("name");
  if (session) teamQuery.session(session);
  const teams = await teamQuery.lean();
  const teamIdsByKey = new Map<Official2026TeamKey, string>();
  for (const team of teams) {
    const definition = resolveOfficial2026TeamDefinition(team.name);
    if (!definition) {
      throw new Error(`Unexpected men's team identity in fixtures: ${team.name}`);
    }
    const existing = teamIdsByKey.get(definition.key);
    if (existing && existing !== team._id.toString()) {
      throw new Error(`Duplicate official team identity for ${definition.key}.`);
    }
    teamIdsByKey.set(definition.key, team._id.toString());
  }
  if (teamIdsByKey.size !== OFFICIAL_2026_TEAMS.length) {
    throw new Error(
      `Reschedule refused: expected the pinned 14 men's teams, found ${teamIdsByKey.size}.`,
    );
  }

  const plan = buildOfficial2026ReschedulePlan(
    OFFICIAL_MENS_TOURNAMENT_ID,
    matches.map(toPlanMatch),
    teamIdsByKey,
  );

  const womensQuery = Match.find({
    tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
    isDeleted: false,
  }).sort({ officialFixtureNumber: 1, _id: 1 });
  if (session) womensQuery.session(session);
  const womensMatches = (await womensQuery.lean()) as StoredMatch[];

  return {
    tournament,
    matches,
    teamIdsByKey,
    plan,
    womensMatchCount: womensMatches.length,
    womensFingerprint: fingerprintMatches(womensMatches),
  };
};

const assertExecutionAuthorized = (
  options: RescheduleOptions,
  databaseName: string,
  tournamentName: string,
): void => {
  if (!options.execute) return;
  if (process.env.OFFICIAL_2026_RESCHEDULE_ALLOW_EXECUTE !== "true") {
    throw new Error(
      "Set OFFICIAL_2026_RESCHEDULE_ALLOW_EXECUTE=true for this one approved reschedule run.",
    );
  }
  if (process.env.OFFICIAL_2026_RESCHEDULE_ALLOW_PRODUCTION !== "true") {
    throw new Error(
      "Every execution requires OFFICIAL_2026_RESCHEDULE_ALLOW_PRODUCTION=true because the MongoDB URI may target production regardless of NODE_ENV.",
    );
  }
  if (options.tournamentId !== OFFICIAL_MENS_TOURNAMENT_ID) {
    throw new Error(
      `Pass --tournament-id=${OFFICIAL_MENS_TOURNAMENT_ID} to target only the pinned men's tournament.`,
    );
  }
  if (options.confirmedTournamentId !== OFFICIAL_MENS_TOURNAMENT_ID) {
    throw new Error(
      `Pass --confirm-tournament-id=${OFFICIAL_MENS_TOURNAMENT_ID}.`,
    );
  }
  if (options.confirmedTournamentName !== tournamentName) {
    throw new Error(
      "Pass --confirm-tournament-name with the exact current tournament name returned by the plan.",
    );
  }
  if (options.confirmedDatabase !== databaseName) {
    throw new Error(
      `Pass --confirm-db=${databaseName}; it must exactly match the connected database.`,
    );
  }
  if (options.confirmation !== RESCHEDULE_CONFIRMATION) {
    throw new Error(`Pass --confirm=${RESCHEDULE_CONFIRMATION} after reviewing the plan.`);
  }
  if (!options.backupReference) {
    throw new Error("Pass --backup-reference=<verified-restorable-backup-id>.");
  }
  if (!options.backupSha256 || !/^[0-9a-fA-F]{64}$/.test(options.backupSha256)) {
    throw new Error(
      "Pass --backup-sha256=<independently-computed-backup-artifact-sha256>.",
    );
  }
};

const applyReschedule = async (
  inspection: Awaited<ReturnType<typeof inspectTarget>>,
  session: ClientSession,
  backupSha256: string,
): Promise<void> => {
  if (inspection.plan.alreadyApplied) return;

  const teamIds = [...inspection.teamIdsByKey.values()];
  const fencedTeams = await fenceTeamLifecycles(teamIds, session, {
    registrationStatus: "registered",
  });
  if ([...fencedTeams.values()].some((team) => !team)) {
    throw new Error("A pinned men's team became unavailable during reschedule.");
  }

  const venueNames = [
    ...new Set(
      OFFICIAL_2026_FIXTURES.map((fixture) => fixture.venueName).filter(
        (venue): venue is string => Boolean(venue),
      ),
    ),
  ];
  const canonicalVenues = await fenceActiveVenueNames(venueNames, session);
  const publishedAt = new Date();

  for (const fixture of OFFICIAL_2026_FIXTURES) {
    const stored = inspection.matches.find(
      (match) => match.officialFixtureNumber === fixture.officialNumber,
    );
    if (!stored) {
      throw new Error(`Missing stored official fixture ${fixture.officialNumber}.`);
    }
    const homeTeamId = inspection.teamIdsByKey.get(fixture.homeTeamKey);
    const awayTeamId = inspection.teamIdsByKey.get(fixture.awayTeamKey);
    const canonicalVenue = canonicalVenues.get(
      (fixture.venueName ?? "").trim().toLocaleLowerCase(),
    );
    if (!homeTeamId || !awayTeamId || !canonicalVenue || !fixture.kickoffAt) {
      throw new Error(
        `Reschedule could not resolve identities for official fixture ${fixture.officialNumber}.`,
      );
    }

    const filter =
      fixture.officialNumber === 1
        ? {
            _id: stored._id,
            status: MatchStatus.COMPLETED,
            homeScore: 8,
            awayScore: 1,
            __v: stored.__v ?? 0,
          }
        : {
            _id: stored._id,
            status: MatchStatus.SCHEDULED,
            homeScore: 0,
            awayScore: 0,
            resultLockedAt: { $exists: false },
            __v: stored.__v ?? 0,
          };

    const update =
      fixture.officialNumber === 1
        ? {
            $set: {
              fixturePublicationHash: OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
              fixtureSourceReference: OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE,
              fixturePublishedAt: publishedAt,
            },
            $inc: { __v: 1 },
          }
        : {
            $set: {
              homeTeam: new Types.ObjectId(homeTeamId),
              awayTeam: new Types.ObjectId(awayTeamId),
              date: new Date(fixture.kickoffAt),
              venue: canonicalVenue,
              scheduleStatus: MatchScheduleStatus.CONFIRMED,
              fixturePublicationHash: OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
              fixtureSourceReference: OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE,
              fixturePublishedAt: publishedAt,
            },
            $inc: { __v: 1 },
          };

    const result = await Match.updateOne(filter, update, {
      session,
      runValidators: true,
    });
    if (result.modifiedCount !== 1) {
      throw new Error(
        `Official fixture ${fixture.officialNumber} changed concurrently and was not rewritten.`,
      );
    }
  }

  const tournamentUpdate = await Tournament.updateOne(
    {
      _id: OFFICIAL_MENS_TOURNAMENT_ID,
      isDeleted: false,
      format: TournamentFormat.TWO_GROUP_KNOCKOUT,
      currentStage: MatchStage.GROUP_STAGE,
    },
    { $inc: { scheduleRevision: 1, __v: 1 } },
    { session, runValidators: true },
  );
  if (tournamentUpdate.modifiedCount !== 1) {
    throw new Error("The men's tournament changed concurrently during reschedule.");
  }

  await CompetitionOperation.create(
    [
      {
        tournamentId: new Types.ObjectId(OFFICIAL_MENS_TOURNAMENT_ID),
        operation: RESCHEDULE_OPERATION,
        idempotencyKey: IDEMPOTENCY_KEY,
        requestHash: OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
        status: CompetitionOperationStatus.COMPLETED,
        result: {
          sourceSha256: OFFICIAL_2026_SOURCE_SHA256,
          sourceByteLength: OFFICIAL_2026_SOURCE_BYTE_LENGTH,
          fixturePublicationHash: OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
          remainingFixtureCount: OFFICIAL_2026_MASTER_RESCHEDULE.remainingFixtureCount,
          backupSha256,
          publishedAt,
        },
      },
    ],
    { session },
  );
};

const printPlan = (
  inspection: Awaited<ReturnType<typeof inspectTarget>>,
  databaseName: string,
): void => {
  console.log(`Connected database: ${databaseName}`);
  console.log(
    `Target tournament: ${inspection.tournament.name} (${OFFICIAL_MENS_TOURNAMENT_ID})`,
  );
  console.log(
    `Pinned master sheet: sha256=${OFFICIAL_2026_SOURCE_SHA256}, bytes=${OFFICIAL_2026_SOURCE_BYTE_LENGTH}`,
  );
  console.log(`Fixture publication hash: ${OFFICIAL_2026_FIXTURE_PUBLICATION_HASH}`);
  console.log(
    `Women's tournament left untouched: ${inspection.womensMatchCount} matches, fingerprint ${inspection.womensFingerprint}`,
  );
  console.log(
    inspection.plan.alreadyApplied
      ? "Plan: already applied. No men's remaining fixtures need rewriting."
      : `Plan: keep Samba Boys 8-1 NYSC, rewrite ${inspection.plan.remainingScheduleChanges} remaining schedule row(s), swap home/away on ${inspection.plan.homeAwaySwaps} fixture(s), and refresh publication hashes on all 42.`,
  );
  console.table(
    inspection.plan.rows
      .filter((row) => !row.metadataOnly)
      .filter(
        (row) =>
          row.fromKickoff !== row.toKickoff ||
          row.fromVenue !== row.toVenue ||
          row.swappedHomeAway,
      )
      .map((row) => ({
        no: row.officialNumber,
        home: row.homeTeamKey,
        away: row.awayTeamKey,
        from: `${row.fromKickoff ?? "TBC"} @ ${row.fromVenue ?? "TBC"}`,
        to: `${row.toKickoff} @ ${row.toVenue}`,
        swap: row.swappedHomeAway ? "yes" : "",
      })),
  );
};

const run = async (): Promise<void> => {
  const options = parseOptions();
  if (options.tournamentId && options.tournamentId !== OFFICIAL_MENS_TOURNAMENT_ID) {
    throw new Error(
      `This command only targets the pinned men's tournament ${OFFICIAL_MENS_TOURNAMENT_ID}.`,
    );
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. No database connection was attempted.");
  }

  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("MongoDB connected without an available database handle.");
  }

  const inspection = await inspectTarget();
  printPlan(inspection, database.databaseName);
  if (!options.execute) {
    console.log(
      `Dry run only: no records changed. After a verified backup, rerun with --execute, exact database/tournament confirmations, and --confirm=${RESCHEDULE_CONFIRMATION}.`,
    );
    return;
  }

  assertExecutionAuthorized(
    options,
    database.databaseName,
    inspection.tournament.name,
  );
  const backup = buildOfficial2026SafeBackupReference(
    options.backupReference!,
    options.backupSha256!,
  );

  if (inspection.plan.alreadyApplied) {
    console.log("Master sheet already published on the men's tournament. No writes were made.");
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(
      async () => {
        const transactionInspection = await inspectTarget(session);
        if (
          transactionInspection.womensFingerprint !== inspection.womensFingerprint
        ) {
          throw new Error("Women's fixtures changed after the approved plan.");
        }
        await applyReschedule(transactionInspection, session, backup.sha256);
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      },
    );
  } finally {
    await session.endSession();
  }

  const verified = await inspectTarget();
  assertOfficial2026RescheduledMatchesMatchManifest(
    OFFICIAL_MENS_TOURNAMENT_ID,
    verified.matches.map(toPlanMatch),
    verified.teamIdsByKey,
  );
  if (verified.womensFingerprint !== inspection.womensFingerprint) {
    throw new Error("Women's fixtures changed during the men's reschedule.");
  }
  console.log(
    "Master-sheet reschedule committed and verified: opener 8-1 preserved, 41 remaining men's fixtures rewritten, women's fixtures unchanged.",
  );
};

run()
  .catch((error: unknown) => {
    console.error(
      `Official 2026 master-sheet reschedule stopped: ${sanitizeErrorMessage(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
