# Build plan: November 2026 → April 2027

## Done (6 Nov 2026)
- ✅ Database design for every Version 1 feature, sealed per school
- ✅ Server foundation: login flow, roles & permissions, school settings
- ✅ Fee receipts core: collect, number, cancel-with-reason, never delete
- ✅ 35 automatic safety checks, all passing

## Done (7 Nov 2026)
- ✅ Admin website: login, school chooser, menu that follows each person's roles
- ✅ Setup screens: school settings, subjects, classes & sections, class teachers, staff & roles
- ✅ Students added by hand, families linked by one phone number, brothers/sisters grouped
- ✅ 45 automatic checks passing; whole flow clicked through in a real browser, desktop and phone size
- ⏸ Excel import postponed until the school's file is available

## Done (7 Nov 2026, afternoon)
- ✅ Teacher app (Android + iPhone, one codebase): login, today's classes, attendance register
- ✅ Once-a-day and every-period attendance; covering another class; "Absent today" messages queued for parents
- ✅ 55 automatic checks passing; app clicked through at phone size against the real server

## Done (7 Nov 2026, later)
- ✅ Homework in the teacher app; one message per family
- ✅ Website attendance: school-wide day view, absent list with phone numbers, correcting past days, printable monthly register
- ✅ 64 automatic checks passing

## Done (7 Nov 2026, evening)
- ✅ Arscio brand applied to the website and teacher app (logo, colours, fonts, icons)
- ✅ School identity: logo, colour, short name, affiliation number
- ✅ Fees & receipts: setup, collection, printable receipts, concessions, cancelling, day book, defaulters
- ✅ 78 automatic checks passing; whole fee flow clicked through in a browser

## Done (7 Nov 2026, night)
- ✅ Notices on the website, delivered as app messages and phone notifications
- ✅ Arscio Parent app: children across schools, attendance calendar, fees and receipts, homework, messages,
  each school's own logo and colour inside; ready for per-school builds later
- ✅ 88 automatic checks passing

## Done (7 Nov 2026, late night)

- **New look** applied to the parent app, office website and teacher app (Peacock palette, glass,
  soft raised controls, ledger-style office pages, print-friendly receipts). New logo colours and app icons.
- Receipt numbers now include the month. Demo data script (`pnpm --filter @arscio/api demo`).

## Done (7 Nov 2026, late night, part 2)

- **Exams, marks and report cards**: exam setup and weightage, marks entry (teacher app and
  website), class teacher remarks, printable report cards, publish to parents, report card in the
  parent app. 10 new automatic checks (98 in total).

## Done (7 Nov 2026, late night, part 3)

- **Principal dashboard** and **staff attendance**. 5 new automatic checks (103 in total).

## Done (7 Nov 2026, late night, part 4)

- **Timetable, teacher leave and substitute cover**. 8 new automatic checks (111 in total).

## Done (7 Nov 2026, late night, part 5)

- Digital student file: photo everywhere, automatic admission numbers, Aadhaar last 4, document
  checklist per class, labelled documents with on-screen viewer, single or ZIP download, history.
- Next, in order: certificates (TC, bonafide, character, with printed or hand signature) and the
  admission and withdrawal register; moving to the new school year; the Excel import and export page.

## Done (8 Nov 2026)

- Certificates (transfer, bonafide, character) with printed or hand signature, filed in the student
  file, and the admission and withdrawal register. 5 new automatic checks (128 in total).
- Moving to the new school year: prepare, decide per student, start (report cards filed, roll
  numbers, leavers, fees), undo the same day. 5 new automatic checks (133 in total).
- Excel import and export page, with a new right the principal can give. 9 new automatic checks
  (142 in total).
- Next: public school website, online payments (Razorpay), servers and backups, security review,
  app store submission.

## Done (16 Nov 2026): getting ready for the first real school

- Logins without SMS (password mode): owner, principal-made staff logins by email or mobile,
  parents by admission number with the date of birth as the first password, forced change on first
  login, lockout, resets, "Remove access" for staff who leave, Parent logins page with missing
  dates of birth and printable login slips with an app QR code. 14 new automatic checks (157 in total).
- Exams set by the principal (dates, marks deadline, internal marks), one responsible teacher per
  subject, submit with a 7-day correction window, class tests, assignment submissions, parent Marks
  section. 12 new automatic checks.
- Results day: formula and pass rule per class, result date, marksheets with the principal's
  signature and a QR check, held marksheets confirmed by the principal, office class download,
  families told automatically. 10 new automatic checks (179 in total).
- 17 Nov: name chosen (Arscio) and logo; control panel (schools, health, activity), nightly backups,
  real-school mode with the arscio.in domain, "live" app builds. 188 automatic checks.
- Next: buy arscio.in, enlarge the disk, go live on the Curavo server for the first school
  (deploy/README.md section F); later a dedicated server for the market launch.

## Building, two weeks at a time

| When | What gets built |
|---|---|
| 7 – 20 Nov | ~~Admin website shell + login, setup screens~~ (done early). Next: timetable/periods, and Excel import once the school's file arrives. |
| 21 Nov – 4 Dec | ~~Teacher app, attendance, homework, attendance reports~~ (done early). Next: exams, marks and report cards; then the principal dashboard. Staff attendance still to do. |
| 5 – 18 Dec | ~~Fees~~ (done early, 7 Nov). |
| 19 Dec – 1 Jan | ~~Notices and parent app~~ (done early, 7 Nov). |
| 2 – 15 Jan | ~~Exams, marks, report cards~~ (done early, 7 Nov). Next: principal dashboard, staff attendance. |
| 16 – 22 Jan | ~~Principal dashboard~~ (done early, 7 Nov). Online payment (Razorpay) in test mode. |
| After report cards | ~~Timetable, teacher leave and substitute cover~~ (done, 7 Nov). |
| 23 Jan – 5 Feb | Cloud servers, daily backups, security review, App Store / Play Store submission. |
| Feb | Load the school's real data, train staff. |
| March | Staff use it alongside paper. Fix what they find. |
| April | Live. |

## Things only you can do – start these NOW (they take weeks)

1. **Company registration** – Apple, Google, Razorpay and SMS registration all
   go faster with a registered company.
2. **Apple Developer account (organisation)** – needs a D-U-N-S number for the
   company, which can take 1–3 weeks to get. Without it, no App Store.
3. **Google Play Console (organisation account)** – one-time fee; new accounts
   may need identity checks and app testing before going public.
4. **SMS DLT registration** (TRAI rule in India) – required to send OTP SMS.
   Needs company documents; allow 1–2 weeks.
5. **From the school, please collect:** their current student Excel file, current
   fee structure (all fee types, instalments, fines), a current report card, their
   period timings, and the class/section list.
6. **Tell me the new GitHub account username** so I can connect this code to it.
