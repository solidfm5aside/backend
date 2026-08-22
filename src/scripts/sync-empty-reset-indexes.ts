import dotenv from 'dotenv';
import mongoose from 'mongoose';

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
import '@/models/womens-competition-final.model';

dotenv.config();

const ADMIN_COLLECTION = 'admins';

interface Options {
  execute: boolean;
  confirmedDatabase?: string;
  backupReference?: string;
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
  execute: process.argv.includes('--execute'),
  confirmedDatabase: readOption('confirm-db'),
  backupReference: readOption('backup-reference'),
});

const assertExecutionAuthorized = (
  options: Options,
  databaseName: string
): void => {
  if (process.env.DB_INDEX_ALLOW_EXECUTE !== 'true') {
    throw new Error(
      'Set DB_INDEX_ALLOW_EXECUTE=true for this one guarded index rollout.'
    );
  }
  if (options.confirmedDatabase !== databaseName) {
    throw new Error(
      `Pass --confirm-db=${databaseName}. It must exactly match the connected database.`
    );
  }
  if (!options.backupReference) {
    throw new Error(
      'Pass --backup-reference=<verified-archive> before changing indexes.'
    );
  }
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.DB_INDEX_ALLOW_PRODUCTION !== 'true'
  ) {
    throw new Error(
      'Production index changes are blocked unless DB_INDEX_ALLOW_PRODUCTION=true is set for the maintenance run.'
    );
  }
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
  if (!database) throw new Error('MongoDB connected without a database handle.');

  const databaseName = database.databaseName;
  const collections = await database.listCollections({}, { nameOnly: true }).toArray();
  const collectionNames = collections.map(({ name }) => name).sort();
  const nonAdminCounts = await Promise.all(
    collectionNames
      .filter((name) => name !== ADMIN_COLLECTION)
      .map(async (name) => ({
        collection: name,
        documents: await database.collection(name).countDocuments({}),
      }))
  );
  const nonEmpty = nonAdminCounts.filter(({ documents }) => documents > 0);
  if (nonEmpty.length > 0) {
    throw new Error(
      `Index rollout refused: non-admin collection(s) are no longer empty: ${nonEmpty
        .map(({ collection, documents }) => `${collection}=${documents}`)
        .join(', ')}.`
    );
  }

  const adminCollection = database.collection(ADMIN_COLLECTION);
  const adminIdsBefore = (
    await adminCollection.find({}, { projection: { _id: 1 } }).toArray()
  )
    .map(({ _id }) => _id.toString())
    .sort();
  const usableAdminCount = await adminCollection.countDocuments({
    isDeleted: { $ne: true },
    isVerified: true,
    role: { $in: ['admin', 'super_admin'] },
    email: { $type: 'string', $ne: '' },
    password: { $type: 'string', $ne: '' },
  });
  if (adminIdsBefore.length === 0 || usableAdminCount === 0) {
    throw new Error('Index rollout refused: no usable administrator login was found.');
  }

  const models = mongoose.modelNames().map((name) => mongoose.model(name));
  const adminModel = models.find(
    (model) => model.collection.collectionName === ADMIN_COLLECTION
  );
  if (adminModel) {
    throw new Error(
      'Index rollout configuration error: the protected Admin model must not be registered by this script.'
    );
  }

  const plan = await Promise.all(
    models.map(async (model) => ({
      model: model.modelName,
      collection: model.collection.collectionName,
      ...(await model.diffIndexes()),
    }))
  );

  console.log(`Connected database: ${databaseName}`);
  console.log(`Protected administrator records: ${adminIdsBefore.length}`);
  console.table(plan);

  if (!options.execute) {
    console.log('Inventory only: no indexes or documents were changed.');
    return;
  }

  assertExecutionAuthorized(options, databaseName);
  console.log(`Verified backup reference: ${options.backupReference}`);

  for (const model of models) {
    const dropped = await model.syncIndexes();
    console.log(
      `Synchronized ${model.collection.collectionName}; removed obsolete indexes: ${
        dropped.length > 0 ? dropped.join(', ') : 'none'
      }.`
    );
  }

  const adminIdsAfter = (
    await adminCollection.find({}, { projection: { _id: 1 } }).toArray()
  )
    .map(({ _id }) => _id.toString())
    .sort();
  if (JSON.stringify(adminIdsAfter) !== JSON.stringify(adminIdsBefore)) {
    throw new Error('Administrator verification failed after index synchronization.');
  }

  const finalCollectionNames = (
    await database.listCollections({}, { nameOnly: true }).toArray()
  ).map(({ name }) => name);
  const unexpectedDocuments = (
    await Promise.all(
      finalCollectionNames
        .filter((name) => name !== ADMIN_COLLECTION)
        .map(async (name) => ({
          collection: name,
          documents: await database.collection(name).countDocuments({}),
        }))
    )
  ).filter(({ documents }) => documents > 0);
  if (unexpectedDocuments.length > 0) {
    throw new Error('A non-admin document appeared during index synchronization.');
  }

  console.log(
    `Index rollout verified: ${adminIdsAfter.length} administrator record(s) unchanged and all non-admin collections remain empty.`
  );
};

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
