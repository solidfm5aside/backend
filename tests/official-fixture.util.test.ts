import { MatchScheduleStatus } from '@/models/match.model';
import {
  buildOfficialGroupFixturePlanCore,
  competitionLocalCalendarDay,
  OfficialFixtureEntry,
  OfficialGroupFixtureInput,
} from '@/utils/official-fixture.util';

const tournamentId = 'tournament-2026';
const venues = ['Solid FM Arena', 'Community Pitch'];
const entries: OfficialFixtureEntry[] = (['A', 'B'] as const).flatMap((groupKey) =>
  Array.from({ length: 7 }, (_, index) => ({
    entryId: `${groupKey}-entry-${index + 1}`,
    teamId: `${groupKey}-team-${index + 1}`,
    teamName: `${groupKey} Team ${index + 1}`,
    groupKey,
  }))
);

const buildCompletePlan = (): OfficialGroupFixtureInput[] => {
  let officialNumber = 0;
  const fixtures: OfficialGroupFixtureInput[] = [];
  for (const groupKey of ['A', 'B'] as const) {
    const groupEntries = entries.filter((entry) => entry.groupKey === groupKey);
    for (let homeIndex = 0; homeIndex < groupEntries.length; homeIndex++) {
      for (let awayIndex = homeIndex + 1; awayIndex < groupEntries.length; awayIndex++) {
        officialNumber++;
        const kickoff = new Date('2026-08-23T11:00:00.000Z');
        kickoff.setUTCDate(kickoff.getUTCDate() + officialNumber);
        fixtures.push({
          officialNumber,
          groupKey,
          homeEntryId: groupEntries[homeIndex].entryId,
          awayEntryId: groupEntries[awayIndex].entryId,
          kickoffAt: kickoff.toISOString(),
          venue: officialNumber % 2 === 0 ? venues[0] : venues[1],
        });
      }
    }
  }
  fixtures[0] = { ...fixtures[0], kickoffAt: null, venue: null };
  return fixtures;
};

const expectPlanError = (
  mutate: (fixtures: OfficialGroupFixtureInput[]) => void,
  code: string
) => {
  const fixtures = buildCompletePlan();
  mutate(fixtures);
  expect(() =>
    buildOfficialGroupFixturePlanCore(tournamentId, fixtures, entries, venues)
  ).toThrow(expect.objectContaining({ code }));
};

describe('official physical group fixture plan integrity', () => {
  it('normalizes exactly 42 complete pairings while preserving an allowed pending row', () => {
    const plan = buildOfficialGroupFixturePlanCore(
      tournamentId,
      buildCompletePlan().reverse(),
      entries,
      venues
    );

    expect(plan.totalMatches).toBe(42);
    expect(plan.confirmedCount).toBe(41);
    expect(plan.pendingCount).toBe(1);
    expect(plan.fixtures.map((fixture) => fixture.officialNumber)).toEqual(
      Array.from({ length: 42 }, (_, index) => index + 1)
    );
    expect(plan.fixtures[0]).toEqual(
      expect.objectContaining({
        fixtureKey: `${tournamentId}:group_stage:official:1`,
        kickoffAt: null,
        venue: null,
        scheduleStatus: MatchScheduleStatus.PENDING,
      })
    );
    expect(plan.fixtures[1]).toEqual(
      expect.objectContaining({
        scheduleStatus: MatchScheduleStatus.CONFIRMED,
        venue: 'Solid FM Arena',
      })
    );

    const appearances = new Map(entries.map((entry) => [entry.entryId, 0]));
    for (const fixture of plan.fixtures) {
      appearances.set(fixture.homeEntryId, appearances.get(fixture.homeEntryId)! + 1);
      appearances.set(fixture.awayEntryId, appearances.get(fixture.awayEntryId)! + 1);
    }
    expect([...appearances.values()]).toEqual(Array(14).fill(6));
  });

  it('uses Africa/Lagos calendar days at UTC boundaries', () => {
    expect(competitionLocalCalendarDay(new Date('2026-08-22T23:30:00.000Z'))).toBe(
      '2026-08-23'
    );
  });

  it('rejects missing/duplicate official numbers, repeated pairings, and cross-group teams', () => {
    expectPlanError((fixtures) => fixtures.pop(), 'OFFICIAL_FIXTURE_COUNT_INVALID');
    expectPlanError((fixtures) => {
      fixtures[1].officialNumber = fixtures[0].officialNumber;
    }, 'OFFICIAL_FIXTURE_NUMBERS_INVALID');
    expectPlanError((fixtures) => {
      fixtures[1].homeEntryId = fixtures[0].homeEntryId;
      fixtures[1].awayEntryId = fixtures[0].awayEntryId;
    }, 'OFFICIAL_FIXTURE_PAIR_DUPLICATED');
    expectPlanError((fixtures) => {
      fixtures[0].awayEntryId = 'B-entry-1';
    }, 'OFFICIAL_FIXTURE_CROSS_GROUP');
  });

  it('rejects incomplete schedules and inactive venue names', () => {
    expectPlanError((fixtures) => {
      fixtures[0] = { ...fixtures[0], kickoffAt: '2026-08-23T12:00:00+01:00' };
    }, 'OFFICIAL_FIXTURE_SCHEDULE_INCOMPLETE');
    expectPlanError((fixtures) => {
      fixtures[1].venue = 'Unregistered Ground';
    }, 'OFFICIAL_FIXTURE_VENUE_INVALID');
  });

  it('rejects same-team local-day and same-venue/kickoff collisions', () => {
    expectPlanError((fixtures) => {
      const first = fixtures.find(
        (fixture) => fixture.homeEntryId === 'A-entry-1' && fixture.kickoffAt
      )!;
      const second = fixtures.find(
        (fixture) =>
          fixture.officialNumber !== first.officialNumber &&
          (fixture.homeEntryId === 'A-entry-1' || fixture.awayEntryId === 'A-entry-1')
      )!;
      second.kickoffAt = first.kickoffAt;
      second.venue = first.venue === venues[0] ? venues[1] : venues[0];
    }, 'OFFICIAL_FIXTURE_TEAM_DAY_COLLISION');

    expectPlanError((fixtures) => {
      const source = fixtures[1];
      const sourceEntries = new Set([source.homeEntryId, source.awayEntryId]);
      const target = fixtures.find(
        (fixture) =>
          fixture.kickoffAt !== null &&
          !sourceEntries.has(fixture.homeEntryId) &&
          !sourceEntries.has(fixture.awayEntryId)
      )!;
      target.kickoffAt = source.kickoffAt;
      target.venue = source.venue;
    }, 'OFFICIAL_FIXTURE_VENUE_COLLISION');
  });

  it('rejects plans where an official row references an entry outside the tournament', () => {
    expectPlanError((fixtures) => {
      fixtures[0].homeEntryId = 'not-enrolled';
    }, 'OFFICIAL_FIXTURE_ENTRY_INVALID');
  });
});
