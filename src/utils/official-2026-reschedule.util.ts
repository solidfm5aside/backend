import {
  OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
  OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE,
  OFFICIAL_2026_FIXTURES,
  Official2026TeamKey,
} from "@/data/official-2026-fixture-manifest";
import {
  MatchFixtureSource,
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from "@/models/match.model";

export const OFFICIAL_2026_FROZEN_OPENER_RESULT = {
  officialNumber: 1,
  homeTeamKey: "samba-boys",
  awayTeamKey: "nysc-fc",
  homeScore: 8,
  awayScore: 1,
  status: MatchStatus.COMPLETED,
  kickoffAt: "2026-08-23T14:00:00.000Z",
  venueName: "Tribu Arena",
} as const;

export interface Official2026RescheduleMatchLike {
  homeTeam: unknown;
  awayTeam: unknown;
  homeScore?: number;
  awayScore?: number;
  date?: Date | string;
  venue?: string;
  status?: string;
  stage?: string;
  groupKey?: string;
  leg?: number;
  fixtureKey?: string;
  scheduleStatus?: string;
  officialFixtureNumber?: number;
  fixtureSource?: string;
  fixturePublicationHash?: string;
  fixtureSourceReference?: string;
  fixturePublishedAt?: Date | string;
  events?: unknown[];
  isDeleted?: boolean;
  resultLockedAt?: Date | string;
  winner?: unknown;
}

export interface Official2026RescheduleRow {
  officialNumber: number;
  homeTeamKey: Official2026TeamKey;
  awayTeamKey: Official2026TeamKey;
  fromKickoff: string | null;
  toKickoff: string;
  fromVenue: string | null;
  toVenue: string;
  swappedHomeAway: boolean;
  metadataOnly: boolean;
}

export interface Official2026ReschedulePlan {
  alreadyApplied: boolean;
  remainingScheduleChanges: number;
  homeAwaySwaps: number;
  rows: Official2026RescheduleRow[];
}

const dateIso = (value: Date | string | undefined): string | null => {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const pairKey = (left: string, right: string): string =>
  [left, right].sort().join(":");

const teamId = (
  teamIdsByKey: ReadonlyMap<Official2026TeamKey, string>,
  key: Official2026TeamKey,
): string => {
  const id = teamIdsByKey.get(key);
  if (!id) {
    throw new Error(`Reschedule could not resolve team identity for ${key}.`);
  }
  return id;
};

const keyByTeamId = (
  teamIdsByKey: ReadonlyMap<Official2026TeamKey, string>,
): Map<string, Official2026TeamKey> => {
  const reversed = new Map<string, Official2026TeamKey>();
  for (const [key, id] of teamIdsByKey) {
    if (reversed.has(id)) {
      throw new Error("Reschedule team identity map contains duplicate IDs.");
    }
    reversed.set(id, key);
  }
  return reversed;
};

export const assertOfficial2026OpenerIsFrozen = (
  match: Official2026RescheduleMatchLike,
  teamIdsByKey: ReadonlyMap<Official2026TeamKey, string>,
): void => {
  const expectedHome = teamId(teamIdsByKey, OFFICIAL_2026_FROZEN_OPENER_RESULT.homeTeamKey);
  const expectedAway = teamId(teamIdsByKey, OFFICIAL_2026_FROZEN_OPENER_RESULT.awayTeamKey);
  if (
    match.officialFixtureNumber !== OFFICIAL_2026_FROZEN_OPENER_RESULT.officialNumber ||
    String(match.homeTeam) !== expectedHome ||
    String(match.awayTeam) !== expectedAway ||
    match.status !== OFFICIAL_2026_FROZEN_OPENER_RESULT.status ||
    (match.homeScore ?? 0) !== OFFICIAL_2026_FROZEN_OPENER_RESULT.homeScore ||
    (match.awayScore ?? 0) !== OFFICIAL_2026_FROZEN_OPENER_RESULT.awayScore ||
    dateIso(match.date) !== OFFICIAL_2026_FROZEN_OPENER_RESULT.kickoffAt ||
    (match.venue ?? null) !== OFFICIAL_2026_FROZEN_OPENER_RESULT.venueName ||
    match.scheduleStatus !== MatchScheduleStatus.CONFIRMED ||
    match.stage !== MatchStage.GROUP_STAGE ||
    match.isDeleted !== false
  ) {
    throw new Error(
      "Official fixture 1 must remain the completed Samba Boys 8-1 NYSC opener at Tribu Arena.",
    );
  }
};

export const buildOfficial2026ReschedulePlan = (
  tournamentId: string,
  matches: Official2026RescheduleMatchLike[],
  teamIdsByKey: ReadonlyMap<Official2026TeamKey, string>,
): Official2026ReschedulePlan => {
  if (matches.length !== OFFICIAL_2026_FIXTURES.length) {
    throw new Error(
      `Reschedule expected 42 stored men's group fixtures, found ${matches.length}.`,
    );
  }

  const sorted = [...matches].sort(
    (left, right) =>
      (left.officialFixtureNumber ?? Number.MAX_SAFE_INTEGER) -
      (right.officialFixtureNumber ?? Number.MAX_SAFE_INTEGER),
  );
  const teamKeyById = keyByTeamId(teamIdsByKey);
  const rows: Official2026RescheduleRow[] = [];
  let remainingScheduleChanges = 0;
  let homeAwaySwaps = 0;
  let alreadyApplied = true;

  for (let index = 0; index < OFFICIAL_2026_FIXTURES.length; index++) {
    const expected = OFFICIAL_2026_FIXTURES[index];
    const stored = sorted[index];
    const expectedHome = teamId(teamIdsByKey, expected.homeTeamKey);
    const expectedAway = teamId(teamIdsByKey, expected.awayTeamKey);
    const expectedKey = `${tournamentId}:group_stage:official:${expected.officialNumber}`;

    if (
      stored.officialFixtureNumber !== expected.officialNumber ||
      stored.groupKey !== expected.groupKey ||
      stored.fixtureKey !== expectedKey ||
      stored.fixtureSource !== MatchFixtureSource.PHYSICAL_OFFICIAL ||
      stored.stage !== MatchStage.GROUP_STAGE ||
      stored.leg !== 1 ||
      stored.isDeleted !== false
    ) {
      throw new Error(
        `Stored official fixture ${expected.officialNumber} does not keep its published identity.`,
      );
    }

    if (expected.officialNumber === 1) {
      assertOfficial2026OpenerIsFrozen(stored, teamIdsByKey);
      const metadataMatches =
        stored.fixturePublicationHash === OFFICIAL_2026_FIXTURE_PUBLICATION_HASH &&
        stored.fixtureSourceReference === OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE;
      if (!metadataMatches) alreadyApplied = false;
      rows.push({
        officialNumber: 1,
        homeTeamKey: expected.homeTeamKey,
        awayTeamKey: expected.awayTeamKey,
        fromKickoff: dateIso(stored.date),
        toKickoff: expected.kickoffAt!,
        fromVenue: stored.venue ?? null,
        toVenue: expected.venueName!,
        swappedHomeAway: false,
        metadataOnly: true,
      });
      continue;
    }

    if (
      stored.status !== MatchStatus.SCHEDULED ||
      stored.resultLockedAt ||
      stored.winner ||
      (stored.homeScore ?? 0) !== 0 ||
      (stored.awayScore ?? 0) !== 0 ||
      (stored.events?.length ?? 0) !== 0
    ) {
      throw new Error(
        `Official fixture ${expected.officialNumber} is no longer a blank scheduled match and cannot be rewritten.`,
      );
    }

    const storedHomeKey = teamKeyById.get(String(stored.homeTeam));
    const storedAwayKey = teamKeyById.get(String(stored.awayTeam));
    if (!storedHomeKey || !storedAwayKey) {
      throw new Error(
        `Official fixture ${expected.officialNumber} references a team outside the pinned 14-team inventory.`,
      );
    }
    if (
      pairKey(storedHomeKey, storedAwayKey) !==
      pairKey(expected.homeTeamKey, expected.awayTeamKey)
    ) {
      throw new Error(
        `Official fixture ${expected.officialNumber} pairing no longer matches the pinned group pair.`,
      );
    }

    const swappedHomeAway =
      storedHomeKey !== expected.homeTeamKey || storedAwayKey !== expected.awayTeamKey;
    const fromKickoff = dateIso(stored.date);
    const fromVenue = stored.venue ?? null;
    const scheduleChanged =
      fromKickoff !== expected.kickoffAt || fromVenue !== expected.venueName || swappedHomeAway;
    const metadataMatches =
      String(stored.homeTeam) === expectedHome &&
      String(stored.awayTeam) === expectedAway &&
      stored.scheduleStatus === MatchScheduleStatus.CONFIRMED &&
      stored.fixturePublicationHash === OFFICIAL_2026_FIXTURE_PUBLICATION_HASH &&
      stored.fixtureSourceReference === OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE &&
      !scheduleChanged;

    if (!metadataMatches) alreadyApplied = false;
    if (scheduleChanged) remainingScheduleChanges += 1;
    if (swappedHomeAway) homeAwaySwaps += 1;

    rows.push({
      officialNumber: expected.officialNumber,
      homeTeamKey: expected.homeTeamKey,
      awayTeamKey: expected.awayTeamKey,
      fromKickoff,
      toKickoff: expected.kickoffAt!,
      fromVenue,
      toVenue: expected.venueName!,
      swappedHomeAway,
      metadataOnly: false,
    });
  }

  return {
    alreadyApplied,
    remainingScheduleChanges,
    homeAwaySwaps,
    rows,
  };
};

export const assertOfficial2026RescheduledMatchesMatchManifest = (
  tournamentId: string,
  matches: Official2026RescheduleMatchLike[],
  teamIdsByKey: ReadonlyMap<Official2026TeamKey, string>,
): void => {
  const plan = buildOfficial2026ReschedulePlan(tournamentId, matches, teamIdsByKey);
  if (!plan.alreadyApplied || plan.remainingScheduleChanges !== 0 || plan.homeAwaySwaps !== 0) {
    throw new Error("Post-commit verification found men's fixtures that still do not match the master sheet.");
  }

  const sorted = [...matches].sort(
    (left, right) =>
      (left.officialFixtureNumber ?? Number.MAX_SAFE_INTEGER) -
      (right.officialFixtureNumber ?? Number.MAX_SAFE_INTEGER),
  );

  for (let index = 0; index < OFFICIAL_2026_FIXTURES.length; index++) {
    const expected = OFFICIAL_2026_FIXTURES[index];
    const stored = sorted[index];
    const expectedHome = teamId(teamIdsByKey, expected.homeTeamKey);
    const expectedAway = teamId(teamIdsByKey, expected.awayTeamKey);
    if (
      String(stored.homeTeam) !== expectedHome ||
      String(stored.awayTeam) !== expectedAway ||
      dateIso(stored.date) !== expected.kickoffAt ||
      (stored.venue ?? null) !== expected.venueName ||
      stored.fixturePublicationHash !== OFFICIAL_2026_FIXTURE_PUBLICATION_HASH ||
      stored.fixtureSourceReference !== OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE
    ) {
      throw new Error(
        `Post-commit fixture ${expected.officialNumber} does not match the verified master sheet.`,
      );
    }
  }
};
