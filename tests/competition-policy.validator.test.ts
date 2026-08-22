import {
  CompetitionCommitteeDecisionMethod,
  CompetitionDrawMode,
  CompetitionTieBreaker,
  FIXED_V2_COMPETITION_RULES,
} from '@/models/tournament.model';
import {
  createCompetitionDrawSchema,
  previewGroupFixturesSchema,
  publishGroupFixturesSchema,
  resolveCompetitionTieSchema,
  updateCompetitionRulesSchema,
} from '@/validators/competition.validator';

const objectIds = Array.from(
  { length: 14 },
  (_, index) => (index + 1).toString(16).padStart(24, '0')
);

describe('fixed v2 competition API policy', () => {
  it('publishes the confirmed immutable rule values', () => {
    expect(FIXED_V2_COMPETITION_RULES).toEqual({
      teamCount: 14,
      groupCount: 2,
      teamsPerGroup: 7,
      roundRobinLegs: 1,
      qualifiersPerGroup: 4,
      tieBreakers: [
        CompetitionTieBreaker.POINTS,
        CompetitionTieBreaker.GOAL_DIFFERENCE,
        CompetitionTieBreaker.GOALS_FOR,
        CompetitionTieBreaker.HEAD_TO_HEAD,
        CompetitionTieBreaker.COMMITTEE_DECISION,
      ],
      drawMode: CompetitionDrawMode.MANUAL,
      avoidSameGroupFirstRound: false,
      thirdPlaceMatch: false,
      maxRosterPlayers: 10,
    });
  });

  it('accepts idempotent fixed-rule confirmation and rejects format variants', () => {
    expect(updateCompetitionRulesSchema.parse({ expectedRevision: 3 })).toEqual({
      expectedRevision: 3,
    });
    expect(() =>
      updateCompetitionRulesSchema.parse({ expectedRevision: 3, roundRobinLegs: 2 })
    ).toThrow();
    expect(
      updateCompetitionRulesSchema.parse({
        expectedRevision: 3,
        drawMode: CompetitionDrawMode.MANUAL,
      }).drawMode
    ).toBe(CompetitionDrawMode.MANUAL);
    expect(() =>
      updateCompetitionRulesSchema.parse({
        expectedRevision: 3,
        drawMode: CompetitionDrawMode.SEEDED_CROSS_GROUP,
      })
    ).toThrow();
  });

  it('requires all four manually recorded physical quarter-final pairings', () => {
    const pairings = Array.from({ length: 4 }, (_, index) => ({
      slot: index + 1,
      homeEntryId: objectIds[index * 2],
      awayEntryId: objectIds[index * 2 + 1],
      kickoffAt: null,
      venue: null,
    }));
    expect(createCompetitionDrawSchema.parse({ expectedRevision: 9, pairings })).toEqual({
      expectedRevision: 9,
      pairings,
    });
    expect(() =>
      createCompetitionDrawSchema.parse({
        expectedRevision: 9,
        pairings: pairings.slice(0, 3),
      })
    ).toThrow();
    expect(() =>
      createCompetitionDrawSchema.parse({
        expectedRevision: 9,
        pairings: pairings.map((pairing, index) =>
          index === 0
            ? { ...pairing, kickoffAt: '2026-08-23T12:00:00+01:00' }
            : pairing
        ),
      })
    ).toThrow(/both be set or both be null/i);
  });

  it('requires the exact official group-manifest shape for preview and publish', () => {
    const fixtures = Array.from({ length: 42 }, (_, index) => ({
      officialNumber: index + 1,
      groupKey: index < 21 ? ('A' as const) : ('B' as const),
      homeEntryId: objectIds[index % 7],
      awayEntryId: objectIds[(index + 1) % 7],
      kickoffAt: null,
      venue: null,
    }));
    expect(
      previewGroupFixturesSchema.parse({ expectedRevision: 3, fixtures }).fixtures
    ).toHaveLength(42);
    expect(
      publishGroupFixturesSchema.parse({
        expectedRevision: 3,
        fixtures,
        planHash: 'a'.repeat(64),
      }).planHash
    ).toBe('a'.repeat(64));
    expect(() =>
      previewGroupFixturesSchema.parse({ expectedRevision: 3, fixtures: fixtures.slice(1) })
    ).toThrow();
    expect(() =>
      publishGroupFixturesSchema.parse({
        expectedRevision: 3,
        fixtures,
        planHash: 'not-a-hash',
      })
    ).toThrow();
  });

  it('requires a committee explanation for the other method', () => {
    const base = {
      expectedRevision: 12,
      groupKey: 'A',
      basisHash: 'a'.repeat(64),
      orderedTeamIds: [
        '507f1f77bcf86cd799439011',
        '507f191e810c19729de860ea',
      ],
    };
    expect(
      resolveCompetitionTieSchema.parse({
        ...base,
        method: CompetitionCommitteeDecisionMethod.COIN_TOSS,
      }).method
    ).toBe(CompetitionCommitteeDecisionMethod.COIN_TOSS);
    expect(() =>
      resolveCompetitionTieSchema.parse({
        ...base,
        method: CompetitionCommitteeDecisionMethod.OTHER,
      })
    ).toThrow();
  });
});
