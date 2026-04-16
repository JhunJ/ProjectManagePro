# AGENTS.md

## Cursor Cloud specific instructions

### Overview
ProjectManagePro is a full-stack Next.js (App Router) construction project management system with PostgreSQL. All frontend and API routes live in a single `src/` directory.

### Services
| Service | How to start |
|---------|-------------|
| PostgreSQL 16 | `sudo pg_ctlcluster 16 main start` (native install on port 5432) |
| Next.js dev server | `npm run dev` (port 3000) |

### Database
- Connection string for dev: `postgresql://postgres:1234@localhost:5432/projectmanagepro`
- This is hardcoded in `next.config.ts` for `NODE_ENV=development`, so a `.env` file is optional for dev but needed for Prisma CLI commands.
- If the database is empty after starting PostgreSQL, run: `npm run db:generate && npm run db:deploy && npm run db:seed`
- Default login: `admin` / `admin123`

### Commands
- See `package.json` scripts. Key ones: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run dev`.
- `npm run lint` has pre-existing lint errors in the codebase (React hooks refs); these are not regressions.

### Gotchas
- The `predev` script runs `db:provider:audit` automatically before `npm run dev`; this is expected.
- `next.config.ts` forces `DATABASE_URL` to `postgres:1234@localhost:5432` in dev mode, so the `.env` file values are overridden at runtime for the Next.js app process.
- PostgreSQL must be started manually (`sudo pg_ctlcluster 16 main start`) before running the dev server or Prisma commands.
