import { MatchScheduleStatus } from '@/models/match.model';
import { competitionLocalCalendarDay } from './official-fixture.util';

export interface WomensLeagueFixtureInput {
  officialNumber: number;
  homeEntryId: string;
  awayEntryId: string;
  kickoffAt: string | null;
  venue: string | null;
}

export interface WomensFixtureEntry {
  entryId: string;
  teamId: string;
  teamName: string;
}

export interface NormalizedWomensLeagueFixture extends WomensLeagueFixtureInput {
  fixtureKey: string;
  leg: 1;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  scheduleStatus: MatchScheduleStatus;
}

export class WomensCompetitionPlanError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'WomensCompetitionPlanError';
  }
}

const pairKey = (left: string, right: string): string => [left, right].sort().join(':');

export const buildWomensLeagueFixturePlanCore = (
  tournamentId: string,
  requestedFixtures: WomensLeagueFixtureInput[],
  entries: WomensFixtureEntry[],
  activeVenueNames: string[],
  timeZone = 'Africa/Lagos'
) => {
  if (entries.length !== 3) {
    throw new WomensCompetitionPlanError(
      'The women’s competition requires exactly three active entries.',
      'WOMENS_ENTRY_COUNT_INVALID',
      { expected: 3, actual: entries.length }
    );
  }
  if (requestedFixtures.length !== 3) {
    throw new WomensCompetitionPlanError(
      'The official women’s league plan must contain exactly three matches.',
      'WOMENS_FIXTURE_COUNT_INVALID',
      { expected: 3, actual: requestedFixtures.length }
    );
  }

  const suppliedNumbers = new Set(requestedFixtures.map((fixture) => fixture.officialNumber));
  if (
    suppliedNumbers.size !== 3 ||
    [...suppliedNumbers].some((number) => number < 1 || number > 3)
  ) {
    throw new WomensCompetitionPlanError(
      'Official fixture numbers must use 1, 2, and 3 exactly once.',
      'WOMENS_FIXTURE_NUMBERS_INVALID'
    );
  }

  const entryById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const activeVenueByKey = new Map(
    activeVenueNames.map((venue) => [venue.trim().toLocaleLowerCase(), venue.trim()])
  );
  const pairs = new Set<string>();
  const appearances = new Map(entries.map((entry) => [entry.entryId, 0]));
  const teamDays = new Set<string>();
  const venueKickoffs = new Set<string>();

  const fixtures = [...requestedFixtures]
    .sort((left, right) => left.officialNumber - right.officialNumber)
    .map((fixture): NormalizedWomensLeagueFixture => {
      const home = entryById.get(fixture.homeEntryId);
      const away = entryById.get(fixture.awayEntryId);
      if (!home || !away) {
        throw new WomensCompetitionPlanError(
          `Official fixture ${fixture.officialNumber} contains an entry outside this tournament.`,
          'WOMENS_FIXTURE_ENTRY_INVALID',
          { officialNumber: fixture.officialNumber }
        );
      }
      if (home.entryId === away.entryId) {
        throw new WomensCompetitionPlanError(
          `Official fixture ${fixture.officialNumber} cannot pair a team with itself.`,
          'WOMENS_FIXTURE_SELF_MATCH',
          { officialNumber: fixture.officialNumber }
        );
      }

      const pairing = pairKey(home.entryId, away.entryId);
      if (pairs.has(pairing)) {
        throw new WomensCompetitionPlanError(
          `Official fixture ${fixture.officialNumber} repeats a pairing.`,
          'WOMENS_FIXTURE_PAIR_DUPLICATED',
          { officialNumber: fixture.officialNumber }
        );
      }
      pairs.add(pairing);
      appearances.set(home.entryId, (appearances.get(home.entryId) ?? 0) + 1);
      appearances.set(away.entryId, (appearances.get(away.entryId) ?? 0) + 1);

      const hasKickoff = fixture.kickoffAt !== null;
      const hasVenue = fixture.venue !== null && fixture.venue.trim().length > 0;
      if (hasKickoff !== hasVenue) {
        throw new WomensCompetitionPlanError(
          `Official fixture ${fixture.officialNumber} must provide both kickoffAt and venue, or leave both pending.`,
          'WOMENS_FIXTURE_SCHEDULE_INCOMPLETE',
          { officialNumber: fixture.officialNumber }
        );
      }

      let kickoffAt: string | null = null;
      let venue: string | null = null;
      if (hasKickoff && hasVenue) {
        const kickoffDate = new Date(fixture.kickoffAt!);
        if (Number.isNaN(kickoffDate.getTime())) {
          throw new WomensCompetitionPlanError(
            `Official fixture ${fixture.officialNumber} has an invalid kickoffAt value.`,
            'WOMENS_FIXTURE_KICKOFF_INVALID',
            { officialNumber: fixture.officialNumber }
          );
        }
        const canonicalVenue = activeVenueByKey.get(fixture.venue!.trim().toLocaleLowerCase());
        if (!canonicalVenue) {
          throw new WomensCompetitionPlanError(
            `Official fixture ${fixture.officialNumber} must use an active venue.`,
            'WOMENS_FIXTURE_VENUE_INVALID',
            { officialNumber: fixture.officialNumber, venue: fixture.venue }
          );
        }
        const day = competitionLocalCalendarDay(kickoffDate, timeZone);
        for (const entry of [home, away]) {
          const teamDayKey = `${entry.teamId}:${day}`;
          if (teamDays.has(teamDayKey)) {
            throw new WomensCompetitionPlanError(
              `${entry.teamName} appears more than once on ${day}.`,
              'WOMENS_FIXTURE_TEAM_DAY_COLLISION',
              { officialNumber: fixture.officialNumber, teamId: entry.teamId, day }
            );
          }
          teamDays.add(teamDayKey);
        }
        const venueKickoffKey = `${canonicalVenue.toLocaleLowerCase()}:${kickoffDate.toISOString()}`;
        if (venueKickoffs.has(venueKickoffKey)) {
          throw new WomensCompetitionPlanError(
            `Official fixture ${fixture.officialNumber} collides with another match at the same venue and kickoff.`,
            'WOMENS_FIXTURE_VENUE_COLLISION',
            { officialNumber: fixture.officialNumber, venue: canonicalVenue }
          );
        }
        venueKickoffs.add(venueKickoffKey);
        kickoffAt = kickoffDate.toISOString();
        venue = canonicalVenue;
      }

      return {
        officialNumber: fixture.officialNumber,
        fixtureKey: `${tournamentId}:league:official:${fixture.officialNumber}`,
        leg: 1,
        homeEntryId: home.entryId,
        awayEntryId: away.entryId,
        homeTeamId: home.teamId,
        awayTeamId: away.teamId,
        homeTeamName: home.teamName,
        awayTeamName: away.teamName,
        kickoffAt,
        venue,
        scheduleStatus: kickoffAt
          ? MatchScheduleStatus.CONFIRMED
          : MatchScheduleStatus.PENDING,
      };
    });

  const invalidAppearances = entries
    .map((entry) => ({ entryId: entry.entryId, matches: appearances.get(entry.entryId) ?? 0 }))
    .filter((entry) => entry.matches !== 2);
  if (pairs.size !== 3 || invalidAppearances.length > 0) {
    throw new WomensCompetitionPlanError(
      'Every pair must meet exactly once and every team must play exactly two league matches.',
      'WOMENS_FIXTURE_COVERAGE_INVALID',
      invalidAppearances
    );
  }

  const confirmedCount = fixtures.filter(
    (fixture) => fixture.scheduleStatus === MatchScheduleStatus.CONFIRMED
  ).length;
  return {
    totalMatches: 3 as const,
    confirmedCount,
    pendingCount: fixtures.length - confirmedCount,
    fixtures,
  };
};
