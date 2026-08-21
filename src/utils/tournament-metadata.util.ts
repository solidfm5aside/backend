export interface TournamentDateChanges {
  startDate?: Date;
  endDate?: Date | null;
}

export const resolveTournamentDateRange = (
  existingStartDate: Date,
  existingEndDate: Date | undefined,
  changes: TournamentDateChanges
): { startDate: Date; endDate?: Date } => ({
  startDate: Object.prototype.hasOwnProperty.call(changes, 'startDate')
    ? changes.startDate!
    : existingStartDate,
  endDate: Object.prototype.hasOwnProperty.call(changes, 'endDate')
    ? changes.endDate ?? undefined
    : existingEndDate,
});

export const isTournamentDateRangeValid = (
  existingStartDate: Date,
  existingEndDate: Date | undefined,
  changes: TournamentDateChanges
): boolean => {
  const resolved = resolveTournamentDateRange(existingStartDate, existingEndDate, changes);
  return !resolved.endDate || resolved.endDate >= resolved.startDate;
};
