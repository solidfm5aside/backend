# Solid FM 5-Aside Football — Backend

The official API engine for the **Solid FM 5-Aside Football League**. A high-performance, secure Node.js backend designed to handle real-time tournament logistics, automated league standings, and global administrative broadcasts.

---

## 🚀 Core Technical Features

*   **🏆 Automated Match Engine**: Handles both League (Points/GD) and Knockout (Extra Time/Shootout) logic with professional tie-breaking rules (Goals > Assists).
*   **🛰️ Broadcast Alert System**: Integrated **SMTP (Namecheap cPanel)** mailing service that allows admins to send urgent updates to all registered team captains instantly.
*   **🔒 Secure Admin Shield**: Robust JWT-based authentication with separate Access and Refresh tokens. Includes role-based protection (`super_admin` vs `admin`) and account verification logic.
*   **📊 Live Standings Service**: Optimized database queries for real-time calculation of points, goal difference, and player statistics (Golden Boot tracking).
*   **🖼️ Asset Management**: Integrated Cloudinary support for high-performance delivery of team logos and tournament publicity banners.

---

## 🛠️ Technology Stack

- **Runtime**: [Node.js](https://nodejs.org/) (v18+)
- **Framework**: [Express.js](https://expressjs.com/)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict Mode)
- **Database**: [MongoDB](https://www.mongodb.com/) via [Mongoose](https://mongoosejs.com/)
- **Authentication**: [JSON Web Tokens (JWT)](https://jwt.io/)
- **Mailing**: [Nodemailer](https://nodemailer.com/)
- **Storage**: [Cloudinary SDK](https://cloudinary.com/documentation/node_integration)
- **Logger**: [Winston](https://github.com/winstonjs/winston)

---

## 📂 Project Structure

```text
src/
├── controllers/    # API request handlers
├── middleware/     # Auth, Role-protection, Validation guards
├── models/         # Mongoose schemas (Admin, Team, Match, etc.)
├── routes/         # API endpoint definitions
├── services/       # Core business logic (Standings, Matches, Broadcast)
├── utils/          # Helper utilities (Mailer, JWT, Logger)
└── validators/     # Zod-based request validation
```

---

## ⚙️ Setup & Configuration

### 1. Environment Configuration
Create a `.env` file in the root directory and configure the following variables:

```bash
# Database & Auth
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_32_char_secret
JWT_REFRESH_SECRET=your_32_char_refresh_secret

# External Services
CLOUDINARY_URL=your_cloudinary_config
SMTP_HOST=mail.privateemail.com
SMTP_PORT=465
SMTP_USER=admin@yourdomain.com
SMTP_PASS=your_email_password
SMTP_FROM_NAME='SolidFM Football'
SMTP_FROM_EMAIL=noreply@yourdomain.com
```

### 2. Installation & Development
```bash
# Install dependencies
npm install

# Run development server (with auto-reload)
npm run dev

# Build for production
npm run build
```

---

## 📄 License
This project is private and intended for the Solid FM 5-Aside Football League.
