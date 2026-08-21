import {
  isTournamentDateRangeValid,
  resolveTournamentDateRange,
} from '@/utils/tournament-metadata.util';
import {
  createTournamentSchema,
  updateTournamentSchema,
} from '@/validators/tournament.validator';

describe('tournament metadata corrections', () => {
  const startDate = new Date('2026-09-01T00:00:00.000Z');
  const endDate = new Date('2026-09-30T00:00:00.000Z');

  it('validates partial date changes against the persisted counterpart', () => {
    expect(
      isTournamentDateRangeValid(startDate, endDate, {
        endDate: new Date('2026-08-31T00:00:00.000Z'),
      })
    ).toBe(false);
    expect(
      isTournamentDateRangeValid(startDate, endDate, {
        startDate: new Date('2026-10-01T00:00:00.000Z'),
      })
    ).toBe(false);
    expect(
      isTournamentDateRangeValid(startDate, endDate, {
        startDate: new Date('2026-09-02T00:00:00.000Z'),
      })
    ).toBe(true);
  });

  it('allows an end date to be explicitly cleared', () => {
    expect(resolveTournamentDateRange(startDate, endDate, { endDate: null })).toEqual({
      startDate,
      endDate: undefined,
    });
    expect(isTournamentDateRangeValid(startDate, endDate, { endDate: null })).toBe(true);
  });

  it('trims bounded name/season values and accepts a nullable endDate patch', () => {
    const created = createTournamentSchema.parse({
      name: '  Solid FM Cup  ',
      season: '  2026  ',
      startDate: '2026-09-01T00:00:00.000Z',
      formatVersion: 2,
      format: 'two_group_knockout',
    });
    expect(created.name).toBe('Solid FM Cup');
    expect(created.season).toBe('2026');
    expect(updateTournamentSchema.parse({ endDate: null })).toEqual({ endDate: null });
    expect(() =>
      createTournamentSchema.parse({
        name: 'x'.repeat(121),
        season: '2026',
        startDate: '2026-09-01T00:00:00.000Z',
        formatVersion: 2,
        format: 'two_group_knockout',
      })
    ).toThrow();
  });

  it('rejects stale create payloads that omit or request the legacy format', () => {
    const metadata = {
      name: 'Solid FM Cup',
      season: '2026',
      startDate: '2026-09-01T00:00:00.000Z',
    };
    expect(() => createTournamentSchema.parse(metadata)).toThrow();
    expect(() =>
      createTournamentSchema.parse({
        ...metadata,
        formatVersion: 1,
        format: 'legacy_league',
      })
    ).toThrow();
  });
});
