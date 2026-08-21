import {
  CompetitionCommitteeDecisionMethod,
  CompetitionDrawMode,
  CompetitionTieBreaker,
  FIXED_V2_COMPETITION_RULES,
} from '@/models/tournament.model';
import {
  createCompetitionDrawSchema,
  resolveCompetitionTieSchema,
  updateCompetitionRulesSchema,
} from '@/validators/competition.validator';

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
      drawMode: CompetitionDrawMode.SEEDED_CROSS_GROUP,
      avoidSameGroupFirstRound: true,
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
    expect(() =>
      updateCompetitionRulesSchema.parse({
        expectedRevision: 3,
        drawMode: CompetitionDrawMode.MANUAL,
      })
    ).toThrow();
  });

  it('allows only a revision when creating the fixed seeded draw', () => {
    expect(createCompetitionDrawSchema.parse({ expectedRevision: 9 })).toEqual({
      expectedRevision: 9,
    });
    expect(() =>
      createCompetitionDrawSchema.parse({
        expectedRevision: 9,
        manualPairings: [],
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
