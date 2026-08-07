# Multi-user Personal Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Glentify from a single shared password-gated app into a multi-user app where each musician has their own account, songs, programs and sessions, while the original admin's repertoire doubles as a copy-from-me suggestion pool for everyone else.

**Architecture:** Real per-user accounts (email + scrypt password hash) replace the single `APP_PASSWORD` gate. `src/proxy.ts` verifies a signed per-user session token and injects `x-user-id` on every request; route handlers read that header and scope all Drizzle queries by `ownerId`. Shared taxonomies (region/rhythm/dromos/genre/composer) get a nullable `ownerId`: `NULL` rows are the admin-curated baseline visible to everyone, non-null rows are private per-user additions. Vercel Blob (client-upload) stores optional sheet-music photos; Resend sends password-reset emails.

**Tech Stack:** Next.js 16 (`proxy.ts`, not `middleware.ts`), Drizzle ORM + Neon Postgres, Zod, Vitest, daisyUI, Node built-in `crypto` (scrypt) for password hashing, `@vercel/blob` for image upload, `resend` for transactional email.

## Global Constraints

- No new auth dependency beyond Node's built-in `crypto` — no bcrypt/argon2/passport/next-auth.
- No OAuth/social login; open self-service registration (email + password only).
- Vercel Blob free tier ceiling: 5GB storage / 100GB data transfer per month — client-upload flow only (no server-side proxy of file bytes).
- Resend free tier: 3,000 emails/month, 100/day — used only for password-reset links.
- `APP_PASSWORD` env var is retired; `AUTH_SECRET` is reused to sign per-user session tokens (same env var, new meaning).
- All new user-facing copy is in Greek, matching the existing app.
- Every schema change goes through `npm run db:generate` then `npm run db:migrate` (drizzle-kit), never hand-written migration SQL.
- This codebase's convention: pure logic (`src/lib/*.ts`) gets Vitest unit tests; DB-touching query/route/UI code is verified manually (no existing `src/db/queries/*.test.ts` files) — follow that split, don't invent a new pattern.

---

## Task 1: `users` and `password_reset_tokens` tables

**Files:**
- Modify: `src/db/schema.ts`
- Test: manual (schema-only change, verified via Task 2's migration run)

**Interfaces:**
- Produces: `users` table (`id`, `email` unique, `passwordHash`, `role` — `'admin' | 'user'`, `createdAt`), `passwordResetTokens` table (`id`, `userId` FK, `tokenHash`, `expiresAt`, `usedAt` nullable, `createdAt`), and exported types `UserRow`, `PasswordResetTokenRow`.

- [ ] **Step 1: Add the two tables to the schema**

Add near the top of `src/db/schema.ts` (after the imports, before `regions`):

```ts
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'), // 'admin' | 'user'
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

- [ ] **Step 2: Add the corresponding exported types**

Add alongside the other `export type ...Row` lines at the bottom of `src/db/schema.ts`:

```ts
export type UserRow = typeof users.$inferSelect;
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
```

- [ ] **Step 3: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate
```

Expected: drizzle-kit prints a new migration file (e.g. `drizzle/0006_*.sql`) creating both tables; `db:migrate` applies it against your local `DATABASE_URL` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "Add users and password_reset_tokens tables"
```

---

## Task 2: Password hashing (`src/lib/passwordHash.ts`)

**Files:**
- Create: `src/lib/passwordHash.ts`
- Test: `src/lib/passwordHash.test.ts`

**Interfaces:**
- Produces: `hashPassword(password: string): string`, `verifyPassword(password: string, storedHash: string): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/passwordHash.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './passwordHash';

describe('passwordHash', () => {
  it('verifies a password against its own hash', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects the wrong password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces a different hash each time (random salt)', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(a).not.toBe(b);
    expect(verifyPassword('same password', a)).toBe(true);
    expect(verifyPassword('same password', b)).toBe(true);
  });

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- passwordHash`
Expected: FAIL with "Cannot find module './passwordHash'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/passwordHash.ts
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, derivedHex] = storedHash.split(':');
  if (!salt || !derivedHex) return false;
  const derived = scryptSync(password, salt, KEY_LENGTH);
  let stored: Buffer;
  try {
    stored = Buffer.from(derivedHex, 'hex');
  } catch {
    return false;
  }
  if (derived.length !== stored.length) return false;
  return timingSafeEqual(derived, stored);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- passwordHash`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/passwordHash.ts src/lib/passwordHash.test.ts
git commit -m "Add scrypt password hashing"
```

---

## Task 3: Reset-token generation (`src/lib/resetToken.ts`)

**Files:**
- Create: `src/lib/resetToken.ts`
- Test: `src/lib/resetToken.test.ts`

**Interfaces:**
- Produces: `generateResetToken(): { token: string; tokenHash: string }`, `hashResetToken(token: string): string`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/resetToken.test.ts
import { describe, it, expect } from 'vitest';
import { generateResetToken, hashResetToken } from './resetToken';

describe('resetToken', () => {
  it('generates a token whose hash matches hashResetToken(token)', () => {
    const { token, tokenHash } = generateResetToken();
    expect(hashResetToken(token)).toBe(tokenHash);
  });

  it('generates a different token each call', () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('produces a stable hash for the same token', () => {
    expect(hashResetToken('same-token')).toBe(hashResetToken('same-token'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- resetToken`
Expected: FAIL with "Cannot find module './resetToken'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/resetToken.ts
import { randomBytes, createHash } from 'crypto';

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashResetToken(token) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- resetToken`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/resetToken.ts src/lib/resetToken.test.ts
git commit -m "Add password-reset token generation"
```

---

## Task 4: Per-user session tokens (rewrite `src/lib/auth.ts`)

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/auth.test.ts`

**Interfaces:**
- Consumes: `process.env.AUTH_SECRET`.
- Produces: `getAuthCookieName(): string` (unchanged name/behavior), `createSessionToken(userId: number): string`, `verifySessionToken(token: string | undefined): number | null` (returns the userId or `null` if missing/invalid/expired).
- Removes: `isValidPassword`, `getAuthCookieValue`, `isAuthCookieValid` — every caller is updated in later tasks (Task 6 proxy, Task 7/8 routes).

- [ ] **Step 1: Rewrite the test file for the new API**

```ts
// src/lib/auth.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { getAuthCookieName, createSessionToken, verifySessionToken } from './auth';

describe('auth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('has a stable cookie name', () => {
    expect(getAuthCookieName()).toBe('glentify_auth');
  });

  it('verifies a token it just created, returning the same userId', () => {
    const token = createSessionToken(42);
    expect(verifySessionToken(token)).toBe(42);
  });

  it('rejects an undefined token', () => {
    expect(verifySessionToken(undefined)).toBeNull();
  });

  it('rejects a tampered token', () => {
    const token = createSessionToken(42);
    const tampered = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken(42);
    process.env.AUTH_SECRET = 'a-different-secret';
    expect(verifySessionToken(token)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = createSessionToken(42);
    const [userIdStr] = token.split('.');
    // Re-sign an already-expired payload using the same secret so only expiry fails.
    const expiredPayload = `${userIdStr}.${Math.floor(Date.now() / 1000) - 10}`;
    const expiredToken = `${expiredPayload}.${createHmac('sha256', 'test-secret').update(expiredPayload).digest('hex')}`;
    expect(verifySessionToken(expiredToken)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- auth.test`
Expected: FAIL — `createSessionToken`/`verifySessionToken` not exported yet.

- [ ] **Step 3: Rewrite the implementation**

```ts
// src/lib/auth.ts
import { createHmac, timingSafeEqual } from 'crypto';

const COOKIE_NAME = 'glentify_auth';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches the existing cookie maxAge

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET env var is not set');
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function getAuthCookieName(): string {
  return COOKIE_NAME;
}

export function createSessionToken(userId: number): string {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userIdStr, expStr, signature] = parts;
  const payload = `${userIdStr}.${expStr}`;
  const expected = sign(payload);
  const actual = Buffer.from(signature, 'hex');
  const wanted = Buffer.from(expected, 'hex');
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const userId = Number(userIdStr);
  if (!Number.isInteger(userId)) return null;
  return userId;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- auth.test`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "Replace single shared auth token with signed per-user session tokens"
```

---

## Task 5: `users` query module

**Files:**
- Create: `src/db/queries/users.ts`

**Interfaces:**
- Consumes: `users` table from `src/db/schema.ts` (Task 1).
- Produces: `createUser(data: { email: string; passwordHash: string; role?: 'admin' | 'user' }): Promise<UserRow>`, `getUserByEmail(email: string): Promise<UserRow | undefined>`, `getUserById(id: number): Promise<UserRow | undefined>`, `updateUserPassword(id: number, passwordHash: string): Promise<void>`, `countAdmins(): Promise<number>`.

- [ ] **Step 1: Write the module**

```ts
// src/db/queries/users.ts
import { db } from '../client';
import { users } from '../schema';
import { eq } from 'drizzle-orm';
import type { UserRow } from '../schema';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  role?: 'admin' | 'user';
}

export async function createUser(data: CreateUserInput): Promise<UserRow> {
  const rows = await db
    .insert(users)
    .values({ email: data.email, passwordHash: data.passwordHash, role: data.role ?? 'user' })
    .returning();
  return rows[0];
}

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.email, email));
  return rows[0];
}

export async function getUserById(id: number): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows[0];
}

export async function updateUserPassword(id: number, passwordHash: string): Promise<void> {
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

export async function countAdmins(): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  return rows.length;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/queries/users.ts
git commit -m "Add users query module"
```

---

## Task 6: Rewrite `src/proxy.ts` for per-user sessions

**Files:**
- Modify: `src/proxy.ts`

**Interfaces:**
- Consumes: `getAuthCookieName`, `verifySessionToken` from `src/lib/auth.ts` (Task 4).
- Produces: request header `x-user-id` (set on every request that passes auth), consumed by `src/lib/requestUser.ts` (Task 12) in every protected API route.

- [ ] **Step 1: Rewrite the file**

```ts
// src/proxy.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthCookieName, verifySessionToken } from '@/lib/auth';

const MOBILE_ORIGINS = new Set(['capacitor://localhost', 'http://localhost', 'https://localhost']);

// Paths reachable without a session — auth pages and the API endpoints that establish one.
const PUBLIC_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/api/login',
  '/api/register',
  '/api/forgot-password',
  '/api/reset-password',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !MOBILE_ORIGINS.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  };
}

function applyCors(response: NextResponse, cors: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
  return response;
}

function getBearerToken(request: NextRequest): string | undefined {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const cors = corsHeaders(request.headers.get('origin'));

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return applyCors(NextResponse.next(), cors);
  }

  const cookie = request.cookies.get(getAuthCookieName())?.value;
  const bearer = getBearerToken(request);
  const userId = verifySessionToken(cookie) ?? verifySessionToken(bearer);

  if (userId === null) {
    if (pathname.startsWith('/api/')) {
      return applyCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cors);
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', String(userId));
  return applyCors(NextResponse.next({ request: { headers: requestHeaders } }), cors);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 2: Commit**

```bash
git add src/proxy.ts
git commit -m "Verify per-user session tokens in proxy and forward x-user-id"
```

Note: this task intentionally leaves the app non-functional end-to-end until Task 7/8 add register/login — that's expected, verify manually only after Task 8.

---

## Task 7: Registration (`/api/register` + `/register` page)

**Files:**
- Create: `src/app/api/register/route.ts`
- Create: `src/app/register/page.tsx`

**Interfaces:**
- Consumes: `hashPassword` (Task 2), `createUser`/`getUserByEmail` (Task 5), `createSessionToken`/`getAuthCookieName` (Task 4).
- Produces: `POST /api/register` — sets the session cookie and returns `{ ok: true, token }` on success, matching the response shape `/api/login` already used (Task 8 keeps this shape).

- [ ] **Step 1: Write the route**

```ts
// src/app/api/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createUser, getUserByEmail } from '@/db/queries/users';
import { hashPassword } from '@/lib/passwordHash';
import { createSessionToken, getAuthCookieName } from '@/lib/auth';

const registerSchema = z.object({ email: z.email(), password: z.string().min(8) });

export async function POST(request: NextRequest) {
  const parsed = registerSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const existing = await getUserByEmail(parsed.data.email);
  if (existing) return NextResponse.json({ error: 'Υπάρχει ήδη λογαριασμός με αυτό το email' }, { status: 409 });

  const user = await createUser({ email: parsed.data.email, passwordHash: hashPassword(parsed.data.password) });
  const token = createSessionToken(user.id);

  const response = NextResponse.json({ ok: true, token }, { status: 201 });
  response.cookies.set(getAuthCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
```

- [ ] **Step 2: Write the page**

```tsx
// src/app/register/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { isNativePlatform } from '@/lib/platform';
import { saveAuthToken } from '@/lib/authToken';
import { apiUrl } from '@/lib/apiClient';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(apiUrl('/api/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === 'string' ? body.error : 'Κάτι πήγε στραβά');
      return;
    }
    if (isNativePlatform()) {
      const body = await res.json();
      await saveAuthToken(body.token);
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-base-200 p-4">
      <div className="card w-full max-w-sm bg-base-100 shadow-xl">
        <form onSubmit={handleSubmit} className="card-body gap-3">
          <h1 className="card-title text-2xl">Νέος λογαριασμός</h1>
          {error && (
            <div role="alert" className="alert alert-error">
              <span>{error}</span>
            </div>
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="input input-bordered input-lg w-full"
            autoFocus
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Κωδικός (τουλάχιστον 8 χαρακτήρες)"
            className="input input-bordered input-lg w-full"
            minLength={8}
            required
          />
          <button type="submit" className="btn btn-primary btn-lg">Εγγραφή</button>
          <Link href="/login" className="link text-center text-sm">Έχεις ήδη λογαριασμό; Σύνδεση</Link>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/register/route.ts src/app/register/page.tsx
git commit -m "Add self-service registration"
```

---

## Task 8: Rewrite login for email + password

**Files:**
- Modify: `src/app/api/login/route.ts`
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `verifyPassword` (Task 2), `getUserByEmail` (Task 5), `createSessionToken`/`getAuthCookieName` (Task 4).
- Unchanged: `src/app/api/logout/route.ts` — it only deletes the cookie by name, nothing to update.

- [ ] **Step 1: Rewrite the login route**

```ts
// src/app/api/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByEmail } from '@/db/queries/users';
import { verifyPassword } from '@/lib/passwordHash';
import { createSessionToken, getAuthCookieName } from '@/lib/auth';

const loginSchema = z.object({ email: z.email(), password: z.string().min(1) });

export async function POST(request: NextRequest) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Λάθος email ή κωδικός' }, { status: 401 });

  const user = await getUserByEmail(parsed.data.email);
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: 'Λάθος email ή κωδικός' }, { status: 401 });
  }

  const token = createSessionToken(user.id);
  const response = NextResponse.json({ ok: true, token });
  response.cookies.set(getAuthCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
```

- [ ] **Step 2: Rewrite the login page for email + password, with a forgot-password link**

```tsx
// src/app/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { isNativePlatform } from '@/lib/platform';
import { saveAuthToken } from '@/lib/authToken';
import { apiUrl } from '@/lib/apiClient';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(apiUrl('/api/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === 'string' ? body.error : 'Κάτι πήγε στραβά');
      return;
    }
    if (isNativePlatform()) {
      const body = await res.json();
      await saveAuthToken(body.token);
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-base-200 p-4">
      <div className="card w-full max-w-sm bg-base-100 shadow-xl">
        <form onSubmit={handleSubmit} className="card-body gap-3">
          <h1 className="card-title text-2xl">Glentify</h1>
          {error && (
            <div role="alert" className="alert alert-error">
              <span>{error}</span>
            </div>
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="input input-bordered input-lg w-full"
            autoFocus
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Κωδικός"
            className="input input-bordered input-lg w-full"
            required
          />
          <button type="submit" className="btn btn-primary btn-lg">Είσοδος</button>
          <div className="flex justify-between text-sm">
            <Link href="/register" className="link">Νέος λογαριασμός</Link>
            <Link href="/forgot-password" className="link">Ξέχασα τον κωδικό</Link>
          </div>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/login/route.ts src/app/login/page.tsx
git commit -m "Switch login to email + password"
```

---

## Task 9: Manual verification — auth foundation end to end

**Files:** none (manual checklist only)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Register a brand-new account**

Visit `http://localhost:3000/register`, submit a new email + password (8+ chars). Expected: redirected to `/`, no error.

- [ ] **Step 3: Log out and log back in**

Trigger logout (existing "Αποσύνδεση" control), then log in again at `/login` with the same credentials. Expected: success, redirected to `/`.

- [ ] **Step 4: Confirm unauthenticated access is blocked**

In a private/incognito window, visit `http://localhost:3000/` directly. Expected: redirected to `/login`. `curl -i http://localhost:3000/api/sessions` (no cookie). Expected: `401 {"error":"Unauthorized"}`.

- [ ] **Step 5: Confirm wrong password is rejected**

At `/login`, submit the right email with a wrong password. Expected: "Λάθος email ή κωδικός", no redirect.

No commit for this task — it's a verification checkpoint before Task 10 touches ownership.

---

## Task 10: Ownership columns — schema

**Files:**
- Modify: `src/db/schema.ts`

**Interfaces:**
- Produces: nullable `ownerId: integer` on `songs`, `programs`, `sessions` (tightened to NOT NULL in Task 11 after backfill), nullable `ownerId: integer` on `regions`, `rhythms`, `dromoi`, `genres`, `composers` (stays nullable forever — `NULL` = shared baseline), nullable `imageUrl: text` on `songs`.

- [ ] **Step 1: Add `ownerId` to the five taxonomy tables**

In `src/db/schema.ts`, add `ownerId: integer('owner_id').references(() => users.id)` (nullable — no `.notNull()`) to each of `regions`, `rhythms`, `dromoi`, `genres`, `composers`. Example for `regions`:

```ts
export const regions = pgTable('regions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  parentId: integer('parent_id'),
  ownerId: integer('owner_id').references(() => users.id),
});
```

Apply the identical `ownerId: integer('owner_id').references(() => users.id),` field to `rhythms`, `dromoi`, `genres`, `composers`.

- [ ] **Step 2: Add nullable `ownerId` to `songs`, `programs`, `sessions`, and `imageUrl` to `songs`**

```ts
export const songs = pgTable('songs', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  lyrics: text('lyrics'),
  imageUrl: text('image_url'),
  genreId: integer('genre_id').notNull().references(() => genres.id),
  notes: text('notes'),
  maleKey: text('male_key'),
  femaleKey: text('female_key'),
  ownerId: integer('owner_id').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const programs = pgTable('programs', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  ownerId: integer('owner_id').references(() => users.id),
});

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  label: text('label'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  currentSongId: integer('current_song_id').references(() => songs.id),
  ownerId: integer('owner_id').references(() => users.id),
});
```

(Leave `ownerId` nullable here on purpose — Task 11 backfills existing rows, then a second migration tightens it to `.notNull()`.)

- [ ] **Step 3: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate
```

Expected: a new migration adding `owner_id` (nullable) to `regions`, `rhythms`, `dromoi`, `genres`, `composers`, `songs`, `programs`, `sessions`, plus `image_url` (nullable) to `songs`. Applies cleanly since every new column is nullable.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "Add nullable ownerId/imageUrl columns for multi-user support"
```

---

## Task 11: Backfill script + tighten ownership to NOT NULL

**Files:**
- Create: `scripts/migrate-to-multiuser.ts`
- Modify: `src/db/schema.ts`

**Interfaces:**
- Consumes: `createUser` (Task 5), `hashPassword` (Task 2), `db` client.
- Produces: the first `role: 'admin'` user account; `songs.ownerId`, `programs.ownerId`, `sessions.ownerId` become `NOT NULL`.

- [ ] **Step 1: Write the backfill script**

```ts
// scripts/migrate-to-multiuser.ts
import { db } from '../src/db/client';
import { songs, programs, sessions } from '../src/db/schema';
import { isNull, eq } from 'drizzle-orm';
import { createUser, getUserByEmail } from '../src/db/queries/users';
import { hashPassword } from '../src/lib/passwordHash';

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD env vars before running this script.');
    process.exit(1);
  }

  let admin = await getUserByEmail(email);
  if (!admin) {
    admin = await createUser({ email, passwordHash: hashPassword(password), role: 'admin' });
    console.log(`Created admin user #${admin.id} (${admin.email})`);
  } else {
    console.log(`Admin user #${admin.id} (${admin.email}) already exists, reusing it`);
  }

  const [songsUpdated, programsUpdated, sessionsUpdated] = await Promise.all([
    db.update(songs).set({ ownerId: admin.id }).where(isNull(songs.ownerId)).returning({ id: songs.id }),
    db.update(programs).set({ ownerId: admin.id }).where(isNull(programs.ownerId)).returning({ id: programs.id }),
    db.update(sessions).set({ ownerId: admin.id }).where(isNull(sessions.ownerId)).returning({ id: sessions.id }),
  ]);

  console.log(`Backfilled ownerId on ${songsUpdated.length} songs, ${programsUpdated.length} programs, ${sessionsUpdated.length} sessions`);
  // Explicit no-op read to keep eq imported for future targeted backfills without an unused-import lint error.
  void eq;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script to `package.json`**

Add under `"scripts"`:

```json
"db:migrate-to-multiuser": "dotenv -e .env.local -- tsx scripts/migrate-to-multiuser.ts"
```

- [ ] **Step 3: Run it against your local database**

```bash
ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="a-strong-password" npm run db:migrate-to-multiuser
```

Expected: prints the created admin user id and the number of rows backfilled (matches your current song/program/session counts).

- [ ] **Step 4: Tighten `ownerId` to `NOT NULL` on `songs`, `programs`, `sessions`**

In `src/db/schema.ts`, change the three `ownerId` fields from Task 10 to:

```ts
  ownerId: integer('owner_id').notNull().references(() => users.id),
```

(on `songs`, `programs`, and `sessions` only — leave the five taxonomy tables' `ownerId` nullable).

- [ ] **Step 5: Generate and apply the tightening migration**

```bash
npm run db:generate
npm run db:migrate
```

Expected: a migration altering `owner_id` to `NOT NULL` on those three tables. Applies cleanly because Step 3 already backfilled every row.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-to-multiuser.ts package.json src/db/schema.ts drizzle/
git commit -m "Backfill admin ownership and enforce NOT NULL on songs/programs/sessions.ownerId"
```

**On production (Vercel + Neon):** run the same command with `DATABASE_URL` pointed at the production connection string, before applying the tightening migration, exactly like the existing `db:migrate` deployment step in `README.md`.

---

## Task 12: `getUserId` request helper

**Files:**
- Create: `src/lib/requestUser.ts`

**Interfaces:**
- Consumes: the `x-user-id` header set by `src/proxy.ts` (Task 6).
- Produces: `getUserId(request: NextRequest): number` — throws if the header is missing/invalid, which only happens if a route bypasses `proxy.ts`'s matcher (a bug, not a normal user-facing case).

- [ ] **Step 1: Write the helper**

```ts
// src/lib/requestUser.ts
import type { NextRequest } from 'next/server';

export function getUserId(request: NextRequest): number {
  const header = request.headers.get('x-user-id');
  const userId = header ? Number(header) : NaN;
  if (!Number.isInteger(userId)) {
    throw new Error('Missing x-user-id header — proxy.ts should have set this for every authenticated request');
  }
  return userId;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/requestUser.ts
git commit -m "Add getUserId request helper"
```

---

## Task 13: Scope songs by owner

**Files:**
- Modify: `src/db/queries/songs.ts`
- Modify: `src/app/api/songs/route.ts`
- Modify: `src/app/api/songs/[id]/route.ts`

**Interfaces:**
- Consumes: `getUserId` (Task 12).
- Produces: `listSongs(ownerId: number, filters?: SongFilters)`, `getSongById(ownerId: number, id: number)`, `getSongWithAxisValues(ownerId: number, id: number)`, `createSong(ownerId: number, data: SongInput)`, `updateSong(ownerId: number, id: number, data: SongInput)`, `deleteSong(ownerId: number, id: number)` — every function now takes `ownerId` first and every `where` clause includes it, so a user can never read/write another user's song by guessing an id.

- [ ] **Step 1: Update `src/db/queries/songs.ts`**

```ts
// src/db/queries/songs.ts
import { db } from '../client';
import { songs, sessionPlayedSongs, sessions, songAxisValues, regions } from '../schema';
import { eq, ilike, and, inArray, type SQL } from 'drizzle-orm';
import type { SongRow, SongAxisValueRow } from '../schema';
import { replaceSongAxisValues, getAxisValuesForSong, type AxisValueInput } from './axisValues';
import { getRegionDescendantIds } from '@/lib/suggestions';

export interface SongFilters {
  search?: string;
  genreId?: number;
  regionId?: number;
}

export async function listSongs(ownerId: number, filters: SongFilters = {}): Promise<SongRow[]> {
  const conditions: SQL[] = [eq(songs.ownerId, ownerId)];
  if (filters.search) conditions.push(ilike(songs.title, `%${filters.search}%`));
  if (filters.genreId) conditions.push(eq(songs.genreId, filters.genreId));

  const results = await db.select().from(songs).where(and(...conditions));

  if (!filters.regionId) return results;

  const allRegions = await db.select().from(regions);
  const allowedRegionIds = new Set([filters.regionId, ...getRegionDescendantIds(filters.regionId, allRegions)]);
  const songIds = results.map((s) => s.id);
  if (songIds.length === 0) return [];
  const regionAxisRows = await db
    .select()
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'region'), inArray(songAxisValues.songId, songIds)));
  const matchingSongIds = new Set(
    regionAxisRows.filter((r) => r.refId !== null && allowedRegionIds.has(r.refId)).map((r) => r.songId)
  );
  return results.filter((s) => matchingSongIds.has(s.id));
}

export async function getSongById(ownerId: number, id: number): Promise<SongRow | undefined> {
  const rows = await db.select().from(songs).where(and(eq(songs.id, id), eq(songs.ownerId, ownerId)));
  return rows[0];
}

export interface SongWithAxisValues extends SongRow {
  axisValues: SongAxisValueRow[];
}

export async function getSongWithAxisValues(ownerId: number, id: number): Promise<SongWithAxisValues | undefined> {
  const song = await getSongById(ownerId, id);
  if (!song) return undefined;
  const axisValues = await getAxisValuesForSong(id);
  return { ...song, axisValues };
}

export interface SongInput {
  title: string;
  lyrics: string | null;
  imageUrl: string | null;
  genreId: number;
  notes: string | null;
  maleKey: string | null;
  femaleKey: string | null;
  axisValues: AxisValueInput[];
}

export async function createSong(ownerId: number, data: SongInput): Promise<SongRow> {
  const rows = await db
    .insert(songs)
    .values({
      ownerId,
      title: data.title,
      lyrics: data.lyrics,
      imageUrl: data.imageUrl,
      genreId: data.genreId,
      notes: data.notes,
      maleKey: data.maleKey,
      femaleKey: data.femaleKey,
    })
    .returning();
  const song = rows[0];
  await replaceSongAxisValues(song.id, data.axisValues);
  return song;
}

export async function updateSong(ownerId: number, id: number, data: SongInput): Promise<SongRow | undefined> {
  const rows = await db
    .update(songs)
    .set({
      title: data.title,
      lyrics: data.lyrics,
      imageUrl: data.imageUrl,
      genreId: data.genreId,
      notes: data.notes,
      maleKey: data.maleKey,
      femaleKey: data.femaleKey,
      updatedAt: new Date(),
    })
    .where(and(eq(songs.id, id), eq(songs.ownerId, ownerId)))
    .returning();
  if (rows.length === 0) return undefined;
  await replaceSongAxisValues(id, data.axisValues);
  return rows[0];
}

export async function deleteSong(ownerId: number, id: number): Promise<void> {
  const song = await getSongById(ownerId, id);
  if (!song) throw new Error('Το τραγούδι δεν βρέθηκε');
  const [playedUsage] = await db.select({ id: sessionPlayedSongs.id }).from(sessionPlayedSongs).where(eq(sessionPlayedSongs.songId, id)).limit(1);
  if (playedUsage) throw new Error('Το τραγούδι έχει παιχτεί σε κάποιο session και δεν μπορεί να διαγραφεί');
  const [currentUsage] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.currentSongId, id)).limit(1);
  if (currentUsage) throw new Error('Το τραγούδι είναι το τρέχον τραγούδι ενός ενεργού session');
  await db.delete(songAxisValues).where(eq(songAxisValues.songId, id));
  await db.delete(songs).where(eq(songs.id, id));
}
```

- [ ] **Step 2: Update `src/app/api/songs/route.ts`**

```ts
// src/app/api/songs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listSongs, createSong } from '@/db/queries/songs';
import { getUserId } from '@/lib/requestUser';

const axisValueSchema = z.object({
  axisType: z.enum(['region', 'rhythm', 'dromos', 'composer', 'year']),
  refId: z.number().int().nullable(),
  yearValue: z.number().int().nullable(),
});

const createSchema = z.object({
  title: z.string().min(1),
  lyrics: z.string().nullable(),
  imageUrl: z.string().nullable(),
  genreId: z.number().int(),
  notes: z.string().nullable(),
  maleKey: z.string().nullable(),
  femaleKey: z.string().nullable(),
  axisValues: z.array(axisValueSchema),
});

export async function GET(request: NextRequest) {
  const ownerId = getUserId(request);
  const params = request.nextUrl.searchParams;
  const songs = await listSongs(ownerId, {
    search: params.get('search') ?? undefined,
    genreId: params.get('genreId') ? Number(params.get('genreId')) : undefined,
    regionId: params.get('regionId') ? Number(params.get('regionId')) : undefined,
  });
  return NextResponse.json(songs);
}

export async function POST(request: NextRequest) {
  const ownerId = getUserId(request);
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const song = await createSong(ownerId, parsed.data);
  return NextResponse.json(song, { status: 201 });
}
```

- [ ] **Step 3: Update `src/app/api/songs/[id]/route.ts`**

Read the current file first (`src/app/api/songs/[id]/route.ts`) and apply the same shape of change as Step 2: call `getUserId(request)` at the top of every handler, pass it as the first argument to `getSongWithAxisValues`/`updateSong`/`deleteSong`, and return `404` when `updateSong`/`getSongWithAxisValues` resolve to `undefined` (meaning the song doesn't exist *for this owner*) instead of leaking a different user's song.

- [ ] **Step 4: Commit**

```bash
git add src/db/queries/songs.ts src/app/api/songs/
git commit -m "Scope songs by ownerId"
```

---

## Task 14: Scope programs and sessions by owner

**Files:**
- Modify: `src/db/queries/programs.ts`
- Modify: `src/db/queries/sessions.ts`
- Modify: `src/app/api/programs/route.ts`, `src/app/api/programs/[id]/route.ts`
- Modify: `src/app/api/sessions/route.ts`, `src/app/api/sessions/[id]/route.ts`

**Interfaces:**
- Consumes: `getUserId` (Task 12).
- Produces: `listPrograms(ownerId)`, `getProgramById(ownerId, id)`, `createProgram(ownerId, title)`, `updateProgram(ownerId, id, title)`, `deleteProgram(ownerId, id)` (sequence/sequence-song helpers stay id-based — they're only ever reached through an owner-checked program/sequence first); `getActiveSession(ownerId)`, `createSession(ownerId, label, startingSongId)`, `getSessionById(ownerId, id)`.

- [ ] **Step 1: Add `ownerId` scoping to `src/db/queries/programs.ts`**

Change the top-level, owner-facing functions only (leave `listSequencesForProgram`, `getSequenceById`, `createSequence`, `updateSequence`, `deleteSequence`, `listSongsForSequence`, `addSongToSequence`, `removeSongFromSequence`, `reorderSequenceSongs` untouched — they're reached via a program/sequence id that Step 3 already owner-checks before use):

```ts
export async function listPrograms(ownerId: number): Promise<ProgramRow[]> {
  return db.select().from(programs).where(eq(programs.ownerId, ownerId));
}

export async function getProgramById(ownerId: number, id: number): Promise<ProgramRow | undefined> {
  const rows = await db.select().from(programs).where(and(eq(programs.id, id), eq(programs.ownerId, ownerId)));
  return rows[0];
}

export async function createProgram(ownerId: number, title: string): Promise<ProgramRow> {
  const rows = await db.insert(programs).values({ ownerId, title }).returning();
  return rows[0];
}

export async function updateProgram(ownerId: number, id: number, title: string): Promise<ProgramRow | undefined> {
  const rows = await db
    .update(programs)
    .set({ title })
    .where(and(eq(programs.id, id), eq(programs.ownerId, ownerId)))
    .returning();
  return rows[0];
}

export async function deleteProgram(ownerId: number, id: number): Promise<void> {
  const program = await getProgramById(ownerId, id);
  if (!program) throw new Error('Το πρόγραμμα δεν βρέθηκε');
  const sequences = await db.select({ id: programSequences.id }).from(programSequences).where(eq(programSequences.programId, id));
  for (const seq of sequences) {
    await db.delete(sequenceSongs).where(eq(sequenceSongs.sequenceId, seq.id));
  }
  await db.delete(programSequences).where(eq(programSequences.programId, id));
  await db.delete(programs).where(eq(programs.id, id));
}
```

Add `and` to the existing `drizzle-orm` import line in that file.

- [ ] **Step 2: Add `ownerId` scoping to `src/db/queries/sessions.ts`**

```ts
export async function getActiveSession(ownerId: number): Promise<SessionRow | undefined> {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(isNull(sessions.endedAt), eq(sessions.ownerId, ownerId)))
    .orderBy(desc(sessions.startedAt));
  return rows[0];
}

export async function createSession(ownerId: number, label: string | null, startingSongId: number): Promise<SessionRow> {
  const rows = await db.insert(sessions).values({ ownerId, label, currentSongId: startingSongId }).returning();
  return rows[0];
}

export async function getSessionById(ownerId: number, id: number): Promise<SessionRow | undefined> {
  const rows = await db.select().from(sessions).where(and(eq(sessions.id, id), eq(sessions.ownerId, ownerId)));
  return rows[0];
}
```

Add `and` to the existing `drizzle-orm` import line in that file. Leave `getPlayedSongIds`, `advanceToSong`, `endSequence`, `endSession` unchanged — each already loads the session via `getSessionById`, so pass `ownerId` through at the call site (Step 4) rather than duplicating the check inside every helper.

- [ ] **Step 3: Update the program routes**

Read `src/app/api/programs/route.ts` and `src/app/api/programs/[id]/route.ts`, add `const ownerId = getUserId(request);` at the top of each handler, and pass `ownerId` as the first argument to every query call from Steps 1. Return `404` where a query now resolves to `undefined` instead of throwing.

- [ ] **Step 4: Update the session routes**

Read `src/app/api/sessions/route.ts` and `src/app/api/sessions/[id]/route.ts`, add `const ownerId = getUserId(request);` at the top of each handler, pass `ownerId` into `getActiveSession`/`createSession`/`getSessionById`. For `advanceToSong`/`endSequence`/`endSession` (which take only a `sessionId`), first call `getSessionById(ownerId, sessionId)` and return `404` if it's `undefined`, confirming the session belongs to the caller before mutating it.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries/programs.ts src/db/queries/sessions.ts src/app/api/programs/ src/app/api/sessions/
git commit -m "Scope programs and sessions by ownerId"
```

---

## Task 15: Shared baseline vs. personal taxonomies (all 5 tables)

**Files:**
- Modify: `src/db/queries/regions.ts`, `src/db/queries/rhythms.ts`, `src/db/queries/dromoi.ts`, `src/db/queries/genres.ts`, `src/db/queries/composers.ts`
- Modify: `src/app/api/regions/route.ts`, `src/app/api/regions/[id]/route.ts` (and the equivalent `rhythms`, `dromoi`, `genres`, `composers` routes)

**Interfaces:**
- Consumes: `getUserId` (Task 12), `getUserById` (Task 5).
- Produces: `list*(userId)` returns baseline (`ownerId IS NULL`) ∪ personal (`ownerId = userId`) rows; `get*ById(id)`; `create*` now takes `ownerId: number | null`; a caller with `role: 'admin'` creates `ownerId: null` (baseline), everyone else creates `ownerId: <their id>` (personal) — decided in the route layer, not the query layer.

- [ ] **Step 1: Update `src/db/queries/regions.ts`**

```ts
// src/db/queries/regions.ts
import { db } from '../client';
import { regions, songAxisValues, songs } from '../schema';
import { eq, and, or, isNull, inArray } from 'drizzle-orm';
import type { RegionRow } from '../schema';

export async function listRegions(userId: number): Promise<RegionRow[]> {
  return db.select().from(regions).where(or(isNull(regions.ownerId), eq(regions.ownerId, userId)));
}

export async function getRegionById(id: number): Promise<RegionRow | undefined> {
  const rows = await db.select().from(regions).where(eq(regions.id, id));
  return rows[0];
}

function findTopLevelRegionId(regionId: number, byId: Map<number, RegionRow>): number {
  let current = byId.get(regionId);
  while (current && current.parentId !== null) {
    current = byId.get(current.parentId);
  }
  return current ? current.id : regionId;
}

export async function getUsedTopLevelRegionsForGenre(genreId: number): Promise<RegionRow[]> {
  const genreSongs = await db.select({ id: songs.id }).from(songs).where(eq(songs.genreId, genreId));
  const songIds = genreSongs.map((s) => s.id);
  if (songIds.length === 0) return [];

  const [allRegions, axisRows] = await Promise.all([
    db.select().from(regions),
    db
      .select()
      .from(songAxisValues)
      .where(and(eq(songAxisValues.axisType, 'region'), inArray(songAxisValues.songId, songIds))),
  ]);

  const byId = new Map(allRegions.map((r) => [r.id, r]));
  const topLevelIds = new Set<number>();
  for (const row of axisRows) {
    if (row.refId !== null) topLevelIds.add(findTopLevelRegionId(row.refId, byId));
  }
  return allRegions.filter((r) => topLevelIds.has(r.id));
}

export async function createRegion(data: { name: string; parentId: number | null; ownerId: number | null }): Promise<RegionRow> {
  const rows = await db.insert(regions).values(data).returning();
  return rows[0];
}

export async function updateRegion(id: number, data: { name: string; parentId: number | null }): Promise<RegionRow> {
  const rows = await db.update(regions).set(data).where(eq(regions.id, id)).returning();
  return rows[0];
}

export async function deleteRegion(id: number): Promise<void> {
  const [songUsage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'region'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (songUsage) throw new Error('Η περιοχή χρησιμοποιείται από τραγούδι');
  const [childRegion] = await db.select({ id: regions.id }).from(regions).where(eq(regions.parentId, id)).limit(1);
  if (childRegion) throw new Error('Η περιοχή έχει θυγατρικές περιοχές');
  await db.delete(regions).where(eq(regions.id, id));
}
```

- [ ] **Step 2: Apply the identical pattern to `rhythms.ts`, `dromoi.ts`, `genres.ts`, `composers.ts`**

```ts
// src/db/queries/rhythms.ts
import { db } from '../client';
import { rhythms, songAxisValues } from '../schema';
import { eq, and, or, isNull } from 'drizzle-orm';
import type { RhythmRow } from '../schema';

export async function listRhythms(userId: number): Promise<RhythmRow[]> {
  return db.select().from(rhythms).where(or(isNull(rhythms.ownerId), eq(rhythms.ownerId, userId)));
}

export async function getRhythmById(id: number): Promise<RhythmRow | undefined> {
  const rows = await db.select().from(rhythms).where(eq(rhythms.id, id));
  return rows[0];
}

export async function createRhythm(data: { name: string; ownerId: number | null }): Promise<RhythmRow> {
  const rows = await db.insert(rhythms).values(data).returning();
  return rows[0];
}

export async function updateRhythm(id: number, data: { name: string }): Promise<RhythmRow> {
  const rows = await db.update(rhythms).set(data).where(eq(rhythms.id, id)).returning();
  return rows[0];
}

export async function deleteRhythm(id: number): Promise<void> {
  const [songUsage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'rhythm'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (songUsage) throw new Error('Ο ρυθμός χρησιμοποιείται από τραγούδι');
  await db.delete(rhythms).where(eq(rhythms.id, id));
}
```

```ts
// src/db/queries/dromoi.ts
import { db } from '../client';
import { dromoi, songAxisValues } from '../schema';
import { eq, and, or, isNull } from 'drizzle-orm';
import type { DromosRow } from '../schema';

export async function listDromoi(userId: number): Promise<DromosRow[]> {
  return db.select().from(dromoi).where(or(isNull(dromoi.ownerId), eq(dromoi.ownerId, userId)));
}

export async function getDromosById(id: number): Promise<DromosRow | undefined> {
  const rows = await db.select().from(dromoi).where(eq(dromoi.id, id));
  return rows[0];
}

export async function createDromos(data: { name: string; ownerId: number | null }): Promise<DromosRow> {
  const rows = await db.insert(dromoi).values(data).returning();
  return rows[0];
}

export async function updateDromos(id: number, data: { name: string }): Promise<DromosRow> {
  const rows = await db.update(dromoi).set(data).where(eq(dromoi.id, id)).returning();
  return rows[0];
}

export async function deleteDromos(id: number): Promise<void> {
  const [songUsage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'dromos'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (songUsage) throw new Error('Ο δρόμος χρησιμοποιείται από τραγούδι');
  await db.delete(dromoi).where(eq(dromoi.id, id));
}
```

```ts
// src/db/queries/genres.ts
import { db } from '../client';
import { genres, songs } from '../schema';
import { eq, or, isNull } from 'drizzle-orm';
import type { GenreRow } from '../schema';

export async function listGenres(userId: number): Promise<GenreRow[]> {
  return db.select().from(genres).where(or(isNull(genres.ownerId), eq(genres.ownerId, userId)));
}

export async function getGenreById(id: number): Promise<GenreRow | undefined> {
  const rows = await db.select().from(genres).where(eq(genres.id, id));
  return rows[0];
}

export async function createGenre(data: { name: string; ownerId: number | null }): Promise<GenreRow> {
  const rows = await db.insert(genres).values(data).returning();
  return rows[0];
}

export async function updateGenre(id: number, data: { name: string }): Promise<GenreRow> {
  const rows = await db.update(genres).set(data).where(eq(genres.id, id)).returning();
  return rows[0];
}

export async function deleteGenre(id: number): Promise<void> {
  const [songUsage] = await db.select({ id: songs.id }).from(songs).where(eq(songs.genreId, id)).limit(1);
  if (songUsage) throw new Error('Το είδος χρησιμοποιείται από τραγούδι');
  await db.delete(genres).where(eq(genres.id, id));
}
```

```ts
// src/db/queries/composers.ts
import { db } from '../client';
import { composers, songAxisValues } from '../schema';
import { eq, and, or, isNull } from 'drizzle-orm';
import type { ComposerRow } from '../schema';

export async function listComposers(userId: number): Promise<ComposerRow[]> {
  return db.select().from(composers).where(or(isNull(composers.ownerId), eq(composers.ownerId, userId)));
}

export async function getComposerById(id: number): Promise<ComposerRow | undefined> {
  const rows = await db.select().from(composers).where(eq(composers.id, id));
  return rows[0];
}

export async function createComposer(data: { name: string; ownerId: number | null }): Promise<ComposerRow> {
  const rows = await db.insert(composers).values(data).returning();
  return rows[0];
}

export async function updateComposer(id: number, data: { name: string }): Promise<ComposerRow> {
  const rows = await db.update(composers).set(data).where(eq(composers.id, id)).returning();
  return rows[0];
}

export async function deleteComposer(id: number): Promise<void> {
  const [usage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'composer'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (usage) throw new Error('Ο συνθέτης χρησιμοποιείται από τραγούδι');
  await db.delete(composers).where(eq(composers.id, id));
}
```

- [ ] **Step 3: Update `src/app/api/regions/route.ts` and `src/app/api/regions/[id]/route.ts`**

```ts
// src/app/api/regions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listRegions, createRegion } from '@/db/queries/regions';
import { getUserId } from '@/lib/requestUser';
import { getUserById } from '@/db/queries/users';

const createSchema = z.object({ name: z.string().min(1), parentId: z.number().int().nullable() });

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  return NextResponse.json(await listRegions(userId));
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const ownerId = user.role === 'admin' ? null : user.id;
  const region = await createRegion({ ...parsed.data, ownerId });
  return NextResponse.json(region, { status: 201 });
}
```

```ts
// src/app/api/regions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRegionById, updateRegion, deleteRegion } from '@/db/queries/regions';
import { getUserId } from '@/lib/requestUser';
import { getUserById } from '@/db/queries/users';

const updateSchema = z.object({ name: z.string().min(1), parentId: z.number().int().nullable() });

async function assertCanModify(request: NextRequest, id: number): Promise<NextResponse | null> {
  const userId = getUserId(request);
  const [user, region] = await Promise.all([getUserById(userId), getRegionById(id)]);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!region) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const canModify = user.role === 'admin' ? region.ownerId === null : region.ownerId === user.id;
  if (!canModify) return NextResponse.json({ error: 'Δεν έχεις δικαίωμα' }, { status: 403 });
  return null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await assertCanModify(request, Number(id));
  if (denied) return denied;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const region = await updateRegion(Number(id), parsed.data);
  return NextResponse.json(region);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await assertCanModify(request, Number(id));
  if (denied) return denied;
  try {
    await deleteRegion(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
```

- [ ] **Step 4: Apply the same two-route pattern to `rhythms`, `dromoi`, `genres`, `composers`**

For each of `src/app/api/rhythms/`, `src/app/api/dromoi/`, `src/app/api/genres/`, `src/app/api/composers/`: mirror Step 3 exactly, swapping `Region`/`regions`/`region` for the matching type/module/Greek-noun (`Rhythm`/`rhythms`/`ρυθμός`, `Dromos`/`dromoi`/`δρόμος`, `Genre`/`genres`/`είδος`, `Composer`/`composers`/`συνθέτης`), and importing `getRhythmById`/`getDromosById`/`getGenreById`/`getComposerById` from Step 2 instead of `getRegionById`. `genres`' create/update schema has no `parentId` field — keep it to just `{ name: z.string().min(1) }`.

- [ ] **Step 5: Update the admin taxonomy pages to be admin-only**

In each of `src/app/admin/regions/page.tsx`, `rhythms/page.tsx`, `dromoi/page.tsx`, `genres/page.tsx`, `composers/page.tsx`: these pages already call the routes above unauthenticated-looking (auth is transparent via cookie); no client code changes are needed for the happy path, since a non-admin's `POST`/`PATCH`/`DELETE` there would create a *personal* row (harmless) and a `DELETE`/`PATCH` on someone else's baseline row now correctly 403s. Leave the pages as-is — the personal "+ Νέα τιμή" inline flow for regular users is delivered by whichever song-form dropdown consumes it (already covered by the same `POST` routes; no separate page needed for MVP).

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/regions.ts src/db/queries/rhythms.ts src/db/queries/dromoi.ts src/db/queries/genres.ts src/db/queries/composers.ts src/app/api/regions/ src/app/api/rhythms/ src/app/api/dromoi/ src/app/api/genres/ src/app/api/composers/
git commit -m "Split shared taxonomies into admin baseline (NULL owner) and personal rows"
```

- [ ] **Step 7: Add inline "+ Νέα τιμή" creation to `SongAxisEditor`**

Regular users don't get the `/admin/regions`-style pages (Step 5), so the only way they create a personal taxonomy value is inline, from the song form. In `src/components/SongAxisEditor.tsx`, add local state and a create handler:

```tsx
const [creatingValue, setCreatingValue] = useState(false);
const [newValueName, setNewValueName] = useState('');

async function handleCreateValue() {
  if (!selectedType?.lookupTable || !newValueName.trim()) return;
  const endpoint = LOOKUP_ENDPOINTS[selectedType.lookupTable];
  const body = selectedType.lookupTable === 'regions' ? { name: newValueName.trim(), parentId: null } : { name: newValueName.trim() };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return;
  const created: Option = await res.json();
  setOptionsByAxis((prev) => ({ ...prev, [selectedType.key]: [...(prev[selectedType.key] ?? []), created] }));
  setNewRefId(String(created.id));
  setCreatingValue(false);
  setNewValueName('');
}
```

Replace the existing value `<select>` (the one rendered when `selectedType && selectedType.key !== 'year'`) with a version that offers a "+ Νέα τιμή..." option and, when chosen, an inline name field:

```tsx
{selectedType && selectedType.key !== 'year' && (
  <>
    <select
      value={creatingValue ? '__new__' : newRefId}
      onChange={(e) => {
        if (e.target.value === '__new__') {
          setCreatingValue(true);
          setNewRefId('');
        } else {
          setCreatingValue(false);
          setNewRefId(e.target.value);
        }
      }}
      className="select select-bordered select-sm"
    >
      <option value="">Τιμή...</option>
      {(optionsByAxis[selectedType.key] ?? []).map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
      <option value="__new__">+ Νέα τιμή...</option>
    </select>
    {creatingValue && (
      <>
        <input
          type="text"
          value={newValueName}
          onChange={(e) => setNewValueName(e.target.value)}
          placeholder="Όνομα νέας τιμής"
          className="input input-bordered input-sm"
        />
        <button type="button" onClick={handleCreateValue} className="btn btn-secondary btn-sm">Δημιουργία</button>
      </>
    )}
  </>
)}
```

The value this creates belongs to whichever user is logged in — ownership is decided server-side in the `POST` route from Step 3/4 based on their role, so no client-side ownership logic is needed here.

- [ ] **Step 8: Add the same inline creation to the genre dropdown**

In `src/app/admin/songs/new/page.tsx` (and the edit form, mirrored per Step 3 of Task 17's guidance to check both), add:

```tsx
const [creatingGenre, setCreatingGenre] = useState(false);
const [newGenreName, setNewGenreName] = useState('');

async function handleCreateGenre() {
  if (!newGenreName.trim()) return;
  const res = await fetch('/api/genres', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newGenreName.trim() }),
  });
  if (!res.ok) return;
  const created: Option = await res.json();
  setGenres((prev) => [...prev, created]);
  setGenreId(String(created.id));
  setCreatingGenre(false);
  setNewGenreName('');
}
```

Replace the genre `<select>` with:

```tsx
<select
  value={creatingGenre ? '__new__' : genreId}
  onChange={(e) => {
    if (e.target.value === '__new__') {
      setCreatingGenre(true);
    } else {
      setCreatingGenre(false);
      setGenreId(e.target.value);
    }
  }}
  className="select select-bordered"
  required
>
  <option value="">Είδος...</option>
  {genres.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
  <option value="__new__">+ Νέο είδος...</option>
</select>
{creatingGenre && (
  <div className="flex gap-2">
    <input
      type="text"
      value={newGenreName}
      onChange={(e) => setNewGenreName(e.target.value)}
      placeholder="Όνομα νέου είδους"
      className="input input-bordered flex-1"
    />
    <button type="button" onClick={handleCreateGenre} className="btn btn-secondary">Δημιουργία</button>
  </div>
)}
```

- [ ] **Step 9: Commit**

```bash
git add src/components/SongAxisEditor.tsx src/app/admin/songs/
git commit -m "Add inline personal-value creation to the song form's taxonomy pickers"
```

- [ ] **Step 10: Manual verification**

Log in as the admin (created in Task 11) and as a second, freshly registered user in two browser profiles. Confirm: admin can still create/edit/delete baseline regions/rhythms/etc; the second user sees the same baseline list plus nothing else; the second user can use "+ Νέα τιμή" / "+ Νέο είδος" on the song form to create their own (verify via the browser network tab that the resulting row has a non-null `ownerId`); the second user gets `403` trying to `DELETE` a baseline region's id via the API directly.

---

## Task 16: Suggestion-on-create

**Files:**
- Modify: `src/db/queries/axisValues.ts`
- Modify: `src/db/queries/songs.ts`
- Create: `src/app/api/songs/suggestions/route.ts`
- Modify: `src/app/admin/songs/new/page.tsx`

**Interfaces:**
- Produces: `getVisibleAxisRefIds(userId: number): Promise<Map<string, Set<number>>>` (axisType → set of taxonomy ids the given user may reference), `searchSuggestionSongs(query: string): Promise<SongRow[]>` (title-matches among admin-owned songs only), `GET /api/songs/suggestions?title=...` → `Array<SongRow & { axisValues: SongAxisValueRow[] }>` with axis values already filtered to what the requesting user can see.

- [ ] **Step 1: Add `getVisibleAxisRefIds` to `src/db/queries/axisValues.ts`**

```ts
// add to src/db/queries/axisValues.ts
import { regions, rhythms, dromoi, composers } from '../schema';
import { or, isNull } from 'drizzle-orm';

export async function getVisibleAxisRefIds(userId: number): Promise<Map<string, Set<number>>> {
  const [regionRows, rhythmRows, dromosRows, composerRows] = await Promise.all([
    db.select({ id: regions.id }).from(regions).where(or(isNull(regions.ownerId), eq(regions.ownerId, userId))),
    db.select({ id: rhythms.id }).from(rhythms).where(or(isNull(rhythms.ownerId), eq(rhythms.ownerId, userId))),
    db.select({ id: dromoi.id }).from(dromoi).where(or(isNull(dromoi.ownerId), eq(dromoi.ownerId, userId))),
    db.select({ id: composers.id }).from(composers).where(or(isNull(composers.ownerId), eq(composers.ownerId, userId))),
  ]);
  return new Map<string, Set<number>>([
    ['region', new Set(regionRows.map((r) => r.id))],
    ['rhythm', new Set(rhythmRows.map((r) => r.id))],
    ['dromos', new Set(dromosRows.map((r) => r.id))],
    ['composer', new Set(composerRows.map((r) => r.id))],
  ]);
}
```

(Merge the new `import` lines into the existing ones at the top of the file rather than duplicating the `import { db } from '../client'` line.)

- [ ] **Step 2: Add `searchSuggestionSongs` to `src/db/queries/songs.ts`**

```ts
// add to src/db/queries/songs.ts
import { users } from '../schema';

export async function searchSuggestionSongs(titleQuery: string): Promise<SongRow[]> {
  const rows = await db
    .select({ song: songs })
    .from(songs)
    .innerJoin(users, eq(songs.ownerId, users.id))
    .where(and(eq(users.role, 'admin'), ilike(songs.title, `%${titleQuery}%`)));
  return rows.map((r) => r.song);
}
```

- [ ] **Step 3: Write `src/app/api/songs/suggestions/route.ts`**

```ts
// src/app/api/songs/suggestions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { searchSuggestionSongs } from '@/db/queries/songs';
import { getAxisValuesForSongIds, getVisibleAxisRefIds } from '@/db/queries/axisValues';
import { getUserId } from '@/lib/requestUser';

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const title = request.nextUrl.searchParams.get('title')?.trim();
  if (!title) return NextResponse.json([]);

  const candidates = await searchSuggestionSongs(title);
  const axisRows = await getAxisValuesForSongIds(candidates.map((s) => s.id));
  const visible = await getVisibleAxisRefIds(userId);

  const result = candidates.map((song) => ({
    ...song,
    axisValues: axisRows.filter(
      (a) =>
        a.songId === song.id &&
        (a.axisType === 'year' || (a.refId !== null && visible.get(a.axisType)?.has(a.refId)))
    ),
  }));
  return NextResponse.json(result);
}
```

- [ ] **Step 4: Add the search + "use as template" UI to the new-song page**

In `src/app/admin/songs/new/page.tsx`, add a debounced title-suggestions lookup and a copy action. Insert this state and effect after the existing `useState` declarations:

```tsx
interface SuggestionSong {
  id: number;
  title: string;
  lyrics: string | null;
  notes: string | null;
  genreId: number;
  maleKey: string | null;
  femaleKey: string | null;
  axisValues: AxisValueEntry[];
}

const [suggestions, setSuggestions] = useState<SuggestionSong[]>([]);

useEffect(() => {
  if (title.trim().length < 2) {
    setSuggestions([]);
    return;
  }
  const timeout = setTimeout(() => {
    fetch(`/api/songs/suggestions?title=${encodeURIComponent(title.trim())}`)
      .then((r) => r.json())
      .then(setSuggestions);
  }, 300);
  return () => clearTimeout(timeout);
}, [title]);

function useSuggestion(s: SuggestionSong) {
  setLyrics(s.lyrics ?? '');
  setNotes(s.notes ?? '');
  setGenreId(String(s.genreId));
  setMaleKey(s.maleKey ?? '');
  setFemaleKey(s.femaleKey ?? '');
  setAxisValues(s.axisValues);
  setSuggestions([]);
}
```

Then render the suggestion list right below the title `<input>`:

```tsx
{suggestions.length > 0 && (
  <div className="flex flex-col gap-2 rounded-box border border-base-300 bg-base-200 p-3">
    <p className="text-sm font-semibold">Βρέθηκαν παρόμοια τραγούδια — χρησιμοποίησε ένα ως βάση:</p>
    {suggestions.map((s) => (
      <div key={s.id} className="flex items-center justify-between gap-2">
        <span>{s.title}</span>
        <button type="button" onClick={() => useSuggestion(s)} className="btn btn-sm btn-outline">
          Χρησιμοποίησε ως βάση
        </button>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/db/queries/axisValues.ts src/db/queries/songs.ts src/app/api/songs/suggestions/ src/app/admin/songs/new/page.tsx
git commit -m "Add suggestion-on-create: search and copy from the admin's repertoire"
```

- [ ] **Step 6: Manual verification**

As a non-admin user, start typing a title that matches one of the admin's existing songs on `/admin/songs/new`. Confirm the suggestion appears, "Χρησιμοποίησε ως βάση" pre-fills lyrics/notes/genre/axis values, and the fields remain freely editable before saving. Confirm the new song is saved with your `ownerId`, independent of the original.

---

## Task 17: Sheet-music image upload

**Files:**
- Modify: `package.json` (add `@vercel/blob`)
- Create: `src/app/api/songs/image-upload/route.ts`
- Modify: `src/app/admin/songs/new/page.tsx` (and `src/app/admin/songs/[id]/page.tsx` if it duplicates the form — read it first and mirror the same addition)
- Modify: `src/lib/suggestions.ts`
- Modify: `src/components/LiveSessionView.tsx`

**Interfaces:**
- Produces: `POST /api/songs/image-upload` (Vercel Blob client-upload token endpoint), `CurrentSongPayload.imageUrl: string | null`, `LiveSessionView` renders the image instead of lyrics text when `imageUrl` is set.

- [ ] **Step 1: Install the dependency**

```bash
npm install @vercel/blob
```

- [ ] **Step 2: Write the upload route**

```ts
// src/app/api/songs/image-upload/route.ts
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp'],
        maximumSizeInBytes: 10 * 1024 * 1024, // 10MB client-side ceiling
      }),
      onUploadCompleted: async () => {
        // No server-side bookkeeping needed — the client PATCHes the song's imageUrl itself.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
```

Note: this route must be reachable through `proxy.ts`'s normal (non-public) path — it's already covered since it's not in `PUBLIC_PATHS`, and Vercel Blob's client-upload flow calls it with the same authenticated `fetch` as the rest of the app (cookie/Bearer attached automatically by the browser / `apiClient`).

- [ ] **Step 3: Add an upload widget to the new-song form**

In `src/app/admin/songs/new/page.tsx`, add:

```tsx
import { upload } from '@vercel/blob/client';

// inside the component, alongside the other useState calls:
const [imageUrl, setImageUrl] = useState<string | null>(null);
const [uploading, setUploading] = useState(false);

async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;
  setUploading(true);
  try {
    const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/songs/image-upload' });
    setImageUrl(blob.url);
  } finally {
    setUploading(false);
  }
}
```

Render it below the lyrics `<textarea>`:

```tsx
<div className="flex flex-col gap-2">
  <label className="label-text">Εικόνα παρτιτούρας (προαιρετικό, εναλλακτικά ή μαζί με τους στίχους)</label>
  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} className="file-input file-input-bordered" />
  {uploading && <span className="loading loading-spinner loading-sm" />}
  {imageUrl && <img src={imageUrl} alt="Προεπισκόπηση παρτιτούρας" className="max-h-64 rounded-box object-contain" />}
</div>
```

And include `imageUrl` in the `POST /api/songs` request body in `handleSubmit`.

Read `src/app/admin/songs/[id]/page.tsx` (the edit form) and apply the identical widget + `imageUrl` field to its `PATCH` payload — it almost certainly mirrors the new-song form's structure.

- [ ] **Step 4: Surface `imageUrl` on the live-session payload**

In `src/lib/suggestions.ts`, add `imageUrl: string | null;` to the `CurrentSongPayload` interface (next to `femaleKey`), and add `imageUrl: currentSongWithAxes.imageUrl,` to the `currentSong` object construction (next to the existing `femaleKey: currentSongWithAxes.femaleKey,` line).

- [ ] **Step 5: Render the image in `LiveSessionView`**

In `src/components/LiveSessionView.tsx`, change `LyricsCard`'s signature and body:

```tsx
function LyricsCard({
  lyrics,
  imageUrl,
  maleKey,
  femaleKey,
}: {
  lyrics: string | null;
  imageUrl: string | null;
  maleKey: string | null;
  femaleKey: string | null;
}) {
  return (
    <div className="card flex flex-col gap-3 bg-base-100 p-6 shadow sm:p-8">
      <KeyBadges maleKey={maleKey} femaleKey={femaleKey} />
      {imageUrl ? (
        <img src={imageUrl} alt="Παρτιτούρα" className="mx-auto max-h-[70vh] w-auto object-contain" />
      ) : lyrics ? (
        <pre className="whitespace-pre-wrap text-center font-sans text-xl sm:text-2xl leading-relaxed text-base-content">{lyrics}</pre>
      ) : (
        <p className="text-lg italic text-base-content/50">Δεν έχουν προστεθεί ακόμη στίχοι ή παρτιτούρα για αυτό το τραγούδι.</p>
      )}
    </div>
  );
}
```

And update its call site:

```tsx
<LyricsCard
  lyrics={currentSong.lyrics}
  imageUrl={currentSong.imageUrl}
  maleKey={currentSong.maleKey}
  femaleKey={currentSong.femaleKey}
/>
```

- [ ] **Step 6: Set the Blob env var**

Note in a comment / to yourself: enabling a Blob store on the Vercel project auto-populates `BLOB_READ_WRITE_TOKEN` in the project's env vars (production) — for local dev, run `vercel env pull .env.local` after enabling it, or copy the token manually into `.env.local`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/app/api/songs/image-upload/ src/app/admin/songs/ src/lib/suggestions.ts src/components/LiveSessionView.tsx
git commit -m "Add sheet-music image upload via Vercel Blob"
```

- [ ] **Step 8: Manual verification**

Upload a photo on the new-song form, save, start a session with that song as current, confirm the live view shows the image instead of the "no lyrics" placeholder. Confirm a song with only lyrics (no image) still renders as before.

---

## Task 18: Password reset via Resend

**Files:**
- Modify: `package.json` (add `resend`)
- Create: `src/lib/email.ts`
- Create: `src/db/queries/passwordResetTokens.ts`
- Create: `src/app/api/forgot-password/route.ts`
- Create: `src/app/api/reset-password/route.ts`
- Create: `src/app/forgot-password/page.tsx`
- Create: `src/app/reset-password/page.tsx`

**Interfaces:**
- Consumes: `generateResetToken`/`hashResetToken` (Task 3), `hashPassword` (Task 2), `getUserByEmail`/`updateUserPassword` (Task 5).
- Produces: `sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>`, `createResetToken(userId, tokenHash, expiresAt)`, `findValidResetToken(tokenHash)`, `markResetTokenUsed(id)`.

- [ ] **Step 1: Install the dependency**

```bash
npm install resend
```

- [ ] **Step 2: Write `src/lib/email.ts`**

```ts
// src/lib/email.ts
import { Resend } from 'resend';

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'Glentify <no-reply@glentify.app>',
    to,
    subject: 'Επαναφορά κωδικού Glentify',
    html: `<p>Πατήστε <a href="${resetUrl}">εδώ</a> για να ορίσετε νέο κωδικό.</p><p>Ο σύνδεσμος λήγει σε 1 ώρα. Αν δεν ζήτησες εσύ επαναφορά κωδικού, αγνόησε αυτό το email.</p>`,
  });
}
```

- [ ] **Step 3: Write `src/db/queries/passwordResetTokens.ts`**

```ts
// src/db/queries/passwordResetTokens.ts
import { db } from '../client';
import { passwordResetTokens } from '../schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import type { PasswordResetTokenRow } from '../schema';

export async function createResetToken(userId: number, tokenHash: string, expiresAt: Date): Promise<PasswordResetTokenRow> {
  const rows = await db.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt }).returning();
  return rows[0];
}

export async function findValidResetToken(tokenHash: string): Promise<PasswordResetTokenRow | undefined> {
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date())
      )
    );
  return rows[0];
}

export async function markResetTokenUsed(id: number): Promise<void> {
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, id));
}
```

- [ ] **Step 4: Write `/api/forgot-password`**

```ts
// src/app/api/forgot-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByEmail } from '@/db/queries/users';
import { createResetToken } from '@/db/queries/passwordResetTokens';
import { generateResetToken } from '@/lib/resetToken';
import { sendPasswordResetEmail } from '@/lib/email';

const schema = z.object({ email: z.email() });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await getUserByEmail(parsed.data.email);
  if (user) {
    const { token, tokenHash } = generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await createResetToken(user.id, tokenHash, expiresAt);
    const origin = request.nextUrl.origin;
    await sendPasswordResetEmail(user.email, `${origin}/reset-password?token=${token}`);
  }
  // Same response whether or not the email exists, to avoid leaking which emails are registered.
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Write `/api/reset-password`**

```ts
// src/app/api/reset-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { findValidResetToken, markResetTokenUsed } from '@/db/queries/passwordResetTokens';
import { updateUserPassword } from '@/db/queries/users';
import { hashResetToken } from '@/lib/resetToken';
import { hashPassword } from '@/lib/passwordHash';

const schema = z.object({ token: z.string().min(1), password: z.string().min(8) });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const record = await findValidResetToken(hashResetToken(parsed.data.token));
  if (!record) return NextResponse.json({ error: 'Ο σύνδεσμος έληξε ή δεν είναι έγκυρος' }, { status: 400 });

  await updateUserPassword(record.userId, hashPassword(parsed.data.password));
  await markResetTokenUsed(record.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Write the two pages**

```tsx
// src/app/forgot-password/page.tsx
'use client';

import { useState } from 'react';
import { apiUrl } from '@/lib/apiClient';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch(apiUrl('/api/forgot-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-base-200 p-4">
      <div className="card w-full max-w-sm bg-base-100 shadow-xl">
        <div className="card-body gap-3">
          <h1 className="card-title text-2xl">Ξέχασα τον κωδικό</h1>
          {sent ? (
            <p>Αν υπάρχει λογαριασμός με αυτό το email, θα λάβεις σύνδεσμο επαναφοράς σε λίγο.</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="input input-bordered input-lg w-full"
                autoFocus
                required
              />
              <button type="submit" className="btn btn-primary btn-lg">Αποστολή συνδέσμου</button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
```

```tsx
// src/app/reset-password/page.tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiUrl } from '@/lib/apiClient';

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(apiUrl('/api/reset-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === 'string' ? body.error : 'Κάτι πήγε στραβά');
      return;
    }
    router.push('/login');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-base-200 p-4">
      <div className="card w-full max-w-sm bg-base-100 shadow-xl">
        <form onSubmit={handleSubmit} className="card-body gap-3">
          <h1 className="card-title text-2xl">Νέος κωδικός</h1>
          {error && (
            <div role="alert" className="alert alert-error">
              <span>{error}</span>
            </div>
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Νέος κωδικός (τουλάχιστον 8 χαρακτήρες)"
            className="input input-bordered input-lg w-full"
            minLength={8}
            autoFocus
            required
          />
          <button type="submit" className="btn btn-primary btn-lg">Αποθήκευση</button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/email.ts src/db/queries/passwordResetTokens.ts src/app/api/forgot-password/ src/app/api/reset-password/ src/app/forgot-password/ src/app/reset-password/
git commit -m "Add password reset via Resend email"
```

- [ ] **Step 8: Manual verification**

Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (a verified sender on your Resend domain) in `.env.local`. Go to `/forgot-password`, submit your test account's email, receive the email, click the link, set a new password, log in with it. Confirm submitting an unregistered email also shows the generic "θα λάβεις σύνδεσμο" message (no leak).

---

## Task 19: Account deletion (GDPR)

**Files:**
- Create: `src/db/queries/accountDeletion.ts`
- Create: `src/app/api/account/route.ts`
- Create: `src/app/account/page.tsx`

**Interfaces:**
- Consumes: `countAdmins`, `getUserById` (Task 5).
- Produces: `deleteUserCascade(userId: number): Promise<void>`, `DELETE /api/account`.

- [ ] **Step 1: Write the cascade-delete query**

```ts
// src/db/queries/accountDeletion.ts
import { db } from '../client';
import {
  users,
  songs,
  programs,
  sessions,
  sessionPlayedSongs,
  programSequences,
  sequenceSongs,
  songAxisValues,
  regions,
  rhythms,
  dromoi,
  genres,
  composers,
  passwordResetTokens,
} from '../schema';
import { eq, inArray } from 'drizzle-orm';

export async function deleteUserCascade(userId: number): Promise<void> {
  const ownedSongs = await db.select({ id: songs.id }).from(songs).where(eq(songs.ownerId, userId));
  const songIds = ownedSongs.map((s) => s.id);

  const ownedPrograms = await db.select({ id: programs.id }).from(programs).where(eq(programs.ownerId, userId));
  const programIds = ownedPrograms.map((p) => p.id);
  const sequences = programIds.length
    ? await db.select({ id: programSequences.id }).from(programSequences).where(inArray(programSequences.programId, programIds))
    : [];
  const sequenceIds = sequences.map((s) => s.id);

  const ownedSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.ownerId, userId));
  const sessionIds = ownedSessions.map((s) => s.id);

  if (sequenceIds.length) await db.delete(sequenceSongs).where(inArray(sequenceSongs.sequenceId, sequenceIds));
  if (programIds.length) await db.delete(programSequences).where(inArray(programSequences.programId, programIds));
  if (sessionIds.length) await db.delete(sessionPlayedSongs).where(inArray(sessionPlayedSongs.sessionId, sessionIds));
  if (songIds.length) await db.delete(songAxisValues).where(inArray(songAxisValues.songId, songIds));

  await db.delete(programs).where(eq(programs.ownerId, userId));
  await db.delete(sessions).where(eq(sessions.ownerId, userId));
  await db.delete(songs).where(eq(songs.ownerId, userId));

  await db.delete(regions).where(eq(regions.ownerId, userId));
  await db.delete(rhythms).where(eq(rhythms.ownerId, userId));
  await db.delete(dromoi).where(eq(dromoi.ownerId, userId));
  await db.delete(genres).where(eq(genres.ownerId, userId));
  await db.delete(composers).where(eq(composers.ownerId, userId));

  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}
```

- [ ] **Step 2: Write `DELETE /api/account`**

```ts
// src/app/api/account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getUserById, countAdmins } from '@/db/queries/users';
import { deleteUserCascade } from '@/db/queries/accountDeletion';
import { getUserId } from '@/lib/requestUser';
import { getAuthCookieName } from '@/lib/auth';

export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (user.role === 'admin') {
    const admins = await countAdmins();
    if (admins <= 1) {
      return NextResponse.json({ error: 'Δεν μπορείς να διαγράψεις τον μοναδικό admin λογαριασμό' }, { status: 409 });
    }
  }

  await deleteUserCascade(userId);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(getAuthCookieName());
  return response;
}
```

- [ ] **Step 3: Write a minimal account settings page**

```tsx
// src/app/account/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUrl } from '@/lib/apiClient';

export default function AccountPage() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">Λογαριασμός</h1>
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

- [ ] **Step 4: Commit**

```bash
git add src/db/queries/accountDeletion.ts src/app/api/account/ src/app/account/
git commit -m "Add account deletion with cascade cleanup"
```

- [ ] **Step 5: Manual verification**

As a non-admin test user, delete the account via `/account`. Confirm redirect to `/login`, confirm the deleted user can no longer log in, and confirm (via the admin's `/admin/songs`) that none of the deleted user's songs leaked into the admin's list. Separately, confirm attempting `DELETE /api/account` as the sole admin returns `409` and does not delete anything.

---

## Task 20: Update README and final full-flow verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the new env vars and setup step**

In `README.md`, under "Local development", replace the `APP_PASSWORD` mention and add the new vars:

```markdown
3. `cp .env.example .env.local` and fill in `DATABASE_URL` (from Neon), `AUTH_SECRET` (any random string), `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (from https://resend.com, used for password-reset emails), and `BLOB_READ_WRITE_TOKEN` (from the Vercel Blob store you enable on the project — see step 6 below for local pull).
4. `npm run db:generate` then `npm run db:migrate`
5. First deploy only: `ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="..." npm run db:migrate-to-multiuser` to create the first admin account and backfill ownership of any pre-existing data.
6. `npm run dev` and open http://localhost:3000 — register a normal account at `/register`, or log in as the admin you just created.
```

Update `.env.example` to list `AUTH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `BLOB_READ_WRITE_TOKEN` instead of `APP_PASSWORD`/`AUTH_SECRET`.

- [ ] **Step 2: Commit**

```bash
git add README.md .env.example
git commit -m "Document multi-user setup in README"
```

- [ ] **Step 3: Full-flow manual verification**

Run `npm test` (all unit tests green) and `npm run lint` (clean), then walk through, in order: register → login → create a personal song via suggestion-on-create → upload a sheet-music photo on a second song → start a live session and confirm both the lyrics song and the image song render correctly → forgot-password → reset → log in with the new password → delete the (non-admin) account and confirm cleanup. This is the final acceptance check for the whole feature.
