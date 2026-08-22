import { Types } from 'mongoose';
import { CompetitionDivision } from '@/models/competition-division';
import {
  assertOfficialWomensTeamInventory,
  assertVerifiedBackupEvidence,
  buildOfficialWomensTeamCasFilter,
  OFFICIAL_WOMENS_TEAM_TAGS,
  OfficialWomensTeamInventoryRow,
} from '@/scripts/tag-official-womens-teams';

const inventory = (
  overrides: Partial<OfficialWomensTeamInventoryRow> = {}
): OfficialWomensTeamInventoryRow[] =>
  OFFICIAL_WOMENS_TEAM_TAGS.map((target) => ({
    ...target,
    found: true,
    actualName: target.name,
    registrationStatus: 'registered',
    isDeleted: false,
    division: '(missing => men)',
    rawDivision: undefined,
    lifecycleRevision: 4,
    playerCount: 0,
    tournamentEntryCount: 0,
    ...overrides,
  }));

describe('guarded official women team tagging preconditions', () => {
  it('requires the exact target inventory and rejects dependencies before retagging', () => {
    expect(() => assertOfficialWomensTeamInventory(inventory())).not.toThrow();
    expect(() => assertOfficialWomensTeamInventory(inventory().slice(1))).toThrow(
      /exact three-team inventory/i
    );
    expect(() =>
      assertOfficialWomensTeamInventory(inventory({ playerCount: 1 }))
    ).toThrow(/preconditions failed/i);
    expect(() =>
      assertOfficialWomensTeamInventory(inventory({ actualName: 'Wrong Team' }))
    ).toThrow(/preconditions failed/i);
    expect(() =>
      assertOfficialWomensTeamInventory(inventory({ isDeleted: undefined }))
    ).toThrow(/preconditions failed/i);
    expect(() =>
      assertOfficialWomensTeamInventory(inventory({ isDeleted: null }))
    ).toThrow(/preconditions failed/i);
  });

  it('is a safe no-op after tagging even if normal women dependencies now exist', () => {
    expect(() =>
      assertOfficialWomensTeamInventory(
        inventory({
          division: CompetitionDivision.WOMEN,
          rawDivision: CompetitionDivision.WOMEN,
          playerCount: 10,
          tournamentEntryCount: 1,
        })
      )
    ).not.toThrow();
  });

  it('builds an exact lifecycle CAS including legacy missing fields', () => {
    const id = new Types.ObjectId(OFFICIAL_WOMENS_TEAM_TAGS[0].id);
    expect(
      buildOfficialWomensTeamCasFilter({
        _id: id,
        name: OFFICIAL_WOMENS_TEAM_TAGS[0].name,
        registrationStatus: 'registered',
        isDeleted: false,
        division: undefined,
        lifecycleRevision: undefined,
      })
    ).toEqual({
      _id: id,
      name: OFFICIAL_WOMENS_TEAM_TAGS[0].name,
      registrationStatus: 'registered',
      isDeleted: false,
      division: { $exists: false },
      lifecycleRevision: { $exists: false },
    });
  });

  it('accepts only a safe backup basename and an exact SHA-256', () => {
    const sha256 = 'A'.repeat(64);
    expect(assertVerifiedBackupEvidence('solidfm-2026-08-23.archive', sha256)).toEqual({
      artifact: 'solidfm-2026-08-23.archive',
      sha256: sha256.toLowerCase(),
    });
    expect(() => assertVerifiedBackupEvidence('../backup.archive', sha256)).toThrow(
      /safe-basename/i
    );
    expect(() => assertVerifiedBackupEvidence('backup.archive', 'abc')).toThrow(
      /64-character/i
    );
  });
});
