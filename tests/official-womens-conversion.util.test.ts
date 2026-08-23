import { Types } from "mongoose";
import { CompetitionDivision } from "@/models/competition-division";
import { MatchStage } from "@/models/match.model";
import {
  CompetitionWorkflowState,
  FIXED_V2_COMPETITION_RULES,
  FIXED_WOMENS_COMPETITION_RULES,
  TournamentFormat,
  TournamentStatus,
} from "@/models/tournament.model";
import {
  assertOfficialWomensConversionInventory,
  assertVerifiedBackupEvidence,
  buildOfficialWomensEntryCasFilter,
  buildOfficialWomensTeamCasFilter,
  buildOfficialWomensTournamentCasFilter,
  buildOfficialWomensTournamentUpdate,
  deriveOfficialWomensSetupStatus,
  OFFICIAL_WOMENS_ENTRY_TARGETS,
  OFFICIAL_WOMENS_TOURNAMENT_ID,
  OFFICIAL_WOMENS_TOURNAMENT_IDENTITY,
  OfficialWomensConversionInventory,
  RawOfficialWomensEntry,
  RawOfficialWomensTeam,
  RawOfficialWomensTournament,
} from "@/utils/official-womens-conversion.util";

const timestamp = new Date("2026-08-22T20:00:00.000Z");

const sourceTournament = (): RawOfficialWomensTournament => ({
  _id: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID),
  name: OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.name,
  season: OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.season,
  startDate: new Date(OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.startDate),
  endDate: new Date(OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.endDate),
  status: TournamentStatus.UPCOMING,
  division: CompetitionDivision.MEN,
  currentStage: MatchStage.GROUP_STAGE,
  leagueRounds: 0,
  fixturesGenerated: false,
  formatVersion: 2,
  format: TournamentFormat.TWO_GROUP_KNOCKOUT,
  workflowState: CompetitionWorkflowState.SETUP,
  workflowRevision: 3,
  entryIdentityRevision: 0,
  rosterIdentityRevision: 0,
  standingsRevision: 0,
  scheduleRevision: 0,
  competitionRules: {
    ...FIXED_V2_COMPETITION_RULES,
    tieBreakers: [...FIXED_V2_COMPETITION_RULES.tieBreakers],
  },
  competitionTieResolutions: [],
  qualificationSnapshot: [],
  isDeleted: false,
  createdAt: timestamp,
  updatedAt: timestamp,
  __v: 0,
});

const sourceTeams = (): RawOfficialWomensTeam[] =>
  OFFICIAL_WOMENS_ENTRY_TARGETS.map((target) => ({
    _id: new Types.ObjectId(target.teamId),
    name: target.teamName,
    registrationStatus: "registered",
    division: CompetitionDivision.MEN,
    lifecycleRevision: 2,
    isDeleted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    __v: 0,
  }));

const sourceEntries = (): RawOfficialWomensEntry[] =>
  OFFICIAL_WOMENS_ENTRY_TARGETS.map((target) => ({
    _id: new Types.ObjectId(target.entryId),
    tournamentId: new Types.ObjectId(OFFICIAL_WOMENS_TOURNAMENT_ID),
    teamId: new Types.ObjectId(target.teamId),
    status: "active",
    source: "admin",
    teamNameSnapshot: target.teamName,
    teamLogoSnapshot: target.teamLogoSnapshot,
    createdBy: new Types.ObjectId(target.createdBy),
    isDeleted: false,
    createdAt: new Date(target.createdAt),
    updatedAt: new Date(target.updatedAt),
    __v: 0,
  }));

const sourceInventory = (): OfficialWomensConversionInventory => {
  const teams = sourceTeams();
  return {
    tournament: sourceTournament(),
    entries: sourceEntries(),
    teams: OFFICIAL_WOMENS_ENTRY_TARGETS.map((target, index) => ({
      id: target.teamId,
      expectedName: target.teamName,
      found: true,
      raw: teams[index],
      playerCount: 0,
      tournamentEntryCount: 1,
    })),
    resources: {
      entries: 3,
      matches: 0,
      standings: 0,
      rosters: 0,
      draws: 0,
      brackets: 0,
      operations: 0,
      playerStats: 0,
      womensFinals: 0,
    },
  };
};

const targetInventory = (): OfficialWomensConversionInventory => {
  const inventory = sourceInventory();
  const tournament = inventory.tournament!;
  Object.assign(tournament, {
    status: TournamentStatus.ONGOING,
    division: CompetitionDivision.WOMEN,
    currentStage: MatchStage.LEAGUE,
    leagueRounds: 3,
    formatVersion: 3,
    format: TournamentFormat.SINGLE_TABLE_FINAL,
    workflowState: CompetitionWorkflowState.ENTRIES_READY,
    workflowRevision: 4,
    competitionRules: {
      ...FIXED_WOMENS_COMPETITION_RULES,
      tieBreakers: [...FIXED_WOMENS_COMPETITION_RULES.tieBreakers],
    },
    __v: 1,
  });
  inventory.teams.forEach((row) => {
    row.raw!.division = CompetitionDivision.WOMEN;
    row.raw!.lifecycleRevision = 3;
  });
  inventory.entries.forEach((entry, index) => {
    entry.groupKey = "A";
    entry.groupSlot = index + 1;
    entry.__v = 1;
  });
  return inventory;
};

describe("official women tournament conversion contract", () => {
  it("accepts only the exact audited v2 source and exact v3 idempotent target", () => {
    expect(assertOfficialWomensConversionInventory(sourceInventory())).toBe(
      false,
    );
    expect(assertOfficialWomensConversionInventory(targetInventory())).toBe(
      true,
    );
  });

  it("builds the fixed v3 update without mutating editable tournament metadata", () => {
    const tournament = sourceTournament();
    const migratedAt = new Date("2026-08-23T12:00:00.000Z");
    const update = buildOfficialWomensTournamentUpdate(tournament, migratedAt);
    expect(update.$set).toMatchObject({
      status: TournamentStatus.ONGOING,
      division: CompetitionDivision.WOMEN,
      formatVersion: 3,
      format: TournamentFormat.SINGLE_TABLE_FINAL,
      workflowState: CompetitionWorkflowState.ENTRIES_READY,
      workflowRevision: 4,
      currentStage: MatchStage.LEAGUE,
      leagueRounds: 3,
      fixturesGenerated: false,
      competitionRules: {
        ...FIXED_WOMENS_COMPETITION_RULES,
        tieBreakers: [...FIXED_WOMENS_COMPETITION_RULES.tieBreakers],
      },
    });
    expect(update.$set).not.toHaveProperty("name");
    expect(update.$set).not.toHaveProperty("season");
    expect(update.$set).not.toHaveProperty("startDate");
    expect(update.$set).not.toHaveProperty("endDate");
  });

  it("allows players only on the verified v3 no-op path", () => {
    const source = sourceInventory();
    source.teams[0].playerCount = 1;
    expect(() => assertOfficialWomensConversionInventory(source)).toThrow(
      /team preconditions failed/i,
    );

    const target = targetInventory();
    target.teams[0].playerCount = 10;
    expect(assertOfficialWomensConversionInventory(target)).toBe(true);
  });

  it("rejects any unexpected entry, resource, workflow revision, or table order", () => {
    const extraResource = sourceInventory();
    extraResource.resources.matches = 1;
    expect(() =>
      assertOfficialWomensConversionInventory(extraResource),
    ).toThrow(/no published competition resources/i);

    const wrongRevision = sourceInventory();
    wrongRevision.tournament!.workflowRevision = 2;
    expect(() =>
      assertOfficialWomensConversionInventory(wrongRevision),
    ).toThrow(/workflow revision 3/i);

    const wrongSourceStatus = sourceInventory();
    wrongSourceStatus.tournament!.status = TournamentStatus.ONGOING;
    expect(() =>
      assertOfficialWomensConversionInventory(wrongSourceStatus),
    ).toThrow(/workflow revision 3/i);

    const completedTarget = targetInventory();
    completedTarget.tournament!.status = TournamentStatus.COMPLETED;
    expect(() =>
      assertOfficialWomensConversionInventory(completedTarget),
    ).toThrow(/idempotent target state/i);

    const staleUpcomingTarget = targetInventory();
    staleUpcomingTarget.tournament!.status = TournamentStatus.UPCOMING;
    expect(() =>
      assertOfficialWomensConversionInventory(
        staleUpcomingTarget,
        new Date("2026-08-23T12:00:00.000Z"),
      ),
    ).toThrow(/idempotent target state/i);

    const wrongEntry = sourceInventory();
    wrongEntry.entries[0].teamLogoSnapshot = "https://example.com/replaced.jpg";
    expect(() => assertOfficialWomensConversionInventory(wrongEntry)).toThrow(
      new RegExp(OFFICIAL_WOMENS_ENTRY_TARGETS[0].entryId),
    );

    const wrongOrder = sourceInventory();
    wrongOrder.entries[1].createdAt = new Date(
      OFFICIAL_WOMENS_ENTRY_TARGETS[0].createdAt,
    );
    expect(() => assertOfficialWomensConversionInventory(wrongOrder)).toThrow(
      /entry preconditions failed|creation order/i,
    );

    const wrongSlot = targetInventory();
    wrongSlot.entries[0].groupSlot = 2;
    expect(() => assertOfficialWomensConversionInventory(wrongSlot)).toThrow(
      /entry preconditions failed/i,
    );
  });

  it("hard-pins the tournament identity and dates while preserving them", () => {
    for (const mutate of [
      (raw: RawOfficialWomensTournament) => {
        raw.name = `${raw.name} changed`;
      },
      (raw: RawOfficialWomensTournament) => {
        raw.season = "2027";
      },
      (raw: RawOfficialWomensTournament) => {
        raw.startDate = new Date("2026-08-24T00:00:00.000Z");
      },
      (raw: RawOfficialWomensTournament) => {
        raw.endDate = new Date("2026-10-18T00:00:00.000Z");
      },
    ]) {
      const inventory = sourceInventory();
      mutate(inventory.tournament!);
      expect(() => assertOfficialWomensConversionInventory(inventory)).toThrow(
        /not a pristine setup/i,
      );
    }
  });

  it("uses exact raw CAS predicates, including absent values and entry versions", () => {
    const team = sourceTeams()[0];
    team.division = undefined;
    team.lifecycleRevision = undefined;
    expect(buildOfficialWomensTeamCasFilter(team)).toMatchObject({
      _id: team._id,
      division: { $exists: false },
      lifecycleRevision: { $exists: false },
      __v: 0,
    });

    const entry = sourceEntries()[0];
    expect(buildOfficialWomensEntryCasFilter(entry)).toMatchObject({
      _id: entry._id,
      groupKey: { $exists: false },
      groupSlot: { $exists: false },
      teamLogoSnapshot: OFFICIAL_WOMENS_ENTRY_TARGETS[0].teamLogoSnapshot,
      createdBy: entry.createdBy,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      __v: 0,
    });

    const tournament = sourceTournament();
    expect(buildOfficialWomensTournamentCasFilter(tournament)).toMatchObject({
      _id: tournament._id,
      name: OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.name,
      endDate: tournament.endDate,
      qualificationFinalizedAt: { $exists: false },
      __v: 0,
    });
  });

  it("derives setup status from the start date without falsely completing a workflow", () => {
    const start = new Date(OFFICIAL_WOMENS_TOURNAMENT_IDENTITY.startDate);
    expect(
      deriveOfficialWomensSetupStatus(start, new Date("2026-08-22T23:59:59Z")),
    ).toBe(TournamentStatus.UPCOMING);
    expect(
      deriveOfficialWomensSetupStatus(start, new Date("2026-08-23T00:00:00Z")),
    ).toBe(TournamentStatus.ONGOING);
    expect(
      deriveOfficialWomensSetupStatus(start, new Date("2027-01-01T00:00:00Z")),
    ).toBe(TournamentStatus.ONGOING);
  });

  it("accepts only a safe backup basename and an exact SHA-256", () => {
    const sha256 = "A".repeat(64);
    expect(
      assertVerifiedBackupEvidence("solidfm-2026-08-23.archive", sha256),
    ).toEqual({
      artifact: "solidfm-2026-08-23.archive",
      sha256: sha256.toLowerCase(),
    });
    expect(() =>
      assertVerifiedBackupEvidence("../backup.archive", sha256),
    ).toThrow(/safe-basename/i);
    expect(() => assertVerifiedBackupEvidence("backup.archive", "abc")).toThrow(
      /64-character/i,
    );
  });
});
