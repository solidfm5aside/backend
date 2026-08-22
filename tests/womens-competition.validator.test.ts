import { CompetitionCommitteeDecisionMethod } from '@/models/tournament.model';
import {
  previewWomensFinalSchema,
  previewWomensLeagueFixturesSchema,
  publishWomensFinalSchema,
  publishWomensLeagueFixturesSchema,
  resolveWomensTableTieSchema,
} from '@/validators/womens-competition.validator';

const entryIds = [
  '507f1f77bcf86cd799439011',
  '507f191e810c19729de860ea',
  '507f191e810c19729de860eb',
];
const fixtures = [
  {
    officialNumber: 1,
    homeEntryId: entryIds[0],
    awayEntryId: entryIds[1],
    kickoffAt: null,
    venue: null,
  },
  {
    officialNumber: 2,
    homeEntryId: entryIds[2],
    awayEntryId: entryIds[0],
    kickoffAt: null,
    venue: null,
  },
  {
    officialNumber: 3,
    homeEntryId: entryIds[1],
    awayEntryId: entryIds[2],
    kickoffAt: null,
    venue: null,
  },
];

describe('women competition request contracts', () => {
  it('requires exactly three physical league rows and a stable publish hash', () => {
    expect(
      previewWomensLeagueFixturesSchema.parse({ expectedRevision: 3, fixtures }).fixtures
    ).toHaveLength(3);
    expect(
      publishWomensLeagueFixturesSchema.parse({
        expectedRevision: 3,
        fixtures,
        planHash: 'a'.repeat(64),
      }).planHash
    ).toBe('a'.repeat(64));
    expect(() =>
      previewWomensLeagueFixturesSchema.parse({
        expectedRevision: 3,
        fixtures: fixtures.slice(0, 2),
      })
    ).toThrow();
  });

  it('allows a fully TBC league/final schedule but never a half-schedule', () => {
    expect(
      previewWomensFinalSchema.parse({
        expectedRevision: 5,
        kickoffAt: null,
        venue: null,
      })
    ).toEqual({ expectedRevision: 5, kickoffAt: null, venue: null });
    expect(
      publishWomensFinalSchema.parse({
        expectedRevision: 5,
        kickoffAt: null,
        venue: null,
        planHash: 'b'.repeat(64),
      }).planHash
    ).toBe('b'.repeat(64));
    expect(() =>
      previewWomensFinalSchema.parse({
        expectedRevision: 5,
        kickoffAt: '2026-09-20T15:00:00+01:00',
        venue: null,
      })
    ).toThrow(/both be set or both be null/i);
  });

  it('uses a table tie contract without a fake group key', () => {
    const value = resolveWomensTableTieSchema.parse({
      expectedRevision: 4,
      basisHash: 'c'.repeat(64),
      orderedTeamIds: entryIds.slice(0, 2),
      method: CompetitionCommitteeDecisionMethod.COIN_TOSS,
    });
    expect(value).not.toHaveProperty('groupKey');
    expect(() =>
      resolveWomensTableTieSchema.parse({
        ...value,
        groupKey: 'A',
      })
    ).toThrow();
  });
});
