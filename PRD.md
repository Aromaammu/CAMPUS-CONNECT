# PRD — Institute Live Learning & Communication Platform (version 1)

> **Working name:** *Campus Connect* (placeholder; see Decision D1)
> **Owner:** Institute Director (business owner) · **Product/Build:** Claude
> **Status:** Draft 1 · **Date:** 08-11-2026
> **Market:** India only · **Platform:** Web app only (works on laptops, tablets and phone browsers)

---

## 1. What we are building (in one paragraph)

A private web app for our technology training institute and its franchise branches. It replaces Google Meet / Microsoft Teams **and** the spreadsheets we use to run branches. Head office controls every branch from one place. Teachers run **live classes inside our own app** (no Zoom, Meet or Teams links). Attendance is captured automatically, recordings are kept for the batch, and chat, polls and a whiteboard work in the class. Students log in to see their courses, batches, timetable, attendance, performance, fees and final project. Staff and students message each other the way they would in Teams. Accounts staff record fee payments by hand and track what is collected and what is still due. The Director and Admins can compare how every branch is performing.

## 2. Goals for version 1

| # | Goal | How we know it worked |
|---|------|------------------------|
| G1 | Every live class runs inside our app | 0 classes need an outside meeting link |
| G2 | Attendance takes no teacher effort for online classes | ≥ 95% of online attendance marked automatically |
| G3 | Head office sees every branch's health on one screen | All 7 branch KPIs (§13) visible and up to date daily |
| G4 | Fee dues are never "lost" | Every enrolment has a fee plan, every payment a receipt |
| G5 | It holds up at our size | 200 live classes at the same time, 70+ branches, no failures in the load test |
| G6 | Built for growth | New modules can be added without rebuilding existing ones |

**Not in version 1** (we'll plan these in v2/v3): online payment gateway, parent login, homework/assignments, online quizzes, certificates, staff leave, enquiry/admissions CRM, AI class summaries, teacher scorecard as a separate module, mobile apps, breakout rooms, waiting room, selling the platform to other institutes.

## 3. Size we must support

| Item | Version 1 target |
|------|------------------|
| Branches | 70+ within 2 years (system tested at 100) |
| Students per branch live at one time | 30+ (a single class can hold up to 100; this is a setting) |
| Live classes at the same moment | **200** (hard cap, a setting) → about 6,000–8,000 people in classes at once |
| Recordings | Every online/hybrid class, kept 180 days by default |
| Region | All servers and data in India (Mumbai region) |

---

## 4. Who uses it (roles)

```
Super Admin (Director)
 └── Admins (each given one or more MODULES, across ALL branches)
      e.g. Academics Admin · People Admin · Monitoring Admin · Head of Accounts
           └── Branches (70+)
                └── Branch Admin (only their own branch)
                     └── Departments → Designations → Employees
                          (Teachers, Accountants, Counsellors, Other staff)
                          └── Students (enrolled in batches)
```

| Role | Sees | Can do |
|------|------|--------|
| **Super Admin** (Director) | Everything, every branch | Everything. Creates Admins and decides which modules each Admin controls. Only role that can change Super-Admin-level settings. |
| **Admin** | Only the modules given to them, but across **all** branches | Full control inside their modules (see §4.1). |
| **Head of Accounts** | All money data across all branches | An Admin with the **Accounts** module. Fee plans, payments, dues, collections, voids, reports. |
| **Branch Admin** | Only their branch | Runs the branch: departments, designations, employees, students, batches, timetable, rooms, enrolments, project final approval, help desk, branch reports. Requests new courses from head office. |
| **Teacher** (an employee) | Their own batches (in any branch they're assigned to) | Runs live/offline classes, marks and corrects attendance, uploads materials, gives feedback and performance marks, reviews final projects, chats with students. |
| **Branch Accountant** (an employee) | Their branch's money data | Records payments, prints receipts, follows up dues. |
| **Other staff** (an employee) | What their designation allows | Messaging, help desk tickets, and any screens the Branch Admin allows. |
| **Student** | Only their own data | Joins classes, sees attendance/performance/fees/materials/recordings, requests attendance correction, submits final project, chats with teachers/staff, raises help desk tickets. |

### 4.1 Admin modules (Super Admin assigns any combination)

| Module | What it controls (all branches) |
|--------|--------------------------------|
| **Branches** | Create/edit/close branches, assign Branch Admins |
| **Academics** | Course catalogue, course requests from branches, all batches, recordings |
| **People** | All employees, departments and designations templates, all students |
| **Accounts** | Fees, payments, dues, collections (= Head of Accounts) |
| **Monitoring** | Branch performance dashboards and reports |
| **Communication** | Announcements to branches, chat moderation |
| **Help Desk** | All help desk tickets, escalations |
| **Settings** | Branding, rules, notification templates, holidays |

### 4.2 Permission rules

1. **Every permission is checked on the server.** Hiding a button is never the only protection.
2. A Branch Admin can never see another branch's data, even with a direct link.
3. A teacher teaching in two branches sees both, but only their own batches.
4. A student can join courses in more than one branch. They have **one login** and see everything they're enrolled in.
5. Employees get permissions from their **designation** (e.g. "Senior Teacher", "Accountant"). Branch Admins can add or remove permissions from a set list.
6. Every important action goes into a permanent **audit log** (who, what, when, before/after).

---

## 5. Organisation set-up

### 5.1 Branches
- Fields: branch name, **branch code** (e.g. `KOC01`), address, city, state, PIN, phone, email, GST (optional), opening date, status (Active / Inactive).
- A branch has **rooms** (for offline/hybrid classes): name and capacity.
- A branch has its own **holiday list** on top of the head-office holiday list.
- Closing a branch keeps all its history (read-only).

### 5.2 Departments & designations
- Head office keeps **templates** (e.g. Departments: Academics, Accounts, Admissions, Admin; Designations: Trainer, Senior Trainer, Accountant, Counsellor, Front Office).
- Each branch starts with the templates and can add its own.
- Every designation carries a **permission set**.

### 5.3 Employees
- Created by the Branch Admin (or by People Admin for any branch). **Bulk add** from an Excel template.
- Fields: name, employee ID (auto, `EMP-<BRANCH>-<NNNN>`), email, mobile, department, designation, home branch, **extra branches** (for teachers who teach elsewhere), joining date, status.
- Employees get a welcome email/SMS with a set-password link.

### 5.4 Students
- Created by the Branch Admin (single or **Excel bulk upload** with a row-by-row error report).
- Fields: name, student ID (auto, `STU-<BRANCH>-<YY>-<NNNN>`), email, mobile, date of birth, address, guardian name & phone (stored only, guardians do not log in), ID proof (optional upload), photo (optional), status (Active / On hold / Completed / Dropped).
- A student is **enrolled** into a batch (§6.3). One student can have many enrolments, in any branch.

### 5.5 Logging in
- Login with **email or mobile + password**. A **one-time SMS code** login is also available (our existing SMS gateway).
- First login forces a password change. Forgot password by email or SMS link.
- Lockout for 15 minutes after 5 wrong passwords.
- **One active class connection per student**: if the same student joins from a second device, the first is disconnected. This stops shared logins.

---

## 6. Courses, batches and sessions

**Example:** *Python Full Stack (40 hours)* → *Morning Batch A, Mon–Fri 9–11 am, Online* → 20 sessions of 2 hours each.

### 6.1 Course catalogue (head office)
- Created by Academics Admin. Fields: name, code, category, **total hours**, syllabus (modules and topics), default fee, description, status (Draft / Published / Retired).
- **Branch course requests:** a Branch Admin can propose a new course. It goes to head office as **Pending**. Academics Admin can **Approve** (it joins the catalogue and is open to that branch, and optionally to all branches), **Reject** with a reason, or **Send back** for changes. The branch is notified each time.

### 6.2 Batches (branch)
- Created by the Branch Admin from a published course.
- Fields: batch name, course, **mode** = **Online** / **Offline** / **Hybrid**, teacher(s) (main + backup), start date, weekly days, start–end time, room (offline/hybrid), capacity, status (Upcoming / Running / Completed / Cancelled).
- The system **builds the session list automatically** from the days and times. It skips holidays and stops when the course hours are reached.
- Each session can be **rescheduled, cancelled, or given a substitute teacher**. Students are notified.
- **Clash check:** a warning appears if a teacher or room is booked twice at the same time.
- Hours tracker: *hours delivered / course hours* on every batch.

### 6.3 Enrolments
- Student + batch + enrolment date + **fee plan** (§11). Enrolments can be **moved** to another batch (history kept), **put on hold**, or **dropped** with a reason.

### 6.4 Timetable / calendar (feature 2)
- **Students:** all their upcoming sessions across all batches. Day / week / month view. Join button when the class is live.
- **Teachers:** all their sessions across branches.
- **Branch Admin:** the branch timetable by teacher, room or batch.
- Shows cancellations and reschedules clearly.

---

## 7. Live class module (our own, built into the app)

### 7.1 Joining
- The teacher can open the room **15 minutes before** the start time. Students can join from **10 minutes before** until the session ends.
- **Pre-join check:** camera, microphone and speaker test, name shown.
- **Who may enter (restrictions):** only students **actively enrolled** in that batch, the assigned teacher(s), and people the teacher or Branch Admin **adds as guests** for that session (e.g. a guest trainer or an observer from head office). Everyone else is refused. Admins with Academics or Monitoring can enter any class silently as **observers**.
- Works in Chrome, Edge, Firefox and Safari, on desktop and phone browsers.

### 7.2 In the class (version 1)
| Feature | Details |
|---------|---------|
| Video & audio | Teacher and students; layout switches between gallery and speaker view |
| Screen sharing | Teacher by default; teacher can let a student share |
| Whiteboard | Shared drawing board; teacher draws, can give a student the pen; board can be saved to the session's materials |
| Chat | Everyone in class; teacher can turn off student chat; chat is saved with the session |
| Polls | Teacher creates single/multiple choice polls (or uses saved ones); live results; teacher chooses whether students see results; results saved |
| Raise hand | Queue in order of raising; teacher lowers hands |
| Reactions | Thumbs up, clap, etc. |
| Teacher controls | Mute one/all, turn off a student's camera, stop student screen share, remove a student, lock the room, allow/disallow student mic and camera |
| Participants list | Who is in, who left, join time, connection quality |
| Attendance panel | Live attendance status for every enrolled student (§8) |
| Recording | Start/stop by teacher; **auto-record** switch per batch (default ON for online/hybrid) |

Not in version 1: breakout rooms, waiting room.

### 7.3 Staff meetings (Teams replacement)
The same meeting room is used for **staff meetings**. Any employee with permission can start an instant meeting or schedule one with chosen colleagues. Polls, chat, whiteboard and screen sharing are included. Attendance is not tracked; recording is optional.

### 7.4 Recordings
- Visible **only to students of that batch** (plus the teacher, Branch Admin and Admins with Academics).
- Watched in the app. **No download**. The player shows the viewer's name as a faint watermark.
- Kept **180 days** by default (setting). Deleted recordings can be recovered for 7 days.
- **Branch Admin** can rename, hide/show, replace or delete their branch's recordings. Academics Admin can do this for every branch. Every change is audited.

### 7.5 Scale and reliability
- Cap of **200 live classes at once** across the whole network. Room size cap of **100** per class. Both are settings.
- If someone's internet drops, the app reconnects them automatically. Their attendance time continues instead of restarting.
- If the class server restarts, everyone reconnects to the same room.

---

## 8. Attendance

### 8.1 How it is marked
| Class type | How attendance is marked |
|------------|--------------------------|
| **Online** | **(a) Automatic:** Present if the student was in class for **≥ 75%** of the session (setting). Late if they joined **more than 10 minutes** after the start (setting). **(b) Check-in:** the teacher can open a **"Mark your attendance"** window during class. Students tap *I'm present* within **2 minutes** (setting). The teacher decides per batch whether check-ins are **required** (Present needs both a + b) or **extra**. **(c) Manual:** the teacher can override any student, with a reason. |
| **Offline** | The teacher marks a roster on their phone or laptop (Present / Absent / Late / Excused). |
| **Hybrid** | Online students as above; in-room students on the roster. Each student is marked once. |

- Statuses: **Present, Late, Absent, Excused**.
- Attendance **locks 48 hours** after the session. After that, only an attendance request or a Branch Admin can change it.

### 8.2 Attendance requests (student → teacher)
1. A student who missed being marked (dropped connection, missed the check-in, etc.) opens the session and taps **Request attendance**. They choose a reason and can attach a screenshot. This is allowed **within 3 days** of the session (setting).
2. The teacher gets a notification and **Approves** (status becomes Present or Late) or **Rejects** with a reason.
3. If the teacher hasn't decided within **2 days**, it **escalates** to the Branch Admin.
4. The student is notified of the decision. Every request and decision is kept.

### 8.3 Attendance alerts
- If a student's attendance in a batch drops **below 75%**, the student and the Branch Admin are alerted (once a week while it stays low).

---

## 9. Learning: materials, performance, feedback, final project

### 9.1 Notes & materials
- Teachers upload files (PDF, slides, documents, images, zip; up to **100 MB** each, a setting) and links. They attach them to a **batch**, a **session**, or a **course module**.
- Students of that batch can view and download materials. Uploads can be shared with other batches of the same course.

### 9.2 Performance in each class
- For each session the teacher can give each student a **performance mark (1–5)** and a short remark (optional, quick-entry grid).
- The student sees their per-session marks and a running average per batch.

### 9.3 Feedback (two-way)
- **Teacher → student:** written feedback at any time, plus a structured feedback form at mid-course and end of course (ratings on understanding, practice, participation, punctuality, plus comments).
- **Student → session/teacher:** after each class a quick **1–5 star** rating with an optional comment, and a longer end-of-course feedback form. Student ratings feed the branch KPIs (§13). Teachers see averages, not student names (setting).

### 9.4 Final course project
1. When the batch has delivered all its hours (or the Branch Admin opens submissions), students **upload their project**: files, GitHub/online link and a description.
2. **Teacher review:** Approve, or **Request changes** with comments. The student resubmits, and every version is kept.
3. **Branch Admin final approval:** Approve, which marks the student's course **Completed**, or send back to the teacher.
4. Statuses: Not submitted → Submitted → Changes requested → Teacher approved → **Completed** (or Rejected).

---

## 10. Student portal (summary)

| Screen | Contents |
|--------|----------|
| **Dashboard** | Next class with **Join** button, today's timetable, attendance %, dues, unread messages, latest notices |
| **My courses** | Each enrolment: course, batch, mode, timings, teacher, hours progress, status |
| **Course / batch page** | Sessions (past/upcoming), join live, materials, recordings, polls taken, project |
| **Timetable** | Calendar of all sessions |
| **Attendance** | Per batch: %, per-session status, **Request attendance**, request history |
| **Performance & feedback** | Per-session marks, teacher feedback, give feedback |
| **Payments & dues** | Fee plan, instalments, payments made, **receipts (PDF)**, amounts overdue |
| **Final project** | Submit / resubmit, review comments, status |
| **Messages** | Chat with teachers/staff and batch group (§12) |
| **Help desk** | Raise and track tickets (§14) |
| **Profile** | Details, password, notification preferences, privacy |

**Reports a student can download (PDF):** attendance report, performance report, payment statement, dues statement.

## 11. Accounts (Head of Accounts + Branch Accountants)

### 11.1 Fees
- **Course default fee** set by head office. Branches can use it or set a **branch price** for a batch (Head of Accounts can lock this).
- **Fee plan per enrolment:** total fee, discount (amount or %, with reason; discounts above a limit, default 10%, need Head of Accounts approval), net fee, **instalments** (amount + due date), or one-time.
- No online payments in v1. **Payments are recorded by hand.**

### 11.2 Recording a payment
- Fields: student, enrolment, amount, date, method (**Cash / UPI / Bank transfer / Card (POS) / Cheque / DD**), reference number (required for non-cash), received by, note.
- The payment is applied to the oldest unpaid instalment first.
- A **receipt PDF** is created automatically with the number `RCPT/<BRANCH>/<YYYY>/<NNNNN>` (never repeated or skipped). It is emailed to the student and available in their portal.
- **Corrections:** a payment is never edited. It is **voided** with a reason, and voids need Head of Accounts approval. Refunds and adjustments are separate entries. Everything is audited.

### 11.3 What Accounts can see
- **Sales** (value of new enrolments), **collections**, **pending** (due, not yet late), **overdue**, **discounts given**, **refunds**. These can be shown by branch, course, batch, date range or payment method.
- Daily collection summary per branch. Day-close report showing cash by accountant.
- Dues list with **reminder** buttons (email/SMS). Automatic reminders **3 days before** and **on** the due date, then **weekly** while overdue.
- Export everything to **Excel**.

---

## 12. Messaging (the "Teams" part)

| Conversation type | Who |
|-------------------|-----|
| **1-to-1** | Student ↔ teacher/staff of their batches/branch · Staff ↔ staff (any branch) |
| **Batch group** | Created automatically per batch: teacher(s) + enrolled students. The teacher can make it "announcements only" |
| **Staff groups** | Any staff member with permission can create one (e.g. "KOC01 Trainers", "All Accountants") |
| **Announcements** | Head office → all/selected branches; Branch Admin → branch/batches; read-only, with read counts |

- Not allowed: **private student-to-student chat**.
- Text, emoji, **file and image sharing**, replies, edit/delete own message within 15 minutes, read receipts, typing indicator, unread counts, search.
- Start a **call / meeting from a chat** (uses the meeting room, §7.3).
- **Moderation:** Admins with the Communication module (and Branch Admins for their branch) can **review** conversations involving students and **hide** a message, with a reason. Moderation actions are audited. Students are told in the Terms that chats may be reviewed.
- Notifications: in-app and web push for new messages (not SMS/email, to avoid noise).

## 13. Monitoring branch performance (Super Admin & Monitoring Admin)

**KPIs, per branch and network-wide, with trends and comparison:**

| # | KPI | Definition |
|---|-----|------------|
| K1 | **Attendance %** | Present + Late ÷ expected, for all sessions in the period |
| K2 | **Enrolments** | New enrolments in the period (and their value = sales) |
| K3 | **Classes held vs scheduled** | Sessions held ÷ sessions scheduled (cancelled ones shown separately) |
| K4 | **Teacher punctuality** | % of sessions where the teacher started within 5 minutes of start time |
| K5 | **Feedback rating** | Average student rating of sessions/teachers |
| K6 | **Fees collected / pending / overdue** | From Accounts |
| K7 | **Drop-outs** | Enrolments marked Dropped ÷ active enrolments |

- **Network dashboard:** totals, a branch ranking table you can sort by any KPI, red/amber/green highlights (thresholds are settings), and trend charts.
- **Branch drill-down:** the same KPIs per batch and per teacher.
- **Live now:** how many classes are running, how many students are in them, and any class that should have started but hasn't.
- Every table exports to Excel. A **weekly summary email** goes to the Super Admin and Admins.

## 14. Help desk (feature 10)

- Students (and staff) raise a ticket: category (Class/Technical/Fees/Certificate/Other), subject, description, attachments.
- The ticket goes to its branch. The Branch Admin or the assigned staff member replies and changes the status: **Open → In progress → Waiting on student → Resolved → Closed**. The student can reopen within 7 days.
- **SLA:** first reply within **1 business day** (setting). After **3 business days** it escalates to the Help Desk Admin.
- Branch help desk numbers feed the monitoring dashboard.

## 15. Notifications

Channels: **in-app notification centre**, **web push** (browser), **email**, **SMS** (our existing SMS gateway, DLT-registered templates).

| # | Event | Who | Channels |
|---|-------|-----|----------|
| N1 | Account created (welcome + set password) | New user | Email, SMS |
| N2 | Password reset / OTP | User | Email or SMS |
| N3 | Class starts in 15 minutes | Batch students, teacher | Push, in-app |
| N4 | Class started (teacher joined) | Batch students | Push, in-app |
| N5 | Session cancelled / rescheduled / substitute | Batch students, teacher | Push, in-app, email, SMS |
| N6 | Attendance request submitted / decided / escalated | Teacher / student / Branch Admin | Push, in-app, email |
| N7 | Low attendance alert (< 75%) | Student, Branch Admin | In-app, email |
| N8 | New material uploaded | Batch students | Push, in-app |
| N9 | New recording available | Batch students | In-app |
| N10 | Feedback received | Student | In-app, push |
| N11 | Project submitted / changes requested / approved / completed | Teacher, student, Branch Admin | In-app, push, email |
| N12 | Fee due soon / due today / overdue | Student | Email, SMS, in-app |
| N13 | Payment received (receipt attached) | Student | Email, SMS |
| N14 | Void/discount needs approval | Head of Accounts | In-app, email |
| N15 | Course request submitted / decided | Academics Admin / Branch Admin | In-app, email |
| N16 | New message | Recipient | Push, in-app |
| N17 | Ticket created / replied / escalated | Branch staff / student / Help Desk Admin | In-app, email |
| N18 | Announcement | Audience | In-app, push (email optional) |
| N19 | Weekly network summary | Super Admin, Admins | Email |

- Users can switch **push and email** off for non-essential events. Security, fee and class-change messages always send.
- All message wording is editable in Settings. SMS wording must match the DLT-approved template.

## 16. Settings (Super Admin / Settings Admin)

Branding (name, logo, colours) · ID formats · attendance rules (75%, 10 min late, 2-min check-in, 48-h lock, 3-day request window, 2-day escalation) · live class caps (200 rooms, 100 per room) · recording retention (180 days) · upload limits · discount approval limit · fee reminder timing · KPI thresholds · help desk SLA · head-office holidays · notification templates · privacy and terms pages · grievance officer details.

## 17. Security, privacy and compliance (India)

- HTTPS everywhere. Passwords stored hashed. Sessions expire after inactivity (setting).
- Role and branch checks on every server request, with automated tests proving each role is refused what it must not see.
- Files are private and opened only through short-lived links after a permission check.
- **DPDP Act 2023 / DPDP Rules 2025:** privacy notice, consent recorded at first login, "delete my data" request (handled by Admin; fee and attendance records kept as the law requires), grievance officer details. Students under 18 need guardian consent (Decision D6).
- Audit log of logins, permission changes, attendance changes, money entries, recording changes, moderation and exports.
- Daily database backups, kept 30 days. Recordings and files stored in India.

## 18. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Speed | Pages load in < 2 seconds on a 4G phone. Joining a class takes < 5 seconds |
| Live class | Audio/video delay < 400 ms within India. The app adjusts quality on weak connections |
| Capacity | 200 concurrent classes × 40 participants, proven by a **load test** before launch |
| Availability | 99.5% monthly in the first year |
| Devices | Chrome, Edge, Firefox, Safari (latest 2 versions); phones from 360 px wide |
| Languages | English in v1 (screens built so more languages can be added) |
| Accessibility | Keyboard usable, readable contrast, captions-ready player |

## 19. Screens (every screen, with codes)

**Public:** P1 Login · P2 Forgot / reset password · P3 First-login set password + consent · P4 Privacy Policy · P5 Terms

**Super Admin / Admins (by module):** AD1 Network dashboard (KPIs) · AD2 Live-now monitor · AD3 Branches · AD4 Branch detail & performance · AD5 Admins & module access · AD6 Course catalogue · AD7 Course requests · AD8 All batches · AD9 All employees · AD10 All students · AD11 Department & designation templates · AD12 Recordings (all) · AD13 Announcements · AD14 Chat moderation · AD15 Help desk (all) · AD16 Reports & exports · AD17 Settings · AD18 Holidays · AD19 Audit log · AD20 Data deletion requests

**Head of Accounts / Accountants:** AC1 Accounts dashboard · AC2 Course & branch fees · AC3 Student fee ledger · AC4 Record payment · AC5 Receipts · AC6 Dues & reminders · AC7 Collections & sales reports · AC8 Approvals (voids, discounts) · AC9 Day-close report

**Branch Admin:** BA1 Branch dashboard · BA2 Departments & designations · BA3 Employees (+ bulk import) · BA4 Students (+ bulk import) · BA5 Enrolments · BA6 Batches & sessions · BA7 Branch timetable · BA8 Rooms · BA9 Course requests · BA10 Project approvals · BA11 Attendance overview & escalations · BA12 Recordings (branch) · BA13 Help desk · BA14 Branch reports

**Teacher:** T1 Dashboard (today) · T2 My batches · T3 Batch detail (students, sessions, materials, group chat) · T4 Session detail (attendance, performance, polls, chat log) · T5 Attendance requests · T6 Materials · T7 Feedback · T8 Project reviews · T9 My timetable

**Student:** S1 Dashboard · S2 My courses · S3 Course/batch page · S4 Timetable · S5 Attendance & requests · S6 Performance & feedback · S7 Payments & dues · S8 Final project · S9 Help desk · S10 Profile & privacy

**Shared:** C1 Messages · C2 Notification centre · C3 Pre-join check · C4 Live class room · C5 Recording player · C6 Staff meetings · C7 My profile & password

## 20. Build phases (version 1)

Each phase ends with the app working, all automated tests passing, and a **"what to check"** list for the owner.

| Phase | Name | What you can click through at the end |
|-------|------|---------------------------------------|
| 0 | **Foundation** | Login, role menus, look and feel, audit log, test setup, project hub |
| 1 | **Organisation** | Branches, rooms, departments, designations, admins & modules, employees, students, Excel bulk import, settings, holidays |
| 2 | **Academics** | Course catalogue, branch course requests, batches with auto sessions, enrolments, timetable calendar |
| 3 | **Live class: core** | Join a real class from two browsers: video, audio, screen share, chat, raise hand, teacher controls, entry restrictions, phone browser |
| 4 | **Live class: attendance, polls, whiteboard, recording** | Auto/check-in/manual attendance, offline & hybrid roster, attendance requests, polls, whiteboard, recordings with player & branch controls |
| 5 | **Learning portal** | Materials, per-session performance, two-way feedback, final project flow, student reports (PDF) |
| 6 | **Messaging & staff meetings** | 1-to-1, batch groups, staff groups, announcements, files, moderation, meetings from chat |
| 7 | **Accounts** | Fee plans, instalments, manual payments, receipts, voids/discount approvals, dues & reminders, collections reports |
| 8 | **Notifications & help desk** | Email, SMS, web push, notification centre, preferences; tickets with SLA and escalation |
| 9 | **Monitoring** | Network & branch KPI dashboards, live-now monitor, rankings, exports, weekly summary |
| 10 | **Hardening & launch** | Load test (200 classes), security review, India hosting, backups, legal pages, your acceptance test, go-live |

## 21. Acceptance checklist (summary)

- [ ] Every role logs in and sees only its own menu and data. Cross-branch access is refused (automated tests).
- [ ] A student enrolled in batches in two branches sees both. A teacher in two branches sees both.
- [ ] Batch sessions generate correctly, skip holidays and stop at course hours. Clashes are warned.
- [ ] A live class runs with teacher + 30 students (simulated) for 2 hours: video, screen share, whiteboard, chat, poll, raise hand all working.
- [ ] A non-enrolled student is refused entry. A guest added by the teacher gets in. A second device disconnects the first.
- [ ] Attendance is marked automatically. A check-in works. Offline and hybrid rosters work. An attendance request goes student → teacher → decision, or escalates.
- [ ] A recording appears for the batch only, can't be downloaded, can be renamed/deleted by the Branch Admin, and expires after the retention period.
- [ ] A final project goes student → teacher (changes requested → resubmit → approve) → Branch Admin → Completed.
- [ ] A payment is recorded and a receipt PDF with a correct, unique number is emailed. A void needs approval. Dues and reminders are correct.
- [ ] Messaging works 1-to-1, in batch groups and staff groups. Students cannot DM each other. Moderation is audited.
- [ ] All 7 KPIs match hand-calculated numbers on test data.
- [ ] The load test passes with 200 concurrent classes.
- [ ] The owner has clicked through every screen in §19 and signed off.

## 22. Decisions & open questions

Defaults are already built into this PRD. The owner confirms or changes them.

| # | Question | Default used |
|---|----------|-------------|
| D1 | Product name, logo and brand colours | "Campus Connect" placeholder, neutral blue |
| D2 | Attendance thresholds (75% present, 10 min late, 2-min check-in) | As stated |
| D3 | Recording retention | 180 days, no download, watermark |
| D4 | Discount approval limit | Above 10% needs Head of Accounts |
| D5 | Can teachers see which student gave which rating? | No, averages only |
| D6 | Do we have students under 18? (DPDP guardian consent) | Assume some: guardian consent checkbox for under-18s |
| D7 | Hosting budget: live video & recording servers for 200 classes cost real money monthly | Self-hosted on AWS Mumbai; exact estimate given in Phase 10 |
| D8 | Domain name for the app | Needed before Phase 10 |
| D9 | Email sending service (e.g. Amazon SES / Resend) | Chosen in Phase 8 |
| D10 | SMS: reuse our existing SMS gateway account and DLT templates? | Yes, the same gateway as our other projects |
| D11 | GitHub repository for the code | Needed before Phase 10 |
| D12 | A Linux test server for recordings (recordings can't be fully tested on this Windows machine) | Needed by Phase 4 |

## 23. Ideas for v2 / v3 (not committed)

Online payments (Razorpay/UPI) · parent view · homework & assignments · online quizzes & exams · completion certificates · staff leave & payroll links · enquiry/admission CRM per branch · AI class summary & notes from recordings · teacher scorecard · Android/iOS apps · breakout rooms & waiting room · QR-code check-in for offline classes · offering the platform to other institutes (multi-tenant).
