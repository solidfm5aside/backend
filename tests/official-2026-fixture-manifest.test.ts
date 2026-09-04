import { createHash } from "node:crypto";

import {
  assertOfficial2026FixtureManifestIntegrity,
  getOfficial2026TeamDefinition,
  normalizeOfficial2026Name,
  OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
  OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE,
  OFFICIAL_2026_FIXTURES,
  OFFICIAL_2026_OPENER_SUPPLEMENT,
  OFFICIAL_2026_SOURCE_BYTE_LENGTH,
  OFFICIAL_2026_SOURCE_SHA256,
  OFFICIAL_2026_TEAMS,
  OFFICIAL_2026_TIME_ZONE,
  OFFICIAL_2026_VENUES,
  resolveOfficial2026TeamDefinition,
} from "@/data/official-2026-fixture-manifest";

const localDate = (iso: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OFFICIAL_2026_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

describe("official 2026 physical fixture manifest", () => {
  it("records the deliberate Pot 1 -> Group A and Pot 2 -> Group B mapping", () => {
    expect(OFFICIAL_2026_TEAMS).toHaveLength(14);
    expect(
      OFFICIAL_2026_TEAMS.filter((team) => team.groupKey === "A").map(
        (team) => team.sourcePot,
      ),
    ).toEqual(Array(7).fill("Pot 1"));
    expect(
      OFFICIAL_2026_TEAMS.filter((team) => team.groupKey === "B").map(
        (team) => team.sourcePot,
      ),
    ).toEqual(Array(7).fill("Pot 2"));
  });

  it("pins the exact current 14-team database identity inventory", () => {
    expect(OFFICIAL_2026_TEAMS.map((team) => team.databaseName).sort()).toEqual(
      [
        "ACE FC",
        "BIG TIME FC",
        "GOLDEN BOYS OF KIBANG",
        "LALA BROTHERS FC",
        "MR PHIL PHOTO FC",
        "NYSC FC",
        "PADRE FC",
        "ROCK FC",
        "SAMBA BOYS FC",
        "SMOOTH CITIZENS FC",
        "SUCCESS FC",
        "TAWM FC",
        "TRIBU HOTEL FC",
        "UDI SIDING YOUTH FC",
      ],
    );
    for (const team of OFFICIAL_2026_TEAMS) {
      expect(resolveOfficial2026TeamDefinition(team.databaseName)?.key).toBe(
        team.key,
      );
    }
  });

  it("pins the three live venue identities and their document display labels", () => {
    expect(
      OFFICIAL_2026_VENUES.map(({ databaseName, documentName }) => ({
        databaseName,
        documentName,
      })),
    ).toEqual([
      { databaseName: "ECLIPSE ARENA", documentName: "Eclipse Arena" },
      { databaseName: "WEMBLEY ARENA", documentName: "Wembley Hotel" },
      { databaseName: "TRIBU HOTEL ARENA", documentName: "Tribu Arena" },
    ]);
  });

  it("resolves only the source-document aliases without creating duplicate identities", () => {
    expect(resolveOfficial2026TeamDefinition("Tribu Hotel")?.key).toBe(
      "tribu-hotel-fc",
    );
    expect(resolveOfficial2026TeamDefinition("Tribu Hotel FC")?.key).toBe(
      "tribu-hotel-fc",
    );
    expect(resolveOfficial2026TeamDefinition("Udi Siding Youths")?.key).toBe(
      "udi-siding-youths-fc",
    );
    expect(resolveOfficial2026TeamDefinition("Success")?.key).toBe("success-fc");
    expect(
      resolveOfficial2026TeamDefinition("Not An Official Team"),
    ).toBeNull();
    expect(normalizeOfficial2026Name("  MrPhil   Photos ")).toBe(
      "mrphil photos",
    );
  });

  it("contains exactly 42 unique group pairs, 21 per group and six per team", () => {
    const pairKeys = new Set<string>();
    const pairsPerGroup = { A: new Set<string>(), B: new Set<string>() };
    const teamCounts = new Map(
      OFFICIAL_2026_TEAMS.map((team) => [team.key, 0]),
    );

    for (const fixture of OFFICIAL_2026_FIXTURES) {
      const pair = [fixture.homeTeamKey, fixture.awayTeamKey].sort().join(":");
      pairKeys.add(`${fixture.groupKey}:${pair}`);
      pairsPerGroup[fixture.groupKey].add(pair);
      teamCounts.set(
        fixture.homeTeamKey,
        (teamCounts.get(fixture.homeTeamKey) ?? 0) + 1,
      );
      teamCounts.set(
        fixture.awayTeamKey,
        (teamCounts.get(fixture.awayTeamKey) ?? 0) + 1,
      );
      expect(getOfficial2026TeamDefinition(fixture.homeTeamKey).groupKey).toBe(
        fixture.groupKey,
      );
      expect(getOfficial2026TeamDefinition(fixture.awayTeamKey).groupKey).toBe(
        fixture.groupKey,
      );
    }

    expect(OFFICIAL_2026_FIXTURES).toHaveLength(42);
    expect(pairKeys.size).toBe(42);
    expect(pairsPerGroup.A.size).toBe(21);
    expect(pairsPerGroup.B.size).toBe(21);
    expect([...teamCounts.values()]).toEqual(Array(14).fill(6));
  });

  it("places the separately confirmed opener first and keeps all 42 schedules confirmed", () => {
    const confirmed = OFFICIAL_2026_FIXTURES;

    expect(
      OFFICIAL_2026_FIXTURES.every(
        (fixture) => fixture.scheduleStatus === "confirmed",
      ),
    ).toBe(true);
    expect(confirmed).toHaveLength(42);
    expect(
      OFFICIAL_2026_FIXTURES.slice(1).every(
        (fixture) =>
          fixture.venueName === "Tribu Arena" ||
          fixture.venueName === "Wembley Hotel",
      ),
    ).toBe(true);
    expect(
      OFFICIAL_2026_FIXTURES.map((fixture) => fixture.officialNumber),
    ).toEqual(Array.from({ length: 42 }, (_, index) => index + 1));
    expect(OFFICIAL_2026_FIXTURES[0]).toEqual(
      expect.objectContaining({
        officialNumber: 1,
        homeTeamKey: "samba-boys",
        awayTeamKey: "nysc-fc",
        sourceAwayName: "NYSC",
        kickoffAt: "2026-08-23T14:00:00.000Z",
        venueName: "Tribu Arena",
        scheduleStatus: "confirmed",
      }),
    );
    expect(confirmed[1]).toEqual(
      expect.objectContaining({
        officialNumber: 2,
        kickoffAt: "2026-09-13T14:00:00.000Z",
        venueName: "Wembley Hotel",
      }),
    );
    expect(confirmed.at(-1)).toEqual(
      expect.objectContaining({
        officialNumber: 42,
        kickoffAt: "2026-09-20T15:00:00.000Z",
        venueName: "Wembley Hotel",
      }),
    );
  });

  it("has no confirmed team/day or venue/kickoff conflicts", () => {
    const teamDates = new Set<string>();
    const venueSlots = new Set<string>();

    for (const fixture of OFFICIAL_2026_FIXTURES) {
      if (!fixture.kickoffAt || !fixture.venueName) continue;
      const date = localDate(fixture.kickoffAt);
      for (const teamKey of [fixture.homeTeamKey, fixture.awayTeamKey]) {
        const key = `${teamKey}:${date}`;
        expect(teamDates.has(key)).toBe(false);
        teamDates.add(key);
      }
      const slotKey = `${fixture.kickoffAt}:${fixture.venueName}`;
      expect(venueSlots.has(slotKey)).toBe(false);
      venueSlots.add(slotKey);
    }
  });

  it("passes the reusable pure integrity guard and exposes a stable SHA-256 marker", () => {
    expect(assertOfficial2026FixtureManifestIntegrity()).toEqual(
      expect.objectContaining({
        fixtureCount: 42,
        confirmedFixtureCount: 42,
        pendingFixtureCount: 0,
        fixturesPerGroup: { A: 21, B: 21 },
      }),
    );
    expect(OFFICIAL_2026_FIXTURE_PUBLICATION_HASH).toBe(
      "11f5eec3538ac33a48a2866d167507527d0e290bb6f84581515175df9ac6d569",
    );
    expect(OFFICIAL_2026_SOURCE_SHA256).toBe(
      "0d9061edc5ab1a23ae16a7627354203c3563e398f9f5c0fe41c9a980e3f9be22",
    );
    expect(OFFICIAL_2026_SOURCE_BYTE_LENGTH).toBe(37_952);
    expect(OFFICIAL_2026_OPENER_SUPPLEMENT).toEqual({
      sourceTitle: "WhatsApp Image 2026-08-22 at 7.10.30 PM.jpeg",
      sourceSha256:
        "2aa35e968a6147639da44d83c1535263d2a445a48b9264c282ddea2a8fa431db",
      sourceByteLength: 26_158,
      evidenceScope: "fixture-1-pairing-and-15:00-local-kickoff",
      confirmedLocalDate: "2026-08-23",
      confirmedLocalKickoffTime: "15:00",
      confirmedVenueName: "Tribu Arena",
      dateAndVenueAuthority: "user-confirmed-2026-08-22",
    });
    expect(OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE).toContain(
      `docx-sha256:${OFFICIAL_2026_SOURCE_SHA256}`,
    );
    expect(OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE).toContain(
      `opener-image-sha256:${OFFICIAL_2026_OPENER_SUPPLEMENT.sourceSha256}`,
    );
    expect(OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE).toContain(
      "master-reschedule:2026-09-04",
    );
    expect(OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE.length).toBeLessThanOrEqual(
      200,
    );

    expect(
      createHash("sha256")
        .update(JSON.stringify(OFFICIAL_2026_FIXTURES.slice(1)))
        .digest("hex"),
    ).toBe(
      "5072c2773aa9e6527330685fafb6206fa58a8cf693efd4a9012f7b5c496a1652",
    );
  });
});
