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

## Building, two weeks at a time

| When | What gets built |
|---|---|
| 7 – 20 Nov | ~~Admin website shell + login, setup screens~~ (done early). Next: timetable/periods, and Excel import once the school's file arrives. |
| 21 Nov – 4 Dec | Attendance (once-a-day or per-period) + staff attendance. **Teacher app** first version: login, today's classes, take attendance. |
| 5 – 18 Dec | Fees: fee structure screens, generating dues, counter collection, **printable receipt PDF**, concessions, defaulters list. |
| 19 Dec – 1 Jan | Notices with app notifications. **Parent app** first version: children, attendance, fees due & receipts, notices, homework. |
| 2 – 15 Jan | Exams, weightage, marks/grades entry in teacher app, **report card design + PDF**. |
| 16 – 22 Jan | **Principal dashboard.** Online payment (Razorpay) in test mode. |
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
