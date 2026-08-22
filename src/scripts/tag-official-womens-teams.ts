import dotenv from 'dotenv';
import mongoose, { ClientSession, Types } from 'mongoose';
import Team from '@/models/team.model';
import Player from '@/models/player.model';
import TournamentEntry from '@/models/tournament-entry.model';
import { CompetitionDivision } from '@/models/competition-division';

dotenv.config();

export const OFFICIAL_WOMENS_TEAM_TAGS = Object.freeze([
  { id: '6a8a1ec9508de0e7425195a6', name: 'NYSC WOMEN TEAM' },
  { id: '6a8a1f1f508de0e7425195a7', name: 'RANGERS INTERNATIONAL WOMEN' },
  { id: '6a8a1ea3508de0e7425195a5', name: 'ZOHAR FA' },
]);

interface Options {
  execute: boolean;
  confirmedDatabase?: string;
  backupArtifact?: string;
  backupSha256?: string;
}

export interface RawTargetTeam {
  _id: Types.ObjectId;
  name?: string;
  division?: CompetitionDivision | null;
  registrationStatus?: string;
  isDeleted?: boolean | null;
  lifecycleRevision?: number | null;
}

export interface OfficialWomensTeamInventoryRow {
  id: string;
  name: string;
  found: boolean;
  actualName?: string;
  registrationStatus?: string;
  isDeleted?: boolean | null;
  division: CompetitionDivision | '(missing => men)' | '(null => men)';
  rawDivision?: CompetitionDivision | null;
  lifecycleRevision?: number | null;
  playerCount: number;
  tournamentEntryCount: number;
}

export interface VerifiedBackupEvidence {
  artifact: string;
  sha256: string;
}

const SAFE_BACKUP_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/i;

const readOption = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
};

const parseOptions = (): Options => ({
  execute: process.argv.includes('--execute'),
  confirmedDatabase: readOption('confirm-db'),
  backupArtifact: readOption('backup-artifact'),
  backupSha256: readOption('backup-sha256'),
});

export const assertVerifiedBackupEvidence = (
  artifact?: string,
  sha256?: string
): VerifiedBackupEvidence => {
  if (!artifact || !SAFE_BACKUP_BASENAME.test(artifact)) {
    throw new Error(
      'Pass --backup-artifact=<safe-basename> (letters, numbers, dot, underscore, or hyphen only).'
    );
  }
  if (!sha256 || !SHA256_HEX.test(sha256)) {
    throw new Error('Pass --backup-sha256=<exact-64-character-sha256>.');
  }
  return { artifact, sha256: sha256.toLowerCase() };
};

const authorizeExecution = (
  options: Options,
  databaseName: string
): VerifiedBackupEvidence => {
  if (process.env.WOMENS_DIVISION_MIGRATION_ALLOW_EXECUTE !== 'true') {
    throw new Error('Set WOMENS_DIVISION_MIGRATION_ALLOW_EXECUTE=true for this one run.');
  }
  if (options.confirmedDatabase !== databaseName) {
    throw new Error(`Pass --confirm-db=${databaseName} exactly.`);
  }
  if (process.env.WOMENS_DIVISION_MIGRATION_BACKUP_VERIFIED !== 'true') {
    throw new Error(
      'Execution is blocked until WOMENS_DIVISION_MIGRATION_BACKUP_VERIFIED=true confirms the independent backup was restored or otherwise verified.'
    );
  }
  const backup = assertVerifiedBackupEvidence(options.backupArtifact, options.backupSha256);
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.WOMENS_DIVISION_MIGRATION_ALLOW_PRODUCTION !== 'true'
  ) {
    throw new Error(
      'Production execution is blocked unless WOMENS_DIVISION_MIGRATION_ALLOW_PRODUCTION=true.'
    );
  }
  return backup;
};

const exactOptionalField = (value: unknown): unknown =>
  value === undefined ? { $exists: false } : value;

/**
 * Builds the exact compare-and-set predicate used by the migration. Keeping
 * this pure makes the legacy/missing-field behavior independently testable.
 */
export const buildOfficialWomensTeamCasFilter = (
  team: RawTargetTeam
) => ({
  _id: team._id,
  name: exactOptionalField(team.name),
  registrationStatus: exactOptionalField(team.registrationStatus),
  isDeleted: exactOptionalField(team.isDeleted),
  division: exactOptionalField(team.division),
  lifecycleRevision: exactOptionalField(team.lifecycleRevision),
});

const loadRawTargets = async (session?: ClientSession): Promise<RawTargetTeam[]> => {
  const ids = OFFICIAL_WOMENS_TEAM_TAGS.map(({ id }) => new Types.ObjectId(id));
  return Team.collection
    .find(
      { _id: { $in: ids } },
      {
        ...(session ? { session } : {}),
        projection: {
          _id: 1,
          name: 1,
          division: 1,
          registrationStatus: 1,
          isDeleted: 1,
          lifecycleRevision: 1,
        },
      }
    )
    .toArray() as Promise<RawTargetTeam[]>;
};

const countDependencies = async (
  teamId: string,
  session?: ClientSession
): Promise<{ playerCount: number; tournamentEntryCount: number }> => {
  const playerQuery = Player.countDocuments({ teamId, isDeleted: { $ne: true } });
  const entryQuery = TournamentEntry.countDocuments({
    teamId,
    isDeleted: { $ne: true },
  });
  if (session) {
    playerQuery.session(session);
    entryQuery.session(session);
  }

  // Do not run operations concurrently on one MongoDB transaction session.
  const playerCount = await playerQuery;
  const tournamentEntryCount = await entryQuery;
  return { playerCount, tournamentEntryCount };
};

const inspectTargets = async (
  session?: ClientSession
): Promise<OfficialWomensTeamInventoryRow[]> => {
  const rawTeams = await loadRawTargets(session);
  const byId = new Map(rawTeams.map((team) => [team._id.toString(), team]));
  const inventory: OfficialWomensTeamInventoryRow[] = [];

  for (const target of OFFICIAL_WOMENS_TEAM_TAGS) {
    const team = byId.get(target.id);
    const dependencies = await countDependencies(target.id, session);
    inventory.push({
      ...target,
      found: Boolean(team),
      actualName: team?.name,
      registrationStatus: team?.registrationStatus,
      isDeleted: team?.isDeleted,
      division:
        team?.division === undefined
          ? '(missing => men)'
          : team.division === null
            ? '(null => men)'
            : team.division,
      rawDivision: team?.division,
      lifecycleRevision: team?.lifecycleRevision,
      ...dependencies,
    });
  }
  return inventory;
};

export const assertOfficialWomensTeamInventory = (
  inventory: OfficialWomensTeamInventoryRow[]
): void => {
  const expectedIds = new Set(OFFICIAL_WOMENS_TEAM_TAGS.map((target) => target.id));
  if (
    inventory.length !== OFFICIAL_WOMENS_TEAM_TAGS.length ||
    new Set(inventory.map((row) => row.id)).size !== OFFICIAL_WOMENS_TEAM_TAGS.length ||
    inventory.some((row) => !expectedIds.has(row.id))
  ) {
    throw new Error('Women’s team tagging refused: the exact three-team inventory is required.');
  }
  const invalid = inventory.filter(
    (row) =>
      !row.found ||
      row.actualName !== row.name ||
      row.registrationStatus !== 'registered' ||
      row.isDeleted !== false ||
      ![
        '(missing => men)',
        '(null => men)',
        CompetitionDivision.MEN,
        CompetitionDivision.WOMEN,
      ].includes(String(row.division)) ||
      (row.division !== CompetitionDivision.WOMEN &&
        (row.playerCount !== 0 || row.tournamentEntryCount !== 0))
  );
  if (invalid.length > 0) {
    throw new Error(
      `Women’s team tagging refused: exact target preconditions failed for ${invalid
        .map((row) => row.id)
        .join(', ')}.`
    );
  }
};

const assertNoDependenciesForChangedTeams = (
  inventory: OfficialWomensTeamInventoryRow[],
  changedTeamIds: string[]
): void => {
  const changed = new Set(changedTeamIds);
  const invalid = inventory.filter(
    (row) =>
      changed.has(row.id) &&
      (row.playerCount !== 0 || row.tournamentEntryCount !== 0)
  );
  if (invalid.length > 0) {
    throw new Error(
      `Women’s team tagging refused: a player or tournament entry appeared for ${invalid
        .map((row) => row.id)
        .join(', ')} while acquiring lifecycle fences.`
    );
  }
};

const assertRawTargetPreconditions = (teams: RawTargetTeam[]): void => {
  const byId = new Map(teams.map((team) => [team._id.toString(), team]));
  for (const target of OFFICIAL_WOMENS_TEAM_TAGS) {
    const team = byId.get(target.id);
    if (
      !team ||
      team.name !== target.name ||
      team.registrationStatus !== 'registered' ||
      team.isDeleted !== false ||
      ![undefined, null, CompetitionDivision.MEN, CompetitionDivision.WOMEN].includes(
        team.division
      ) ||
      (team.lifecycleRevision != null &&
        (!Number.isInteger(team.lifecycleRevision) || team.lifecycleRevision < 0))
    ) {
      throw new Error(`Women’s team tagging refused: exact target ${target.id} changed.`);
    }
  }
};

const migrateInsideTransaction = async (
  session: ClientSession
): Promise<{
  preWrite: OfficialWomensTeamInventoryRow[];
  postFence: OfficialWomensTeamInventoryRow[];
  changedTeamIds: string[];
}> => {
  const preWrite = await inspectTargets(session);
  assertOfficialWomensTeamInventory(preWrite);
  const rawTargets = await loadRawTargets(session);
  assertRawTargetPreconditions(rawTargets);
  const rawById = new Map(rawTargets.map((team) => [team._id.toString(), team]));
  const changedTeamIds: string[] = [];

  // This exact lifecycle CAS is the same serialization boundary used by the
  // roster and tournament-entry APIs. Stable ordering prevents deadlocks.
  for (const target of [...OFFICIAL_WOMENS_TEAM_TAGS].sort((a, b) =>
    a.id.localeCompare(b.id)
  )) {
    const team = rawById.get(target.id)!;
    if (team.division === CompetitionDivision.WOMEN) continue;
    const result = await Team.collection.updateOne(
      buildOfficialWomensTeamCasFilter(team),
      {
        $set: { division: CompetitionDivision.WOMEN },
        $inc: { lifecycleRevision: 1 },
      },
      { session }
    );
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
      throw new Error(`Team ${target.id} changed while acquiring its lifecycle fence.`);
    }
    changedTeamIds.push(target.id);
  }

  // Re-read all exact rows and both dependency collections after acquiring the
  // lifecycle fences. A concurrent API player/entry write conflicts and forces
  // this transaction to retry against its new dependency.
  const postFence = await inspectTargets(session);
  assertOfficialWomensTeamInventory(postFence);
  assertNoDependenciesForChangedTeams(postFence, changedTeamIds);
  if (postFence.some((row) => row.division !== CompetitionDivision.WOMEN)) {
    throw new Error('Transaction verification failed before commit.');
  }
  return { preWrite, postFence, changedTeamIds };
};

const run = async (): Promise<void> => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set.');
  const options = parseOptions();
  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  const databaseName = mongoose.connection.db?.databaseName;
  if (!databaseName) throw new Error('MongoDB connected without a database name.');

  const dryRunInventory = await inspectTargets();
  console.log(`Connected database: ${databaseName}`);
  console.table(dryRunInventory);
  assertOfficialWomensTeamInventory(dryRunInventory);

  if (!options.execute) {
    console.log(
      'Dry run only: no team was changed. Verify a restorable backup before guarded execution.'
    );
    return;
  }
  const backup = authorizeExecution(options, databaseName);

  const session = await mongoose.startSession();
  let transactionEvidence:
    | {
        preWrite: OfficialWomensTeamInventoryRow[];
        postFence: OfficialWomensTeamInventoryRow[];
        changedTeamIds: string[];
      }
    | undefined;
  try {
    await session.withTransaction(async () => {
      transactionEvidence = await migrateInsideTransaction(session);
    });
  } finally {
    await session.endSession();
  }
  if (!transactionEvidence) throw new Error('Migration transaction did not commit.');

  const after = await inspectTargets();
  assertOfficialWomensTeamInventory(after);
  if (after.some((row) => row.division !== CompetitionDivision.WOMEN)) {
    throw new Error('Post-commit verification failed; one or more exact teams are not women.');
  }

  const receipt = {
    receiptType: 'official-womens-team-division-migration',
    receiptVersion: 1,
    databaseName,
    committedAt: new Date().toISOString(),
    backup,
    exactTargetCount: OFFICIAL_WOMENS_TEAM_TAGS.length,
    changedTeamIds: transactionEvidence.changedTeamIds,
    transactionPreWriteSnapshot: transactionEvidence.preWrite,
    transactionPostFenceSnapshot: transactionEvidence.postFence,
    postCommitSnapshot: after,
  };
  console.table(after);
  console.log(JSON.stringify(receipt, null, 2));
  console.log(
    `Verified exactly ${OFFICIAL_WOMENS_TEAM_TAGS.length} women’s teams; all other teams were untouched. Backup artifact: ${backup.artifact}; SHA-256: ${backup.sha256}`
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
