import {
  assertOfficialWomensFixtureManifestIntegrity,
  OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY,
  OFFICIAL_WOMENS_EXPECTED_PLAN_HASH,
  OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH,
  OFFICIAL_WOMENS_FIXTURE_SOURCE,
  OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE,
  OFFICIAL_WOMENS_FIXTURE_TEAMS,
  OFFICIAL_WOMENS_MATCH_ONE_VENUE_SUPPLEMENT,
  OFFICIAL_WOMENS_NORMALIZED_FIXTURES,
  OFFICIAL_WOMENS_RAW_FIXTURE_ROWS,
  OFFICIAL_WOMENS_TIME_RANGE_INTERPRETATION,
} from "@/data/official-womens-fixture-manifest";

describe("official women physical fixture manifest", () => {
  it("pins the exact reviewed DOCX identity and preserves every raw table cell", () => {
    expect(OFFICIAL_WOMENS_FIXTURE_SOURCE).toEqual({
      fileName: "Womens_Category_Final_Fixtures_Updated.docx",
      sha256:
        "fda11501689e5c98533e353410521eb123d5993b436e7996df4d6bcd52848adb",
      byteLength: 37_260,
      title: "COJUDE SOLID FM 5-ASIDE FOOTBALL TOURNAMENT",
      scheduleTitle: "WOMEN'S CATEGORY – FINAL FIXTURES",
      competitionDescription:
        "Three-Team Women's Competition – Single Round-Robin",
      timeZone: "Africa/Lagos",
      localZoneAbbreviation: "WAT",
    });
    expect(OFFICIAL_WOMENS_RAW_FIXTURE_ROWS).toEqual([
      {
        officialNumber: 1,
        matchCell: "1",
        fixtureCell: "Rangers International Women vs Zohar FA",
        dateCell: "Sunday, 23 August 2026",
        venueCell: "Opening Ceremony",
        timeCell: "1:00 PM",
      },
      {
        officialNumber: 2,
        matchCell: "2",
        fixtureCell: "NYSC Women vs Rangers International Women",
        dateCell: "Saturday, 12 September 2026",
        venueCell: "Tribu Arena",
        timeCell: "4:00–5:00 PM",
      },
      {
        officialNumber: 3,
        matchCell: "3",
        fixtureCell: "NYSC Women vs Zohar FA",
        dateCell: "Sunday, 27 September 2026",
        venueCell: "Tribu Arena",
        timeCell: "4:00–5:00 PM",
      },
    ]);
  });

  it("pins exact entry/team IDs instead of fuzzy-matching live names", () => {
    expect(OFFICIAL_WOMENS_FIXTURE_TEAMS).toEqual([
      expect.objectContaining({
        sourceName: "Rangers International Women",
        databaseName: "RANGERS INTERNATIONAL WOMEN",
        entryId: "6a8a1f82508de0e7425195a8",
        teamId: "6a8a1f1f508de0e7425195a7",
      }),
      expect.objectContaining({
        sourceName: "NYSC Women",
        databaseName: "NYSC WOMEN TEAM",
        entryId: "6a8a1fa1508de0e7425195a9",
        teamId: "6a8a1ec9508de0e7425195a6",
      }),
      expect.objectContaining({
        sourceName: "Zohar FA",
        databaseName: "ZOHAR FA",
        entryId: "6a8a1fb1508de0e7425195aa",
        teamId: "6a8a1ea3508de0e7425195a5",
      }),
    ]);
  });

  it("normalizes all three WAT kickoffs and uses the confirmed Tribu venue", () => {
    expect(OFFICIAL_WOMENS_NORMALIZED_FIXTURES).toEqual([
      expect.objectContaining({
        officialNumber: 1,
        homeTeamKey: "rangers-international-women",
        awayTeamKey: "zohar-fa",
        localDate: "2026-08-23",
        localKickoffTime: "13:00",
        kickoffAt: "2026-08-23T12:00:00.000Z",
        venue: "Tribu Arena",
      }),
      expect.objectContaining({
        officialNumber: 2,
        homeTeamKey: "nysc-women",
        awayTeamKey: "rangers-international-women",
        localDate: "2026-09-12",
        localKickoffTime: "16:00",
        kickoffAt: "2026-09-12T15:00:00.000Z",
        venue: "Tribu Arena",
      }),
      expect.objectContaining({
        officialNumber: 3,
        homeTeamKey: "nysc-women",
        awayTeamKey: "zohar-fa",
        localDate: "2026-09-27",
        localKickoffTime: "16:00",
        kickoffAt: "2026-09-27T15:00:00.000Z",
        venue: "Tribu Arena",
      }),
    ]);
    expect(OFFICIAL_WOMENS_MATCH_ONE_VENUE_SUPPLEMENT).toEqual({
      officialNumber: 1,
      rawDocumentVenueCell: "Opening Ceremony",
      confirmedVenueName: "Tribu Arena",
      authority: "competition-owner-confirmed-2026-08-23",
      scope: "match-1-physical-venue-only",
    });
    expect(OFFICIAL_WOMENS_TIME_RANGE_INTERPRETATION).toMatchObject({
      rawDocumentValue: "4:00–5:00 PM",
      kickoffLocalTime: "16:00",
      scheduledEndLocalTime: "17:00",
      storageScope: "kickoff-only",
    });
  });

  it("passes coverage/integrity guards and exposes immutable hash identities", () => {
    expect(assertOfficialWomensFixtureManifestIntegrity()).toEqual({
      fixtureCount: 3,
      teamCount: 3,
      matchesPerTeam: {
        "rangers-international-women": 2,
        "nysc-women": 2,
        "zohar-fa": 2,
      },
      publicationHash:
        "d4885b89b8221d3d2d548b9a8d6f0fe4b438d758ceefcd257febf455499bdc4f",
    });
    expect(OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH).toBe(
      "d4885b89b8221d3d2d548b9a8d6f0fe4b438d758ceefcd257febf455499bdc4f",
    );
    expect(OFFICIAL_WOMENS_EXPECTED_PLAN_HASH).toBe(
      "4da7ebc9b7a980a6772a44542e1db569105d96fca9322e276465105383b321ce",
    );
    expect(OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY).toBe(
      `official-womens-fixtures:${OFFICIAL_WOMENS_FIXTURE_PUBLICATION_HASH}`,
    );
    expect(OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE).toContain(
      `docx-sha256:${OFFICIAL_WOMENS_FIXTURE_SOURCE.sha256}`,
    );
    expect(OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE.length).toBeLessThanOrEqual(
      200,
    );
  });
});
