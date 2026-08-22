import {
  CompetitionDivision,
  competitionDivisionFilter,
  resolveCompetitionDivision,
} from '@/models/competition-division';

describe('competition division legacy compatibility', () => {
  it('interprets missing, null, and unknown legacy division values as men without writes', () => {
    expect(resolveCompetitionDivision(undefined)).toBe(CompetitionDivision.MEN);
    expect(resolveCompetitionDivision(null)).toBe(CompetitionDivision.MEN);
    expect(resolveCompetitionDivision('legacy')).toBe(CompetitionDivision.MEN);
    expect(resolveCompetitionDivision(CompetitionDivision.WOMEN)).toBe(
      CompetitionDivision.WOMEN
    );
  });

  it('includes legacy missing rows only in the men filter', () => {
    expect(competitionDivisionFilter(CompetitionDivision.MEN)).toEqual({
      $or: [
        { division: CompetitionDivision.MEN },
        { division: { $exists: false } },
        { division: null },
      ],
    });
    expect(competitionDivisionFilter(CompetitionDivision.WOMEN)).toEqual({
      division: CompetitionDivision.WOMEN,
    });
  });
});
