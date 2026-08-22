import { MatchScheduleStatus } from '@/models/match.model';

export type OfficialGroupKey = 'A' | 'B';

export interface OfficialGroupFixtureInput {
  officialNumber: number;
  groupKey: OfficialGroupKey;
  homeEntryId: string;
  awayEntryId: string;
  kickoffAt: string | null;
  venue: string | null;
}

export interface OfficialFixtureEntry {
  entryId: string;
  teamId: string;
  groupKey: OfficialGroupKey;
  teamName: string;
}

export interface NormalizedOfficialGroupFixture extends OfficialGroupFixtureInput {
  fixtureKey: string;
  leg: 1;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  scheduleStatus: MatchScheduleStatus;
}

export interface OfficialGroupFixturePlanCore {
  totalMatches: 42;
  confirmedCount: number;
  pendingCount: number;
  fixtures: NormalizedOfficialGroupFixture[];
}

export class OfficialFixturePlanError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'OfficialFixturePlanError';
  }
}

export const competitionLocalCalendarDay = (
  date: Date,
  timeZone = 'Africa/Lagos'
): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

const pairKey = (left: string, right: string): string => [left, right].sort().join(':');

export const buildOfficialGroupFixturePlanCore = (
  tournamentId: string,
  requestedFixtures: OfficialGroupFixtureInput[],
  entries: OfficialFixtureEntry[],
  activeVenueNames: string[],
  timeZone = 'Africa/Lagos'
): OfficialGroupFixturePlanCore => {
  if (requestedFixtures.length !== 42) {
    throw new OfficialFixturePlanError(
      'The official group fixture plan must contain exactly 42 matches.',
      'OFFICIAL_FIXTURE_COUNT_INVALID',
      { expected: 42, actual: requestedFixtures.length }
    );
  }

  const expectedNumbers = new Set(Array.from({ length: 42 }, (_, index) => index + 1));
  const suppliedNumbers = new Set(requestedFixtures.map((fixture) => fixture.officialNumber));
  if (
    suppliedNumbers.size !== requestedFixtures.length ||
    suppliedNumbers.size !== expectedNumbers.size ||
    [...suppliedNumbers].some((number) => !expectedNumbers.has(number))
  ) {
    throw new OfficialFixturePlanError(
      'Official fixture numbers must use every number from 1 through 42 exactly once.',
      'OFFICIAL_FIXTURE_NUMBERS_INVALID'
    );
  }

  const entryById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const activeVenueByKey = new Map(
    activeVenueNames.map((venue) => [venue.trim().toLocaleLowerCase(), venue.trim()])
  );
  const pairKeysByGroup: Record<OfficialGroupKey, Set<string>> = {
    A: new Set(),
    B: new Set(),
  };
  const appearances = new Map(entries.map((entry) => [entry.entryId, 0]));
  const teamDays = new Set<string>();
  const venueKickoffs = new Set<string>();

  const fixtures = [...requestedFixtures]
    .sort((left, right) => left.officialNumber - right.officialNumber)
    .map((fixture): NormalizedOfficialGroupFixture => {
      const homeEntry = entryById.get(fixture.homeEntryId);
      const awayEntry = entryById.get(fixture.awayEntryId);
      if (!homeEntry || !awayEntry) {
        throw new OfficialFixturePlanError(
          `Official fixture ${fixture.officialNumber} contains an entry outside this tournament.`,
          'OFFICIAL_FIXTURE_ENTRY_INVALID',
          { officialNumber: fixture.officialNumber }
        );
      }
      if (homeEntry.entryId === awayEntry.entryId) {
        throw new OfficialFixturePlanError(
          `Official fixture ${fixture.officialNumber} cannot pair a team with itself.`,
          'OFFICIAL_FIXTURE_SELF_MATCH',
          { officialNumber: fixture.officialNumber }
        );
      }
      if (
        homeEntry.groupKey !== fixture.groupKey ||
        awayEntry.groupKey !== fixture.groupKey
      ) {
        throw new OfficialFixturePlanError(
          `Official fixture ${fixture.officialNumber} must contain two teams from Group ${fixture.groupKey}.`,
          'OFFICIAL_FIXTURE_CROSS_GROUP',
          { officialNumber: fixture.officialNumber }
        );
      }

      const pairing = pairKey(homeEntry.entryId, awayEntry.entryId);
      if (pairKeysByGroup[fixture.groupKey].has(pairing)) {
        throw new OfficialFixturePlanError(
          `Official fixture ${fixture.officialNumber} repeats a group pairing.`,
          'OFFICIAL_FIXTURE_PAIR_DUPLICATED',
          { officialNumber: fixture.officialNumber }
        );
      }
      pairKeysByGroup[fixture.groupKey].add(pairing);
      appearances.set(homeEntry.entryId, (appearances.get(homeEntry.entryId) ?? 0) + 1);
      appearances.set(awayEntry.entryId, (appearances.get(awayEntry.entryId) ?? 0) + 1);

      const hasKickoff = fixture.kickoffAt !== null;
      const hasVenue = fixture.venue !== null && fixture.venue.trim().length > 0;
      if (hasKickoff !== hasVenue) {
        throw new OfficialFixturePlanError(
          `Official fixture ${fixture.officialNumber} must provide both kickoffAt and venue, or leave both pending.`,
          'OFFICIAL_FIXTURE_SCHEDULE_INCOMPLETE',
          { officialNumber: fixture.officialNumber }
        );
      }

      let kickoffAt: string | null = null;
      let venue: string | null = null;
      if (hasKickoff && hasVenue) {
        const kickoffDate = new Date(fixture.kickoffAt!);
        if (Number.isNaN(kickoffDate.getTime())) {
          throw new OfficialFixturePlanError(
            `Official fixture ${fixture.officialNumber} has an invalid kickoffAt value.`,
            'OFFICIAL_FIXTURE_KICKOFF_INVALID',
            { officialNumber: fixture.officialNumber }
          );
        }
        const canonicalVenue = activeVenueByKey.get(fixture.venue!.trim().toLocaleLowerCase());
        if (!canonicalVenue) {
          throw new OfficialFixturePlanError(
            `Official fixture ${fixture.officialNumber} must use an active venue.`,
            'OFFICIAL_FIXTURE_VENUE_INVALID',
            { officialNumber: fixture.officialNumber, venue: fixture.venue }
          );
        }
        const day = competitionLocalCalendarDay(kickoffDate, timeZone);
        for (const entry of [homeEntry, awayEntry]) {
          const teamDayKey = `${entry.teamId}:${day}`;
          if (teamDays.has(teamDayKey)) {
            throw new OfficialFixturePlanError(
              `${entry.teamName} appears more than once on ${day}.`,
              'OFFICIAL_FIXTURE_TEAM_DAY_COLLISION',
              { officialNumber: fixture.officialNumber, teamId: entry.teamId, day }
            );
          }
          teamDays.add(teamDayKey);
        }
        const venueKickoffKey = `${canonicalVenue.toLocaleLowerCase()}:${kickoffDate.toISOString()}`;
        if (venueKickoffs.has(venueKickoffKey)) {
          throw new OfficialFixturePlanError(
            `Official fixture ${fixture.officialNumber} collides with another match at the same venue and kickoff.`,
            'OFFICIAL_FIXTURE_VENUE_COLLISION',
            { officialNumber: fixture.officialNumber, venue: canonicalVenue }
          );
        }
        venueKickoffs.add(venueKickoffKey);
        kickoffAt = kickoffDate.toISOString();
        venue = canonicalVenue;
      }

      return {
        officialNumber: fixture.officialNumber,
        fixtureKey: `${tournamentId}:group_stage:official:${fixture.officialNumber}`,
        groupKey: fixture.groupKey,
        leg: 1,
        homeEntryId: homeEntry.entryId,
        awayEntryId: awayEntry.entryId,
        homeTeamId: homeEntry.teamId,
        awayTeamId: awayEntry.teamId,
        homeTeamName: homeEntry.teamName,
        awayTeamName: awayEntry.teamName,
        kickoffAt,
        venue,
        scheduleStatus: kickoffAt
          ? MatchScheduleStatus.CONFIRMED
          : MatchScheduleStatus.PENDING,
      };
    });

  for (const groupKey of ['A', 'B'] as const) {
    if (pairKeysByGroup[groupKey].size !== 21) {
      throw new OfficialFixturePlanError(
        `Group ${groupKey} must contain every one of its 21 pairings exactly once.`,
        'OFFICIAL_FIXTURE_GROUP_COVERAGE_INVALID',
        { groupKey, pairCount: pairKeysByGroup[groupKey].size }
      );
    }
  }
  const invalidAppearances = entries
    .map((entry) => ({ entryId: entry.entryId, matches: appearances.get(entry.entryId) ?? 0 }))
    .filter((entry) => entry.matches !== 6);
  if (invalidAppearances.length > 0) {
    throw new OfficialFixturePlanError(
      'Every tournament team must appear in exactly six official group matches.',
      'OFFICIAL_FIXTURE_TEAM_COVERAGE_INVALID',
      invalidAppearances
    );
  }

  const confirmedCount = fixtures.filter(
    (fixture) => fixture.scheduleStatus === MatchScheduleStatus.CONFIRMED
  ).length;
  return {
    totalMatches: 42,
    confirmedCount,
    pendingCount: fixtures.length - confirmedCount,
    fixtures,
  };
};
