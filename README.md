# Solid FM 5-Aside Football — Backend API

The high-performance API engine powering the **Solid FM 5-Aside Football League**. Built with a focus on real-time tournament logistics, automated league standings, and secure administrative control.

This documentation is designed to help developers understand, deploy, and extend the SolidFM backend ecosystem.

---

## 🚀 Technology Stack

- **Runtime**: [Node.js](https://nodejs.org/) (20.19 or newer)
- **Framework**: [Express.js](https://expressjs.com/)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict Type Checking)
- **Database**: [MongoDB](https://www.mongodb.com/) via [Mongoose](https://mongoosejs.com/)
- **Real-time**: [Socket.io](https://socket.io/) (Live match updates)
- **Mailing**: [Nodemailer](https://nodemailer.com/) (SMTP)
- **Storage**: [Cloudinary](https://cloudinary.com/) (Assets & Publicity)
- **Validation**: [Zod](https://zod.dev/)

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory. Below is the required schema:

```bash
# Server Config
PORT=5000
NODE_ENV=development # production

# Database
MONGODB_URI=mongodb+srv://...

# Security (JWT)
JWT_SECRET=your_32_char_access_secret
JWT_REFRESH_SECRET=your_32_char_refresh_secret
JWT_EXPIRE=15m
JWT_REFRESH_EXPIRE=7d

# Required only to create the first admin in an empty database. Use a random
# secret of at least 32 characters and store it in the deployment secret manager.
ADMIN_BOOTSTRAP_SECRET=replace_with_a_random_32_plus_character_secret

# Third Party Services
CLOUDINARY_URL=cloudinary://...
SMTP_HOST=mail.privateemail.com
SMTP_PORT=465
SMTP_USER=admin@yourdomain.com
SMTP_PASS=your_email_password
SMTP_FROM_NAME='SolidFM Football'
SMTP_FROM_EMAIL=noreply@yourdomain.com

# One or more exact browser origins, separated by commas. Paths, credentials,
# query strings, fragments, and non-http(s) URLs are rejected at startup.
CLIENT_URL=http://localhost:3000,https://staging.example.com

# Exact browser origin used in emailed links. It follows the same strict origin
# rules as CLIENT_URL. If omitted, the first CLIENT_URL origin is used.
FRONTEND_URL=http://localhost:3000

# Use `none` for a frontend and API on different sites (production cookies are Secure).
# Use `lax` or `strict` when the deployment is same-site.
COOKIE_SAME_SITE=lax
```

---

## 🔒 Authentication Flow

The API stores short-lived access and longer-lived refresh JWTs in secure,
HttpOnly cookies. Browser API calls must use credentials (`credentials: include`
or Axios `withCredentials: true`). Protected endpoints also retain Bearer-token
support for trusted non-browser clients.

1. **Sign in**: Send credentials to `POST /api/v1/auth/login`; the response sets both cookies.
2. **Refresh**: `POST /api/v1/auth/refresh-token` validates the refresh cookie and replaces both cookies.
3. **Validate UI state**: `GET /api/v1/auth/me` is the source of truth for the current admin.
4. **Sign out**: `POST /api/v1/auth/logout` increments the account session version and clears both cookies.

### Initial administrator bootstrap

Public registration never accepts a requested role. If the database already has
an admin record, every new registration is created as an unverified viewer and
must be approved by a super admin.

Only an empty database can create the initial verified super admin. Send the
configured secret either in the preferred header or in the request body:

```bash
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Admin-Bootstrap-Secret: $ADMIN_BOOTSTRAP_SECRET" \
  -d '{"name":"Initial Admin","email":"admin@example.com","password":"replace-this-password"}'
```

The database enforces one unique bootstrap claim, so concurrent requests cannot
both become super admins. If `ADMIN_BOOTSTRAP_SECRET` is absent, an empty
database fails closed and cannot bootstrap through the public endpoint.

Refresh cookies are replaced on refresh, and logout/password reset revoke the
account session through `sessionVersion`. A remaining optional hardening step is
to persist hashed per-session refresh-token `jti` families, rotate them on every
refresh, and detect reuse of an older family member. That would add replay
detection beyond the current stateless session-version revocation.

## Guarded database cleanup

Database cleanup is inventory-only by default. Never run it until the exact
database and named manifest have been reviewed and a restorable backup has been
verified:

```bash
npm run db:cleanup:inventory
```

Execution additionally requires `DB_CLEANUP_ALLOW_EXECUTE=true`, an exact
database-name confirmation, a non-empty verified backup reference, and exactly
one dependency-closed manifest:

- `season-reset` removes tournaments and their competition, match, standings,
  roster-snapshot, player-stat, and payment records while preserving teams,
  players, admins, settings, and venues.
- `full-competition-reset` removes the same records plus teams and players while
  still preserving admins, settings, and venues.
- `admin-only-reset` removes all known application data, including teams,
  players, tournaments, fixtures/results, standings, draws/brackets, payments,
  venues, and settings. It preserves only documents in the `admins` collection
  and refuses to run unless at least one verified active admin login with stored
  credentials exists. The command also verifies that every registered non-admin
  Mongoose model is covered by the manifest. If the inventory contains data in
  an undeclared collection, it stops for explicit review instead of silently
  leaving or deleting unknown data.

For example, after the backup and database name have been independently
verified:

```bash
npm run db:cleanup -- --manifest=admin-only-reset --confirm-db=<exact-db-name> --backup-reference=<snapshot-id>
```

All selected collections are deleted in one MongoDB transaction and verified
empty afterward. An admin-only reset additionally verifies that no non-admin
documents remain in any collection. The command therefore requires Atlas or
another replica-set deployment with transaction support; it fails without
partially applying a manifest when transactions are unavailable. Cloudinary
assets are deliberately left untouched. Production also requires the temporary
`DB_CLEANUP_ALLOW_PRODUCTION=true` maintenance-window override. The legacy wipe
and obsolete 28-team seed scripts are intentionally disabled.

After an approved admin-only reset, inspect the index plan while every
non-admin collection is still empty:

```bash
npm run db:indexes:inventory
```

The one-time synchronization command requires `DB_INDEX_ALLOW_EXECUTE=true`,
the exact connected database name, and the verified backup reference:

```bash
npm run db:indexes:sync -- --confirm-db=<exact-db-name> --backup-reference=<archive-path>
```

It refuses to run when any non-admin document exists, never registers or
synchronizes the protected `Admin` model, and verifies that every admin ID is
unchanged afterward. Production also requires the temporary
`DB_INDEX_ALLOW_PRODUCTION=true` maintenance-window override.

## Guarded official 2026 fixture migration

The one-time 2026 fixture migration is read-only by default and always targets
one explicitly supplied tournament ID:

```bash
npm run db:official-2026:plan -- --tournament-id=<exact-tournament-object-id>
```

The plan pins the source DOCX and the separately supplied opener artwork by
SHA-256, verifies the exact 14 registered team identities, maps Pot 1 to Group
A and Pot 2 to Group B, and maps the three existing venue records to `Eclipse
Arena`, `Wembley Hotel`, and `Tribu Arena`. It accepts only the documented
exact aliases; it does not fuzzy-match names. The official manifest contains
42 unique, confirmed group matches. Fixture 1 is Samba Boys–NYSC at 3:00 PM
`Africa/Lagos` on 23 August 2026 at `Tribu Arena`; its time is supported by the
pinned artwork, while its date and venue are recorded from the competition
owner's explicit confirmation. Fixtures 2–42 retain the DOCX table schedule.

Execution is refused unless all 42 legacy generated fixtures and all 14 legacy
standings remain untouched. Any live/completed match, score, event, winner,
result lock, deleted fixture, draw, bracket, player statistic, competition
operation, existing v2 entry, or roster snapshot stops the migration. It also
requires a maximum of ten active players per team and refuses ambiguous or
unexpected team/venue/count inventories.

After independently verifying the plan and a restorable backup, execution
requires the temporary environment gate plus the exact connected database,
tournament ID, current tournament name, backup reference, and confirmation
phrase:

```bash
OFFICIAL_2026_MIGRATION_ALLOW_EXECUTE=true npm run db:official-2026:migrate -- \
  --tournament-id=<exact-tournament-object-id> \
  --confirm-tournament-id=<same-exact-tournament-object-id> \
  --confirm-tournament-name="<exact-current-tournament-name>" \
  --confirm-db=<exact-connected-database-name> \
  --backup-reference=<verified-restorable-backup-id> \
  --backup-sha256=<independently-computed-backup-artifact-sha256> \
  --confirm=APPLY-OFFICIAL-2026-PHYSICAL-FIXTURES
```

Production additionally requires the temporary
`OFFICIAL_2026_MIGRATION_ALLOW_PRODUCTION=true` maintenance-window gate. The
replacement, v2 conversion, entry/group creation, roster snapshot, zero
standings, venue renames, official fixture insert, and immutable audit marker
are committed in one MongoDB transaction. The audit marker stores only the
backup reference's safe basename (when available) and SHA-256 checksum, never
the supplied absolute path. The checksum must be computed independently from
the backup artifact; it is not derived from the reference/path text. After
commit, every one of the 42 stored pairings,
groups, dates, venues, schedule states, and provenance fields is compared with
the pinned manifest before success is reported. The command never prints the
MongoDB URI or application secrets.

## Guarded official 2026 master-sheet reschedule

After the original physical publication, remaining men's group fixtures can be
rewritten from the verified master sheet without touching the completed opener
or the women's tournament:

```bash
npm run db:official-2026:reschedule:plan -- --tournament-id=6a88bfa4ce2cf64818770691
```

The plan keeps official fixture numbers on the original pairings, moves the
remaining 41 kickoffs onto `Tribu Arena` and `Wembley Hotel` only, preserves
Samba Boys 8-1 NYSC, and refuses if any remaining men's fixture is live,
completed, scored, or event-bearing. Eclipse Arena remains a venue identity
but is unused on remaining fixtures.

After independently verifying the plan and a restorable backup:

```bash
OFFICIAL_2026_RESCHEDULE_ALLOW_EXECUTE=true \
OFFICIAL_2026_RESCHEDULE_ALLOW_PRODUCTION=true npm run db:official-2026:reschedule -- \
  --tournament-id=6a88bfa4ce2cf64818770691 \
  --confirm-tournament-id=6a88bfa4ce2cf64818770691 \
  --confirm-tournament-name="<exact-current-tournament-name>" \
  --confirm-db=<exact-connected-database-name> \
  --backup-reference=<verified-restorable-backup-id> \
  --backup-sha256=<independently-computed-backup-artifact-sha256> \
  --confirm=APPLY-OFFICIAL-2026-MASTER-RESCHEDULE
```

The remaining men's updates, opener publication-hash refresh, schedule
revision increment, and audit marker are committed in one MongoDB transaction.
Women's matches are fingerprinted before and after and must be unchanged.

## Guarded official women-tournament conversion

`Team.division` and `Tournament.division` are explicit (`men` or `women`). A
legacy team/tournament with a missing or `null` division is interpreted as men
at read time; the application does not rewrite those rows. The women format
accepts only women teams, the men format accepts only effective-men teams, and
player transfers across divisions are rejected transactionally.

There is one dry-run-first conversion runbook. It targets only tournament
`6a8a1c47508de0e7425195a4`, whose audited immutable identity is:

- name: `COJUDESOLIDFM5-ASIDE FOOTBALL TOURNAMENT(WOMEN)`
- season: `2026`
- start: `2026-08-23T00:00:00.000Z`
- end: `2026-10-17T00:00:00.000Z`

It also pins the three existing admin-created entry/team pairs and their
audited entry creation order:

1. entry `6a8a1f82508de0e7425195a8`, team
   `6a8a1f1f508de0e7425195a7` — `RANGERS INTERNATIONAL WOMEN`
2. entry `6a8a1fa1508de0e7425195a9`, team
   `6a8a1ec9508de0e7425195a6` — `NYSC WOMEN TEAM`
3. entry `6a8a1fb1508de0e7425195aa`, team
   `6a8a1ea3508de0e7425195a5` — `ZOHAR FA`

The manifest additionally pins each entry's original Cloudinary logo snapshot,
creator admin ID, and exact creation/update timestamps. Those audit fields are
preserved byte-for-byte. The internal table slots are administrative display
positions only; they do not seed or rank the teams.

It is dry-run-only by default and must be reviewed before any execution:

```bash
npm run db:womens-tournament:plan
```

The source plan fails closed unless the tournament is exactly format v2
(`two_group_knockout`), `upcoming`, `setup` at workflow revision 3, has the
fixed men rules, has no fixtures, and contains exactly those three active admin
entries and no other entry. It requires zero players and no matches, standings,
tournament rosters, draws, brackets, operations, player stats, or women-final records. An
already exact v3 state (`single_table_final`, `entries_ready`, revision 4) is a
verified no-op; this no-op remains valid if ordinary team players were added
after conversion.

The dry run prints a read-only SHA-256 for the official men tournament using
the converter's canonical algorithm. Copy that exact value into the execution
command. Historical checksums made with a different serialization algorithm
are not interchangeable.

Before execution, create and independently verify a restorable database backup,
compute the backup artifact's SHA-256 from its bytes, and retain the artifact
outside the application deployment. Execution requires all temporary gates,
the exact connected database name, a safe artifact basename, and the exact
64-character SHA-256:

Pause admin and match-result writes before taking that backup, and keep them
paused through the fresh dry run, conversion, receipt capture, and post-commit
verification. This prevents a legitimate concurrent men result from changing
the explicitly confirmed men-state checksum after the women-only transaction.

```bash
WOMENS_TOURNAMENT_CONVERSION_ALLOW_EXECUTE=true \
WOMENS_TOURNAMENT_CONVERSION_INVENTORY_VERIFIED=true \
WOMENS_TOURNAMENT_CONVERSION_BACKUP_VERIFIED=true \
npm run db:womens-tournament:convert -- \
  --confirm-db=<exact-connected-database-name> \
  --confirm-tournament=6a8a1c47508de0e7425195a4 \
  --confirm-tournament-name="COJUDESOLIDFM5-ASIDE FOOTBALL TOURNAMENT(WOMEN)" \
  --confirm-men-sha256=<exact-sha256-from-the-fresh-dry-run> \
  --backup-artifact=<safe-backup-basename> \
  --backup-sha256=<independently-computed-64-character-sha256>
```

Production also requires the temporary
`WOMENS_TOURNAMENT_CONVERSION_ALLOW_PRODUCTION=true` gate. Before any write, the
transaction re-reads the complete manifest, confirms the CLI-pinned men-state
hash, and acquires exact raw compare-and-set fences for the tournament, all
three teams, and all three entry `__v` values. It tags only those teams as
women, assigns internal group `A` and table slots 1–3 without replacing the
entry documents or snapshots, and converts the tournament to the fixed women
v3 rules at `entries_ready` revision 4. Name, season, dates, entry creator,
logos, and timestamps are preserved. Status is `upcoming` before the start
instant and otherwise `ongoing`; competition completion remains owned by the
final workflow.

The receipt contains the true transaction pre-write snapshot, transaction
post-write snapshot, post-commit snapshot, backup basename/SHA, exact changed
IDs, and one canonical men-state checksum before and after. Capture stdout in
the approved deployment record and retain it with the independently verified
backup. The converter never prints the MongoDB URI or application secrets and
must not be run against live merely to test it.

If any precondition or post-check fails before commit, the transaction aborts.
After a successful commit, do not blindly reverse the format, divisions, or
entry slots. Stop writes, retain the receipt, and inspect all dependencies. Use
the verified full backup only in an approved maintenance window, or prepare a
separately reviewed conditional CAS rollback against the receipt's exact
post-write versions when the women workflow has acquired no new data.

## Guarded official women fixture import

Run this only after the women-tournament conversion reaches the exact v3
`entries_ready` state at workflow revision 4. The immutable manifest pins the
reviewed `Womens_Category_Final_Fixtures_Updated.docx` by byte length and
SHA-256, every raw table cell, the exact three entry/team IDs, and these WAT
kickoffs:

1. Rangers International Women–Zohar FA, 23 August 2026 at 1:00 PM,
   `Tribu Arena` (the raw `Opening Ceremony` cell is retained as provenance and
   the venue is the competition owner's explicit correction).
2. NYSC Women–Rangers International Women, 12 September 2026 at 4:00 PM,
   `Tribu Arena`.
3. NYSC Women–Zohar FA, 27 September 2026 at 4:00 PM, `Tribu Arena`.

For the two `4:00–5:00 PM` source ranges, 4:00 PM is the stored kickoff and
5:00 PM remains source provenance because the match schema stores no end time.
The document contains no rank-1 versus rank-2 final schedule, so this importer
does not create a final, draw, or `CompetitionBracket`.

The plan is read-only by default. It requires the actual source file and one
exact verified admin/super-admin publisher ID:

```bash
npm run db:womens-fixtures:plan -- \
  --source-file="<absolute-path-to-Womens_Category_Final_Fixtures_Updated.docx>" \
  --publisher-admin-id=<exact-active-admin-object-id>
```

Review and retain the printed source identity, women inventory SHA-256, plan
SHA-256, canonical men-state SHA-256, publisher, fixture rows, and per-team
active-player counts. Zero-player teams are reported prominently but do not
block fixture publication; the women-only late-enrollment and live-start guard
owns subsequent player eligibility. More than ten active players on any team
does block publication.

Pause admin, team/player, scheduling, match-result, and competition-workflow
writes, create and independently verify a restorable backup, and rerun the
fresh plan inside that maintenance window.
Execution requires every temporary gate and every exact value from that plan:

```bash
WOMENS_FIXTURE_IMPORT_ALLOW_EXECUTE=true \
WOMENS_FIXTURE_IMPORT_INVENTORY_VERIFIED=true \
WOMENS_FIXTURE_IMPORT_BACKUP_VERIFIED=true \
WOMENS_FIXTURE_IMPORT_ALLOW_PRODUCTION=true \
npm run db:womens-fixtures:import -- \
  --source-file="<absolute-path-to-Womens_Category_Final_Fixtures_Updated.docx>" \
  --publisher-admin-id=<exact-active-admin-object-id> \
  --confirm-publisher-admin-id=<same-admin-object-id> \
  --confirm-db=<exact-connected-database-name> \
  --confirm-tournament=6a8a1c47508de0e7425195a4 \
  --confirm-tournament-name="COJUDESOLIDFM5-ASIDE FOOTBALL TOURNAMENT(WOMEN)" \
  --confirm-source-sha256=<exact-pinned-source-sha256> \
  --confirm-inventory-sha256=<exact-sha256-from-fresh-plan> \
  --confirm-men-sha256=<exact-sha256-from-fresh-plan> \
  --confirm-plan-sha256=<exact-sha256-from-fresh-plan> \
  --backup-artifact=<safe-backup-basename> \
  --backup-sha256=<independently-computed-64-character-sha256> \
  --confirm=IMPORT-OFFICIAL-WOMENS-2026-FIXTURES
```

Every execution requires `WOMENS_FIXTURE_IMPORT_ALLOW_PRODUCTION=true`; this
remains mandatory when `NODE_ENV` is unset because the MongoDB URI can still
point at the live database. First publication also requires the backup gate and
backup arguments shown above. The importer rechecks all hashes inside one
majority-write MongoDB transaction, calls the same session-aware publication
core as the HTTP API, records one stable idempotency receipt, and verifies that
its own transaction leaves the canonical men snapshot unchanged.
The mandatory maintenance pause is what excludes unrelated concurrent men
writers; MongoDB snapshot reads cannot retroactively roll back the women commit
if a separate writer changes men after that snapshot. The immediate post-commit
reread detects and reports such external drift. The importer then verifies the
exact three matches, three zero-valued standings rows, exact roster-snapshot row
IDs/player IDs plus strict and immutable hashes, workflow revision, absent
draw/bracket/final/stats resources, receipt, and men checksum again after commit.
It never synchronizes indexes, prints the MongoDB URI, or stores the backup
path—only a safe artifact basename and its verified SHA-256.

A later execution with the same stable receipt is a verification-only replay;
it never republishes or rewrites records and therefore requires neither a new
backup nor the backup gate/arguments. The original backup evidence is validated
from the immutable receipt. Use any currently verified admin/super-admin as the
replay operator; the original publisher may since have been demoted or deleted,
and remains separately verified as historical provenance. Replay requires the
original three league identities, participants, fixture keys, provenance
hash/reference, publisher, and atomic publication timestamp to remain intact,
but deliberately allows and reports legitimate later roster additions and
identity refreshes, tournament/team renames, reschedules, results,
qualification/final workflow progress, and additional women operations. The
inventory confirmation may be either the fresh replay-plan value or the exact
original approved value stored in the receipt, so an already-authorized
concurrent first publication converges safely to verification. Its men checksum
is compared with that replay's fresh approved baseline, not the historical
checksum stored by the first import.

A transaction error commits no importer changes. A failure during the separate
post-commit verification can occur after a successful write (for example, when
an unrelated men write violates the maintenance pause). Do not blindly rerun
or restore after any non-zero exit: retain the console output and backup, run
the read-only plan, inspect the completed receipt and live state, then use only
a reviewed rollback or full restore during a new maintenance window if one is
actually required.

---

## 🛠️ API Reference

### 🔐 Authentication (`/api/v1/auth`)

| Method  | Endpoint                 | Access      | Description                                                               |
| :------ | :----------------------- | :---------- | :------------------------------------------------------------------------ |
| `POST`  | `/register`              | Public      | Register pending admin; empty-DB bootstrap requires the configured secret |
| `POST`  | `/login`                 | Public      | Authenticate and set HttpOnly access/refresh cookies                      |
| `POST`  | `/refresh-token`         | Public      | Refresh the cookie-backed access session                                  |
| `POST`  | `/logout`                | Public      | Revoke the current session version and clear cookies                      |
| `POST`  | `/forgot-password`       | Public      | Trigger password reset email                                              |
| `PATCH` | `/reset-password/:token` | Public      | Complete password reset                                                   |
| `GET`   | `/me`                    | Admin       | Validate the current cookie session and return the admin                  |
| `GET`   | `/`                      | Super Admin | List all registered staff/admins                                          |
| `PATCH` | `/admins/:id/role`       | Super Admin | Grant or revoke Admin/Super Admin access with last-owner safeguards       |
| `PATCH` | `/verify/:id`            | Super Admin | Verify a new admin account                                                |

### 🏆 Tournaments (`/api/v1/tournaments`)

| Method  | Endpoint         | Access | Description                                     |
| :------ | :--------------- | :----- | :---------------------------------------------- |
| `GET`   | `/`              | Public | List safe public tournament summaries           |
| `GET`   | `/archive`       | Public | View historical results                         |
| `GET`   | `/:id/bracket`   | Public | Get knockout stage bracket data                 |
| `POST`  | `/`              | Admin  | Create a new tournament season                  |
| `PATCH` | `/:id`           | Admin  | Update tournament details/status                |
| `GET`   | `/:id/readiness` | Admin  | Verification if teams/players meet requirements |

#### 14-team two-group workflow (`/:tournamentId/competition`)

| Method     | Endpoint suffix           | Access | Description                                                                                    |
| :--------- | :------------------------ | :----- | :--------------------------------------------------------------------------------------------- |
| `GET`      | `/`                       | Admin  | Read workflow state, blockers, entries, progress, and allowed actions                          |
| `PATCH`    | `/rules`                  | Admin  | Validate the immutable fixed-format rule contract; incompatible values are rejected            |
| `GET/POST` | `/entries`                | Admin  | List or enroll one of exactly 14 tournament teams                                              |
| `DELETE`   | `/entries/:entryId`       | Admin  | Remove an entry before fixture publication                                                     |
| `PUT`      | `/groups`                 | Admin  | Save the complete seven-team Group A and Group B assignment                                    |
| `POST`     | `/group-fixtures/preview` | Admin  | Validate and normalize the admin-supplied 42-row official group plan                           |
| `GET`      | `/group-fixtures/plan`    | Admin  | Read the published official plan, or `not_published` with an empty fixture list                |
| `POST`     | `/group-fixtures/publish` | Admin  | Publish the unchanged validated official plan with `Idempotency-Key`                           |
| `GET`      | `/standings`              | Public | Return independent Group A and Group B standings                                               |
| `PUT`      | `/tie-resolutions`        | Admin  | Record or correct the committee decision for a still-current tied ranking basis                |
| `POST`     | `/qualification/finalize` | Admin  | Lock qualifiers after all group results and cutoff ties resolve                                |
| `GET/POST` | `/draws`                  | Admin  | List or record all four pairings from the physical quarter-final draw                          |
| `POST`     | `/draws/:drawId/publish`  | Admin  | Publish the four recorded pairings as the durable bracket                                      |
| `POST`     | `/knockout/progress`      | Admin  | Consume completed bracket results, create unscheduled next-round slots, or record the champion |

The fixed rules are 14 teams, two manually assigned groups of seven, one group
leg (six matches/team), top four per group, one-leg quarter-finals through the
final, a manually recorded physical quarter-final draw, and no third-place
match. The backend never chooses group or knockout pairings. Ranking is points, goal
difference, goals scored, a completed direct head-to-head result for an exact
two-team tie, then an explicit audited committee decision.

The group preview and publish bodies use the same official manifest:

```json
{
  "expectedRevision": 3,
  "sourceReference": "optional physical-document reference",
  "fixtures": [
    {
      "officialNumber": 1,
      "groupKey": "A",
      "homeEntryId": "<TournamentEntry ObjectId>",
      "awayEntryId": "<TournamentEntry ObjectId>",
      "kickoffAt": "2026-08-23T14:00:00.000Z",
      "venue": "Tribu Arena"
    }
  ]
}
```

Exactly 42 rows are required: official numbers 1–42 once each, 21 unique
pairings in each group, and six appearances per team. A schedule is either
confirmed (`kickoffAt` with an explicit offset plus an active `venue`) or
pending (both fields `null`). Confirmed rows reject duplicate venue/kickoff
slots and more than one match per team on an `Africa/Lagos` calendar day.
Preview returns the normalized rows, `planHash`, `timeZone`, and
confirmed/pending counts. Publish adds that unchanged `planHash` to the body.
`GET /group-fixtures/plan` returns the same normalized fields plus
`status: "published" | "not_published"` and published match IDs.

The physical quarter-final draw body is:

```json
{
  "expectedRevision": 9,
  "sourceReference": "optional physical-draw reference",
  "pairings": [
    {
      "slot": 1,
      "homeEntryId": "<qualified TournamentEntry ObjectId>",
      "awayEntryId": "<qualified TournamentEntry ObjectId>",
      "kickoffAt": null,
      "venue": null
    }
  ]
}
```

Slots 1–4 and all eight finalized qualifiers must each be used exactly once;
the server does not impose or invent a pairing. Semi-final and final
participants follow the published bracket topology. Newly reached matches are
created as `scheduleStatus: "pending"` with `date`/`venue` unset until an admin
confirms both through `PATCH /api/v1/matches/:id/details`.

Every competition mutation uses `expectedRevision`; stale concurrent changes
return `409`. Publishing, finalization, draw, and progression operations also
require an `Idempotency-Key`. MongoDB transactions require Atlas or another
replica-set deployment.

#### 3-team women single-table workflow (`/:tournamentId/competition`)

Create this separate competition with the explicit fixed format; it does not
modify or share entries with the men tournament:

```json
{
  "name": "Solid FM Women Cup",
  "season": "2026",
  "startDate": "2026-09-01T00:00:00.000Z",
  "formatVersion": 3,
  "format": "single_table_final",
  "division": "women"
}
```

| Method     | Endpoint suffix            | Access | Description                                                                                   |
| :--------- | :------------------------- | :----- | :-------------------------------------------------------------------------------------------- |
| `GET`      | `/`                        | Admin  | Read women capabilities, readiness, entries, table progress, final state, and allowed actions |
| `GET/POST` | `/entries`                 | Admin  | List or enroll exactly three women teams; DTOs expose `tableSlot`, never group fields         |
| `DELETE`   | `/entries/:entryId`        | Admin  | Remove an entry before league publication                                                     |
| `POST`     | `/league-fixtures/preview` | Admin  | Validate the three physically decided single-leg pairings                                     |
| `GET`      | `/league-fixtures/plan`    | Admin  | Read the published physical league plan or `not_published`                                    |
| `POST`     | `/league-fixtures/publish` | Admin  | Publish the unchanged plan with `planHash` and `Idempotency-Key`                              |
| `GET`      | `/standings`               | Public | Return `{ "table": [...] }` for the single table                                              |
| `GET`      | `/ranking`                 | Admin  | Read ranked rows, current tie bases, and qualification readiness                              |
| `PUT`      | `/table/tie-resolutions`   | Admin  | Record the committee order for a current whole-table tie basis                                |
| `POST`     | `/qualification/finalize`  | Admin  | Lock all three results and snapshot ranks 1 and 2                                             |
| `POST`     | `/final/preview`           | Admin  | Validate the physically decided rank-1 versus rank-2 final schedule                           |
| `GET`      | `/final/plan`              | Admin  | Read the durable final plan and linked match                                                  |
| `POST`     | `/final/publish`           | Admin  | Publish the unchanged physical final with `planHash` and `Idempotency-Key`                    |
| `POST`     | `/knockout/progress`       | Admin  | Lock a completed final and record champion/runner-up; it creates no round                     |

The fixed women rules are three teams, one single round-robin leg, two matches
per team (three league matches total), and ranks 1 and 2 in one final. Ranking
is points, goal difference, goals scored, completed direct head-to-head for an
exact two-team tie, then an explicit committee decision. There is no group,
second leg, random fixture generator, draw, quarter-final, semi-final,
third-place match, or automatically materialized final.

The league manifest contains official numbers 1–3 exactly once and every
unordered team pair exactly once. The final is official number 4 with rank 1
as home and rank 2 as away. Both league and final rows may be published as TBC
by setting `kickoffAt` and `venue` to `null`; therefore zero configured venues
does not block an all-TBC publication. A confirmed row must supply both fields,
use an active venue, and pass global venue/kickoff and team/day collision checks
across men and women tournaments. A pending match cannot start, accept events,
or record a winner until Match Centre confirms both schedule fields.

Women workflow states are `setup`, `entries_ready`, `group_stage` (the internal
workflow state while the public match stage is `league`),
`qualification_finalized`, `knockout_stage` only after the explicit final is
published, and `completed`. Qualification locks the league results; after that,
status reopening and event additions/deletions fail closed. Final publication
uses a dedicated durable women-final record with qualification-rank sources and
does not create or alter a men `CompetitionDraw` or `CompetitionBracket`.

### ⚽ Matches (`/api/v1/matches`)

| Method   | Endpoint               | Access | Description                                                                                 |
| :------- | :--------------------- | :----- | :------------------------------------------------------------------------------------------ |
| `GET`    | `/`                    | Public | List matches by match/tournament/status/stage/group/round/leg filters                       |
| `PATCH`  | `/:id/status`          | Admin  | Apply a valid scheduled/live/completed/cancelled transition                                 |
| `PATCH`  | `/:id/details`         | Admin  | Confirm/reschedule with `{date, venue}`, or set both to `null` to mark the schedule pending |
| `PATCH`  | `/:id/winner`          | Admin  | Atomically set a valid knockout winner and complete the match                               |
| `POST`   | `/:id/events`          | Admin  | Add Goal, Yellow, or Red Card with an `Idempotency-Key`                                     |
| `DELETE` | `/:id/events/:eventId` | Admin  | Remove a specific match event                                                               |

Pending matches cannot become live/completed, accept events, or accept a
knockout winner. Rescheduling revalidates the active venue, venue/kickoff
collision, and one-match-per-team-per-`Africa/Lagos`-day rules atomically.
Once a confirmed match references a venue name, that venue cannot be renamed
or deleted; address and importance edits remain available. Venue mutations and
schedule confirmation share an optimistic venue-version fence so concurrent
changes fail closed and can be retried safely.

### 🛡️ Teams & Players (`/api/v1/teams` & `../../players`)

| Method   | Endpoint           | Access | Description                                                                   |
| :------- | :----------------- | :----- | :---------------------------------------------------------------------------- |
| `POST`   | `/teams/register`  | Public | Public team registration for new seasons                                      |
| `GET`    | `/teams/:id`       | Public | Public team profile without private contact data                              |
| `GET`    | `/teams/admin/:id` | Admin  | Private team profile for registration management                              |
| `POST`   | `/teams`           | Admin  | Create a team with an optional validated logo upload                          |
| `PATCH`  | `/teams/:id`       | Admin  | Update team info, status, and optional logo replacement/removal               |
| `DELETE` | `/teams/:id`       | Admin  | Soft-delete an unused team; active players/competition entries block deletion |
| `POST`   | `/players`         | Admin  | Register a player with an optional validated photo upload                     |
| `PATCH`  | `/players/:id`     | Admin  | Update or transfer a player and replace/remove the photo safely               |
| `DELETE` | `/players/:id`     | Admin  | Soft-delete a player and release the roster slot                              |
| `GET`    | `/players/:id`     | Public | Public player profile without passport-photo data                             |
| `GET`    | `/players/admin`   | Admin  | Filter players by team and active tournament roster snapshot                  |

### 📊 Standings & Statistics (`/api/v1/standings`)

| Method | Endpoint                     | Access | Description                               |
| :----- | :--------------------------- | :----- | :---------------------------------------- |
| `GET`  | `/`                          | Public | Global league table (aggregate)           |
| `GET`  | `/:tournamentId`             | Public | Tournament-specific standings             |
| `GET`  | `/top-scorers`               | Public | Global Golden Boot race (Goals & Assists) |
| `GET`  | `/:tournamentId/top-scorers` | Public | Tournament-specific player statistics     |

### 📡 Administrative Tools

| Method | Endpoint                      | Access | Description                                |
| :----- | :---------------------------- | :----- | :----------------------------------------- |
| `POST` | `/api/v1/broadcast`           | Admin  | Send SMTP Email Alert to all Team Captains |
| `GET`  | `/api/v1/dashboard/stats`     | Admin  | Aggregate data for the Admin Overview      |
| `PUT`  | `/api/v1/settings`            | Admin  | Toggle Registration & Update Global Banner |
| `POST` | `/api/v1/settings/upload-...` | Admin  | Direct Cloudinary upload for publicity     |

---

## 👨‍💻 Developer Guidelines

### 1. Project Architecture

The project follows a **Controller-Service-Model** pattern:

- **Routes**: Define endpoints and apply middleware.
- **Controllers**: Handle HTTP concerns (req/res) and validation.
- **Services**: Contain business logic (Standings calculation, Match scheduling).
- **Models**: Mongoose schemas enforcing data integrity.

### 2. Middleware Chain

Most admin routes follow this protection chain:
`verifyToken` (Authenticates) -> `restrictTo('admin', 'super_admin')` (Authorizes).

### 3. Error Handling

The API returns standardized JSON error responses:

```json
{
  "success": false,
  "message": "Reason for failure",
  "statusCode": 401
}
```

---

## 📄 License

Private Repository — Intended for use by the **Solid FM 5-Aside Football League**.
