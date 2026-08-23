import { CompetitionDivision } from "@/models/competition-division";
import { MatchStage } from "@/models/match.model";
import {
  CompetitionWorkflowState,
  FIXED_V2_COMPETITION_RULES,
  FIXED_WOMENS_COMPETITION_RULES,
  TournamentFormat,
  TournamentStatus,
} from "@/models/tournament.model";

export const OFFICIAL_WOMENS_TOURNAMENT_ID = "6a8a1c47508de0e7425195a4";
export const OFFICIAL_MENS_TOURNAMENT_ID = "6a88bfa4ce2cf64818770691";
export const OFFICIAL_WOMENS_TOURNAMENT_IDENTITY = Object.freeze({
  name: "COJUDESOLIDFM5-ASIDE FOOTBALL TOURNAMENT(WOMEN)",
  season: "2026",
  startDate: "2026-08-23T00:00:00.000Z",
  endDate: "2026-10-17T00:00:00.000Z",
});

/**
 * The existing audited entry creation order is the administrative table-slot
 * order. It does not seed or rank teams. These immutable IDs are deliberately
 * narrower than a name search so the migration can never absorb another team
 * or entry with a similar label.
 */
export const OFFICIAL_WOMENS_ENTRY_TARGETS = Object.freeze([
  {
    entryId: "6a8a1f82508de0e7425195a8",
    teamId: "6a8a1f1f508de0e7425195a7",
    teamName: "RANGERS INTERNATIONAL WOMEN",
    teamLogoSnapshot:
      "https://res.cloudinary.com/dsfkvsbaw/image/upload/v1787436831/solidfm/team_logos/logo_rangers_international_women_1787436830910.jpg",
    createdBy: "69c1de8a26966eeb2b5da87a",
    createdAt: "2026-08-22T22:15:30.045Z",
    updatedAt: "2026-08-22T22:15:30.045Z",
    tableSlot: 1,
  },
  {
    entryId: "6a8a1fa1508de0e7425195a9",
    teamId: "6a8a1ec9508de0e7425195a6",
    teamName: "NYSC WOMEN TEAM",
    teamLogoSnapshot:
      "https://res.cloudinary.com/dsfkvsbaw/image/upload/v1787436743/solidfm/team_logos/logo_nysc_women_team_1787436743401.jpg",
    createdBy: "69c1de8a26966eeb2b5da87a",
    createdAt: "2026-08-22T22:16:01.121Z",
    updatedAt: "2026-08-22T22:16:01.121Z",
    tableSlot: 2,
  },
  {
    entryId: "6a8a1fb1508de0e7425195aa",
    teamId: "6a8a1ea3508de0e7425195a5",
    teamName: "ZOHAR FA",
    teamLogoSnapshot:
      "https://res.cloudinary.com/dsfkvsbaw/image/upload/v1787436706/solidfm/team_logos/logo_zohar_fa_1787436706510.jpg",
    createdBy: "69c1de8a26966eeb2b5da87a",
    createdAt: "2026-08-22T22:16:17.400Z",
    updatedAt: "2026-08-22T22:16:17.400Z",
    tableSlot: 3,
  },
]);

export interface RawOfficialWomensTeam {
  _id: unknown;
  name?: string;
  registrationStatus?: string;
  division?: CompetitionDivision | null;
  lifecycleRevision?: number | null;
  isDeleted?: boolean | null;
  createdAt?: Date;
  updatedAt?: Date;
  __v?: number;
}

export interface RawOfficialWomensEntry {
  _id: unknown;
  tournamentId?: unknown;
  teamId?: unknown;
  status?: string;
  source?: string;
  groupKey?: "A" | "B" | null;
  groupSlot?: number | null;
  teamNameSnapshot?: string;
  teamLogoSnapshot?: string | null;
  createdBy?: unknown;
  isDeleted?: boolean | null;
  createdAt?: Date;
  updatedAt?: Date;
  __v?: number;
}

export interface RawOfficialWomensTournament {
  _id: unknown;
  name?: string;
  season?: string;
  startDate?: Date;
  endDate?: Date | null;
  status?: TournamentStatus;
  division?: CompetitionDivision | null;
  currentStage?: MatchStage;
  leagueRounds?: number;
  fixturesGenerated?: boolean;
  formatVersion?: number;
  format?: TournamentFormat;
  workflowState?: CompetitionWorkflowState;
  workflowRevision?: number;
  entryIdentityRevision?: number;
  rosterIdentityRevision?: number;
  standingsRevision?: number;
  scheduleRevision?: number;
  competitionRules?: unknown;
  competitionTieResolutions?: unknown[];
  qualificationSnapshot?: unknown[];
  qualificationFinalizedAt?: Date | null;
  championTeamId?: unknown;
  runnerUpTeamId?: unknown;
  thirdPlaceTeamId?: unknown;
  competitionCompletedAt?: Date | null;
  isDeleted?: boolean | null;
  createdAt?: Date;
  updatedAt?: Date;
  __v?: number;
}

export interface OfficialWomensTeamInventoryRow {
  id: string;
  expectedName: string;
  found: boolean;
  raw?: RawOfficialWomensTeam;
  playerCount: number;
  tournamentEntryCount: number;
}

export interface OfficialWomensTournamentResourceCounts {
  entries: number;
  matches: number;
  standings: number;
  rosters: number;
  draws: number;
  brackets: number;
  operations: number;
  playerStats: number;
  womensFinals: number;
}

export interface OfficialWomensConversionInventory {
  tournament?: RawOfficialWomensTournament;
  entries: RawOfficialWomensEntry[];
  teams: OfficialWomensTeamInventoryRow[];
  resources: OfficialWomensTournamentResourceCounts;
}

export interface VerifiedBackupEvidence {
  artifact: string;
  sha256: string;
}

export interface OfficialWomensTournamentUpdate {
  $set: Record<string, unknown>;
  $unset: Record<string, 1>;
}

const SAFE_BACKUP_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/i;

const objectIdString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  return "";
};

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && !Number.isNaN(value.getTime());

const canonicalize = (value: unknown): unknown => {
  if (value === undefined) return "__undefined__";
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if ("toHexString" in value && typeof value.toHexString === "function") {
    return value.toHexString();
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
};

const equalCanonical = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

const exactOptionalField = (value: unknown): unknown =>
  value === undefined ? { $exists: false } : value;

const buildExactCasFilter = <T extends object>(
  raw: T,
  fields: ReadonlyArray<keyof T>,
): Record<string, unknown> =>
  Object.fromEntries(
    fields.map((field) => [String(field), exactOptionalField(raw[field])]),
  );

const TOURNAMENT_CAS_FIELDS: ReadonlyArray<keyof RawOfficialWomensTournament> =
  [
    "_id",
    "name",
    "season",
    "startDate",
    "endDate",
    "status",
    "division",
    "currentStage",
    "leagueRounds",
    "fixturesGenerated",
    "formatVersion",
    "format",
    "workflowState",
    "workflowRevision",
    "entryIdentityRevision",
    "rosterIdentityRevision",
    "standingsRevision",
    "scheduleRevision",
    "competitionRules",
    "competitionTieResolutions",
    "qualificationSnapshot",
    "qualificationFinalizedAt",
    "championTeamId",
    "runnerUpTeamId",
    "thirdPlaceTeamId",
    "competitionCompletedAt",
    "isDeleted",
    "createdAt",
    "updatedAt",
    "__v",
  ];

const TEAM_CAS_FIELDS: ReadonlyArray<keyof RawOfficialWomensTeam> = [
  "_id",
  "name",
  "registrationStatus",
  "division",
  "lifecycleRevision",
  "isDeleted",
  "createdAt",
  "updatedAt",
  "__v",
];

const ENTRY_CAS_FIELDS: ReadonlyArray<keyof RawOfficialWomensEntry> = [
  "_id",
  "tournamentId",
  "teamId",
  "status",
  "source",
  "groupKey",
  "groupSlot",
  "teamNameSnapshot",
  "teamLogoSnapshot",
  "createdBy",
  "isDeleted",
  "createdAt",
  "updatedAt",
  "__v",
];

export const buildOfficialWomensTournamentCasFilter = (
  raw: RawOfficialWomensTournament,
): Record<string, unknown> => buildExactCasFilter(raw, TOURNAMENT_CAS_FIELDS);

export const buildOfficialWomensTeamCasFilter = (
  raw: RawOfficialWomensTeam,
): Record<string, unknown> => buildExactCasFilter(raw, TEAM_CAS_FIELDS);

export const buildOfficialWomensEntryCasFilter = (
  raw: RawOfficialWomensEntry,
): Record<string, unknown> => buildExactCasFilter(raw, ENTRY_CAS_FIELDS);

export const assertVerifiedBackupEvidence = (
  artifact?: string,
  sha256?: string,
): VerifiedBackupEvidence => {
  if (!artifact || !SAFE_BACKUP_BASENAME.test(artifact)) {
    throw new Error(
      "Pass --backup-artifact=<safe-basename> (letters, numbers, dot, underscore, or hyphen only).",
    );
  }
  if (!sha256 || !SHA256_HEX.test(sha256)) {
    throw new Error("Pass --backup-sha256=<exact-64-character-sha256>.");
  }
  return { artifact, sha256: sha256.toLowerCase() };
};

export const deriveOfficialWomensSetupStatus = (
  startDate: Date,
  now: Date,
): TournamentStatus => {
  if (!isValidDate(startDate) || !isValidDate(now)) {
    throw new Error("Tournament status derivation requires valid dates.");
  }
  // A setup competition cannot truthfully be completed merely because its
  // scheduled end date passed. Completion remains owned by the final workflow.
  return now.getTime() < startDate.getTime()
    ? TournamentStatus.UPCOMING
    : TournamentStatus.ONGOING;
};

export const isOfficialWomensV3State = (
  tournament: RawOfficialWomensTournament,
): boolean =>
  tournament.formatVersion === 3 &&
  tournament.format === TournamentFormat.SINGLE_TABLE_FINAL &&
  tournament.division === CompetitionDivision.WOMEN;

const assertBaseTournament = (
  tournament: RawOfficialWomensTournament,
): void => {
  if (objectIdString(tournament._id) !== OFFICIAL_WOMENS_TOURNAMENT_ID) {
    throw new Error(
      "Women’s conversion refused: the exact tournament ID is required.",
    );
  }
  if (
    tournament.name !== OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.name ||
    tournament.season !== OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.season ||
    !isValidDate(tournament.startDate) ||
    tournament.startDate.toISOString() !==
      OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.startDate ||
    (tournament.endDate != null && !isValidDate(tournament.endDate)) ||
    tournament.endDate?.toISOString() !==
      OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.endDate ||
    (tournament.endDate instanceof Date &&
      tournament.endDate < tournament.startDate) ||
    tournament.isDeleted !== false ||
    tournament.fixturesGenerated !== false ||
    tournament.entryIdentityRevision !== 0 ||
    tournament.rosterIdentityRevision !== 0 ||
    tournament.standingsRevision !== 0 ||
    tournament.scheduleRevision !== 0 ||
    !Array.isArray(tournament.competitionTieResolutions) ||
    tournament.competitionTieResolutions.length !== 0 ||
    !Array.isArray(tournament.qualificationSnapshot) ||
    tournament.qualificationSnapshot.length !== 0 ||
    tournament.qualificationFinalizedAt != null ||
    tournament.championTeamId != null ||
    tournament.runnerUpTeamId != null ||
    tournament.thirdPlaceTeamId != null ||
    tournament.competitionCompletedAt != null ||
    !Number.isInteger(tournament.__v) ||
    (tournament.__v ?? -1) < 0
  ) {
    throw new Error(
      "Women’s conversion refused: the tournament is not a pristine setup.",
    );
  }
};

const assertTournamentState = (
  tournament: RawOfficialWomensTournament,
  referenceTime?: Date,
): boolean => {
  const alreadyV3 = isOfficialWomensV3State(tournament);
  if (alreadyV3) {
    const expectedStatus = referenceTime
      ? deriveOfficialWomensSetupStatus(tournament.startDate!, referenceTime)
      : undefined;
    if (
      ![TournamentStatus.UPCOMING, TournamentStatus.ONGOING].includes(
        tournament.status as TournamentStatus,
      ) ||
      (expectedStatus !== undefined && tournament.status !== expectedStatus) ||
      tournament.workflowState !== CompetitionWorkflowState.ENTRIES_READY ||
      tournament.workflowRevision !== 4 ||
      tournament.currentStage !== MatchStage.LEAGUE ||
      tournament.leagueRounds !== 3 ||
      !equalCanonical(
        tournament.competitionRules,
        FIXED_WOMENS_COMPETITION_RULES,
      )
    ) {
      throw new Error(
        "Women’s conversion refused: the format-v3 tournament is not the exact idempotent target state.",
      );
    }
    return true;
  }

  if (
    tournament.status !== TournamentStatus.UPCOMING ||
    tournament.formatVersion !== 2 ||
    tournament.format !== TournamentFormat.TWO_GROUP_KNOCKOUT ||
    ![undefined, null, CompetitionDivision.MEN].includes(tournament.division) ||
    tournament.workflowState !== CompetitionWorkflowState.SETUP ||
    tournament.workflowRevision !== 3 ||
    tournament.currentStage !== MatchStage.GROUP_STAGE ||
    tournament.leagueRounds !== 0 ||
    !equalCanonical(tournament.competitionRules, FIXED_V2_COMPETITION_RULES)
  ) {
    throw new Error(
      "Women’s conversion refused: expected the audited format-v2 setup at workflow revision 3.",
    );
  }
  return false;
};

const assertResourceCounts = (
  resources: OfficialWomensTournamentResourceCounts,
): void => {
  const expected: OfficialWomensTournamentResourceCounts = {
    entries: 3,
    matches: 0,
    standings: 0,
    rosters: 0,
    draws: 0,
    brackets: 0,
    operations: 0,
    playerStats: 0,
    womensFinals: 0,
  };
  if (!equalCanonical(resources, expected)) {
    throw new Error(
      "Women’s conversion refused: expected exactly three entries and no published competition resources.",
    );
  }
};

const assertTeams = (
  teams: OfficialWomensTeamInventoryRow[],
  alreadyV3: boolean,
): void => {
  const expectedById = new Map(
    OFFICIAL_WOMENS_ENTRY_TARGETS.map((target) => [target.teamId, target]),
  );
  if (
    teams.length !== expectedById.size ||
    new Set(teams.map((row) => row.id)).size !== expectedById.size
  ) {
    throw new Error(
      "Women’s conversion refused: the exact three-team inventory is required.",
    );
  }

  for (const row of teams) {
    const target = expectedById.get(row.id);
    const team = row.raw;
    if (
      !target ||
      !row.found ||
      !team ||
      objectIdString(team._id) !== target.teamId ||
      row.expectedName !== target.teamName ||
      team.name !== target.teamName ||
      team.registrationStatus !== "registered" ||
      team.isDeleted !== false ||
      (!alreadyV3 && row.playerCount !== 0) ||
      row.tournamentEntryCount !== 1 ||
      !Number.isInteger(team.__v) ||
      (team.__v ?? -1) < 0 ||
      (team.lifecycleRevision != null &&
        (!Number.isInteger(team.lifecycleRevision) ||
          team.lifecycleRevision < 0)) ||
      (alreadyV3
        ? team.division !== CompetitionDivision.WOMEN
        : ![
            undefined,
            null,
            CompetitionDivision.MEN,
            CompetitionDivision.WOMEN,
          ].includes(team.division))
    ) {
      throw new Error(
        `Women’s conversion refused: team preconditions failed for ${row.id}.`,
      );
    }
  }
};

const assertEntries = (
  entries: RawOfficialWomensEntry[],
  alreadyV3: boolean,
): void => {
  const byId = new Map(
    entries.map((entry) => [objectIdString(entry._id), entry]),
  );
  if (
    entries.length !== OFFICIAL_WOMENS_ENTRY_TARGETS.length ||
    byId.size !== OFFICIAL_WOMENS_ENTRY_TARGETS.length
  ) {
    throw new Error(
      "Women’s conversion refused: the exact three entry documents are required.",
    );
  }

  let previousCreatedAt = Number.NEGATIVE_INFINITY;
  for (const target of OFFICIAL_WOMENS_ENTRY_TARGETS) {
    const entry = byId.get(target.entryId);
    if (
      !entry ||
      objectIdString(entry.tournamentId) !== OFFICIAL_WOMENS_TOURNAMENT_ID ||
      objectIdString(entry.teamId) !== target.teamId ||
      entry.status !== "active" ||
      entry.source !== "admin" ||
      entry.teamNameSnapshot !== target.teamName ||
      entry.teamLogoSnapshot !== target.teamLogoSnapshot ||
      objectIdString(entry.createdBy) !== target.createdBy ||
      entry.isDeleted !== false ||
      !isValidDate(entry.createdAt) ||
      entry.createdAt.toISOString() !== target.createdAt ||
      !isValidDate(entry.updatedAt) ||
      entry.updatedAt.toISOString() !== target.updatedAt ||
      !Number.isInteger(entry.__v) ||
      (entry.__v ?? -1) < 0 ||
      (alreadyV3
        ? entry.groupKey !== "A" || entry.groupSlot !== target.tableSlot
        : entry.groupKey != null || entry.groupSlot != null)
    ) {
      throw new Error(
        `Women’s conversion refused: entry preconditions failed for ${target.entryId}.`,
      );
    }
    if (entry.createdAt.getTime() <= previousCreatedAt) {
      throw new Error(
        "Women’s conversion refused: official entry creation order no longer matches slots 1–3.",
      );
    }
    previousCreatedAt = entry.createdAt.getTime();
  }
};

/**
 * Validates both the audited v2 source and the exact v3 target. Returns true
 * for the already-converted, verified no-op state.
 */
export const assertOfficialWomensConversionInventory = (
  inventory: OfficialWomensConversionInventory,
  referenceTime?: Date,
): boolean => {
  if (!inventory.tournament) {
    throw new Error(
      "Women’s conversion refused: the exact tournament was not found.",
    );
  }
  assertBaseTournament(inventory.tournament);
  const alreadyV3 = assertTournamentState(inventory.tournament, referenceTime);
  assertResourceCounts(inventory.resources);
  assertTeams(inventory.teams, alreadyV3);
  assertEntries(inventory.entries, alreadyV3);
  return alreadyV3;
};

export const buildOfficialWomensTournamentUpdate = (
  tournament: RawOfficialWomensTournament,
  migratedAt: Date,
): OfficialWomensTournamentUpdate => {
  if (!isValidDate(tournament.startDate) || !isValidDate(migratedAt)) {
    throw new Error("Women’s conversion update requires valid dates.");
  }
  return {
    $set: {
      status: deriveOfficialWomensSetupStatus(tournament.startDate, migratedAt),
      division: CompetitionDivision.WOMEN,
      formatVersion: 3,
      format: TournamentFormat.SINGLE_TABLE_FINAL,
      workflowState: CompetitionWorkflowState.ENTRIES_READY,
      workflowRevision: 4,
      entryIdentityRevision: 0,
      rosterIdentityRevision: 0,
      standingsRevision: 0,
      scheduleRevision: 0,
      currentStage: MatchStage.LEAGUE,
      leagueRounds: 3,
      fixturesGenerated: false,
      competitionRules: {
        ...FIXED_WOMENS_COMPETITION_RULES,
        tieBreakers: [...FIXED_WOMENS_COMPETITION_RULES.tieBreakers],
      },
      competitionTieResolutions: [],
      qualificationSnapshot: [],
      updatedAt: migratedAt,
    },
    $unset: {
      qualificationFinalizedAt: 1,
      championTeamId: 1,
      runnerUpTeamId: 1,
      thirdPlaceTeamId: 1,
      competitionCompletedAt: 1,
    },
  };
};
