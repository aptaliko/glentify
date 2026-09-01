# Legal & Play Store Compliance — Prep Notes

**Purpose:** not a privacy policy, ToS, or legal advice — a fact sheet and open-decisions list
so that whoever drafts those documents (ideally a lawyer, given real financial/legal exposure)
has everything about how the app actually works in one place, instead of re-deriving it from
the codebase. Compiled 2026-09-01, prompted by the question of whether the app is ready to
publish on Google Play, with the user-submitted song lyrics field as the specific concern.

---

## 1. What the app actually does with data (verified against the code, not assumed)

- **Lyrics are not device-only.** `songs.lyrics` is a column in the app's own Postgres
  database (`src/db/schema.ts:54`), written and read through the app's API routes. Native/
  offline mode caches a copy locally (IndexedDB) for viewing without a connection, but the
  source of truth is the hosted database — the developer operates the storage, not just the
  user's device.
- **Lyrics can be seen by more than the song's owner.** A program shared with collaborators
  exposes the songs referenced in it (including lyrics) to those collaborators, read-only, via
  a `sharedSongs` mechanism (`src/app/api/reference-data/route.ts`). This is a real content-
  sharing path, not purely private per-user storage.
- **Account data collected:** email address, a scrypt-hashed password (`src/lib/
  passwordHash.ts` — no external password service), a role field, and everything a user
  creates: songs (title, lyrics, notes, key info, an optional uploaded image), taxonomy entries
  (regions/rhythms/dromoi/composers/genres), programs and their sequences, and session/played-
  song history.
- **Self-service account deletion already exists.** `DELETE /api/account`
  (`src/db/queries/accountDeletion.ts`) cascades: owned songs (and their lyrics), programs,
  sequences, session history, taxonomy entries the user created, collaborator memberships, and
  the user row itself. This is a real, working "right to erasure" mechanism worth naming
  explicitly in a privacy policy rather than promising to build one.
- **Third-party subprocessors currently in use** (each would need a line in a privacy policy's
  "who we share data with" section, and Google Play's Data Safety form asks about each):
  - **Vercel** — hosting, and the Postgres database (confirm exact DB provider/region before
    writing anything — `DATABASE_URL` is generic in `drizzle.config.ts`, provider not
    independently confirmed here).
  - **Vercel Blob** — stores uploaded song images (`src/app/api/songs/image-upload/route.ts`).
  - **Resend** — sends password-reset emails (`src/lib/email.ts`); the recipient's email
    address and a reset link are the only data sent to it.
- **No analytics, crash reporting, ads, or tracking SDKs found** in the codebase as of this
  writing (worth re-confirming if anything gets added later — this fact sheet goes stale).
- **Native app permissions/capabilities in use:** Capacitor Filesystem, Network status,
  Preferences (local key-value storage, holds the auth token), and Share (the OS share sheet,
  used for PDF export) — none of these are third-party data-collection SDKs, they're local
  device APIs.

## 2. Facts/decisions only George can supply

- [ ] **Publishing identity.** Individual developer or a registered business? This determines
      the "data controller" name a privacy policy must state, and the entity a ToS is between.
- [ ] **Contact details for legal notices.** An email (and possibly postal address, depending
      on what a lawyer says is required) for privacy inquiries, copyright/DMCA notices, and
      general support — Google Play requires a support contact regardless of the lyrics
      question.
- [ ] **Confirm the database provider name** (Neon / Vercel Postgres / other) — needed for an
      accurate subprocessor list and to check its own data-processing terms.
- [ ] **Intended distribution.** Full public Play Store listing, or start on a closed/internal
      testing track (lower Play policy scrutiny, discussed as an option) while compliance work
      is finished?
- [ ] **Governing law / jurisdiction** a ToS should name — likely Greek law given where the
      developer and primary users are, but that's a decision for whoever drafts it, not
      something to assume.
- [ ] **Age of intended users.** Is this exclusively for adults (band members, family), or
      could minors realistically use it? Affects whether GDPR-K / children's-privacy rules
      apply at all.

## 3. Open product/policy decisions specific to the lyrics concern

- [ ] **Should lyrics stay visible to collaborators, or become owner-only?** Restricting
      sharing is a product change (not a legal fix by itself) that reduces the app's own
      "distribution" footprint for any one piece of copyrighted text.
- [ ] **Will there be a copyright/DMCA takedown mechanism?** At minimum: a stated contact for
      copyright complaints, and an actual internal process to remove/redact a specific song's
      lyrics on request (technically trivial today — direct DB access — but not exposed as a
      feature).
- [ ] **Will the Terms of Service require users to affirm they have the right to any lyrics
      they add?** Common mitigation in comparable apps; doesn't eliminate risk but shifts
      framing and is standard practice.
- [ ] **DMCA safe-harbor registration** (US Copyright Office agent registration) — only
      relevant/available if pursuing US DMCA safe harbor specifically; a lawyer should confirm
      whether it's worth doing given where users actually are.

## 4. Documents/mechanisms that don't exist yet

Checked the repo directly — none of the following exist as of this writing:

- [ ] Privacy Policy (publicly hosted URL — Play Store requires this at submission,
      independent of the lyrics question)
- [ ] Terms of Service / EULA
- [ ] Copyright / DMCA policy and reporting contact
- [ ] Content-reporting mechanism for user-generated content (required by Play's
      User-Generated Content policy once you declare the app has UGC, which the lyrics/shared-
      program feature qualifies as)

## 5. Google Play Console submission checklist (operational, not legal)

Things the Play Console will literally ask for at submission time, separate from whether the
underlying legal questions are resolved:

- [ ] Privacy Policy URL
- [ ] Data Safety form — accurate answers per the data inventory in Section 1
- [ ] Content rating questionnaire
- [ ] Target audience & content declarations
- [ ] User-Generated Content declaration + description of moderation practices
- [ ] Ads declaration (none, per current codebase)
- [ ] A test account and instructions for the Play reviewer (the app requires login)

## 6. Recommended next step

Get an IP/tech lawyer — ideally with Greek-law and Google Play policy familiarity, since
distribution is global but the developer and likely userbase are Greek — to review this
document plus the actual sharing behavior (a multi-user database storing user-submitted lyrics,
shared with collaborators) before a public production release. Sections 2 and 3 above are the
concrete open questions to bring to that conversation.
