import { MatchScheduleStatus } from '@/models/match.model';
import {
  buildWomensLeagueFixturePlanCore,
  WomensCompetitionPlanError,
  WomensFixtureEntry,
  WomensLeagueFixtureInput,
} from '@/utils/womens-competition.util';

const tournamentId = 'women-2026';
const entries: WomensFixtureEntry[] = [1, 2, 3].map((number) => ({
  entryId: `entry-${number}`,
  teamId: `team-${number}`,
  teamName: `Women Team ${number}`,
}));
const venues = ['Tribu Arena', 'Solid FM Arena'];

const completePlan = (): WomensLeagueFixtureInput[] => [
  {
    officialNumber: 1,
    homeEntryId: 'entry-1',
    awayEntryId: 'entry-2',
    kickoffAt: null,
    venue: null,
  },
  {
    officialNumber: 2,
    homeEntryId: 'entry-3',
    awayEntryId: 'entry-1',
    kickoffAt: '2026-08-30T15:00:00+01:00',
    venue: 'tribu arena',
  },
  {
    officialNumber: 3,
    homeEntryId: 'entry-2',
    awayEntryId: 'entry-3',
    kickoffAt: '2026-09-06T15:00:00+01:00',
    venue: 'Solid FM Arena',
  },
];

const expectPlanError = (
  mutate: (fixtures: WomensLeagueFixtureInput[]) => void,
  code: string
) => {
  const fixtures = completePlan();
  mutate(fixtures);
  expect(() =>
    buildWomensLeagueFixturePlanCore(tournamentId, fixtures, entries, venues)
  ).toThrow(expect.objectContaining<Partial<WomensCompetitionPlanError>>({ code }));
};

describe('women single-table physical fixture integrity', () => {
  it('accepts exactly three unordered pairs, one leg, two appearances each, and TBC rows', () => {
    const plan = buildWomensLeagueFixturePlanCore(
      tournamentId,
      completePlan().reverse(),
      entries,
      venues
    );

    expect(plan).toMatchObject({ totalMatches: 3, confirmedCount: 2, pendingCount: 1 });
    expect(plan.fixtures.map((fixture) => fixture.officialNumber)).toEqual([1, 2, 3]);
    expect(plan.fixtures[0]).toEqual(
      expect.objectContaining({
        fixtureKey: `${tournamentId}:league:official:1`,
        leg: 1,
        kickoffAt: null,
        venue: null,
        scheduleStatus: MatchScheduleStatus.PENDING,
      })
    );
    expect(plan.fixtures[1]).toEqual(
      expect.objectContaining({
        venue: 'Tribu Arena',
        scheduleStatus: MatchScheduleStatus.CONFIRMED,
      })
    );

    const appearances = new Map(entries.map((entry) => [entry.entryId, 0]));
    for (const fixture of plan.fixtures) {
      appearances.set(fixture.homeEntryId, appearances.get(fixture.homeEntryId)! + 1);
      appearances.set(fixture.awayEntryId, appearances.get(fixture.awayEntryId)! + 1);
    }
    expect([...appearances.values()]).toEqual([2, 2, 2]);
  });

  it('accepts an all-TBC physical plan when no venue exists yet', () => {
    const fixtures = completePlan().map((fixture) => ({
      ...fixture,
      kickoffAt: null,
      venue: null,
    }));
    expect(
      buildWomensLeagueFixturePlanCore(tournamentId, fixtures, entries, [])
    ).toMatchObject({ totalMatches: 3, confirmedCount: 0, pendingCount: 3 });
  });

  it('rejects invalid counts, official numbers, entries, self matches, and repeated pairs', () => {
    expectPlanError((fixtures) => fixtures.pop(), 'WOMENS_FIXTURE_COUNT_INVALID');
    expectPlanError((fixtures) => {
      fixtures[1].officialNumber = 1;
    }, 'WOMENS_FIXTURE_NUMBERS_INVALID');
    expectPlanError((fixtures) => {
      fixtures[0].homeEntryId = 'outside-entry';
    }, 'WOMENS_FIXTURE_ENTRY_INVALID');
    expectPlanError((fixtures) => {
      fixtures[0].awayEntryId = fixtures[0].homeEntryId;
    }, 'WOMENS_FIXTURE_SELF_MATCH');
    expectPlanError((fixtures) => {
      fixtures[1].homeEntryId = fixtures[0].awayEntryId;
      fixtures[1].awayEntryId = fixtures[0].homeEntryId;
    }, 'WOMENS_FIXTURE_PAIR_DUPLICATED');
  });

  it('rejects half-schedules, inactive venues, team-day clashes, and venue collisions', () => {
    expectPlanError((fixtures) => {
      fixtures[0].kickoffAt = '2026-08-23T15:00:00+01:00';
    }, 'WOMENS_FIXTURE_SCHEDULE_INCOMPLETE');
    expectPlanError((fixtures) => {
      fixtures[1].venue = 'Unknown Arena';
    }, 'WOMENS_FIXTURE_VENUE_INVALID');
    expectPlanError((fixtures) => {
      fixtures[2].kickoffAt = fixtures[1].kickoffAt;
    }, 'WOMENS_FIXTURE_TEAM_DAY_COLLISION');
    expectPlanError((fixtures) => {
      fixtures[2] = {
        ...fixtures[2],
        kickoffAt: fixtures[1].kickoffAt,
        venue: fixtures[1].venue,
        homeEntryId: 'entry-2',
        awayEntryId: 'entry-3',
      };
    }, 'WOMENS_FIXTURE_TEAM_DAY_COLLISION');
  });
});
