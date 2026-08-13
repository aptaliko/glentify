# Authenticated Change-Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in user can change their own password from `/account`, given their current password.

**Architecture:** One new API route (`POST /api/account/change-password`) wiring together three already-existing pieces (`verifyPassword`, `hashPassword`, `updateUserPassword`) behind the same auth pattern every other `/api/account*` route already uses. One new form section on the existing `/account` page.

**Tech Stack:** Next.js 16 App Router, Zod, the existing `scrypt`-based password hashing in `src/lib/passwordHash.ts`.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-13-password-management-design.md` — this plan implements Part B only (Part A, the forgot-password email fix, is already deployed and verified — no task here touches it).
- New password must be `≥ 8` characters — the same rule already enforced by `register`/`reset-password` (`z.string().min(8)`).
- No new password-hashing/verification primitives — reuse `hashPassword`/`verifyPassword` (`src/lib/passwordHash.ts`) and `updateUserPassword` (`src/db/queries/users.ts`) exactly as they exist today.
- No timing-safety treatment needed on this route (unlike `forgot-password`) — the caller must already be authenticated as the account being changed, so there's no username-enumeration concern to defend against.
- No automated tests for this task — no new pure logic is introduced (`hashPassword`/`verifyPassword` are pre-existing and already covered by `src/lib/passwordHash.test.ts`). Verification is `npx tsc --noEmit` and a real login → change → logout → re-login round trip.

---

## Task 1: `POST /api/account/change-password`

**Files:**
- Create: `src/app/api/account/change-password/route.ts`

**Interfaces:**
- Consumes: `getUserId(request)` (`src/lib/requestUser.ts`, throws if missing), `getUserById(id)` (`src/db/queries/users.ts`, returns `UserRow | undefined` including `passwordHash`), `verifyPassword(password, storedHash)` / `hashPassword(password)` (`src/lib/passwordHash.ts`), `updateUserPassword(id, passwordHash)` (`src/db/queries/users.ts`).
- Produces: `POST /api/account/change-password` — request body `{ currentPassword: string, newPassword: string }`, response `{ ok: true }` on success (200), `{ error: string }` on wrong current password (400) or validation failure (400), `{ error: 'Unauthorized' }` (401) if the session user no longer exists.

- [ ] **Step 1: Read the existing sibling route first**

Read `src/app/api/account/route.ts` in full — this task's new route follows its exact auth pattern (`getUserId` → `getUserById` → 401 if missing), so confirm nothing has drifted from what's assumed below before writing the new file.

- [ ] **Step 2: Write the route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserById, updateUserPassword } from '@/db/queries/users';
import { hashPassword, verifyPassword } from '@/lib/passwordHash';
import { getUserId } from '@/lib/requestUser';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
    return NextResponse.json({ error: 'Ο τρέχων κωδικός δεν είναι σωστός' }, { status: 400 });
  }

  await updateUserPassword(user.id, hashPassword(parsed.data.newPassword));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual verification against the real database**

This app's local dev and production share the same live database — verify against your own real account rather than inventing test data. Two valid ways to do this, pick whichever fits how you're executing this plan:

- **If Task 2 (the UI form) is implemented in the same sitting as this task:** skip this step's own verification and rely on Task 2 Step 4's UI-based round-trip instead — it exercises this exact route end-to-end.
- **If verifying this route in isolation, before Task 2 exists:** log in via the web UI first, copy the `glentify_auth` cookie value from browser devtools, then run `curl -b "glentify_auth=<cookie-value>" -X POST http://localhost:3000/api/account/change-password -H "Content-Type: application/json" -d '{"currentPassword":"<your real current password>","newPassword":"<a new password, 8+ chars>"}'` — expect `{"ok":true}`, then confirm you can log in with the new password and that logging in with the old one now fails.

If you change your own real password this way, remember what you changed it to (or change it back to something you'll remember) — there is no test account to throw away here, this is the real account.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/account/change-password/route.ts
git commit -m "Add POST /api/account/change-password"
```

---

## Task 2: Change-password form on `/account`

**Files:**
- Modify: `src/app/account/page.tsx`

**Interfaces:**
- Consumes: `POST /api/account/change-password` (Task 1) — request `{ currentPassword, newPassword }`, response `{ ok: true }` or `{ error: string }`.

- [ ] **Step 1: Read the current file first**

Read `src/app/account/page.tsx` in full — confirm it matches the shape this step assumes (a single `error` state used only for the delete-account flow, a `confirming` toggle for the delete confirmation).

- [ ] **Step 2: Add the change-password form**

Replace the whole file:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUrl } from '@/lib/apiClient';
import PageNav from '@/components/PageNav';

export default function AccountPage() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  async function handleDelete() {
    setError(null);
    const res = await fetch(apiUrl('/api/account'), { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === 'string' ? body.error : 'Κάτι πήγε στραβά');
      return;
    }
    router.push('/login');
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);
    if (newPassword !== confirmNewPassword) {
      setPasswordError('Οι νέοι κωδικοί δεν ταιριάζουν');
      return;
    }
    const res = await fetch(apiUrl('/api/account/change-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const body = await res.json();
      setPasswordError(typeof body.error === 'string' ? body.error : 'Κάτι πήγε στραβά');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordSuccess(true);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <PageNav backHref="/" />
      <h1 className="text-xl font-bold">Λογαριασμός</h1>

      <div className="card border border-base-300 bg-base-100">
        <div className="card-body gap-3 p-4">
          <h2 className="font-semibold">Αλλαγή κωδικού</h2>
          {passwordError && (
            <div role="alert" className="alert alert-error alert-sm">
              <span>{passwordError}</span>
            </div>
          )}
          {passwordSuccess && (
            <div role="alert" className="alert alert-success alert-sm">
              <span>Ο κωδικός άλλαξε επιτυχώς.</span>
            </div>
          )}
          <form onSubmit={handleChangePassword} className="flex flex-col gap-2">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Τρέχων κωδικός"
              className="input input-bordered"
              required
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Νέος κωδικός"
              className="input input-bordered"
              required
              minLength={8}
            />
            <input
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder="Επιβεβαίωση νέου κωδικού"
              className="input input-bordered"
              required
              minLength={8}
            />
            <button type="submit" className="btn btn-primary">Αλλαγή κωδικού</button>
          </form>
        </div>
      </div>

      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      {!confirming ? (
        <button onClick={() => setConfirming(true)} className="btn btn-error">Διαγραφή λογαριασμού</button>
      ) : (
        <div className="flex flex-col gap-2">
          <p>Θα διαγραφούν μόνιμα όλα τα τραγούδια, προγράμματα και sessions σου. Είσαι σίγουρος/η;</p>
          <div className="flex gap-2">
            <button onClick={handleDelete} className="btn btn-error">Ναι, διάγραψέ τον</button>
            <button onClick={() => setConfirming(false)} className="btn btn-ghost">Άκυρο</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

The change-password section uses its own `passwordError`/`passwordSuccess` state, separate from the pre-existing `error` state (which stays scoped to the delete-account flow only) — so a failed password change never displays inside the delete-account error slot or vice versa.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```
Log in as your real account, go to `/account`, use the new "Αλλαγή κωδικού" form with your real current password and a new one (8+ characters) — confirm the success message appears, then log out and log back in with the new password to confirm it actually took effect. Try it once with a deliberately wrong "τρέχων κωδικός" first and confirm you get "Ο τρέχων κωδικός δεν είναι σωστός" without your real password being changed.

- [ ] **Step 5: Commit**

```bash
git add src/app/account/page.tsx
git commit -m "Add change-password form to the account page"
```

---

## Task 3: Full verification

No further code changes expected.

- [ ] **Step 1: Type-check and build**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -30
```
Expected: both clean, `/api/account/change-password` listed among the built routes (dynamic, `ƒ`).

- [ ] **Step 2: Full manual round-trip**

If not already done as part of Task 2 Step 4: log in with the real account, change the password through the UI, log out, log back in with the new password, confirm the old password no longer works. Confirm `/account`'s existing "Διαγραφή λογαριασμού" flow still renders and behaves exactly as before (unaffected by this change).

No commit for this task — it's a verification checkpoint.
