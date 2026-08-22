export enum CompetitionDivision {
  MEN = 'men',
  WOMEN = 'women',
}

export const resolveCompetitionDivision = (
  division: CompetitionDivision | string | null | undefined
): CompetitionDivision =>
  division === CompetitionDivision.WOMEN
    ? CompetitionDivision.WOMEN
    : CompetitionDivision.MEN;

export const competitionDivisionFilter = (division: CompetitionDivision) =>
  division === CompetitionDivision.MEN
    ? {
        $or: [
          { division: CompetitionDivision.MEN },
          { division: { $exists: false } },
          { division: null },
        ],
      }
    : { division: CompetitionDivision.WOMEN };
