# Glentify

Εφαρμογή για ζωντανές εμφανίσεις: αποθηκεύει τραγούδια με στίχους και όσα από τα
μεταδεδομένα τους έχουν νόημα ανά τραγούδι (περιοχή, ρυθμός, δρόμος, συνθέτης,
χρονολογία, είδος), και προτείνει το επόμενο τραγούδι με βάση όποιους από αυτούς
τους άξονες ενεργοποιήσεις τη στιγμή της παράστασης. Βλέπε `docs/superpowers/specs/`
για το πλήρες design.

## Local development

1. `npm install`
2. Create a free Postgres database at https://neon.tech
3. `cp .env.example .env.local` and fill in `DATABASE_URL` (from Neon) and `AUTH_SECRET` (any random string). `RESEND_API_KEY`/`RESEND_FROM_EMAIL` (from https://resend.com, used for password-reset emails) and `BLOB_READ_WRITE_TOKEN` (create a Blob store on your Vercel project's Storage tab, then copy the token shown there — no deploy required to do this) can be left unset for now: an unset `RESEND_API_KEY` just skips sending the reset email (logged server-side), and an unset `BLOB_READ_WRITE_TOKEN` only breaks the sheet-music photo upload feature — everything else works without them.
4. `npm run db:generate` then `npm run db:migrate`
5. First-time setup only (skip if you're an admin using someone else's already-running instance): `ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="..." npm run db:migrate-to-multiuser` to create your admin account and backfill ownership of any pre-existing data.
6. `npm run dev` and open http://localhost:3000 — register a normal account at `/register`, or log in as the admin you just created.

## Deployment (Vercel + Neon)

1. Push this repository to GitHub.
2. In the Neon dashboard, note your production database's pooled connection string (used for serverless environments like Vercel).
3. Import the GitHub repository into Vercel (https://vercel.com/new).
4. In the Vercel project's Environment Variables settings, add `DATABASE_URL` (the Neon pooled connection string), `AUTH_SECRET`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` (must be a domain verified with Resend, or emails will fail to send). Add a Blob store from the project's Storage tab — this provisions `BLOB_READ_WRITE_TOKEN` for you automatically.
5. Before (or right after) the first deploy, apply migrations to the production database from your machine:
   ```bash
   DATABASE_URL="<production connection string>" npx tsx scripts/migrate.ts
   ```
6. First deploy only: bootstrap the admin account against the production database from your machine:
   ```bash
   DATABASE_URL="<production connection string>" ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="..." npx tsx scripts/migrate-to-multiuser.ts
   ```
7. Deploy. Visit `https://<your-project>.vercel.app/login` and confirm you can log in as the admin account you just created (or register a new account at `/register`).

## Testing

- `npm test` runs the automated unit tests (the suggestion engine and auth logic).
- Everything else (admin CRUD screens, the live session flow) is verified manually — see the "manually verify" steps in `docs/superpowers/plans/2026-07-26-panigyri-setlist-app.md`.
