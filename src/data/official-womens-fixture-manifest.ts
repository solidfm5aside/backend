import { createHash } from "node:crypto";

import { OFFICIAL_WOMENS_TOURNAMENT_ID } from "@/utils/official-womens-conversion.util";

export const OFFICIAL_WOMENS_FIXTURE_SOURCE = Object.freeze({
  fileName: "Womens_Category_Final_Fixtures_Updated.docx",
  sha256: "fda11501689e5c98533e353410521eb123d5993b436e7996df4d6bcd52848adb",
  byteLength: 37_260,
  title: "COJUDE SOLID FM 5-ASIDE FOOTBALL TOURNAMENT",
  scheduleTitle: "WOMEN'S CATEGORY – FINAL FIXTURES",
  competitionDescription: "Three-Team Women's Competition – Single Round-Robin",
  timeZone: "Africa/Lagos",
  localZoneAbbreviation: "WAT",
} as const);

export const OFFICIAL_WOMENS_MATCH_ONE_VENUE_SUPPLEMENT = Object.freeze({
  officialNumber: 1,
  rawDocumentVenueCell: "Opening Ceremony",
  confirmedVenueName: "Tribu Arena",
  authority: "competition-owner-confirmed-2026-08-23",
  scope: "match-1-physical-venue-only",
} as const);

export const OFFICIAL_WOMENS_TIME_RANGE_INTERPRETATION = Object.freeze({
  rawDocumentValue: "4:00–5:00 PM",
  kickoffLocalTime: "16:00",
  scheduledEndLocalTime: "17:00",
  storageScope: "kickoff-only",
  rationale:
    "The match API stores a kickoff instant; the range start is the kickoff.",
} as const);

export const OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE =
  `docx-sha256:${OFFICIAL_WOMENS_FIXTURE_SOURCE.sha256};match1-venue-owner-confirmed:2026-08-23;tz:WAT` as const;

export const OFFICIAL_WOMENS_FIXTURE_TEAMS = Object.freeze([
  Object.freeze({
    key: "rangers-international-women",
    sourceName: "Rangers International Women",
    databaseName: "RANGERS INTERNATIONAL WOMEN",
    entryId: "6a8a1f82508de0e7425195a8",
    teamId: "6a8a1f1f508de0e7425195a7",
  }),
  Object.freeze({
    key: "nysc-women",
    sourceName: "NYSC Women",
    databaseName: "NYSC WOMEN TEAM",
    entryId: "6a8a1fa1508de0e7425195a9",
    teamId: "6a8a1ec9508de0e7425195a6",
  }),
  Object.freeze({
    key: "zohar-fa",
    sourceName: "Zohar FA",
    databaseName: "ZOHAR FA",
    entryId: "6a8a1fb1508de0e7425195aa",
    teamId: "6a8a1ea3508de0e7425195a5",
  }),
] as const);

export type OfficialWomensFixtureTeamKey =
  (typeof OFFICIAL_WOMENS_FIXTURE_TEAMS)[number]["key"];

export interface OfficialWomensRawFixtureRow {
  readonly officialNumber: 1 | 2 | 3;
  readonly matchCell: string;
  readonly fixtureCell: string;
  readonly dateCell: string;
  readonly venueCell: string;
  readonly timeCell: string;
}

/** Exact cell text extracted from the reviewed DOCX table. */
export const OFFICIAL_WOMENS_RAW_FIXTURE_ROWS = Object.freeze([
  Object.freeze({
    officialNumber: 1,
    matchCell: "1",
    fixtureCell: "Rangers International Women vs Zohar FA",
    dateCell: "Sunday, 23 August 2026",
    venueCell: "Opening Ceremony",
    timeCell: "1:00 PM",
  }),
  Object.freeze({
    officialNumber: 2,
    matchCell: "2",
    fixtureCell: "NYSC Women vs Rangers International Women",
    dateCell: "Saturday, 12 September 2026",
    venueCell: "Tribu Arena",
    timeCell: "4:00–5:00 PM",
  }),
  Object.freeze({
    officialNumber: 3,
    matchCell: "3",
    fixtureCell: "NYSC Women vs Zohar FA",
    dateCell: "Sunday, 27 September 2026",
    venueCell: "Tribu Arena",
    timeCell: "4:00–5:00 PM",
  }),
] as const satisfies readonly OfficialWomensRawFixtureRow[]);

export interface OfficialWomensNormalizedFixture {
  readonly officialNumber: 1 | 2 | 3;
  readonly homeTeamKey: OfficialWomensFixtureTeamKey;
  readonly awayTeamKey: OfficialWomensFixtureTeamKey;
  readonly homeEntryId: string;
  readonly awayEntryId: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly localDate: string;
  readonly localKickoffTime: string;
  readonly kickoffAt: string;
  readonly venue: "Tribu Arena";
}

/**
 * WAT is UTC+01:00 on every listed date. The stored ISO values are the exact
 * UTC instants corresponding to the reviewed local kickoff times.
 */
export const OFFICIAL_WOMENS_NORMALIZED_FIXTURES = Object.freeze([
  Object.freeze({
    officialNumber: 1,
    homeTeamKey: "rangers-international-women",
    awayTeamKey: "zohar-fa",
    homeEntryId: "6a8a1f82508de0e7425195a8",
    awayEntryId: "6a8a1fb1508de0e7425195aa",
    homeTeamId: "6a8a1f1f508de0e7425195a7",
    awayTeamId: "6a8a1ea3508de0e7425195a5",
    localDate: "2026-08-23",
    localKickoffTime: "13:00",
    kickoffAt: "2026-08-23T12:00:00.000Z",
    venue: "Tribu Arena",
  }),
  Object.freeze({
    officialNumber: 2,
    homeTeamKey: "nysc-women",
    awayTeamKey: "rangers-international-women",
    homeEntryId: "6a8a1fa1508de0e7425195a9",
    awayEntryId: "6a8a1f82508de0e7425195a8",
    homeTeamId: "6a8a1ec9508de0e7425195a6",
    awayTeamId: "6a8a1f1f508de0e7425195a7",
    localDate: "2026-09-12",
    localKickoffTime: "16:00",
    kickoffAt: "2026-09-12T15:00:00.000Z",
    venue: "Tribu Arena",
  }),
  Object.freeze({
    officialNumber: 3,
    homeTeamKey: "nysc-women",
    awayTeamKey: "zohar-fa",
    homeEntryId: "6a8a1fa1508de0e7425195a9",
    awayEntryId: "6a8a1fb1508de0e7425195aa",
    homeTeamId: "6a8a1ec9508de0e7425195a6",
    awayTeamId: "6a8a1ea3508de0e7425195a5",
    localDate: "2026-09-27",
    localKickoffTime: "16:00",
    kickoffAt: "2026-09-27T15:00:00.000Z",
    venue: "Tribu Arena",
  }),
] as const satisfies readonly OfficialWomensNormalizedFixture[]);

export const OFFICIAL_WOMENS_FIXTURE_INPUTS = Object.freeze(
  OFFICIAL_WOMENS_NORMALIZED_FIXTURES.map((fixture) =>
    Object.freeze({
      officialNumber: fixture.officialNumber,
      homeEntryId: fixture.homeEntryId,
      awayEntryId: fixture.awayEntryId,
      kickoffAt: fixture.kickoffAt,
      venue: fixture.venue,
    }),
  ),
);

const fixtureTeamByKey = new Map(
  OFFICIAL_WOMENS_FIXTURE_TEAMS.map((team) => [team.key, team]),
);

/**
 * Exact hash returned by the production preview service for this reviewed
 * manifest at the audited pre-publication workflow revision. Pinning it
 * independently prevents a receipt and its matches from agreeing on a
 * substituted plan hash during a later verification-only replay.
 */
export const OFFICIAL_WOMENS_EXPECTED_PLAN_HASH = createHash("sha256")
  .update(
    JSON.stringify({
      tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
      tournamentRevision: 4,
      format: "single_table_final",
      division: "women",
      stage: "league",
      timeZone: OFFICIAL_WOMENS_FIXTURE_SOURCE.timeZone,
      sourceReference: OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE,
      totalMatches: 3,
      confirmedCount: 3,
      pendingCount: 0,
      fixtures: OFFICIAL_WOMENS_NORMALIZED_FIXTURES.map((fixture) => ({
        officialNumber: fixture.officialNumber,
        fixtureKey: `${OFFICIAL_WOMENS_TOURNAMENT_ID}:league:official:${fixture.officialNumber}`,
        leg: 1,
        homeEntryId: fixture.homeEntryId,
        awayEntryId: fixture.awayEntryId,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        homeTeamName: fixtureTeamByKey.get(fixture.homeTeamKey)!.databaseName,
        awayTeamName: fixtureTeamByKey.get(fixture.awayTeamKey)!.databaseName,
        kickoffAt: fixture.kickoffAt,
        venue: fixture.venue,
        scheduleStatus: "confirmed",
      })),
    }),
  )
  .digest("hex");

const publicationPayload = {
  tournamentId: OFFICIAL_WOMENS_TOURNAMENT_ID,
  source: OFFICIAL_WOMENS_FIXTURE_SOURCE,
  sourceReference: OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE,
  matchOneVenueSupplement: OFFICIAL_WOMENS_MATCH_ONE_VENUE_SUPPLEMENT,
  timeRangeInterpretation: OFFICIAL_WOMENS_TIME_RANGE_INTERPRETATION,
  teams: OFFICIAL_WOMENS_FIXTURE_TEAMS,
  rawRows: OFFICIAL_WOMENS_RAW_FIXTURE_ROWS,
  fixtures: OFFICIAL_WOMENS_NORMALIZED_FIXTURES,
};

export const OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH = createHash("sha256")
  .update(JSON.stringify(publicationPayload))
  .digest("hex");

export const OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY =
  `official-womens-fixtures:${OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH}` as const;

const localDateAndTime = (iso: string): { date: string; time: string } => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OFFICIAL_WOMENS_FIXTURE_SOURCE.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
};

export interface OfficialWomensFixtureManifestIntegritySummary {
  fixtureCount: 3;
  teamCount: 3;
  matchesPerTeam: Record<OfficialWomensFixtureTeamKey, number>;
  publicationHash: string;
}

export const assertOfficialWomensFixtureManifestIntegrity =
  (): OfficialWomensFixtureManifestIntegritySummary => {
    if (
      !/^[a-f0-9]{64}$/.test(OFFICIAL_WOMENS_FIXTURE_SOURCE.sha256) ||
      OFFICIAL_WOMENS_FIXTURE_SOURCE.byteLength !== 37_260
    ) {
      throw new Error("The reviewed women fixture source identity is invalid.");
    }
    if (OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE.length > 200) {
      throw new Error(
        "The women fixture source reference exceeds the match schema limit.",
      );
    }
    if (
      OFFICIAL_WOMENS_FIXTURE_TEAMS.length !== 3 ||
      OFFICIAL_WOMENS_RAW_FIXTURE_ROWS.length !== 3 ||
      OFFICIAL_WOMENS_NORMALIZED_FIXTURES.length !== 3
    ) {
      throw new Error(
        "The official women manifest must contain three teams and three fixtures.",
      );
    }

    const teamByKey = new Map(
      OFFICIAL_WOMENS_FIXTURE_TEAMS.map((team) => [team.key, team]),
    );
    const uniqueEntryIds = new Set(
      OFFICIAL_WOMENS_FIXTURE_TEAMS.map((team) => team.entryId),
    );
    const uniqueTeamIds = new Set(
      OFFICIAL_WOMENS_FIXTURE_TEAMS.map((team) => team.teamId),
    );
    if (uniqueEntryIds.size !== 3 || uniqueTeamIds.size !== 3) {
      throw new Error(
        "Every official women team must have one unique pinned team and entry ID.",
      );
    }

    const pairs = new Set<string>();
    const venueKickoffs = new Set<string>();
    const teamDays = new Set<string>();
    const matchesPerTeam = Object.fromEntries(
      OFFICIAL_WOMENS_FIXTURE_TEAMS.map((team) => [team.key, 0]),
    ) as Record<OfficialWomensFixtureTeamKey, number>;

    for (const [
      index,
      fixture,
    ] of OFFICIAL_WOMENS_NORMALIZED_FIXTURES.entries()) {
      const raw = OFFICIAL_WOMENS_RAW_FIXTURE_ROWS[index];
      if (
        fixture.officialNumber !== index + 1 ||
        raw.officialNumber !== fixture.officialNumber
      ) {
        throw new Error(
          "Women fixture numbers and raw rows must remain in exact document order.",
        );
      }
      const home = teamByKey.get(fixture.homeTeamKey);
      const away = teamByKey.get(fixture.awayTeamKey);
      if (
        !home ||
        !away ||
        home.entryId !== fixture.homeEntryId ||
        away.entryId !== fixture.awayEntryId ||
        home.teamId !== fixture.homeTeamId ||
        away.teamId !== fixture.awayTeamId
      ) {
        throw new Error(
          `Fixture ${fixture.officialNumber} does not use its pinned identities.`,
        );
      }
      if (raw.fixtureCell !== `${home.sourceName} vs ${away.sourceName}`) {
        throw new Error(
          `Fixture ${fixture.officialNumber} no longer matches its raw DOCX cell.`,
        );
      }
      const pair = [home.key, away.key].sort().join(":");
      if (pairs.has(pair)) {
        throw new Error(
          `Fixture ${fixture.officialNumber} repeats a women league pairing.`,
        );
      }
      pairs.add(pair);
      matchesPerTeam[home.key] += 1;
      matchesPerTeam[away.key] += 1;

      const kickoff = new Date(fixture.kickoffAt);
      if (
        Number.isNaN(kickoff.getTime()) ||
        kickoff.toISOString() !== fixture.kickoffAt ||
        JSON.stringify(localDateAndTime(fixture.kickoffAt)) !==
          JSON.stringify({
            date: fixture.localDate,
            time: fixture.localKickoffTime,
          })
      ) {
        throw new Error(
          `Fixture ${fixture.officialNumber} is not the pinned WAT kickoff instant.`,
        );
      }
      const venueKickoff = `${fixture.venue.toLocaleLowerCase()}:${fixture.kickoffAt}`;
      if (venueKickoffs.has(venueKickoff)) {
        throw new Error(
          `Fixture ${fixture.officialNumber} double-books its venue and kickoff.`,
        );
      }
      venueKickoffs.add(venueKickoff);
      for (const team of [home, away]) {
        const teamDay = `${team.teamId}:${fixture.localDate}`;
        if (teamDays.has(teamDay)) {
          throw new Error(
            `Fixture ${fixture.officialNumber} schedules a team twice in one day.`,
          );
        }
        teamDays.add(teamDay);
      }
    }

    if (
      pairs.size !== 3 ||
      Object.values(matchesPerTeam).some((count) => count !== 2)
    ) {
      throw new Error(
        "Every women team must play each other team once and exactly two matches.",
      );
    }
    if (
      OFFICIAL_WOMENS_NORMALIZED_FIXTURES[0].venue !==
        OFFICIAL_WOMENS_MATCH_ONE_VENUE_SUPPLEMENT.confirmedVenueName ||
      OFFICIAL_WOMENS_RAW_FIXTURE_ROWS[0].venueCell !==
        OFFICIAL_WOMENS_MATCH_ONE_VENUE_SUPPLEMENT.rawDocumentVenueCell
    ) {
      throw new Error(
        "Match 1 must preserve the raw cell and owner-confirmed Tribu venue override.",
      );
    }

    return {
      fixtureCount: 3,
      teamCount: 3,
      matchesPerTeam,
      publicationHash: OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH,
    };
  };
