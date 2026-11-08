# CLAUDE.md — Campus Connect (working name)

The product spec is **[PRD.md](PRD.md)**. When this file and the PRD disagree on *what* to build, the PRD wins. This file decides *how*.

## 1. Who you are working with

- The owner is a **non-technical business owner**. They never read code. They judge the work by **clicking through the running app** and by reading the **Project Hub** artifact.
- Speak in plain business language: screens, buttons, what happens. Don't mention file names, stack traces or jargon unless asked.
- You are the **whole engineering team**: product, design, frontend, backend, QA, DevOps.
- Never ask the owner a technical question you can decide yourself. Decide, record it in the hub's **Decisions** tab, and carry on. Ask only for things only the owner has: money, accounts, credentials, legal facts, brand assets, business rules the PRD doesn't cover.

## 2. Working modes

The owner switches mode by saying **"supervised"** or **"unsupervised"** (also "go unsupervised", "run on your own", "auto mode"). Default: **supervised**.

### Supervised
1. Work through one **phase** (PRD §20) at a time.
2. At the end of the phase, run the quality gate (§7), update the hub, commit, and stop.
3. Give the owner a short **"what to check"** list: screens to open, logins to use, steps to try.
4. Wait for "approved / continue" or feedback before starting the next phase.

### Unsupervised
1. Run phase after phase **without stopping for confirmation**. Never stop just to ask "shall I continue?".
2. Within a phase, work **card by card** (hub cards). For each card: build → write tests → run the quality gate → fix until green → commit → set the hub card to Completed (or Ready for test if it needs the owner) → next card.
3. **Never move on with a failing test, type error, lint error, console error or broken screen.** Fix the root cause. Never skip, delete or weaken a test to get green. Never mark something done that isn't verified.
4. If something needs the owner (credentials, money, a business fact), **don't stop the whole run**. Build it behind a stub or test double, mark the card *Ready for test* with **"Waiting on you"**, add it to Decisions, and continue with other work.
5. Use the PRD defaults for every open question, and record each default you chose in Decisions.
6. At the end of each phase: run the **full** suite (unit + integration + E2E headless + visual walkthrough), make the checkpoint commit, and update and publish the hub. Then go straight on.
7. Stop only when (a) all phases are done, (b) everything left is waiting on the owner, or (c) a destructive or irreversible action would be needed (deleting data, spending money, publishing to production, pushing to a remote). Finish with a plain-language report.

## 3. Tech stack (decided)

| Layer | Choice | Why |
|-------|--------|-----|
| Language | **TypeScript** everywhere (strict) | One language, fewer bugs |
| Repo | **npm workspaces** monorepo | `apps/web`, `apps/api`, `packages/shared` |
| Web app | **React 18 + Vite + React Router + TanStack Query + Tailwind CSS + Radix UI primitives** | Fast, accessible, mobile-first |
| Forms/validation | **react-hook-form + zod**. Zod schemas live in `packages/shared` and are reused by the API | Same rules on both sides |
| API | **NestJS 11** (Express adapter), run with `@swc-node/register` | Module-per-feature structure, scales with new modules |
| Database | **PostgreSQL 16** via **Prisma** | Relational data (hierarchy, attendance, money); migrations |
| Background jobs | In-process scheduler + `JobRun` table (exactly-once keys) | No Redis needed; safe with several servers |
| Realtime (chat, notifications, live-class signals) | **Socket.IO** (Redis adapter in production only) | Rooms, reconnection |
| Live video | **LiveKit** open-source SFU, **self-hosted** (our own servers), `livekit-client` + `@livekit/components-react` | Our own meeting module, no third-party meeting service; scales horizontally to 200 rooms |
| Recording | **LiveKit Egress** (room composite) → object storage → HLS playback | Needs Linux/Docker: tested on the Linux staging server (Decision D12) |
| Whiteboard | **Excalidraw** (MIT), synced over LiveKit data channels | Open licence, no watermark |
| Files | Storage interface: **local disk in dev**, **S3-compatible (AWS S3 ap-south-1)** in prod; short-lived signed URLs | Data in India |
| PDF | **pdfmake** (receipts, reports) | Server-side, no browser needed |
| Excel | **exceljs** (bulk import templates, exports) | |
| Email | Nodemailer transport interface; **dev = captured to the DB "test mailbox" screen**; prod provider per D9 | Never sends real mail in dev/test |
| SMS | Our existing SMS gateway (same as other projects), behind an `SmsProvider` interface; dev = test mailbox | DLT templates |
| Web push | **web-push** (VAPID) + service worker | |
| Auth | Argon2 password hashes, short-lived JWT access token + rotating refresh token in httpOnly cookie | |
| Tests | **Vitest** (unit, web + api), **Supertest** (API integration on a real test DB), **Playwright** (E2E headless, Chromium with fake camera/mic) | |
| Lint/format | ESLint + Prettier | |

Don't add a library that duplicates one above. Before adding any new dependency, check that it's maintained and its licence is MIT/Apache/BSD.

## 4. Local environment (this machine)

- **Windows Server 2022**, Node 24, npm 11, Git. **No Docker, no system Postgres.**
- **Database in dev/test:** PostgreSQL 16 binaries from the `embedded-postgres` package, started through **pg_ctl** by `npm run db:start` (`tools/scripts/db.mjs`). pg_ctl is required because this machine runs as Administrator and `postgres.exe` refuses to start directly. Port **5433**, databases `cc_dev`, `cc_test`, `cc_e2e`. Data in `.data/pg` (git-ignored).
- `node tools/scripts/recreate-db.mjs cc_dev|cc_test|cc_e2e` rebuilds one local database (Prisma blocks `migrate reset` for AI agents, so use this instead).
- In Git Bash always `export MSYS_NO_PATHCONV=1` before passing URL paths like `/login` to scripts.
- npm 11 blocks install scripts: approve new native packages with `npm approve-scripts <pkg>` (kept in root `allowScripts`).
- **LiveKit in dev:** the `livekit-server` Windows binary in `tools/bin/` (git-ignored, downloaded by `npm run setup`), run with `--dev`. Recording (Egress) is **not available on Windows**: in dev, the recording service uses a fake that produces a sample video, so the rest of the flow (list, player, permissions, retention, delete) is fully testable. Real Egress is verified on the Linux staging server.
- One command starts everything: **`npm run dev`** (db + api + web + livekit). Web: http://localhost:5173 · API: http://localhost:3000 · LiveKit: ws://localhost:7880.
- `npm run seed` loads demo data: 3 branches, every role, courses, batches, sessions, students, fees. **Demo logins are printed and listed in `docs/demo-logins.md`.** Every password is `Demo@1234`.
- Quick visual check of one screen: `node tools/scripts/shot.mjs /path email@demo.cc 390 out.png dark`.
- Hub cards: `node tools/project-hub/set.mjs card "<title>" done` (see the file header for all commands).

## 5. Project structure

```
apps/
  api/src/
    common/            # auth guards, permission decorator, branch-scope, audit, errors
    modules/<feature>/ # one Nest module per feature: controller, service, dto, tests
  web/src/
    app/               # router, layouts per role, providers
    features/<feature>/# pages, components, hooks per feature
    components/ui/     # shared design-system components
packages/shared/       # zod schemas, permission keys, enums, types shared by web+api
prisma/                # schema.prisma, migrations, seed
e2e/                   # Playwright specs, fixtures, page objects
tools/project-hub/     # hub-data.json + build script for the Project Hub artifact
docs/                  # demo logins, decisions log, walkthrough output
```

Feature module names follow the PRD: `auth, org (branches, rooms, departments, designations), people (employees, students), admin-access, courses, batches, sessions, enrolments, timetable, live (rooms, tokens, polls, whiteboard), attendance, recordings, materials, performance, feedback, projects, accounts, messaging, announcements, meetings, notifications, helpdesk, monitoring, settings, audit, privacy`.

## 6. Rules the code must follow

1. **Authorisation on the server, always.** Every endpoint declares `@Permission('<module>.<action>')`. The **branch-scope guard** filters every query by the user's allowed branches. No endpoint may read data outside the user's scope. Each new endpoint gets an integration test proving that an unauthorised role **and** another branch's Branch Admin are refused.
2. **Permission keys** live only in `packages/shared/permissions.ts`. Roles are data (designations + admin modules), not `if (role === ...)` checks.
3. **Audit** every state-changing action listed in PRD §17 through `AuditService.record()` in the same transaction.
4. **Money:** amounts are stored as integer **paise**. Payments are never updated or deleted, only voided or reversed. Receipt numbers come from a DB sequence per branch per year, inside the payment transaction.
5. **Time:** store UTC and show **IST** (`Asia/Kolkata`). Dates in the UI are `DD-MM-YYYY`. Currency is `₹1,23,456` (Indian grouping).
6. **Every setting in PRD §16 comes from the Settings table.** No hard-coded thresholds.
7. **Concurrency:** use DB constraints and transactions for anything two people could do at once (approvals, receipt numbers, enrolment capacity, attendance decisions).
8. **Files:** check type by content, enforce size limits from Settings, store privately, serve only through signed URLs after a permission check.
9. **Live class:** LiveKit tokens are minted by the API only after checking enrolment, guest list and session window. Token grants match the role (students: no admin, publish limited by teacher settings). One active connection per student uses LiveKit identity = userId, so a second join replaces the first.
10. **Attendance** is computed from LiveKit webhooks (participant joined/left) stored as presence intervals, merged across reconnects. Never rely on the browser alone.
11. **Mobile-first UI:** every screen works at 360 px with no horizontal page scroll. Every list has empty, loading and error states. Every destructive action asks for confirmation.
12. **Copy:** buttons and messages in plain English, the same wording as the PRD.
13. No secrets in code. Use `.env` (git-ignored) with `.env.example` kept up to date.

## 7. Quality gate (run before marking any card done)

```
npm run typecheck      # tsc across all workspaces: 0 errors
npm run lint           # 0 errors
npm run test           # Vitest: shared unit + API integration (fresh cc_test DB + demo seed each run)
npm run e2e            # Playwright headless against `stack.mjs e2e` (ports 5174/3100, fresh cc_e2e DB)
```

- **Every feature ships with tests:** unit tests for rules, an integration test per endpoint (including permission refusals), and at least one **E2E user journey** per screen flow, run as the real role.
- **Live class E2E:** Playwright launches Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`, opens a teacher context and several student contexts, and asserts video tiles, chat, poll, raise hand, attendance marking and entry refusal.
- **Browser console:** the E2E fixture fails a test on any console error, page error or 5xx response (expected 4xx answers are allowed).
- **Visual check:** `npm run walkthrough` (screens listed in `e2e/walkthrough/screens.ts`: add every new screen) drives every screen of the finished phase for each role, saves screenshots (and a captioned video) to `docs/walkthrough/`, and **fails on any console error, failed network request or horizontal overflow at 360 px**. Look at the screenshots yourself before calling a phase done.
- **Load test (Phase 10):** a `k6`/LiveKit load-tester script simulates 200 rooms × 40 participants against staging.
- A bug found anywhere gets a test that reproduces it **before** it's fixed.

## 8. Git rules

- Two branches: **`development`** (all work) and **`production`** (live). **Never commit to or push to `production` directly.** It only changes by merging `development` after a review, and only when the owner says to.
- Make a **checkpoint commit** before starting each phase: `Checkpoint: before Phase N (<name>)`.
- Make one commit per finished card, with a plain-English message describing what changed for users, e.g. `Students can request attendance for a missed class`.
- Never commit `.env`, `.data/`, `tools/bin/`, recordings, uploads or walkthrough videos.
- Don't push to any remote until the owner provides the repository (Decision D11).

## 9. Project Hub (the owner's progress page)

- Data lives in **`tools/project-hub/hub-data.json`**: phases, cards, screens, decisions. **`npm run hub`** (`node tools/project-hub/build.mjs`) merges it with live Git info into **`tools/project-hub/project-hub.html`**, which is published as the Claude artifact **"Campus Connect Project Hub"**. The URL is stored in `hub-data.json → artifactUrl`. Always republish to that same URL.
- Card statuses: `planned` (later phase) · `notstarted` (next up) · `dev` (being built) · `test` (built and tests pass, needs the owner: always add `waitingOn`) · `done` (built, all gates green, committed).
- Update the hub **whenever a card changes status** (unsupervised: at least after every card and at every phase end; supervised: at the end of each piece of work). Then rebuild and republish.
- Card text is written for the owner: what they'll see, not how it's built.
- Every screen code in PRD §19 appears in the hub **Screens** tab with its status.

## 10. Definition of done (per phase)

- [ ] All cards in the phase are `done`, or `test` with `waitingOn`.
- [ ] Quality gate green; walkthrough screenshots reviewed; no console errors.
- [ ] Seed data shows the phase's features (the owner can click through right away).
- [ ] `docs/demo-logins.md` up to date.
- [ ] Hub updated and republished; phase-end commit made.
- [ ] A plain-language "what to check" list given to the owner (supervised) or included in the phase summary (unsupervised).
