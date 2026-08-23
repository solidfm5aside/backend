import {
  OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY,
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
  assertOfficialWomensCommittedMatchesMatchManifest,
  assertOfficialWomensImmutablePublishedMatchIdentity,
  assertOfficialWomensImportConfirmationHashes,
  assertOfficialWomensSourceEvidence,
  assertOfficialWomensStableIdempotencyIdentity,
  buildOfficialWomensImportBackupEvidence,
  hashOfficialWomensImportEvidence,
  OfficialWomensCommittedMatchLike,
} from "@/utils/official-womens-fixture-import.util";

describe("guarded official women fixture import utilities", () => {
  it("requires the exact reviewed DOCX bytes and explicit source confirmation", () => {
    const evidence = {
      fileName: OFFICIAL_WOMENS_FIXTURE_SOURCE.fileName,
      byteLength: OFFICIAL_WOMENS_FIXTURE_SOURCE.byteLength,
      sha256: OFFICIAL_WOMENS_FIXTURE_SOURCE.sha256.toUpperCase(),
    };
    expect(
      assertOfficialWomensSourceEvidence(
        evidence,
        OFFICIAL_WOMENS_FIXTURE_SOURCE.sha256,
      ),
    ).toEqual({ ...evidence, sha256: OFFICIAL_WOMENS_FIXTURE_SOURCE.sha256 });
    expect(() =>
      assertOfficialWomensSourceEvidence({
        ...evidence,
        byteLength: evidence.byteLength + 1,
      }),
    ).toThrow(/immutable reviewed/i);
    expect(() =>
      assertOfficialWomensSourceEvidence(evidence, "0".repeat(64)),
    ).toThrow(/explicit source/i);
  });

  it("requires exact fresh inventory, men-state, and plan hashes", () => {
    const inventory = "1".repeat(64);
    const men = "2".repeat(64);
    const plan = "3".repeat(64);
    expect(() =>
      assertOfficialWomensImportConfirmationHashes({
        confirmedInventorySha256: inventory.toUpperCase(),
        actualInventorySha256: inventory,
        confirmedMensSha256: men,
        actualMensSha256: men,
        confirmedPlanSha256: plan,
        actualPlanSha256: plan,
      }),
    ).not.toThrow();
    expect(() =>
      assertOfficialWomensImportConfirmationHashes({
        confirmedInventorySha256: inventory,
        actualInventorySha256: inventory,
        confirmedMensSha256: "4".repeat(64),
        actualMensSha256: men,
        confirmedPlanSha256: plan,
        actualPlanSha256: plan,
      }),
    ).toThrow(/men state/i);
  });

  it("stores only safe backup evidence and has one stable idempotency identity", () => {
    expect(
      buildOfficialWomensImportBackupEvidence(
        "women-before-fixtures.archive",
        "A".repeat(64),
      ),
    ).toEqual({
      artifact: "women-before-fixtures.archive",
      sha256: "a".repeat(64),
    });
    expect(() =>
      buildOfficialWomensImportBackupEvidence(
        "../unsafe.archive",
        "a".repeat(64),
      ),
    ).toThrow(/safe-basename/i);
    expect(() => assertOfficialWomensStableIdempotencyIdentity()).not.toThrow();
    expect(OFFICIAL_WOMENS_FIXTURE_IDEMPOTENCY_KEY.length).toBeLessThanOrEqual(
      200,
    );
  });

  it("canonicalizes evidence before hashing", () => {
    expect(hashOfficialWomensImportEvidence({ b: 2, a: { y: 2, x: 1 } })).toBe(
      hashOfficialWomensImportEvidence({ a: { x: 1, y: 2 }, b: 2 }),
    );
  });

  it("verifies every immutable and initial-state committed match field", () => {
    const tournamentId = "6a8a1c47508de0e7425195a4";
    const publisherAdminId = "69c1de8a26966eeb2b5da87a";
    const planHash = "b".repeat(64);
    const publishedAt = new Date("2026-08-23T12:30:00.000Z");
    const buildMatches = (): OfficialWomensCommittedMatchLike[] =>
      OFFICIAL_WOMENS_NORMALIZED_FIXTURES.map((fixture) => ({
        homeTeam: fixture.homeTeamId,
        awayTeam: fixture.awayTeamId,
        homeScore: 0,
        awayScore: 0,
        date: new Date(fixture.kickoffAt),
        venue: fixture.venue,
        scheduleStatus: MatchScheduleStatus.CONFIRMED,
        status: MatchStatus.SCHEDULED,
        stage: MatchStage.LEAGUE,
        round: fixture.officialNumber,
        leg: 1,
        fixtureKey: `${tournamentId}:league:official:${fixture.officialNumber}`,
        officialFixtureNumber: fixture.officialNumber,
        fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
        fixturePublicationHash: planHash,
        fixtureSourceReference: OFFICIAL_WOMENS_FIXTURE_SOURCE_REFERENCE,
        fixturePublishedBy: publisherAdminId,
        fixturePublishedAt: publishedAt,
        events: [],
        isDeleted: false,
      }));

    expect(
      assertOfficialWomensCommittedMatchesMatchManifest(
        tournamentId,
        buildMatches().reverse(),
        planHash,
        publisherAdminId,
      ),
    ).toEqual({ publishedAt });

    for (const corrupt of [
      (matches: OfficialWomensCommittedMatchLike[]) => {
        matches[0].date = new Date("2026-08-23T13:00:00.000Z");
      },
      (matches: OfficialWomensCommittedMatchLike[]) => {
        matches[0].venue = "Wrong Arena";
      },
      (matches: OfficialWomensCommittedMatchLike[]) => {
        matches[0].fixturePublishedBy = "0".repeat(24);
      },
      (matches: OfficialWomensCommittedMatchLike[]) => {
        matches[0].bracketId = "1".repeat(24);
      },
      (matches: OfficialWomensCommittedMatchLike[]) => {
        matches[0].homeScore = 1;
      },
    ]) {
      const matches = buildMatches();
      corrupt(matches);
      expect(() =>
        assertOfficialWomensCommittedMatchesMatchManifest(
          tournamentId,
          matches,
          planHash,
          publisherAdminId,
        ),
      ).toThrow(/immutable manifest/i);
    }

    const evolved = buildMatches();
    evolved[0].homeScore = 2;
    evolved[0].awayScore = 1;
    evolved[0].status = MatchStatus.COMPLETED;
    evolved[0].date = new Date("2026-08-24T13:00:00.000Z");
    evolved[0].venue = "Another Active Arena";
    evolved[0].events = [{ type: "goal" }];
    expect(() =>
      assertOfficialWomensImmutablePublishedMatchIdentity(
        tournamentId,
        evolved,
        planHash,
        publisherAdminId,
      ),
    ).not.toThrow();
    expect(() =>
      assertOfficialWomensCommittedMatchesMatchManifest(
        tournamentId,
        evolved,
        planHash,
        publisherAdminId,
      ),
    ).toThrow(/initial publication state/i);

    evolved[0].fixtureKey = `${tournamentId}:league:official:999`;
    expect(() =>
      assertOfficialWomensImmutablePublishedMatchIdentity(
        tournamentId,
        evolved,
        planHash,
        publisherAdminId,
      ),
    ).toThrow(/immutable manifest/i);

    const impossibleLeagueWinner = buildMatches();
    impossibleLeagueWinner[0].winner = impossibleLeagueWinner[0].homeTeam;
    expect(() =>
      assertOfficialWomensImmutablePublishedMatchIdentity(
        tournamentId,
        impossibleLeagueWinner,
        planHash,
        publisherAdminId,
      ),
    ).toThrow(/immutable manifest/i);
  });
});
