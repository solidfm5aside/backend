# Solid FM 5-Aside Football — Backend API

The high-performance API engine powering the **Solid FM 5-Aside Football League**. Built with a focus on real-time tournament logistics, automated league standings, and secure administrative control.

This documentation is designed to help developers understand, deploy, and extend the SolidFM backend ecosystem.

---

## 🚀 Technology Stack

- **Runtime**: [Node.js](https://nodejs.org/) (v18+)
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

# Third Party Services
CLOUDINARY_URL=cloudinary://...
SMTP_HOST=mail.privateemail.com
SMTP_PORT=465
SMTP_USER=admin@yourdomain.com
SMTP_PASS=your_email_password
SMTP_FROM_NAME='SolidFM Football'
SMTP_FROM_EMAIL=noreply@yourdomain.com

# Client Link
CLIENT_URL=http://localhost:3000
```

---

## 🔒 Authentication Flow

The API uses **JWT (JSON Web Tokens)** for stateless authentication. 

1.  **Acquire Token**: Send credentials to `POST /api/v1/auth/login`.
2.  **Authorization Header**: For all protected routes, include the Access Token in the header:
    `Authorization: Bearer <your_access_token>`
3.  **Token Rotation**: Use the `refreshToken` endpoint to get a new `accessToken` without re-logging in.

---

## 🛠️ API Reference

### 🔐 Authentication (`/api/v1/auth`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/register` | Public | Register new admin (1st becomes Super Admin) |
| `POST` | `/login` | Public | Authenticate and receive tokens |
| `POST` | `/refresh-token` | Public | Rotate expired access tokens |
| `POST` | `/forgot-password` | Public | Trigger password reset email |
| `PATCH` | `/reset-password/:token` | Public | Complete password reset |
| `GET` | `/` | Admin | List all registered staff/admins |
| `PATCH` | `/verify/:id` | Super Admin | Verify a new admin account |

### 🏆 Tournaments (`/api/v1/tournaments`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Public | Get all active/upcoming tournaments |
| `GET` | `/archive` | Public | View historical results |
| `GET` | `/:id/bracket` | Public | Get knockout stage bracket data |
| `POST` | `/` | Admin | Create a new tournament season |
| `PATCH` | `/:id` | Admin | Update tournament details/status |
| `GET` | `/:id/readiness` | Admin | Verification if teams/players meet requirements |
| `POST` | `/:id/generate-fixtures` | Admin | Initialize League phase matches |
| `POST` | `/:id/generate-knockout` | Admin | Initialize Knockout phase (Round of 16/etc) |

### ⚽ Matches (`/api/v1/matches`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Public | List matches (filterable by tournament) |
| `PATCH` | `/:id/status` | Admin | Update status (Scheduled -> Ongoing -> Finished) |
| `PATCH` | `/:id/details` | Admin | Update scores, time, or stage |
| `PATCH` | `/:id/winner` | Admin | Set winner for knockout (Extra Time/Pens) |
| `POST` | `/:id/events` | Admin | Add Goal, Yellow, or Red Card |
| `DELETE` | `/:id/events/:eventId` | Admin | Remove a specific match event |

### 🛡️ Teams & Players (`/api/v1/teams` & `../../players`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/teams/register` | Public | Public team registration for new seasons |
| `GET` | `/teams/:id` | Public | Detailed team profile |
| `PATCH` | `/teams/:id` | Admin | Update team info or registration status |
| `POST` | `/players` | Admin | Register new player with Passport Upload |
| `GET` | `/players/:id` | Public | Individual player stats and profile |

### 📊 Standings & Statistics (`/api/v1/standings`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Public | Global league table (aggregate) |
| `GET` | `/:tournamentId` | Public | Tournament-specific standings |
| `GET` | `/top-scorers` | Public | Golden Boot race (Goals & Assists) |

### 📡 Administrative Tools
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/broadcast` | Admin | Send SMTP Email Alert to all Team Captains |
| `GET` | `/api/v1/dashboard/stats` | Admin | Aggregate data for the Admin Overview |
| `PUT` | `/api/v1/settings` | Super Admin | Toggle Registration & Update Global Banner |
| `POST` | `/api/v1/settings/upload-...`| Super Admin | Direct Cloudinary upload for publicity |

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
