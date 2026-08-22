import {
  OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
  OFFICIAL_2026_FIXTURES,
  OFFICIAL_2026_SOURCE_BYTE_LENGTH,
  OFFICIAL_2026_SOURCE_SHA256,
  OFFICIAL_2026_SOURCE_TITLE,
  OFFICIAL_2026_TEAMS,
  OFFICIAL_2026_TIME_ZONE,
  OFFICIAL_2026_VENUES,
  Official2026TeamKey,
} from '@/data/official-2026-fixture-manifest';
import {
  MatchFixtureSource,
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from '@/models/match.model';
import {
  CompetitionWorkflowState,
  FIXED_V2_COMPETITION_RULES,
  TournamentFormat,
  TournamentStatus,
} from '@/models/tournament.model';

export interface Official2026LegacyTournamentSafetySnapshot {
  __v?: number;
  season: string;
  startDate: Date;
  endDate?: Date;
  status: TournamentStatus;
  currentStage: MatchStage;
  leagueRounds: number;
  fixturesGenerated: boolean;
  formatVersion?: 1 | 2;
  format?: TournamentFormat;
  workflowState?: CompetitionWorkflowState;
  workflowRevision?: number;
  entryIdentityRevision?: number;
  rosterIdentityRevision?: number;
  standingsRevision?: number;
  scheduleRevision?: number;
  competitionTieResolutions?: unknown[];
  qualificationSnapshot?: unknown[];
  qualificationFinalizedAt?: Date;
  championTeamId?: unknown;
  runnerUpTeamId?: unknown;
  thirdPlaceTeamId?: unknown;
  competitionCompletedAt?: Date;
  isDeleted: boolean;
}

export const assertOfficial2026LegacyTournamentIsPristine = (
  tournament: Official2026LegacyTournamentSafetySnapshot
): void => {
  const formatVersion =
    tournament.formatVersion === undefined ? 1 : tournament.formatVersion;
  const format =
    tournament.format === undefined
      ? TournamentFormat.LEGACY_LEAGUE
      : tournament.format;
  const workflowState =
    tournament.workflowState === undefined
      ? CompetitionWorkflowState.SETUP
      : tournament.workflowState;
  if (tournament.isDeleted) throw new Error('The target tournament is deleted.');
  if (tournament.season.trim() !== '2026') {
    throw new Error('Migration refused: the target tournament season is not exactly 2026.');
  }
  if (
    new Date(tournament.startDate).getUTCFullYear() !== 2026 ||
    (tournament.endDate && new Date(tournament.endDate).getUTCFullYear() !== 2026)
  ) {
    throw new Error(
      'Migration refused: the target tournament metadata is outside calendar year 2026.'
    );
  }
  if (
    formatVersion !== 1 ||
    format !== TournamentFormat.LEGACY_LEAGUE
  ) {
    throw new Error('Migration refused: the target is not an unmigrated legacy tournament.');
  }
  if (
    tournament.currentStage !== MatchStage.LEAGUE ||
    tournament.leagueRounds !== 6 ||
    tournament.fixturesGenerated !== true
  ) {
    throw new Error(
      'Migration refused: expected the untouched six-round legacy fixture-generation state.'
    );
  }
  if (tournament.status === TournamentStatus.COMPLETED) {
    throw new Error('Migration refused: a completed tournament cannot be rewritten.');
  }
  if (workflowState !== CompetitionWorkflowState.SETUP) {
    throw new Error('Migration refused: downstream v2 workflow state already exists.');
  }
  const revisionOrLegacyDefault = (revision: number | undefined): number =>
    revision === undefined ? 0 : revision;
  if (
    revisionOrLegacyDefault(tournament.workflowRevision) !== 0 ||
    revisionOrLegacyDefault(tournament.entryIdentityRevision) !== 0 ||
    revisionOrLegacyDefault(tournament.rosterIdentityRevision) !== 0 ||
    revisionOrLegacyDefault(tournament.standingsRevision) !== 0 ||
    revisionOrLegacyDefault(tournament.scheduleRevision) !== 0
  ) {
    throw new Error('Migration refused: tournament workflow revisions are not pristine.');
  }
  if (
    (tournament.competitionTieResolutions?.length ?? 0) > 0 ||
    (tournament.qualificationSnapshot?.length ?? 0) > 0 ||
    tournament.qualificationFinalizedAt ||
    tournament.championTeamId ||
    tournament.runnerUpTeamId ||
    tournament.thirdPlaceTeamId ||
    tournament.competitionCompletedAt
  ) {
    throw new Error(
      'Migration refused: qualification, winner, or completion state already exists.'
    );
  }
};

export const buildOfficial2026LegacyTournamentCasFilter = (
  tournamentId: unknown,
  tournament: Official2026LegacyTournamentSafetySnapshot
): Record<string, unknown> => {
  const legacyVersionGuard =
    tournament.__v === undefined
      ? { $or: [{ __v: 0 }, { __v: { $exists: false } }] }
      : { __v: tournament.__v };
  return {
    _id: tournamentId,
    currentStage: MatchStage.LEAGUE,
    fixturesGenerated: true,
    $and: [
      legacyVersionGuard,
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
      ...[
        'workflowRevision',
        'entryIdentityRevision',
        'rosterIdentityRevision',
        'standingsRevision',
        'scheduleRevision',
      ].map((field) => ({
        $or: [{ [field]: 0 }, { [field]: { $exists: false } }],
      })),
    ],
  };
};

export interface Official2026SafeBackupReference {
  basename: string | null;
  sha256: string;
}

export const buildOfficial2026SafeBackupReference = (
  rawReference: string,
  artifactSha256: string
): Official2026SafeBackupReference => {
  const normalized = rawReference.trim();
  if (!normalized) throw new Error('A verified backup reference is required.');
  const checksum = artifactSha256.trim().toLocaleLowerCase();
  if (!/^[0-9a-f]{64}$/.test(checksum)) {
    throw new Error('The independently computed backup artifact SHA-256 is required.');
  }
  const pathWithoutQuery = normalized.split(/[?#]/, 1)[0];
  const candidate = pathWithoutQuery.replaceAll('\\', '/').split('/').filter(Boolean).at(-1);
  const basename =
    candidate &&
    candidate.length <= 120 &&
    /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(candidate) &&
    candidate !== '.' &&
    candidate !== '..'
      ? candidate
      : null;
  return {
    basename,
    sha256: checksum,
  };
};

interface Official2026MigrationPublicationInput {
  startDate: Date;
  migratedAt: Date;
  nextWorkflowRevision: number;
  nextEntryRevision: number;
  nextRosterRevision: number;
  nextStandingsRevision: number;
  rosterPlayerCount: number;
  backupReference: Official2026SafeBackupReference;
}

export const buildOfficial2026MigrationPublicationPlan = (
  input: Official2026MigrationPublicationInput
) => {
  const startDate = new Date(input.startDate);
  const migratedAt = new Date(input.migratedAt);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(migratedAt.getTime())) {
    throw new Error('Migration publication dates must be valid.');
  }
  if (!Number.isInteger(input.rosterPlayerCount) || input.rosterPlayerCount < 0) {
    throw new Error('Migration roster count must be a non-negative integer.');
  }
  if (!/^[0-9a-f]{64}$/.test(input.backupReference.sha256)) {
    throw new Error('Migration backup reference checksum is invalid.');
  }
  const status =
    migratedAt.getTime() < startDate.getTime()
      ? TournamentStatus.UPCOMING
      : TournamentStatus.ONGOING;
  const confirmedFixtureCount = OFFICIAL_2026_FIXTURES.filter(
    (fixture) => fixture.scheduleStatus === 'confirmed'
  ).length;
  const pendingFixtureCount = OFFICIAL_2026_FIXTURES.length - confirmedFixtureCount;

  return {
    status,
    tournamentSet: {
      status,
      formatVersion: 2 as const,
      format: TournamentFormat.TWO_GROUP_KNOCKOUT,
      workflowState: CompetitionWorkflowState.GROUP_STAGE,
      workflowRevision: input.nextWorkflowRevision,
      entryIdentityRevision: input.nextEntryRevision,
      rosterIdentityRevision: input.nextRosterRevision,
      standingsRevision: input.nextStandingsRevision,
      scheduleRevision: 0,
      currentStage: MatchStage.GROUP_STAGE,
      leagueRounds: 7,
      fixturesGenerated: true,
      competitionRules: {
        ...FIXED_V2_COMPETITION_RULES,
        tieBreakers: [...FIXED_V2_COMPETITION_RULES.tieBreakers],
      },
      competitionTieResolutions: [] as unknown[],
      qualificationSnapshot: [] as unknown[],
    },
    auditResult: {
      migrationVersion: 1,
      migratedAt,
      tournamentStatus: status,
      backupReference: { ...input.backupReference },
      sourceTitle: OFFICIAL_2026_SOURCE_TITLE,
      sourceSha256: OFFICIAL_2026_SOURCE_SHA256,
      sourceByteLength: OFFICIAL_2026_SOURCE_BYTE_LENGTH,
      sourceTimeZone: OFFICIAL_2026_TIME_ZONE,
      fixturePublicationHash: OFFICIAL_2026_FIXTURE_PUBLICATION_HASH,
      fixtureCount: OFFICIAL_2026_FIXTURES.length,
      confirmedFixtureCount,
      pendingFixtureCount,
      teamCount: OFFICIAL_2026_TEAMS.length,
      rosterPlayerCount: input.rosterPlayerCount,
      groupMapping: { 'Pot 1': 'A', 'Pot 2': 'B' },
      venueNames: OFFICIAL_2026_VENUES.map((venue) => venue.documentName),
    },
  };
};

export interface Official2026CommittedMatchLike {
  homeTeam: unknown;
  awayTeam: unknown;
  homeScore?: number;
  awayScore?: number;
  date?: Date | string;
  venue?: string;
  status?: string;
  stage?: string;
  groupKey?: string;
  leg?: number;
  fixtureKey?: string;
  scheduleStatus?: string;
  officialFixtureNumber?: number;
  fixtureSource?: string;
  fixturePublicationHash?: string;
  fixtureSourceReference?: string;
  fixturePublishedAt?: Date | string;
  events?: unknown[];
  isDeleted?: boolean;
  drawId?: unknown;
  bracketId?: unknown;
  bracketNodeKey?: string;
  winner?: unknown;
  resultLockedAt?: Date | string;
}

const dateIso = (value: Date | string | undefined): string | null => {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const assertOfficial2026CommittedMatchesMatchManifest = (
  tournamentId: string,
  matches: Official2026CommittedMatchLike[],
  teamIdsByKey: ReadonlyMap<Official2026TeamKey, string>,
  migratedAt: Date
): void => {
  if (matches.length !== OFFICIAL_2026_FIXTURES.length) {
    throw new Error(
      `Post-commit verification expected 42 stored fixtures, found ${matches.length}.`
    );
  }
  const sorted = [...matches].sort(
    (left, right) =>
      (left.officialFixtureNumber ?? Number.MAX_SAFE_INTEGER) -
      (right.officialFixtureNumber ?? Number.MAX_SAFE_INTEGER)
  );
  const expectedPublishedAt = migratedAt.toISOString();
  const sourceReference = `docx-sha256:${OFFICIAL_2026_SOURCE_SHA256}`;

  for (let index = 0; index < OFFICIAL_2026_FIXTURES.length; index++) {
    const expected = OFFICIAL_2026_FIXTURES[index];
    const stored = sorted[index];
    const expectedHomeTeamId = teamIdsByKey.get(expected.homeTeamKey);
    const expectedAwayTeamId = teamIdsByKey.get(expected.awayTeamKey);
    if (!expectedHomeTeamId || !expectedAwayTeamId) {
      throw new Error('Post-commit verification could not resolve every pinned team identity.');
    }
    const expectedScheduleStatus =
      expected.scheduleStatus === 'confirmed'
        ? MatchScheduleStatus.CONFIRMED
        : MatchScheduleStatus.PENDING;
    const storedDate = dateIso(stored.date);
    const storedPublishedAt = dateIso(stored.fixturePublishedAt);
    const hasUnexpectedBracketState = Boolean(
      stored.drawId ||
        stored.bracketId ||
        stored.bracketNodeKey ||
        stored.winner ||
        stored.resultLockedAt
    );
    if (
      stored.officialFixtureNumber !== expected.officialNumber ||
      stored.groupKey !== expected.groupKey ||
      String(stored.homeTeam) !== expectedHomeTeamId ||
      String(stored.awayTeam) !== expectedAwayTeamId ||
      stored.scheduleStatus !== expectedScheduleStatus ||
      storedDate !== expected.kickoffAt ||
      (stored.venue ?? null) !== expected.venueName ||
      stored.fixtureKey !==
        `${tournamentId}:group_stage:official:${expected.officialNumber}` ||
      stored.fixtureSource !== MatchFixtureSource.PHYSICAL_OFFICIAL ||
      stored.fixturePublicationHash !== OFFICIAL_2026_FIXTURE_PUBLICATION_HASH ||
      stored.fixtureSourceReference !== sourceReference ||
      storedPublishedAt !== expectedPublishedAt ||
      stored.stage !== MatchStage.GROUP_STAGE ||
      stored.status !== MatchStatus.SCHEDULED ||
      stored.leg !== 1 ||
      (stored.homeScore ?? 0) !== 0 ||
      (stored.awayScore ?? 0) !== 0 ||
      (stored.events?.length ?? 0) !== 0 ||
      stored.isDeleted !== false ||
      hasUnexpectedBracketState
    ) {
      throw new Error(
        `Post-commit fixture ${expected.officialNumber} does not match the pinned official manifest.`
      );
    }
  }
};
