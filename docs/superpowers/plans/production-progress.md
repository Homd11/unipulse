# Progress — 2026-10-20-production-readiness.md

- User approved the fix plan and implementation here.
- Baseline: production build passed; no tests existed; lint required interactive configuration; npm audit found Next's nested PostCSS advisories.
- Working branch: codex/production-hardening. Existing checkout retained to honor implementation here; original main remains unchanged until integration.
- Independent domains: client and push fixes delegated under dispatching-parallel-agents; root owns server auth/access/state/task/file boundaries and schema.
- Shared API contract: ApiError, routeError, readJson, requireSession, requireDb, checkDb from src/lib/api.ts.
- Supabase schema changes prepared locally only; deployment and live database validation remain separate gates.
- Server boundaries complete: expiring/secure signed sessions, salted asynchronous PIN hashes + legacy upgrade, persistent account/IP throttle; group/task/file authorization and validation; owner-bound upload tickets and private download redirects; scoped/paginated state with no public directory or memory fallback.
- Database complete: idempotent transaction, browser grants/policies closed, storage private, service-only atomic limiter/task creation/reminder claims. Real SQL tests verify rollback, ACL, migration preservation, quiet hours and daily reminder recovery.
- Push complete: authenticated self-only subscription/send/manual reminder; secret scheduler; provider allowlist/timeouts/expired cleanup; five-send concurrency; configured timezone forwarded into atomic claims.
- Client complete: failed drafts preserved; checked saves; loading/error recovery; auth generation/order/cancellation; account-keyed modal drafts; visible signed-in polling; true push persistence/delivery feedback; best-effort cleanup cannot block cookie logout.
- Independent review found and reproduced two Important issues (push cleanup blocking logout, quiet-hour daily starvation) and one account-draft privacy issue; all fixed with RED/GREEN regression tests.
- Tooling: TypeScript/hooks ESLint, Vitest, PostgreSQL integration tests, CI, dependency patch override and tested dependency floors. npm audit reports zero known vulnerabilities.
- Local production smoke: page/manifest/service worker HTTP200; guest snapshot contains zero records; unauthenticated task/group/upload/push mutations HTTP401; private no-store API caching and nosniff confirmed. Inspected the signed-out interface in the in-app browser in Arabic/English.
- Launch still requires applying the reviewed migration, verifying unique environment secrets, configuring frequent scheduler, staged load/independent-connection tests, device push and backup/restore. No live changes or messages/notifications performed.
- Final root verification: npm test passed 107 tests across 10 files; npm run lint passed; npm run typecheck passed; npm audit reported 0 vulnerabilities; npm run build exited 0. First Load JS 134 kB versus 198 kB baseline. Build emits a nonfatal notice that the optional Next ESLint plugin is not configured; standalone TypeScript and React hooks ESLint is enforced separately in CI (the Next plugin dependency tree introduced unresolved audit advisories).
- Temporary browser tab and local production server closed after smoke verification. Changes saved on codex/production-hardening for user review; no merge/push/deployment performed.
