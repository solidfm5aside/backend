import {
  OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
  OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE,
  OFFICIAL_2026_FIXTURES,
  OFFICIAL_2026_OPENER_SUPPLEMENT,
  OFFICIAL_2026_SOURCE_SHA256,
  OFFICIAL_2026_TEAMS,
  OFFICIAL_2026_TIME_ZONE,
} from '@/data/official-2026-fixture-manifest';
import {
  MatchFixtureSource,
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from '@/models/match.model';
import {
  CompetitionDrawMode,
  CompetitionWorkflowState,
  TournamentFormat,
  TournamentStatus,
} from '@/models/tournament.model';
import {
  assertOfficial2026CommittedMatchesMatchManifest,
  assertOfficial2026LegacyTournamentIsPristine,
  buildOfficial2026LegacyTournamentCasFilter,
  buildOfficial2026MigrationPublicationPlan,
  buildOfficial2026SafeBackupReference,
  Official2026CommittedMatchLike,
  Official2026LegacyTournamentSafetySnapshot,
} from '@/utils/official-2026-migration.util';

const backupArtifactSha256 = '9'.repeat(64);
const backupReference = buildOfficial2026SafeBackupReference(
  'C:\\verified-backups\\solidfm-before-official-2026.archive',
  backupArtifactSha256
);

const pristineLegacyTournament = (): Official2026LegacyTournamentSafetySnapshot => ({
  season: '2026',
  startDate: new Date('2026-08-23T00:00:00.000Z'),
  status: TournamentStatus.ONGOING,
  currentStage: MatchStage.LEAGUE,
  leagueRounds: 6,
  fixturesGenerated: true,
  formatVersion: 1,
  format: TournamentFormat.LEGACY_LEAGUE,
  workflowState: CompetitionWorkflowState.SETUP,
  workflowRevision: 0,
  entryIdentityRevision: 0,
  rosterIdentityRevision: 0,
  standingsRevision: 0,
  competitionTieResolutions: [],
  qualificationSnapshot: [],
  isDeleted: false,
});

describe('official 2026 destructive migration guards', () => {
  it('accepts only the exact untouched legacy tournament state', () => {
    expect(() =>
      assertOfficial2026LegacyTournamentIsPristine(pristineLegacyTournament())
    ).not.toThrow();

    expect(() =>
      assertOfficial2026LegacyTournamentIsPristine({
        ...pristineLegacyTournament(),
        formatVersion: 2,
        format: TournamentFormat.TWO_GROUP_KNOCKOUT,
      })
    ).toThrow(/not an unmigrated legacy tournament/i);
    expect(() =>
      assertOfficial2026LegacyTournamentIsPristine({
        ...pristineLegacyTournament(),
        workflowRevision: 1,
      })
    ).toThrow(/revisions are not pristine/i);
    expect(() =>
      assertOfficial2026LegacyTournamentIsPristine({
        ...pristineLegacyTournament(),
        status: TournamentStatus.COMPLETED,
      })
    ).toThrow(/completed tournament cannot be rewritten/i);
    expect(() =>
      assertOfficial2026LegacyTournamentIsPristine({
        ...pristineLegacyTournament(),
        championTeamId: 'already-decided',
      })
    ).toThrow(/winner.*state already exists/i);
  });

  it('normalizes only absent pre-schema legacy fields and CAS-fences their default identities', () => {
    const rawLegacy = pristineLegacyTournament();
    delete rawLegacy.formatVersion;
    delete rawLegacy.format;
    delete rawLegacy.workflowState;
    delete rawLegacy.workflowRevision;
    delete rawLegacy.entryIdentityRevision;
    delete rawLegacy.rosterIdentityRevision;
    delete rawLegacy.standingsRevision;
    delete rawLegacy.scheduleRevision;

    expect(() => assertOfficial2026LegacyTournamentIsPristine(rawLegacy)).not.toThrow();

    const tournamentId = '507f1f77bcf86cd799439011';
    expect(buildOfficial2026LegacyTournamentCasFilter(tournamentId, rawLegacy)).toEqual({
      _id: tournamentId,
      currentStage: MatchStage.LEAGUE,
      fixturesGenerated: true,
      $and: [
        { $or: [{ __v: 0 }, { __v: { $exists: false } }] },
        { $or: [{ formatVersion: 1 }, { formatVersion: { $exists: false } }] },
        {
          $or: [
            { format: TournamentFormat.LEGACY_LEAGUE },
            { format: { $exists: false } },
          ],
        },
        {
          $or: [
            { workflowState: CompetitionWorkflowState.SETUP },
            { workflowState: { $exists: false } },
          ],
        },
        { $or: [{ workflowRevision: 0 }, { workflowRevision: { $exists: false } }] },
        {
          $or: [
            { entryIdentityRevision: 0 },
            { entryIdentityRevision: { $exists: false } },
          ],
        },
        {
          $or: [
            { rosterIdentityRevision: 0 },
            { rosterIdentityRevision: { $exists: false } },
          ],
        },
        { $or: [{ standingsRevision: 0 }, { standingsRevision: { $exists: false } }] },
        { $or: [{ scheduleRevision: 0 }, { scheduleRevision: { $exists: false } }] },
      ],
    });

    expect(
      buildOfficial2026LegacyTournamentCasFilter(tournamentId, {
        ...rawLegacy,
        __v: 7,
      })
    ).toEqual(
      expect.objectContaining({
        $and: expect.arrayContaining([{ __v: 7 }]),
      })
    );

    expect(() =>
      assertOfficial2026LegacyTournamentIsPristine({
        ...rawLegacy,
        workflowRevision: null as unknown as number,
      })
    ).toThrow(/revisions are not pristine/i);
  });

  it('keeps a pre-start migration upcoming and records exact counts and provenance', () => {
    const migratedAt = new Date('2026-08-22T12:00:00.000Z');
    const plan = buildOfficial2026MigrationPublicationPlan({
      startDate: new Date('2026-08-23T00:00:00.000Z'),
      migratedAt,
      nextWorkflowRevision: 1,
      nextEntryRevision: 1,
      nextRosterRevision: 1,
      nextStandingsRevision: 1,
      rosterPlayerCount: 99,
      backupReference,
    });

    expect(plan.status).toBe(TournamentStatus.UPCOMING);
    expect(plan.tournamentSet).toEqual(
      expect.objectContaining({
        status: TournamentStatus.UPCOMING,
        formatVersion: 2,
        format: TournamentFormat.TWO_GROUP_KNOCKOUT,
        workflowState: CompetitionWorkflowState.GROUP_STAGE,
        currentStage: MatchStage.GROUP_STAGE,
        leagueRounds: 7,
        fixturesGenerated: true,
        competitionRules: expect.objectContaining({
          drawMode: CompetitionDrawMode.MANUAL,
          thirdPlaceMatch: false,
        }),
      })
    );
    expect(plan.auditResult).toEqual(
      expect.objectContaining({
        migratedAt,
        tournamentStatus: TournamentStatus.UPCOMING,
        backupReference,
        sourceSha256: OFFICIAL_2026_SOURCE_SHA256,
        sourceTimeZone: OFFICIAL_2026_TIME_ZONE,
        fixturePublicationHash: OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
        fixtureCount: 42,
        confirmedFixtureCount: 42,
        pendingFixtureCount: 0,
        teamCount: 14,
        rosterPlayerCount: 99,
        migrationVersion: 2,
        openerSupplement: OFFICIAL_2026_OPENER_SUPPLEMENT,
      })
    );
  });

  it('marks an at-start or post-start migration ongoing and rejects malformed inputs', () => {
    const atStart = new Date('2026-08-23T00:00:00.000Z');
    const plan = buildOfficial2026MigrationPublicationPlan({
      startDate: atStart,
      migratedAt: atStart,
      nextWorkflowRevision: 1,
      nextEntryRevision: 1,
      nextRosterRevision: 1,
      nextStandingsRevision: 1,
      rosterPlayerCount: 0,
      backupReference,
    });
    expect(plan.status).toBe(TournamentStatus.ONGOING);
    expect(() =>
      buildOfficial2026MigrationPublicationPlan({
        startDate: new Date('invalid'),
        migratedAt: atStart,
        nextWorkflowRevision: 1,
        nextEntryRevision: 1,
        nextRosterRevision: 1,
        nextStandingsRevision: 1,
        rosterPlayerCount: 0,
        backupReference,
      })
    ).toThrow(/dates must be valid/i);
    expect(() =>
      buildOfficial2026MigrationPublicationPlan({
        startDate: atStart,
        migratedAt: atStart,
        nextWorkflowRevision: 1,
        nextEntryRevision: 1,
        nextRosterRevision: 1,
        nextStandingsRevision: 1,
        rosterPlayerCount: -1,
        backupReference,
      })
    ).toThrow(/roster count/i);
  });

  it('persists only a safe backup basename and checksum, never the supplied path or credentials', () => {
    expect(backupReference).toEqual({
      basename: 'solidfm-before-official-2026.archive',
      sha256: backupArtifactSha256,
    });
    expect(JSON.stringify(backupReference)).not.toContain('verified-backups');

    const uriReference = buildOfficial2026SafeBackupReference(
      'mongodb://backup-user:secret@host.example/private-snapshot?token=hidden',
      'A'.repeat(64)
    );
    expect(uriReference.basename).toBe('private-snapshot');
    expect(uriReference.sha256).toBe('a'.repeat(64));
    expect(JSON.stringify(uriReference)).not.toMatch(/backup-user|secret|token|hidden/);
    expect(() => buildOfficial2026SafeBackupReference('   ', backupArtifactSha256)).toThrow(
      /backup reference is required/i
    );
    expect(() =>
      buildOfficial2026SafeBackupReference('backup.archive', 'path-text-is-not-a-checksum')
    ).toThrow(/independently computed backup artifact sha-256/i);
  });

  it('verifies every committed fixture field against the pinned 42-row manifest', () => {
    const tournamentId = '507f1f77bcf86cd799439011';
    const migratedAt = new Date('2026-08-22T12:00:00.000Z');
    const teamIdsByKey = new Map(
      OFFICIAL_2026_TEAMS.map((team, index) => [
        team.key,
        (index + 1).toString(16).padStart(24, '0'),
      ])
    );
    const buildStoredMatches = (): Official2026CommittedMatchLike[] =>
      OFFICIAL_2026_FIXTURES.map((fixture) => ({
        homeTeam: teamIdsByKey.get(fixture.homeTeamKey)!,
        awayTeam: teamIdsByKey.get(fixture.awayTeamKey)!,
        homeScore: 0,
        awayScore: 0,
        ...(fixture.kickoffAt ? { date: new Date(fixture.kickoffAt) } : {}),
        ...(fixture.venueName ? { venue: fixture.venueName } : {}),
        status: MatchStatus.SCHEDULED,
        stage: MatchStage.GROUP_STAGE,
        groupKey: fixture.groupKey,
        leg: 1,
        fixtureKey: `${tournamentId}:group_stage:official:${fixture.officialNumber}`,
        scheduleStatus:
          fixture.scheduleStatus === 'confirmed'
            ? MatchScheduleStatus.CONFIRMED
            : MatchScheduleStatus.PENDING,
        officialFixtureNumber: fixture.officialNumber,
        fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
        fixturePublicationHash: OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
        fixtureSourceReference: OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE,
        fixturePublishedAt: migratedAt,
        events: [],
        isDeleted: false,
      }));

    expect(() =>
      assertOfficial2026CommittedMatchesMatchManifest(
        tournamentId,
        buildStoredMatches().reverse(),
        teamIdsByKey,
        migratedAt
      )
    ).not.toThrow();

    for (const corrupt of [
      (matches: ReturnType<typeof buildStoredMatches>) => {
        matches[0].homeTeam = matches[1].homeTeam;
      },
      (matches: ReturnType<typeof buildStoredMatches>) => {
        matches[0].date = new Date('2026-08-23T13:00:00.000Z');
      },
      (matches: ReturnType<typeof buildStoredMatches>) => {
        matches[0].venue = 'Wrong Arena';
      },
      (matches: ReturnType<typeof buildStoredMatches>) => {
        matches[1].date = new Date('2026-08-30T13:00:00.000Z');
      },
      (matches: ReturnType<typeof buildStoredMatches>) => {
        matches[1].venue = 'Wrong Arena';
      },
      (matches: ReturnType<typeof buildStoredMatches>) => {
        matches[1].fixturePublicationHash = '0'.repeat(64);
      },
      (matches: ReturnType<typeof buildStoredMatches>) => {
        matches[1].groupKey = 'B';
      },
    ]) {
      const matches = buildStoredMatches();
      corrupt(matches);
      expect(() =>
        assertOfficial2026CommittedMatchesMatchManifest(
          tournamentId,
          matches,
          teamIdsByKey,
          migratedAt
        )
      ).toThrow(/does not match the pinned official manifest/i);
    }
  });
});
