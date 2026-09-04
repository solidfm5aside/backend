import {
  OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
  OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE,
  OFFICIAL_2026_FIXTURES,
  OFFICIAL_2026_TEAMS,
} from '@/data/official-2026-fixture-manifest';
import {
  MatchFixtureSource,
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from '@/models/match.model';
import {
  assertOfficial2026OpenerIsFrozen,
  assertOfficial2026RescheduledMatchesMatchManifest,
  buildOfficial2026ReschedulePlan,
  Official2026RescheduleMatchLike,
} from '@/utils/official-2026-reschedule.util';

const tournamentId = '6a88bfa4ce2cf64818770691';
const teamIdsByKey = new Map(
  OFFICIAL_2026_TEAMS.map((team, index) => [
    team.key,
    (index + 1).toString(16).padStart(24, '0'),
  ])
);

const storedFromManifest = (
  overrides: Partial<Official2026RescheduleMatchLike> & { officialNumber?: number } = {}
): Official2026RescheduleMatchLike[] =>
  OFFICIAL_2026_FIXTURES.map((fixture) => {
    const isOpener = fixture.officialNumber === 1;
    const base: Official2026RescheduleMatchLike = {
      homeTeam: teamIdsByKey.get(fixture.homeTeamKey)!,
      awayTeam: teamIdsByKey.get(fixture.awayTeamKey)!,
      homeScore: isOpener ? 8 : 0,
      awayScore: isOpener ? 1 : 0,
      date: new Date(fixture.kickoffAt!),
      venue: fixture.venueName!,
      status: isOpener ? MatchStatus.COMPLETED : MatchStatus.SCHEDULED,
      stage: MatchStage.GROUP_STAGE,
      groupKey: fixture.groupKey,
      leg: 1,
      fixtureKey: `${tournamentId}:group_stage:official:${fixture.officialNumber}`,
      scheduleStatus: MatchScheduleStatus.CONFIRMED,
      officialFixtureNumber: fixture.officialNumber,
      fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
      fixturePublicationHash: OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
      fixtureSourceReference: OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE,
      events: [],
      isDeleted: false,
    };
    if (overrides.officialNumber === fixture.officialNumber) {
      return { ...base, ...overrides };
    }
    return base;
  });

describe('official 2026 master-sheet reschedule guards', () => {
  it('freezes the completed Samba Boys 8-1 NYSC opener', () => {
    const opener = storedFromManifest()[0];
    expect(() => assertOfficial2026OpenerIsFrozen(opener, teamIdsByKey)).not.toThrow();
    expect(() =>
      assertOfficial2026OpenerIsFrozen({ ...opener, homeScore: 7 }, teamIdsByKey)
    ).toThrow(/samba boys 8-1 nysc opener/i);
    expect(() =>
      assertOfficial2026OpenerIsFrozen({ ...opener, status: MatchStatus.SCHEDULED }, teamIdsByKey)
    ).toThrow(/samba boys 8-1 nysc opener/i);
  });

  it('treats an already-published master sheet as a no-op', () => {
    const plan = buildOfficial2026ReschedulePlan(
      tournamentId,
      storedFromManifest(),
      teamIdsByKey
    );
    expect(plan.alreadyApplied).toBe(true);
    expect(plan.remainingScheduleChanges).toBe(0);
    expect(plan.homeAwaySwaps).toBe(0);
    expect(() =>
      assertOfficial2026RescheduledMatchesMatchManifest(
        tournamentId,
        storedFromManifest(),
        teamIdsByKey
      )
    ).not.toThrow();
  });

  it('rewrites remaining kickoffs and venues while keeping official numbers on the same pairs', () => {
    const stale = storedFromManifest();
    stale[1] = {
      ...stale[1],
      date: new Date('2026-08-29T13:00:00.000Z'),
      venue: 'Eclipse Arena',
      fixturePublicationHash: '0'.repeat(64),
    };
    const lala = teamIdsByKey.get('lala-brothers')!;
    const success = teamIdsByKey.get('success-fc')!;
    stale[40] = {
      ...stale[40],
      homeTeam: success,
      awayTeam: lala,
      fixturePublicationHash: '0'.repeat(64),
    };

    const plan = buildOfficial2026ReschedulePlan(tournamentId, stale, teamIdsByKey);
    expect(plan.alreadyApplied).toBe(false);
    expect(plan.remainingScheduleChanges).toBe(2);
    expect(plan.homeAwaySwaps).toBe(1);
    expect(plan.rows[1]).toEqual(
      expect.objectContaining({
        officialNumber: 2,
        fromVenue: 'Eclipse Arena',
        toVenue: 'Wembley Hotel',
        swappedHomeAway: false,
      })
    );
    expect(plan.rows[40]).toEqual(
      expect.objectContaining({
        officialNumber: 41,
        homeTeamKey: 'lala-brothers',
        awayTeamKey: 'success-fc',
        swappedHomeAway: true,
      })
    );
  });

  it('refuses to rewrite a remaining fixture that has already been played or scored', () => {
    expect(() =>
      buildOfficial2026ReschedulePlan(
        tournamentId,
        storedFromManifest({ officialNumber: 9, status: MatchStatus.LIVE }),
        teamIdsByKey
      )
    ).toThrow(/no longer a blank scheduled match/i);
    expect(() =>
      buildOfficial2026ReschedulePlan(
        tournamentId,
        storedFromManifest({ officialNumber: 15, homeScore: 2 }),
        teamIdsByKey
      )
    ).toThrow(/no longer a blank scheduled match/i);
  });
});
