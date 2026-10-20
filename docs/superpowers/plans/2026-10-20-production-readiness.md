# UniPulse production readiness implementation plan

> **For agentic workers:** Use superpowers:executing-plans for implementation and requesting-code-review before completion. Track the checks below.

**Goal:** Prepare the existing app for 40–100 college students using phones and PCs through Vercel and Supabase.

**Architecture:** Keep Next.js, Supabase, the existing screens, and College ID/PIN login. Treat the server session as the access boundary: browser database access is denied; server queries are scoped to the signed-in student's groups and private tasks. Database failures must never turn successful writes into temporary memory writes.

**Spec:** The user's request to fix existing bugs before college rollout, with Vercel hosting and Supabase persistence confirmed in chat.

**Tech stack:** Next.js 15 / React 19 / TypeScript / Supabase Postgres and Storage / Web Push.

**Implementation status:** Local changes are implemented on `codex/production-hardening`; verification and review evidence is in `production-progress.md`. The deployment checklist in `README.md` separates the prepared migration/configuration from live staging and launch actions. No live database changes, deployment, or device notification tests were performed.

## Constraints

- Preserve English/Egyptian Arabic and the current visual design.
- Keep PIN login for compatibility; add slow salted hashing, session expiry, and shared database throttling. Upgrade legacy hashes on successful login.
- Prepare migration and environment instructions locally. Apply no live migration, publish no deployment, and send no real notifications during verification.
- Never expose private keys in output or frontend bundles.
- No traffic claim without measuring the actual configured deployment.

## Review focus

1. Nonmembers accessing private tasks through write endpoints or database policies.
2. Database/network failure returning a success response or losing a student's draft.
3. Simultaneous requests colliding on timestamp IDs or duplicating reminders.
4. Logout/account switching while an old state request is still pending.
5. Phones: upload limits, push permission gestures, and reminder quiet hours.

## Task 1: Regression suite and server boundary

**Files:** package.json, test configuration, tests/, src/lib/auth.ts, src/lib/supabase.ts, src/lib/server-db.ts, src/lib/supabase-data.ts, src/lib/api.ts, src/app/api/auth/route.ts.

**Interfaces:** Shared API errors map malformed input to 400, absent authentication to 401, denied access to 403, missing records to 404, and unavailable persistence to 503. Shared group/task authorization is consumed by mutation routes. Rate limits use an atomic Postgres RPC and hashed keys.

- [ ] Add and run failing regression tests for forged/expired sessions, missing production configuration, unscoped state, malformed input, and nonmember writes.
- [ ] Require production session secret and actual service-role credentials; use secure expiring cookies and constant-time signature checks.
- [ ] Upgrade PIN hashing and throttle login/register in shared storage, with no demo-account privilege bypass.
- [ ] Fail closed on database errors and disable memory fallback for production or configured database failures.
- [ ] Scope state queries before fetching related rows; never fetch PIN hashes in state responses or expose the public student directory.
- [ ] Run the focused tests and type check.

## Task 2: Tasks, groups, and files

**Files:** src/app/api/tasks/**, src/app/api/groups/route.ts, src/app/api/state/route.ts, src/app/api/upload/route.ts, authenticated attachment download route, shared validation/access helpers.

- [ ] Reproduce missing membership checks on task create/status/comment/upload, including private tasks.
- [ ] Enforce task ownership for edits/deletes and group ownership for group deletion; remove the hardcoded demo admin.
- [ ] Validate input types, lengths, dates, categories, intervals, and file size. Use UUIDs for identifiers.
- [ ] Consolidate alternate state mutations through the same authorization paths.
- [ ] Make task creation plus initial status/attachment atomic in a Postgres function; propagate write failures.
- [ ] Store files privately and authorize downloads through the server. Bind pending uploads to their uploader to prevent forged attachments.
- [ ] Test forbidden/missing/valid records, failed secondary writes, and invalid uploads.

## Task 3: Push and reminder correctness

**Files:** src/app/api/push/**, src/app/api/cron/reminders/route.ts, src/lib/vapid.ts, reminder helpers and tests.

- [ ] Reproduce unauthenticated sends/subscriptions and unprotected cron execution with controlled dependencies.
- [ ] Require sessions for subscribe/test send and target only the signed-in student's stored subscriptions.
- [ ] Require CRON_SECRET for scheduled dispatch; allow manual dispatch only for the session user's tasks.
- [ ] Remove fallback private VAPID keys; validate endpoints; add send timeouts and expired-subscription cleanup.
- [ ] Claim due reminders atomically so overlapping scheduler runs do not send the same reminder twice; preserve Done/skipped state.
- [ ] Apply configured Africa/Cairo quiet hours consistently; test overnight boundaries and per-user scheduling.
- [ ] Document an external scheduler for frequent reminders on Vercel Hobby.

## Task 4: Client reliability

**Files:** src/components/UniPulseApp.tsx, CreateTaskModal.tsx, TaskDetailModal.tsx, ProfileModal.tsx, src/lib/push-client.ts, public/sw.js, client tests.

- [ ] Reproduce failed task/comment saves discarding drafts and push persistence failures showing success.
- [ ] Await saves; keep failed drafts open and display errors; prevent duplicate submissions.
- [ ] Start with empty state; ignore stale requests during account changes; poll only visible authenticated sessions through the server.
- [ ] Remove anonymous realtime subscriptions that depend on unsafe public policies.
- [ ] Preserve notification permission gestures and report actual server push failure accurately.
- [ ] Verify drafts, auth failure recovery, notification links, and primary flows on mobile/desktop.

## Task 5: Database migration and launch checks

**Files:** supabase/schema.sql, supabase/migrations/, .env.example, README.md, next.config.ts, package.json/lock, CI configuration.

- [ ] Prepare an idempotent migration to revoke anonymous table/storage access, make files private, add indexes and service-only atomic functions. Preserve existing student data.
- [ ] Move demo seeding out of the production schema; document disabling existing demo accounts and rotating committed development secrets.
- [ ] Repair lint tooling and any audited dependency issues without an unnecessary major framework upgrade.
- [ ] Add CI checks and documented setup, backups/recovery, scheduler, and post-deployment smoke checks.
- [ ] Run the full regression suite, type check, lint, audit, and production build.
- [ ] Request independent review, fix important findings, and rerun relevant checks.
- [ ] Report verified changes separately from live rollout steps that require account access.
