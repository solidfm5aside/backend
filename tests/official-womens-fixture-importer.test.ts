import { Types } from "mongoose";

import {
  OFFICIAL_WOMENS_EXPECTED_PLAN_HASH,
  OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY,
  OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH,
  OFFICIAL_WOMENS_FIXTURE_SOURCE,
  OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE,
} from "@/data/official-womens-fixture-manifest";
import { AdminRole } from "@/models/admin.model";
import { CompetitionOperationStatus } from "@/models/competition-operation.model";
import {
  assertApprovedInventoryConfirmation,
  assertReceiptIdentity,
} from "@/scripts/import-official-womens-fixtures";
import {
  OFFICIAL_MENS_TOURNAMENT_ID,
  OFFICIAL_WOMENS_TOURNAMENT_ID,
  OFFICIAL_WOMENS_TOURNAMENT_IDENTITY,
} from "@/utils/official-womens-conversion.util";

const IMPORT_OPERATION = "import_official_womens_league_fixtures";
const MEN_ALGORITHM = "sha256:canonical-json-v1:official-men-tournament-scope";
const DATABASE_NAME = "solidfm-test";

const mensCounts = () => ({
  tournament: 1,
  entries: 14,
  matches: 42,
  rosters: 0,
  standings: 14,
  operations: 4,
  draws: 1,
  brackets: 1,
  playerStats: 0,
  womensFinals: 0,
  teams: 14,
  players: 0,
});

const buildOperation = () => {
  const mensState = {
    tournamentId: OFFICIAL_MENS_TOURNAMENT_ID,
    algorithm: MEN_ALGORITHM,
    sha256: "a".repeat(64),
    counts: mensCounts(),
  };
  return {
    tournamentId: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID),
    operation: IMPORT_OPERATION,
    idempotencyKey: OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY,
    requestHash: OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH,
    status: CompetitionOperationStatus.COMPLETED,
    result: {
      importerVersion: 1,
      operation: IMPORT_OPERATION,
      idempotencyKey: OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY,
      fixtureManifestHash: OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH,
      source: {
        fileName: OFFICIAL_WOMENS_FIXTURE_SOURCE.fileName,
        byteLength: OFFICIAL_WOMENS_FIXTURE_SOURCE.byteLength,
        sha256: OFFICIAL_WOMENS_FIXTURE_SOURCE.sha256,
      },
      sourceReference: OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE,
      databaseName: DATABASE_NAME,
      tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
      tournamentName: OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.name,
      publisher: {
        id: "69c1de8a26966eeb2b5da87a",
        name: "Historical Publisher",
        email: "publisher@example.com",
        role: AdminRole.ADMIN,
      },
      backup: {
        artifact: "women-before-fixtures.archive",
        sha256: "b".repeat(64),
      },
      approvedInventorySha256: "c".repeat(64),
      planHash: OFFICIAL_WOMENS_EXPECTED_PLAN_HASH,
      publication: {
        tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
        workflowRevision: 5,
        fixtureCount: 3,
        confirmedCount: 3,
        pendingCount: 0,
        rosterPlayerCount: 0,
        planHash: OFFICIAL_WOMENS_EXPECTED_PLAN_HASH,
      },
      rosterSnapshot: {
        count: 0,
        rowIds: [],
        playerIds: [],
        strictSha256: "d".repeat(64),
        immutableSha256: "e".repeat(64),
      },
      publishedAt: new Date("2026-08-23T12:30:00.000Z"),
      mensStateBefore: mensState,
      mensStateAfter: { ...mensState, counts: mensCounts() },
    },
  };
};

describe("official women fixture importer orchestration guards", () => {
  it("accepts the complete immutable publication receipt", () => {
    expect(() =>
      assertReceiptIdentity(buildOperation() as never, DATABASE_NAME),
    ).not.toThrow();
  });

  it.each([
    [
      "numeric publisher name",
      (operation: ReturnType<typeof buildOperation>) => {
        operation.result.publisher.name = 123 as never;
      },
    ],
    [
      "non-string backup artifact",
      (operation: ReturnType<typeof buildOperation>) => {
        operation.result.backup.artifact = 123 as never;
      },
    ],
    [
      "invalid men SHA",
      (operation: ReturnType<typeof buildOperation>) => {
        operation.result.mensStateBefore.sha256 = "x";
        operation.result.mensStateAfter.sha256 = "x";
      },
    ],
    [
      "different men counts",
      (operation: ReturnType<typeof buildOperation>) => {
        operation.result.mensStateAfter.counts.matches += 1;
      },
    ],
    [
      "substituted plan hash",
      (operation: ReturnType<typeof buildOperation>) => {
        operation.result.planHash = "f".repeat(64);
        operation.result.publication.planHash = "f".repeat(64);
      },
    ],
  ])("rejects a malformed Mixed receipt: %s", (_label, corrupt) => {
    const operation = buildOperation();
    corrupt(operation);
    expect(() =>
      assertReceiptIdentity(operation as never, DATABASE_NAME),
    ).toThrow(/receipt is incomplete or does not match/i);
  });

  it("accepts either the fresh replay inventory or its exact historical approval", () => {
    const current = "1".repeat(64);
    const historical = "2".repeat(64);
    expect(() =>
      assertApprovedInventoryConfirmation(
        current.toUpperCase(),
        current,
        historical,
      ),
    ).not.toThrow();
    expect(() =>
      assertApprovedInventoryConfirmation(historical, current, historical),
    ).not.toThrow();
    expect(() =>
      assertApprovedInventoryConfirmation("3".repeat(64), current, historical),
    ).toThrow(/neither the fresh state nor the exact original/i);
  });
});
