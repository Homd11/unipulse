# UniPulse

Shared course tasks, private tasks, comments, attachments, and Web Push reminders for a college cohort. Next.js 15, React 19, and Supabase. English and Egyptian Arabic are supported.

## Local setup

Use Node.js 24 (the version used for verification) and npm. Run `npm ci`, copy `.env.example` to `.env.local`, configure a **development** Supabase project, apply `supabase/schema.sql` in its SQL editor, then run `npm run dev`.

The app requires persistent Supabase storage. Missing configuration and database errors return an error; production never silently saves to process memory. Demo data is optional and separate in `supabase/demo-seed.sql`; do not load it into production.

## Before inviting students

1. Export/back up the existing Supabase database and `task-files` objects. Confirm you can restore them into a separate test project. Keep a backup outside the project you are deploying.
2. Apply `supabase/migrations/20261020_production_hardening.sql` in the Supabase SQL editor. It is transactional and idempotent, preserves existing rows, closes browser database access, makes `task-files` private, adds indexes, and installs three service-only functions. For a new database, use `supabase/schema.sql` instead. Never reapply the old public schema.
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a random `SESSION_SECRET` in the Vercel environment. The signing secret needs at least 32 random characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` on your own machine. Keep it out of Git. Confirm the configured Supabase server key has service-role access; an anonymous/publishable key will not work.
4. Rotate any development signing, cron, or VAPID secrets copied from the previous code or example environment. Deploy a fresh unique VAPID pair using `npm run generate-vapid`, set `VAPID_SUBJECT` to your contact address, and set a separate random `CRON_SECRET`. Updating the public VAPID key requires a new build; existing browser subscriptions may need notifications disabled/re-enabled or site permission reset.
5. Review existing `user-*` demo accounts and any real content they own. Production rejects their logins and sessions; the migration preserves them so their data is not deleted. Move legitimate ownership to the appropriate `stu-*` accounts deliberately before removing demo records. Never delete a demo account blindly: foreign keys cascade to its groups/tasks.
6. Deploy this branch only after CI passes, then run the smoke checks below with two test student accounts. Apply the migration before opening the new deployment to students. Older deployments will lose anonymous realtime after the migration; the new app uses authenticated server polling instead.
7. Configure the reminder scheduler below and validate a real phone notification. A passing local push test does not prove delivery to a locked iPhone. No live notification or deployed load test has been run as part of local verification.

If push environment variables are absent, the app can still handle tasks, but notification endpoints return a clear configuration error. Every Vercel environment (Preview and Production) needs its own correct configuration. Prefer a separate Supabase project for previews.

## Reminder scheduling

The checked-in Vercel cron remains a daily fallback at `08:00 UTC`. It **cannot deliver two-hour reminders** by itself. [Vercel Hobby cron runs at most daily](https://vercel.com/docs/cron-jobs/usage-and-pricing). For frequent reminders on Hobby, configure Supabase Cron with `pg_net`, or another scheduler, to call `GET https://YOUR_DOMAIN/api/cron/reminders` every 5–10 minutes with `Authorization: Bearer YOUR_CRON_SECRET`. Store the secret in the scheduler's secret store/Supabase Vault, not a checked-in SQL script or public URL. On a Vercel plan permitting frequent cron jobs, change the Vercel schedule to `*/10 * * * *` instead.

Confirm Vercel Fluid Compute is enabled and the reminder function's duration has not been lowered from its default. [Current Fluid Compute defaults allow 300 seconds](https://vercel.com/docs/functions/configuring-functions/duration); older non-Fluid settings can stop a batch much earlier. Watch invocation duration in staging before rollout.

Avoid configuring multiple schedulers unnecessarily. Atomic Postgres claims prevent normal overlapping runs from sending the same reminder twice. Each invocation claims up to 100 due student/task pairs, processes at most five provider sends concurrently, and leases each pair until its next reminder interval. Additional due rows are handled on the next run. Failed provider sends are retried at the next interval; an interrupted invocation can delay an already claimed reminder until then. Quiet hours use `REMINDER_TIMEZONE` (default `Africa/Cairo`) for all users, including when they travel. A per-student timezone is not implemented. Manual reminders are self-only, limited to once a minute, and respect quiet hours.

Quiet-hour recipients are excluded before claiming: their reminders remain due until quiet hours end, so daily reminders cannot become permanently stuck at a sleeping hour.

Web Push requires HTTPS (localhost works during development). On supported iPhones/iPads, install the app on the Home Screen and enable notifications from a user tap. Test sends use saved subscriptions for the signed-in account; the UI reports delivery errors instead of presenting a local popup as proof of server delivery.

## Access and persistence

- All Supabase table/storage operations go through server routes, authenticated by a signed HttpOnly cookie. Browser Supabase keys cannot read or write app tables. The service key must never appear in `NEXT_PUBLIC_*` configuration or frontend code. Custom cookie login is not Supabase Auth and does not grant Supabase JWT access.
- A student sees joined/owned groups and their own private tasks. Creating tasks, commenting, status updates, uploads, and downloads enforce access. Only the task creator can edit/delete a task; only the group creator can delete its group. Invite codes grant membership, so share them with intended members.
- PINs use salted scrypt hashes; older SHA-256 hashes upgrade at a successful login. Login attempts are limited per account (5 per 15 minutes) and per trusted Vercel IP (30 per 15 minutes); registration is limited per IP (10/hour). Rate limits live in Postgres so they work across serverless instances. A shared college network may hit the IP limit during a signup rush; stagger the initial rollout and tune limits using actual observations.
- College ID registration does not verify enrollment or ownership of the ID. The four-digit PIN has limited entropy. This cohort app has no automated account recovery, PIN change, or university SSO; handle recovery deliberately as the operator and do not collect sensitive university documents or official grades. Adding verified email/SSO is a separate product change.
- Attachments are limited to 4 MiB to stay below [Vercel's 4.5 MB function payload limit](https://vercel.com/docs/functions/limitations), including multipart overhead. Files use a private bucket and authorized download routes issuing 60-second signed download links. Old same-project public URL records are converted on access. Previously shared public links stop working after migration; links already copied while public cannot be recalled from third-party caches.
- Pending uploads carry a signed one-hour owner-bound ticket. A failed/abandoned task submission can leave an unattached Storage object. Deleting a task/group removes relational attachment records through foreign keys, but does not automatically delete its Storage objects. Periodically compare object paths with `task_attachments.file_url` and remove only confirmed unreferenced objects after at least 24 hours; retain a backup. Do not configure an unconditional bucket-wide age deletion.

## Verification

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm audit
npm run build
npm start
```

Tests cover sessions/PIN compatibility, route access and validation, upload tickets, lost drafts/auth races, push failures, quiet hours, and real PostgreSQL policies/functions using embedded PGlite. They use controlled dependencies and never contact your live database or send real notifications. PGlite serializes queries; it does not prove independent-connection Postgres lock contention, Vercel execution limits, or actual device delivery.

State fetching scopes SQL queries before loading related records, paginates beyond database page limits, and indexes child rows in memory once. Visible signed-in tabs refresh every 25 seconds and on focus; hidden/signed-out tabs do not poll. Changes made by another student may take up to 25 seconds to appear. One hundred visible tabs would generate roughly four state requests/second before user actions; this is an estimate, not a deployment benchmark.

On a separate staging database, create two accounts and test signup/login/logout, group creation/joining, task creation/edit/delete, comments, Done/skipped, private/group uploads and downloads. In account B, attempt account A's private task API and file URL: expect 403. Verify anonymous Supabase REST reads/writes are denied, `task-files` is private, and no private data appears after logout/account switching. Test a forced API failure and confirm the draft stays open. Check a phone-width viewport and desktop in both languages.

Load-test staging (never a shared live project without scheduling it): start at five concurrent student sessions, increase toward 20, mix reads and writes, and observe p95 latency, error rate, connection/CPU usage, Storage usage, and Vercel/Supabase quotas. Verify two simultaneous scheduler invocations do not duplicate claims, then test real push on the supported phones/browsers. Keep the first student rollout small until these checks pass.

## Operations and recovery

Monitor Vercel function errors/latency, repeated HTTP 503/429 responses, scheduler run failures, and Supabase database/Storage usage after rollout. Configure alerts in the hosting dashboards. The app sanitizes HTTP errors; use platform diagnostics for the underlying provider issue without logging PINs, cookies, subscription keys, or secrets.

Take a database backup before each migration and regular backups after launch, with a retention policy appropriate to your students' data. Export Storage separately. Restore into a fresh project and test before switching production credentials. Avoid rolling back to the old public-access code/schema: roll forward with a fix, or disable the deployment while restoring a verified backup. Rotating `SESSION_SECRET` invalidates existing sessions and pending upload tickets; students must sign in again. Rotating VAPID keys requires renewing browser subscriptions.
