import { createHash } from "node:crypto";

import {
  OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY,
  OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH,
  OFFICIAL_WOMENS_FIXTURE_SOURCE,
  OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE,
  OFFICIAL_WOMENS_NORMALIZED_FIXTURES,
} from "@/data/official-womens-fixture-manifest";
import {
  MatchFixtureSource,
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from "@/models/match.model";
import {
  assertVerifiedBackupEvidence,
  VerifiedBackupEvidence,
} from "./official-womens-conversion.util";

const SHA256_HEX = /^[a-f0-9]{64}$/i;

const objectIdString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value)
    return String(value);
  return "";
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

export const hashOfficialWomensImportEvidence = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");

export interface OfficialWomensSourceEvidence {
  fileName: string;
  byteLength: number;
  sha256: string;
}

export const assertOfficialWomensSourceEvidence = (
  evidence: OfficialWomensSourceEvidence,
  confirmedSha256?: string,
): OfficialWomensSourceEvidence => {
  const sha256 = evidence.sha256.toLowerCase();
  if (
    evidence.fileName !== OFFICIAL_WOMENS_FIXTURE_SOURCE.fileName ||
    evidence.byteLength !== OFFICIAL_WOMENS_FIXTURE_SOURCE.byteLength ||
    sha256 !== OFFICIAL_WOMENS_FIXTURE_SOURCE.sha256
  ) {
    throw new Error(
      "The supplied DOCX does not match the immutable reviewed women fixture source.",
    );
  }
  if (
    confirmedSha256 !== undefined &&
    confirmedSha256.toLowerCase() !== sha256
  ) {
    throw new Error(
      "The explicit source SHA-256 confirmation does not match the reviewed DOCX.",
    );
  }
  return { ...evidence, sha256 };
};

export const assertOfficialWomensImportConfirmationHashes = (input: {
  confirmedInventorySha256?: string;
  actualInventorySha256: string;
  confirmedMensSha256?: string;
  actualMensSha256: string;
  confirmedPlanSha256?: string;
  actualPlanSha256: string;
}): void => {
  for (const [label, confirmed, actual] of [
    ["inventory", input.confirmedInventorySha256, input.actualInventorySha256],
    ["men state", input.confirmedMensSha256, input.actualMensSha256],
    ["fixture plan", input.confirmedPlanSha256, input.actualPlanSha256],
  ] as const) {
    if (
      !SHA256_HEX.test(confirmed ?? "") ||
      confirmed?.toLowerCase() !== actual.toLowerCase()
    ) {
      throw new Error(
        `The confirmed ${label} SHA-256 does not match the fresh dry-run value; execution is blocked.`,
      );
    }
  }
};

export const buildOfficialWomensImportBackupEvidence = (
  artifact?: string,
  sha256?: string,
): VerifiedBackupEvidence => assertVerifiedBackupEvidence(artifact, sha256);

export interface OfficialWomensCommittedMatchLike {
  homeTeam?: unknown;
  awayTeam?: unknown;
  homeScore?: number;
  awayScore?: number;
  date?: Date | string;
  venue?: string;
  scheduleStatus?: MatchScheduleStatus;
  status?: MatchStatus;
  stage?: MatchStage;
  round?: number;
  groupKey?: unknown;
  leg?: number;
  fixtureKey?: string;
  officialFixtureNumber?: number;
  fixtureSource?: MatchFixtureSource;
  fixturePublicationHash?: string;
  fixtureSourceReference?: string;
  fixturePublishedBy?: unknown;
  fixturePublishedAt?: Date | string;
  events?: unknown[];
  isDeleted?: boolean;
  drawId?: unknown;
  bracketId?: unknown;
  bracketNodeKey?: unknown;
  womensFinalId?: unknown;
  winner?: unknown;
}

export const assertOfficialWomensImmutablePublishedMatchIdentity = (
  tournamentId: string,
  matches: OfficialWomensCommittedMatchLike[],
  planHash: string,
  publisherAdminId: string,
): { publishedAt: Date } => {
  if (!SHA256_HEX.test(planHash)) {
    throw new Error(
      "Committed women fixture verification requires a valid plan SHA-256.",
    );
  }
  if (matches.length !== OFFICIAL_WOMENS_NORMALIZED_FIXTURES.length) {
    throw new Error(
      "Committed women fixtures do not contain the exact three-row manifest.",
    );
  }
  const byNumber = new Map(
    matches.map((match) => [match.officialFixtureNumber, match]),
  );
  if (byNumber.size !== 3) {
    throw new Error(
      "Committed women fixtures have duplicate or missing official numbers.",
    );
  }

  let sharedPublishedAt: Date | undefined;
  for (const fixture of OFFICIAL_WOMENS_NORMALIZED_FIXTURES) {
    const match = byNumber.get(fixture.officialNumber);
    const publishedAt = match?.fixturePublishedAt
      ? new Date(match.fixturePublishedAt)
      : new Date(Number.NaN);
    if (
      !match ||
      objectIdString(match.homeTeam) !== fixture.homeTeamId ||
      objectIdString(match.awayTeam) !== fixture.awayTeamId ||
      match.stage !== MatchStage.LEAGUE ||
      match.round !== fixture.officialNumber ||
      match.groupKey != null ||
      match.leg !== 1 ||
      match.fixtureKey !==
        `${tournamentId}:league:official:${fixture.officialNumber}` ||
      match.fixtureSource !== MatchFixtureSource.PHYSICAL_OFFICIAL ||
      match.fixturePublicationHash !== planHash.toLowerCase() ||
      match.fixtureSourceReference !==
        OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE ||
      objectIdString(match.fixturePublishedBy) !== publisherAdminId ||
      Number.isNaN(publishedAt.getTime()) ||
      match.isDeleted !== false ||
      match.drawId != null ||
      match.bracketId != null ||
      match.bracketNodeKey != null ||
      match.womensFinalId != null ||
      match.winner != null
    ) {
      throw new Error(
        `Committed women fixture ${fixture.officialNumber} does not match the immutable manifest.`,
      );
    }
    if (
      sharedPublishedAt &&
      sharedPublishedAt.getTime() !== publishedAt.getTime()
    ) {
      throw new Error(
        "Committed women fixtures do not share one atomic publication timestamp.",
      );
    }
    sharedPublishedAt = publishedAt;
  }

  return { publishedAt: sharedPublishedAt! };
};

export const assertOfficialWomensCommittedMatchesMatchManifest = (
  tournamentId: string,
  matches: OfficialWomensCommittedMatchLike[],
  planHash: string,
  publisherAdminId: string,
): { publishedAt: Date } => {
  const identity = assertOfficialWomensImmutablePublishedMatchIdentity(
    tournamentId,
    matches,
    planHash,
    publisherAdminId,
  );
  const byNumber = new Map(
    matches.map((match) => [match.officialFixtureNumber, match]),
  );
  for (const fixture of OFFICIAL_WOMENS_NORMALIZED_FIXTURES) {
    const match = byNumber.get(fixture.officialNumber)!;
    const kickoff = match.date ? new Date(match.date) : new Date(Number.NaN);
    if (
      match.homeScore !== 0 ||
      match.awayScore !== 0 ||
      Number.isNaN(kickoff.getTime()) ||
      kickoff.toISOString() !== fixture.kickoffAt ||
      match.venue !== fixture.venue ||
      match.scheduleStatus !== MatchScheduleStatus.CONFIRMED ||
      match.status !== MatchStatus.SCHEDULED ||
      !Array.isArray(match.events) ||
      match.events.length !== 0 ||
      match.winner != null
    ) {
      throw new Error(
        `Committed women fixture ${fixture.officialNumber} does not match the immutable manifest's initial publication state.`,
      );
    }
  }
  return identity;
};

export const assertOfficialWomensStableIdempotencyIdentity = (): void => {
  if (
    OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY !==
      `official-womens-fixtures:${OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH}` ||
    OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY.length > 200
  ) {
    throw new Error(
      "The official women fixture idempotency identity is not stable.",
    );
  }
};
