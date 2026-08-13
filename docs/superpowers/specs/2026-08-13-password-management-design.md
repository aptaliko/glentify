# Password Management: Forgot-Password Email Fix + Authenticated Change-Password — Design Spec

## Problem

Two gaps in password handling:
1. The "forgot password" flow (`POST /api/forgot-password`) never actually delivered an email — `sendPasswordResetEmail` (`src/lib/email.ts`) silently no-ops when `RESEND_API_KEY` isn't set, and production had no such key configured at all.
2. There is no way for a logged-in user to change their password. `/account` only offers account deletion.

## Part A: Forgot-password email — already fixed, deployed, and verified

This part required no code change — `src/lib/email.ts` and `src/app/api/forgot-password/route.ts` were already correct, just unconfigured. Resolution, already done during this design session:

1. User created a Resend account and API key.
2. `RESEND_API_KEY` and `RESEND_FROM_EMAIL="Glentify <onboarding@resend.dev>"` added to the Vercel project (`aptaliko-7393s-projects/glentify`) for both Production and Preview environments via `vercel env add`.
3. A fresh production deployment triggered (`vercel deploy --prod`) so the new env vars take effect — confirmed the production alias (`glentify-kohl.vercel.app`) now serves the new deployment.
4. Verified end-to-end against live production: `POST /api/forgot-password` for a registered email now genuinely calls the Resend API (confirmed via `vercel logs` — no error logged, and the target inbox received the email).

**Known limitation, accepted for now:** Resend's unverified/sandbox mode only allows sending to the email address the Resend account itself was created with (`farantosee@gmail.com`, the account owner's personal email) — not to arbitrary recipients, including the Glentify account's own login email (`farantosgeo@gmail.com`) or any future collaborator's email. This was confirmed directly from a production error log (`validation_error`, HTTP 403, from Resend). Fixing this fully requires verifying an owned domain in Resend and switching `RESEND_FROM_EMAIL` to an address on that domain — no code change, just a domain purchase + DNS verification + one env var update, deferred until the user decides to get a domain. Until then, forgot-password email delivery only works for requests where the registered account's email happens to match the Resend account's own verified address.

No implementation task needed for Part A — already live.

## Part B: Change password while logged in

### Architecture

New API route `POST /api/account/change-password`, following this codebase's existing per-resource route pattern (mirrors `src/app/api/account/route.ts`'s `DELETE` handler: `getUserId(request)` → `getUserById` → 401 if missing). Body: `{ currentPassword: string, newPassword: string }`, validated with the same `z.string().min(8)` rule already used by `register`/`reset-password`. Verifies `currentPassword` against the stored hash with the existing `verifyPassword` (`src/lib/passwordHash.ts`); on match, hashes `newPassword` with the existing `hashPassword` and persists via the existing `updateUserPassword` (`src/db/queries/users.ts`) — no new password-handling primitives, this task only wires already-existing pieces together. Wrong current password returns a 400 with a clear Greek error message; nothing here needs the timing-safety treatment `forgot-password` has, since this path already requires being authenticated as the account in question (no username-enumeration concern).

### UI

A new form section on `/account` (`src/app/account/page.tsx`), placed above the existing "Διαγραφή λογαριασμού" button: three password inputs (τρέχων κωδικός / νέος κωδικός / επιβεβαίωση νέου κωδικού), a submit button, and inline success/error feedback — matching the page's existing `alert alert-error` pattern for errors. Client-side confirms "νέος κωδικός" and "επιβεβαίωση" match before submitting (server only needs to see the one `newPassword` value once client-side confirms they match, matching the existing `register`/`reset-password` pages' pattern of not re-sending a confirmation field to the API).

### Testing

`src/db/queries/users.ts`'s `updateUserPassword`/`getUserById` and `src/lib/passwordHash.ts`'s `hashPassword`/`verifyPassword` are all pre-existing and already covered by `passwordHash.test.ts` — no new pure logic is introduced by this task, so no new unit tests are needed. Verification is manual: `npx tsc --noEmit`, and a real login → change password → log out → log back in with the new password round-trip.
