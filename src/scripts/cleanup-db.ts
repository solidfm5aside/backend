import dotenv from 'dotenv';
import mongoose from 'mongoose';

import '@/models/admin.model';
import '@/models/admin-access-control.model';
import '@/models/competition-bracket.model';
import '@/models/competition-draw.model';
import '@/models/competition-operation.model';
import '@/models/match.model';
import '@/models/payment.model';
import '@/models/player.model';
import '@/models/player-stats.model';
import '@/models/setting.model';
import '@/models/standings.model';
import '@/models/team.model';
import '@/models/tournament.model';
import '@/models/tournament-entry.model';
import '@/models/tournament-roster-entry.model';
import '@/models/venue.model';

dotenv.config();

const SEASON_RESET_COLLECTIONS = [
  'competitionoperations',
  'competitionbrackets',
  'competitiondraws',
  'tournamentrosterentries',
  'playerstats',
  'standings',
  'matches',
  'payments',
  'tournamententries',
  'tournaments',
] as const;

const CLEANUP_MANIFESTS = {
  'season-reset': SEASON_RESET_COLLECTIONS,
  'full-competition-reset': [
    ...SEASON_RESET_COLLECTIONS,
    'adminaccesscontrols',
    'players',
    'teams',
  ],
  'admin-only-reset': [
    ...SEASON_RESET_COLLECTIONS,
    'adminaccesscontrols',
    'players',
    'teams',
    'venues',
    'settings',
  ],
} as const;

type CleanupManifestName = keyof typeof CLEANUP_MANIFESTS;

const ADMIN_COLLECTION = 'admins';

const CLEANABLE_COLLECTIONS = new Set<string>(
  Object.values(CLEANUP_MANIFESTS).flat()
);
const PROTECTED_COLLECTIONS = new Set([ADMIN_COLLECTION]);

const getRegisteredCollectionNames = (): string[] =>
  mongoose
    .modelNames()
    .map((modelName) => mongoose.model(modelName).collection.collectionName)
    .sort();

const assertAdminOnlyManifestCoversRegisteredModels = (): void => {
  const manifestCollections = new Set<string>(
    CLEANUP_MANIFESTS['admin-only-reset']
  );
  const missingCollections = getRegisteredCollectionNames().filter(
    (name) => name !== ADMIN_COLLECTION && !manifestCollections.has(name)
  );

  if (manifestCollections.has(ADMIN_COLLECTION)) {
    throw new Error(
      `Cleanup manifest configuration error: ${ADMIN_COLLECTION} must remain protected.`
    );
  }

  if (missingCollections.length > 0) {
    throw new Error(
      `Cleanup manifest configuration error: registered model collection(s) missing from admin-only-reset: ${missingCollections.join(', ')}.`
    );
  }
};

interface CleanupOptions {
  execute: boolean;
  manifest?: string;
  confirmedDatabase?: string;
  backupReference?: string;
}

const readOption = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const option = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return option?.slice(prefix.length).trim();
};

const parseOptions = (): CleanupOptions => ({
  execute: process.argv.includes('--execute'),
  manifest: readOption('manifest'),
  confirmedDatabase: readOption('confirm-db'),
  backupReference: readOption('backup-reference'),
});

const isCleanupManifestName = (value: string): value is CleanupManifestName =>
  Object.prototype.hasOwnProperty.call(CLEANUP_MANIFESTS, value);

const assertExecutionIsAuthorized = (
  options: CleanupOptions,
  databaseName: string
): CleanupManifestName => {
  if (process.env.DB_CLEANUP_ALLOW_EXECUTE !== 'true') {
    throw new Error('Set DB_CLEANUP_ALLOW_EXECUTE=true for this one cleanup run.');
  }

  if (!options.confirmedDatabase || options.confirmedDatabase !== databaseName) {
    throw new Error(
      `Pass --confirm-db=${databaseName}. The value must exactly match the connected database.`
    );
  }

  if (!options.backupReference) {
    throw new Error(
      'Pass --backup-reference=<snapshot-or-archive-id> after verifying a restorable backup.'
    );
  }

  if (!options.manifest || !isCleanupManifestName(options.manifest)) {
    throw new Error(
      `Pass one approved --manifest value: ${Object.keys(CLEANUP_MANIFESTS).join(', ')}.`
    );
  }

  if (
    process.env.NODE_ENV === 'production' &&
    process.env.DB_CLEANUP_ALLOW_PRODUCTION !== 'true'
  ) {
    throw new Error(
      'Production cleanup is blocked. Set DB_CLEANUP_ALLOW_PRODUCTION=true only inside the approved maintenance window.'
    );
  }

  return options.manifest;
};

const run = async (): Promise<void> => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. No database connection was attempted.');
  }

  const options = parseOptions();
  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });

  const database = mongoose.connection.db;
  if (!database) {
    throw new Error('MongoDB connected without an available database handle.');
  }

  const databaseName = database.databaseName;
  const collectionMetadata = await database.listCollections({}, { nameOnly: true }).toArray();
  const collectionNames = collectionMetadata.map(({ name }) => name).sort();
  const inventory = await Promise.all(
    collectionNames.map(async (name) => ({
      collection: name,
      documents: await database.collection(name).countDocuments({}),
      protected: PROTECTED_COLLECTIONS.has(name),
      cleanable: CLEANABLE_COLLECTIONS.has(name),
    }))
  );

  console.log(`Connected database: ${databaseName}`);
  console.table(inventory);

  if (!options.execute) {
    console.log(
      'Inventory only: no records were changed. Create and verify a backup, approve one named manifest, then rerun with the guarded execute options.'
    );
    return;
  }

  const manifestName = assertExecutionIsAuthorized(options, databaseName);
  assertAdminOnlyManifestCoversRegisteredModels();
  const approvedCollections = [...CLEANUP_MANIFESTS[manifestName]];
  const approvedCollectionSet = new Set<string>(approvedCollections);
  const existingTargets = approvedCollections.filter((name) =>
    collectionNames.includes(name)
  );
  const missingTargets = approvedCollections.filter(
    (name) => !collectionNames.includes(name)
  );

  if (missingTargets.length > 0) {
    console.warn(`Collection(s) not present and skipped: ${missingTargets.join(', ')}`);
  }

  if (manifestName === 'admin-only-reset') {
    const undeclaredData = inventory.filter(
      ({ collection, documents }) =>
        documents > 0 &&
        !PROTECTED_COLLECTIONS.has(collection) &&
        !approvedCollectionSet.has(collection)
    );

    if (undeclaredData.length > 0) {
      throw new Error(
        `Admin-only reset refused: non-empty undeclared collection(s) require explicit review: ${undeclaredData
          .map(({ collection, documents }) => `${collection}=${documents}`)
          .join(', ')}.`
      );
    }
  }

  console.log(`Verified backup reference: ${options.backupReference}`);
  console.log(`Approved cleanup manifest: ${manifestName}`);
  console.log(`Collections in manifest: ${approvedCollections.join(', ')}`);

  const adminCollection = database.collection(ADMIN_COLLECTION);
  const adminIdsBefore = (
    await adminCollection.find({}, { projection: { _id: 1 } }).toArray()
  ).map(({ _id }) => _id.toString()).sort();
  const usableAdminCountBefore = await adminCollection.countDocuments({
    isDeleted: { $ne: true },
    isVerified: true,
    role: { $in: ['admin', 'super_admin'] },
    email: { $type: 'string', $ne: '' },
    password: { $type: 'string', $ne: '' },
  });

  if (manifestName === 'admin-only-reset' && usableAdminCountBefore === 0) {
    throw new Error(
      'Admin-only reset refused: no verified, active admin login exists to preserve.'
    );
  }

  const session = await mongoose.startSession();
  const deletedCounts = new Map<string, number>();

  try {
    await session.withTransaction(async () => {
      for (const name of existingTargets) {
        const result = await database.collection(name).deleteMany({}, { session });
        deletedCounts.set(name, result.deletedCount);
      }
    });
  } finally {
    await session.endSession();
  }

  for (const name of existingTargets) {
    console.log(`Deleted ${deletedCounts.get(name) ?? 0} document(s) from ${name}.`);
  }

  const nonEmptyTargets = (
    await Promise.all(
      existingTargets.map(async (name) => ({
        name,
        remaining: await database.collection(name).countDocuments({}),
      }))
    )
  ).filter(({ remaining }) => remaining > 0);

  if (nonEmptyTargets.length > 0) {
    throw new Error(
      `Cleanup verification failed: ${nonEmptyTargets
        .map(({ name, remaining }) => `${name}=${remaining}`)
        .join(', ')}`
    );
  }

  const adminIdsAfter = (
    await adminCollection.find({}, { projection: { _id: 1 } }).toArray()
  ).map(({ _id }) => _id.toString()).sort();
  const usableAdminCountAfter = await adminCollection.countDocuments({
    isDeleted: { $ne: true },
    isVerified: true,
    role: { $in: ['admin', 'super_admin'] },
    email: { $type: 'string', $ne: '' },
    password: { $type: 'string', $ne: '' },
  });

  if (
    adminIdsBefore.join(',') !== adminIdsAfter.join(',') ||
    usableAdminCountBefore !== usableAdminCountAfter
  ) {
    throw new Error('Admin preservation verification failed after cleanup.');
  }

  if (manifestName === 'admin-only-reset') {
    const postCleanupMetadata = await database
      .listCollections({}, { nameOnly: true })
      .toArray();
    const residualData = (
      await Promise.all(
        postCleanupMetadata
          .map(({ name }) => name)
          .filter((name) => name !== ADMIN_COLLECTION)
          .map(async (name) => ({
            name,
            remaining: await database.collection(name).countDocuments({}),
          }))
      )
    ).filter(({ remaining }) => remaining > 0);

    if (residualData.length > 0) {
      throw new Error(
        `Admin-only reset verification failed: non-admin data remains in ${residualData
          .map(({ name, remaining }) => `${name}=${remaining}`)
          .join(', ')}.`
      );
    }
  }

  console.log(
    `Cleanup finished transactionally; selected collection counts are zero and ${usableAdminCountAfter} usable admin login(s) were preserved. Cloudinary assets were not deleted. Verify application health before ending the maintenance window.`
  );
};

run()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown cleanup error';
    console.error(`Database cleanup stopped: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
