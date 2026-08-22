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

---

## 🛠️ API Reference

### 🔐 Authentication (`/api/v1/auth`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/register` | Public | Register pending admin; empty-DB bootstrap requires the configured secret |
| `POST` | `/login` | Public | Authenticate and set HttpOnly access/refresh cookies |
| `POST` | `/refresh-token` | Public | Refresh the cookie-backed access session |
| `POST` | `/logout` | Public | Revoke the current session version and clear cookies |
| `POST` | `/forgot-password` | Public | Trigger password reset email |
| `PATCH` | `/reset-password/:token` | Public | Complete password reset |
| `GET` | `/me` | Admin | Validate the current cookie session and return the admin |
| `GET` | `/` | Super Admin | List all registered staff/admins |
| `PATCH` | `/admins/:id/role` | Super Admin | Grant or revoke Admin/Super Admin access with last-owner safeguards |
| `PATCH` | `/verify/:id` | Super Admin | Verify a new admin account |

### 🏆 Tournaments (`/api/v1/tournaments`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Public | List safe public tournament summaries |
| `GET` | `/archive` | Public | View historical results |
| `GET` | `/:id/bracket` | Public | Get knockout stage bracket data |
| `POST` | `/` | Admin | Create a new tournament season |
| `PATCH` | `/:id` | Admin | Update tournament details/status |
| `GET` | `/:id/readiness` | Admin | Verification if teams/players meet requirements |

#### 14-team two-group workflow (`/:tournamentId/competition`)

| Method | Endpoint suffix | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Admin | Read workflow state, blockers, entries, progress, and allowed actions |
| `PATCH` | `/rules` | Admin | Validate the immutable fixed-format rule contract; incompatible values are rejected |
| `GET/POST` | `/entries` | Admin | List or enroll one of exactly 14 tournament teams |
| `DELETE` | `/entries/:entryId` | Admin | Remove an entry before fixture publication |
| `PUT` | `/groups` | Admin | Save the complete seven-team Group A and Group B assignment |
| `POST` | `/group-fixtures/preview` | Admin | Validate and normalize the admin-supplied 42-row official group plan |
| `GET` | `/group-fixtures/plan` | Admin | Read the published official plan, or `not_published` with an empty fixture list |
| `POST` | `/group-fixtures/publish` | Admin | Publish the unchanged validated official plan with `Idempotency-Key` |
| `GET` | `/standings` | Public | Return independent Group A and Group B standings |
| `PUT` | `/tie-resolutions` | Admin | Record or correct the committee decision for a still-current tied ranking basis |
| `POST` | `/qualification/finalize` | Admin | Lock qualifiers after all group results and cutoff ties resolve |
| `GET/POST` | `/draws` | Admin | List or record all four pairings from the physical quarter-final draw |
| `POST` | `/draws/:drawId/publish` | Admin | Publish the four recorded pairings as the durable bracket |
| `POST` | `/knockout/progress` | Admin | Consume completed bracket results, create unscheduled next-round slots, or record the champion |

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

### ⚽ Matches (`/api/v1/matches`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Public | List matches by match/tournament/status/stage/group/round/leg filters |
| `PATCH` | `/:id/status` | Admin | Apply a valid scheduled/live/completed/cancelled transition |
| `PATCH` | `/:id/details` | Admin | Confirm/reschedule with `{date, venue}`, or set both to `null` to mark the schedule pending |
| `PATCH` | `/:id/winner` | Admin | Atomically set a valid knockout winner and complete the match |
| `POST` | `/:id/events` | Admin | Add Goal, Yellow, or Red Card with an `Idempotency-Key` |
| `DELETE` | `/:id/events/:eventId` | Admin | Remove a specific match event |

Pending matches cannot become live/completed, accept events, or accept a
knockout winner. Rescheduling revalidates the active venue, venue/kickoff
collision, and one-match-per-team-per-`Africa/Lagos`-day rules atomically.
Once a confirmed match references a venue name, that venue cannot be renamed
or deleted; address and importance edits remain available. Venue mutations and
schedule confirmation share an optimistic venue-version fence so concurrent
changes fail closed and can be retried safely.

### 🛡️ Teams & Players (`/api/v1/teams` & `../../players`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/teams/register` | Public | Public team registration for new seasons |
| `GET` | `/teams/:id` | Public | Public team profile without private contact data |
| `GET` | `/teams/admin/:id` | Admin | Private team profile for registration management |
| `POST` | `/teams` | Admin | Create a team with an optional validated logo upload |
| `PATCH` | `/teams/:id` | Admin | Update team info, status, and optional logo replacement/removal |
| `DELETE` | `/teams/:id` | Admin | Soft-delete an unused team; active players/competition entries block deletion |
| `POST` | `/players` | Admin | Register a player with an optional validated photo upload |
| `PATCH` | `/players/:id` | Admin | Update or transfer a player and replace/remove the photo safely |
| `DELETE` | `/players/:id` | Admin | Soft-delete a player and release the roster slot |
| `GET` | `/players/:id` | Public | Public player profile without passport-photo data |
| `GET` | `/players/admin` | Admin | Filter players by team and active tournament roster snapshot |

### 📊 Standings & Statistics (`/api/v1/standings`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Public | Global league table (aggregate) |
| `GET` | `/:tournamentId` | Public | Tournament-specific standings |
| `GET` | `/top-scorers` | Public | Global Golden Boot race (Goals & Assists) |
| `GET` | `/:tournamentId/top-scorers` | Public | Tournament-specific player statistics |

### 📡 Administrative Tools
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/broadcast` | Admin | Send SMTP Email Alert to all Team Captains |
| `GET` | `/api/v1/dashboard/stats` | Admin | Aggregate data for the Admin Overview |
| `PUT` | `/api/v1/settings` | Admin | Toggle Registration & Update Global Banner |
| `POST` | `/api/v1/settings/upload-...`| Admin | Direct Cloudinary upload for publicity |

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
