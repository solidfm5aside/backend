import { createHash } from "node:crypto";

export const OFFICIAL_2026_SOURCE_TITLE =
  "COJUDE SOLID FM 5-ASIDE FOOTBALL TOURNAMENT" as const;
export const OFFICIAL_2026_SOURCE_SHA256 =
  "0d9061edc5ab1a23ae16a7627354203c3563e398f9f5c0fe41c9a980e3f9be22" as const;
export const OFFICIAL_2026_SOURCE_BYTE_LENGTH = 37_952 as const;
export const OFFICIAL_2026_TIME_ZONE = "Africa/Lagos" as const;

/**
 * Remaining group fixtures 2-42 come from the verified master sheet
 * (Tribu Arena and Wembley Hotel only). Official numbers stay on the
 * original pairing identities; only kickoff, venue, and one home/away
 * orientation change.
 */
export const OFFICIAL_2026_MASTER_RESCHEDULE = {
  sourceTitle: "THE_COJUDE_SOLID_5-ASIDE_MASTER_FIXTURES_FORMATTED_LIKE_SECOND.docx",
  remainingFixtureCount: 41,
  venues: ["Tribu Arena", "Wembley Hotel"],
  firstRemainingLocalDate: "2026-09-05",
  lastRemainingLocalDate: "2026-09-26",
  authority: "competition-owner-verified-master-2026-09-04",
  preservesOfficialNumbers: true,
  frozenOpenerOfficialNumber: 1,
} as const;

/**
 * Fixture 1 was listed without a schedule in the original DOCX. The supplied
 * match artwork independently identifies Samba Boys vs NYSC at 3:00 PM; the
 * competition owner explicitly confirmed 2026-08-23 and Tribu Arena. That
 * completed opener is frozen and is not present on the later master sheet.
 */
export const OFFICIAL_2026_OPENER_SUPPLEMENT = {
  sourceTitle: "WhatsApp Image 2026-08-22 at 7.10.30 PM.jpeg",
  sourceSha256:
    "2aa35e968a6147639da44d83c1535263d2a445a48b9264c282ddea2a8fa431db",
  sourceByteLength: 26_158,
  evidenceScope: "fixture-1-pairing-and-15:00-local-kickoff",
  confirmedLocalDate: "2026-08-23",
  confirmedLocalKickoffTime: "15:00",
  confirmedVenueName: "Tribu Arena",
  dateAndVenueAuthority: "user-confirmed-2026-08-22",
} as const;

export const OFFICIAL_2026_FIXTURE_SOURCE_REFERENCE =
  `docx-sha256:${OFFICIAL_2026_SOURCE_SHA256};opener-image-sha256:${OFFICIAL_2026_OPENER_SUPPLEMENT.sourceSha256};master-reschedule:2026-09-04` as const;

export type Official2026GroupKey = "A" | "B";
export type Official2026SourcePot = "Pot 1" | "Pot 2";
export type Official2026ScheduleStatus = "confirmed" | "pending";

export interface Official2026TeamDefinition {
  key: string;
  databaseName: string;
  acceptedDatabaseNames: readonly string[];
  groupKey: Official2026GroupKey;
  sourcePot: Official2026SourcePot;
  groupSlot: number;
}

/**
 * The DOCX does not contain a separate seeded team list. Group slots below are
 * stable first-appearance ordering only and carry no competitive seeding.
 * Pot 1 is deliberately mapped to Group A and Pot 2 to Group B.
 */
export const OFFICIAL_2026_TEAMS = [
  {
    key: "lala-brothers",
    databaseName: "LALA BROTHERS FC",
    acceptedDatabaseNames: ["LALA BROTHERS FC", "Lala Brothers"],
    groupKey: "A",
    sourcePot: "Pot 1",
    groupSlot: 1,
  },
  {
    key: "smooth-citizens",
    databaseName: "SMOOTH CITIZENS FC",
    acceptedDatabaseNames: ["SMOOTH CITIZENS FC", "Smooth Citizens"],
    groupKey: "A",
    sourcePot: "Pot 1",
    groupSlot: 2,
  },
  {
    key: "success-fc",
    databaseName: "SUCCESS FC",
    acceptedDatabaseNames: ["SUCCESS FC", "Success Fc", "Success"],
    groupKey: "A",
    sourcePot: "Pot 1",
    groupSlot: 3,
  },
  {
    key: "golden-boys-of-kibang",
    databaseName: "GOLDEN BOYS OF KIBANG",
    acceptedDatabaseNames: ["GOLDEN BOYS OF KIBANG", "Golden Boys of Kibang"],
    groupKey: "A",
    sourcePot: "Pot 1",
    groupSlot: 4,
  },
  {
    key: "samba-boys",
    databaseName: "SAMBA BOYS FC",
    acceptedDatabaseNames: ["SAMBA BOYS FC", "Samba Boys"],
    groupKey: "A",
    sourcePot: "Pot 1",
    groupSlot: 5,
  },
  {
    key: "tribu-hotel-fc",
    databaseName: "TRIBU HOTEL FC",
    acceptedDatabaseNames: ["TRIBU HOTEL FC", "Tribu Hotel Fc", "Tribu Hotel"],
    groupKey: "A",
    sourcePot: "Pot 1",
    groupSlot: 6,
  },
  {
    key: "nysc-fc",
    databaseName: "NYSC FC",
    acceptedDatabaseNames: ["NYSC FC", "NYSC Fc", "NYSC"],
    groupKey: "A",
    sourcePot: "Pot 1",
    groupSlot: 7,
  },
  {
    key: "rock-fc",
    databaseName: "ROCK FC",
    acceptedDatabaseNames: ["ROCK FC", "Rock FC"],
    groupKey: "B",
    sourcePot: "Pot 2",
    groupSlot: 1,
  },
  {
    key: "mrphil-photos",
    databaseName: "MR PHIL PHOTO FC",
    acceptedDatabaseNames: ["MR PHIL PHOTO FC", "MrPhil Photos"],
    groupKey: "B",
    sourcePot: "Pot 2",
    groupSlot: 2,
  },
  {
    key: "padre-fc",
    databaseName: "PADRE FC",
    acceptedDatabaseNames: ["PADRE FC", "Padre FC"],
    groupKey: "B",
    sourcePot: "Pot 2",
    groupSlot: 3,
  },
  {
    key: "udi-siding-youths-fc",
    databaseName: "UDI SIDING YOUTH FC",
    acceptedDatabaseNames: [
      "UDI SIDING YOUTH FC",
      "Udi Siding Youths Fc",
      "Udi Siding Youths",
    ],
    groupKey: "B",
    sourcePot: "Pot 2",
    groupSlot: 4,
  },
  {
    key: "ace-fc",
    databaseName: "ACE FC",
    acceptedDatabaseNames: ["ACE FC", "Ace FC"],
    groupKey: "B",
    sourcePot: "Pot 2",
    groupSlot: 5,
  },
  {
    key: "tawm-fc",
    databaseName: "TAWM FC",
    acceptedDatabaseNames: ["TAWM FC", "Tawm FC"],
    groupKey: "B",
    sourcePot: "Pot 2",
    groupSlot: 6,
  },
  {
    key: "big-time-fc",
    databaseName: "BIG TIME FC",
    acceptedDatabaseNames: ["BIG TIME FC", "Big Time FC"],
    groupKey: "B",
    sourcePot: "Pot 2",
    groupSlot: 7,
  },
] as const satisfies readonly Official2026TeamDefinition[];

export type Official2026TeamKey = (typeof OFFICIAL_2026_TEAMS)[number]["key"];

export const OFFICIAL_2026_VENUES = [
  {
    key: "eclipse",
    databaseName: "ECLIPSE ARENA",
    documentName: "Eclipse Arena",
    acceptedDatabaseNames: ["ECLIPSE ARENA", "Eclipse Arena"],
    localKickoffHours: [14, 15],
  },
  {
    key: "wembley",
    databaseName: "WEMBLEY ARENA",
    documentName: "Wembley Hotel",
    acceptedDatabaseNames: ["WEMBLEY ARENA", "Wembley Hotel"],
    localKickoffHours: [14, 15, 16],
  },
  {
    key: "tribu",
    databaseName: "TRIBU HOTEL ARENA",
    documentName: "Tribu Arena",
    acceptedDatabaseNames: ["TRIBU HOTEL ARENA", "Tribu Arena"],
    localKickoffHours: [14, 15, 16],
  },
] as const;

export type Official2026VenueKey = (typeof OFFICIAL_2026_VENUES)[number]["key"];
export type Official2026VenueName =
  (typeof OFFICIAL_2026_VENUES)[number]["documentName"];

export interface Official2026Fixture {
  officialNumber: number;
  groupKey: Official2026GroupKey;
  sourcePot: Official2026SourcePot;
  homeTeamKey: Official2026TeamKey;
  awayTeamKey: Official2026TeamKey;
  sourceHomeName: string;
  sourceAwayName: string;
  kickoffAt: string | null;
  venueName: Official2026VenueName | null;
  scheduleStatus: Official2026ScheduleStatus;
}

/**
 * Kickoffs are exact instants converted from local Nigeria times. Africa/Lagos
 * is UTC+01:00 throughout these 2026 dates. Fixture 1 remains the completed
 * opener. Fixtures 2-42 keep their original official numbers and pairings,
 * with kickoffs and venues taken from the verified master sheet. Official
 * fixture 41 is the only home/away orientation change (Lala Brothers vs Success).
 */
export const OFFICIAL_2026_FIXTURES = [
  {
    officialNumber: 1,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "samba-boys",
    awayTeamKey: "nysc-fc",
    sourceHomeName: "Samba Boys",
    sourceAwayName: "NYSC",
    kickoffAt: "2026-08-23T14:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 2,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "lala-brothers",
    awayTeamKey: "smooth-citizens",
    sourceHomeName: "Lala Brothers",
    sourceAwayName: "Smooth Citizens",
    kickoffAt: "2026-09-13T14:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 3,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "success-fc",
    awayTeamKey: "golden-boys-of-kibang",
    sourceHomeName: "Success",
    sourceAwayName: "Golden Boys of Kibang",
    kickoffAt: "2026-09-13T13:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 4,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "rock-fc",
    awayTeamKey: "mrphil-photos",
    sourceHomeName: "Rock FC",
    sourceAwayName: "MrPhil Photos",
    kickoffAt: "2026-09-19T15:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 5,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "padre-fc",
    awayTeamKey: "udi-siding-youths-fc",
    sourceHomeName: "Padre FC",
    sourceAwayName: "Udi Siding Youths",
    kickoffAt: "2026-09-19T14:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 6,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "mrphil-photos",
    awayTeamKey: "ace-fc",
    sourceHomeName: "MrPhil Photos",
    sourceAwayName: "Ace FC",
    kickoffAt: "2026-09-20T15:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 7,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "udi-siding-youths-fc",
    awayTeamKey: "tawm-fc",
    sourceHomeName: "Udi Siding Youths",
    sourceAwayName: "Tawm FC",
    kickoffAt: "2026-09-20T13:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 8,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "samba-boys",
    awayTeamKey: "tribu-hotel-fc",
    sourceHomeName: "Samba Boys",
    sourceAwayName: "Tribu Hotel",
    kickoffAt: "2026-09-19T14:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 9,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "lala-brothers",
    awayTeamKey: "nysc-fc",
    sourceHomeName: "Lala Brothers",
    sourceAwayName: "NYSC",
    kickoffAt: "2026-09-05T14:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 10,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "rock-fc",
    awayTeamKey: "big-time-fc",
    sourceHomeName: "Rock FC",
    sourceAwayName: "Big Time FC",
    kickoffAt: "2026-09-06T13:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 11,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "padre-fc",
    awayTeamKey: "tawm-fc",
    sourceHomeName: "Padre FC",
    sourceAwayName: "Tawm FC",
    kickoffAt: "2026-09-13T15:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 12,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "golden-boys-of-kibang",
    awayTeamKey: "lala-brothers",
    sourceHomeName: "Golden Boys of Kibang",
    sourceAwayName: "Lala Brothers",
    kickoffAt: "2026-09-19T13:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 13,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "nysc-fc",
    awayTeamKey: "smooth-citizens",
    sourceHomeName: "NYSC",
    sourceAwayName: "Smooth Citizens",
    kickoffAt: "2026-09-12T13:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 14,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "mrphil-photos",
    awayTeamKey: "udi-siding-youths-fc",
    sourceHomeName: "MrPhil Photos",
    sourceAwayName: "Udi Siding Youths",
    kickoffAt: "2026-09-05T14:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 15,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "tribu-hotel-fc",
    awayTeamKey: "success-fc",
    sourceHomeName: "Tribu Hotel",
    sourceAwayName: "Success",
    kickoffAt: "2026-09-05T13:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 16,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "big-time-fc",
    awayTeamKey: "ace-fc",
    sourceHomeName: "Big Time FC",
    sourceAwayName: "Ace FC",
    kickoffAt: "2026-09-13T15:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 17,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "samba-boys",
    awayTeamKey: "lala-brothers",
    sourceHomeName: "Samba Boys",
    sourceAwayName: "Lala Brothers",
    kickoffAt: "2026-09-12T13:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 18,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "tawm-fc",
    awayTeamKey: "mrphil-photos",
    sourceHomeName: "Tawm FC",
    sourceAwayName: "MrPhil Photos",
    kickoffAt: "2026-09-26T15:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 19,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "smooth-citizens",
    awayTeamKey: "success-fc",
    sourceHomeName: "Smooth Citizens",
    sourceAwayName: "Success",
    kickoffAt: "2026-09-19T13:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 20,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "padre-fc",
    awayTeamKey: "rock-fc",
    sourceHomeName: "Padre FC",
    sourceAwayName: "Rock FC",
    kickoffAt: "2026-09-12T15:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 21,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "nysc-fc",
    awayTeamKey: "golden-boys-of-kibang",
    sourceHomeName: "NYSC",
    sourceAwayName: "Golden Boys of Kibang",
    kickoffAt: "2026-09-20T13:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 22,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "padre-fc",
    awayTeamKey: "ace-fc",
    sourceHomeName: "Padre FC",
    sourceAwayName: "Ace FC",
    kickoffAt: "2026-09-05T15:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 23,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "tawm-fc",
    awayTeamKey: "rock-fc",
    sourceHomeName: "Tawm FC",
    sourceAwayName: "Rock FC",
    kickoffAt: "2026-09-05T15:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 24,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "tribu-hotel-fc",
    awayTeamKey: "nysc-fc",
    sourceHomeName: "Tribu Hotel",
    sourceAwayName: "NYSC",
    kickoffAt: "2026-09-13T13:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 25,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "mrphil-photos",
    awayTeamKey: "big-time-fc",
    sourceHomeName: "MrPhil Photos",
    sourceAwayName: "Big Time FC",
    kickoffAt: "2026-09-12T14:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 26,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "samba-boys",
    awayTeamKey: "smooth-citizens",
    sourceHomeName: "Samba Boys",
    sourceAwayName: "Smooth Citizens",
    kickoffAt: "2026-09-05T13:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 27,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "udi-siding-youths-fc",
    awayTeamKey: "rock-fc",
    sourceHomeName: "Udi Siding Youths",
    sourceAwayName: "Rock FC",
    kickoffAt: "2026-09-13T14:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 28,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "nysc-fc",
    awayTeamKey: "success-fc",
    sourceHomeName: "NYSC",
    sourceAwayName: "Success",
    kickoffAt: "2026-09-26T13:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 29,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "padre-fc",
    awayTeamKey: "big-time-fc",
    sourceHomeName: "Padre FC",
    sourceAwayName: "Big Time FC",
    kickoffAt: "2026-09-20T14:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 30,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "golden-boys-of-kibang",
    awayTeamKey: "tribu-hotel-fc",
    sourceHomeName: "Golden Boys of Kibang",
    sourceAwayName: "Tribu Hotel",
    kickoffAt: "2026-09-12T14:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 31,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "ace-fc",
    awayTeamKey: "tawm-fc",
    sourceHomeName: "Ace FC",
    sourceAwayName: "Tawm FC",
    kickoffAt: "2026-09-06T14:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 32,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "smooth-citizens",
    awayTeamKey: "golden-boys-of-kibang",
    sourceHomeName: "Smooth Citizens",
    sourceAwayName: "Golden Boys of Kibang",
    kickoffAt: "2026-09-26T14:00:00.000Z",
    venueName: "Tribu Arena",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 33,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "ace-fc",
    awayTeamKey: "udi-siding-youths-fc",
    sourceHomeName: "Ace FC",
    sourceAwayName: "Udi Siding Youths",
    kickoffAt: "2026-09-12T15:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 34,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "samba-boys",
    awayTeamKey: "success-fc",
    sourceHomeName: "Samba Boys",
    sourceAwayName: "Success",
    kickoffAt: "2026-09-20T14:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 35,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "tawm-fc",
    awayTeamKey: "big-time-fc",
    sourceHomeName: "Tawm FC",
    sourceAwayName: "Big Time FC",
    kickoffAt: "2026-09-19T15:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 36,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "lala-brothers",
    awayTeamKey: "tribu-hotel-fc",
    sourceHomeName: "Lala Brothers",
    sourceAwayName: "Tribu Hotel",
    kickoffAt: "2026-09-26T13:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 37,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "big-time-fc",
    awayTeamKey: "udi-siding-youths-fc",
    sourceHomeName: "Big Time FC",
    sourceAwayName: "Udi Siding Youths",
    kickoffAt: "2026-09-26T15:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 38,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "rock-fc",
    awayTeamKey: "ace-fc",
    sourceHomeName: "Rock FC",
    sourceAwayName: "Ace FC",
    kickoffAt: "2026-09-26T14:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 39,
    groupKey: "B",
    sourcePot: "Pot 2",
    homeTeamKey: "padre-fc",
    awayTeamKey: "mrphil-photos",
    sourceHomeName: "Padre FC",
    sourceAwayName: "MrPhil Photos",
    kickoffAt: "2026-09-06T15:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 40,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "samba-boys",
    awayTeamKey: "golden-boys-of-kibang",
    sourceHomeName: "Samba Boys",
    sourceAwayName: "Golden Boys of Kibang",
    kickoffAt: "2026-09-06T13:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 41,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "lala-brothers",
    awayTeamKey: "success-fc",
    sourceHomeName: "Lala Brothers",
    sourceAwayName: "Success",
    kickoffAt: "2026-09-06T14:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
  {
    officialNumber: 42,
    groupKey: "A",
    sourcePot: "Pot 1",
    homeTeamKey: "tribu-hotel-fc",
    awayTeamKey: "smooth-citizens",
    sourceHomeName: "Tribu Hotel",
    sourceAwayName: "Smooth Citizens",
    kickoffAt: "2026-09-20T15:00:00.000Z",
    venueName: "Wembley Hotel",
    scheduleStatus: "confirmed",
  },
] as const satisfies readonly Official2026Fixture[];

export const normalizeOfficial2026Name = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");

const teamDefinitionByKey = new Map<
  Official2026TeamKey,
  (typeof OFFICIAL_2026_TEAMS)[number]
>(OFFICIAL_2026_TEAMS.map((team) => [team.key, team]));

export const getOfficial2026TeamDefinition = (
  key: Official2026TeamKey,
): (typeof OFFICIAL_2026_TEAMS)[number] => {
  const definition = teamDefinitionByKey.get(key);
  if (!definition) throw new Error(`Unknown official 2026 team key: ${key}`);
  return definition;
};

export const resolveOfficial2026TeamDefinition = (
  databaseName: string,
): (typeof OFFICIAL_2026_TEAMS)[number] | null => {
  const normalized = normalizeOfficial2026Name(databaseName);
  const matches = OFFICIAL_2026_TEAMS.filter((team) =>
    team.acceptedDatabaseNames.some(
      (acceptedName) => normalizeOfficial2026Name(acceptedName) === normalized,
    ),
  );
  if (matches.length > 1) {
    throw new Error(`Ambiguous official 2026 team alias: ${databaseName}`);
  }
  return matches[0] ?? null;
};

const publicationPayload = {
  sourceTitle: OFFICIAL_2026_SOURCE_TITLE,
  sourceSha256: OFFICIAL_2026_SOURCE_SHA256,
  sourceByteLength: OFFICIAL_2026_SOURCE_BYTE_LENGTH,
  timeZone: OFFICIAL_2026_TIME_ZONE,
  openerSupplement: OFFICIAL_2026_OPENER_SUPPLEMENT,
  masterReschedule: OFFICIAL_2026_MASTER_RESCHEDULE,
  teams: OFFICIAL_2026_TEAMS,
  venues: OFFICIAL_2026_VENUES,
  fixtures: OFFICIAL_2026_FIXTURES,
};

export const OFFICIAL_2026_FIXTURE_PUBLICATION_HASH = createHash("sha256")
  .update(JSON.stringify(publicationPayload))
  .digest("hex");

export interface Official2026ManifestIntegritySummary {
  fixtureCount: number;
  confirmedFixtureCount: number;
  pendingFixtureCount: number;
  fixturesPerGroup: Record<Official2026GroupKey, number>;
  matchesPerTeam: Record<Official2026TeamKey, number>;
}

const localDateAndHour = (iso: string): { date: string; hour: number } => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OFFICIAL_2026_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
};

export const assertOfficial2026FixtureManifestIntegrity =
  (): Official2026ManifestIntegritySummary => {
    if (OFFICIAL_2026_TEAMS.length !== 14) {
      throw new Error(
        "The official 2026 manifest must contain exactly 14 teams.",
      );
    }

    const normalizedAliases = new Map<string, Official2026TeamKey>();
    for (const team of OFFICIAL_2026_TEAMS) {
      for (const alias of team.acceptedDatabaseNames) {
        const normalized = normalizeOfficial2026Name(alias);
        const owner = normalizedAliases.get(normalized);
        if (owner && owner !== team.key) {
          throw new Error(
            `Official team alias ${alias} belongs to more than one team.`,
          );
        }
        normalizedAliases.set(normalized, team.key);
      }
    }

    for (const groupKey of ["A", "B"] as const) {
      const groupTeams = OFFICIAL_2026_TEAMS.filter(
        (team) => team.groupKey === groupKey,
      );
      const expectedPot = groupKey === "A" ? "Pot 1" : "Pot 2";
      if (
        groupTeams.length !== 7 ||
        groupTeams.some((team) => team.sourcePot !== expectedPot)
      ) {
        throw new Error(
          `Group ${groupKey} must be the seven-team ${expectedPot} mapping.`,
        );
      }
      const slots = groupTeams
        .map((team) => team.groupSlot)
        .sort((a, b) => a - b);
      if (slots.join(",") !== "1,2,3,4,5,6,7") {
        throw new Error(`Group ${groupKey} slots must be exactly 1 through 7.`);
      }
    }

    if (OFFICIAL_2026_FIXTURES.length !== 42) {
      throw new Error(
        "The official 2026 manifest must contain exactly 42 fixtures.",
      );
    }

    const fixtureNumbers = OFFICIAL_2026_FIXTURES.map(
      (fixture) => fixture.officialNumber,
    );
    if (fixtureNumbers.some((number, index) => number !== index + 1)) {
      throw new Error(
        "Official fixture numbers must be contiguous from 1 through 42.",
      );
    }

    const fixturesPerGroup: Record<Official2026GroupKey, number> = {
      A: 0,
      B: 0,
    };
    const matchCountByTeam = new Map<Official2026TeamKey, number>(
      OFFICIAL_2026_TEAMS.map((team) => [team.key, 0]),
    );
    const pairsByGroup: Record<Official2026GroupKey, Set<string>> = {
      A: new Set<string>(),
      B: new Set<string>(),
    };
    const teamLocalDates = new Set<string>();
    const occupiedVenueSlots = new Set<string>();
    let confirmedFixtureCount = 0;
    let pendingFixtureCount = 0;

    for (const fixture of OFFICIAL_2026_FIXTURES as readonly Official2026Fixture[]) {
      const home = getOfficial2026TeamDefinition(fixture.homeTeamKey);
      const away = getOfficial2026TeamDefinition(fixture.awayTeamKey);
      if (home.key === away.key) throw new Error("A team cannot play itself.");
      if (
        home.groupKey !== fixture.groupKey ||
        away.groupKey !== fixture.groupKey ||
        home.sourcePot !== fixture.sourcePot ||
        away.sourcePot !== fixture.sourcePot
      ) {
        throw new Error(
          `Fixture ${fixture.officialNumber} crosses its declared group or pot.`,
        );
      }
      if (
        resolveOfficial2026TeamDefinition(fixture.sourceHomeName)?.key !==
          home.key ||
        resolveOfficial2026TeamDefinition(fixture.sourceAwayName)?.key !==
          away.key
      ) {
        throw new Error(
          `Fixture ${fixture.officialNumber} contains an unrecognized source alias.`,
        );
      }

      fixturesPerGroup[fixture.groupKey] += 1;
      matchCountByTeam.set(home.key, (matchCountByTeam.get(home.key) ?? 0) + 1);
      matchCountByTeam.set(away.key, (matchCountByTeam.get(away.key) ?? 0) + 1);
      const pairKey = [home.key, away.key].sort().join(":");
      if (pairsByGroup[fixture.groupKey].has(pairKey)) {
        throw new Error(
          `Duplicate group pair in fixture ${fixture.officialNumber}.`,
        );
      }
      pairsByGroup[fixture.groupKey].add(pairKey);

      if (fixture.scheduleStatus === "pending") {
        pendingFixtureCount += 1;
        if (fixture.kickoffAt !== null || fixture.venueName !== null) {
          throw new Error(
            "A pending official fixture cannot invent a kickoff or venue.",
          );
        }
        continue;
      }

      confirmedFixtureCount += 1;
      if (!fixture.kickoffAt || !fixture.venueName) {
        throw new Error(
          `Confirmed fixture ${fixture.officialNumber} needs a kickoff and venue.`,
        );
      }
      const kickoff = new Date(fixture.kickoffAt);
      if (
        Number.isNaN(kickoff.getTime()) ||
        kickoff.toISOString() !== fixture.kickoffAt
      ) {
        throw new Error(
          `Fixture ${fixture.officialNumber} does not use a canonical ISO instant.`,
        );
      }
      const local = localDateAndHour(fixture.kickoffAt);
      const venue = OFFICIAL_2026_VENUES.find(
        (candidate) => candidate.documentName === fixture.venueName,
      );
      if (
        !venue ||
        !(venue.localKickoffHours as readonly number[]).includes(local.hour)
      ) {
        throw new Error(
          `Fixture ${fixture.officialNumber} uses an unavailable venue slot.`,
        );
      }
      for (const teamKey of [home.key, away.key]) {
        const teamDateKey = `${teamKey}:${local.date}`;
        if (teamLocalDates.has(teamDateKey)) {
          throw new Error(
            `Team ${teamKey} is scheduled more than once on ${local.date}.`,
          );
        }
        teamLocalDates.add(teamDateKey);
      }
      const venueSlotKey = `${fixture.kickoffAt}:${fixture.venueName}`;
      if (occupiedVenueSlots.has(venueSlotKey)) {
        throw new Error(
          `Venue ${fixture.venueName} is double-booked at ${fixture.kickoffAt}.`,
        );
      }
      occupiedVenueSlots.add(venueSlotKey);
      if (
        fixture.officialNumber > 1 &&
        fixture.venueName !== "Tribu Arena" &&
        fixture.venueName !== "Wembley Hotel"
      ) {
        throw new Error(
          `Remaining official fixture ${fixture.officialNumber} must use Tribu Arena or Wembley Hotel.`,
        );
      }
    }

    if (confirmedFixtureCount !== 42 || pendingFixtureCount !== 0) {
      throw new Error(
        "The manifest must contain 42 confirmed fixtures and no pending fixtures.",
      );
    }
    const opener = OFFICIAL_2026_FIXTURES[0];
    if (
      opener.homeTeamKey !== "samba-boys" ||
      opener.awayTeamKey !== "nysc-fc" ||
      opener.scheduleStatus !== "confirmed" ||
      opener.kickoffAt !== "2026-08-23T14:00:00.000Z" ||
      opener.venueName !== "Tribu Arena"
    ) {
      throw new Error(
        "Official fixture 1 must be Samba Boys vs NYSC at Tribu Arena on 2026-08-23 at 15:00 Africa/Lagos.",
      );
    }
    if (
      fixturesPerGroup.A !== 21 ||
      fixturesPerGroup.B !== 21 ||
      pairsByGroup.A.size !== 21 ||
      pairsByGroup.B.size !== 21
    ) {
      throw new Error(
        "Each group must contain all 21 unique round-robin pairs.",
      );
    }

    const matchesPerTeam = Object.fromEntries(matchCountByTeam) as Record<
      Official2026TeamKey,
      number
    >;
    if (Object.values(matchesPerTeam).some((count) => count !== 6)) {
      throw new Error(
        "Every official 2026 team must have exactly six group fixtures.",
      );
    }

    return {
      fixtureCount: OFFICIAL_2026_FIXTURES.length,
      confirmedFixtureCount,
      pendingFixtureCount,
      fixturesPerGroup,
      matchesPerTeam,
    };
  };
