# Decisions log

Plain record of what has been decided, so nothing gets lost. Newest at the bottom.

## Business (decided by Zahid)

- New independent company (being registered). Nothing reused from ARZ, except
  possibly an old school website design for the look.
- First customer: CBSE English-medium school, Nursery–Class 10, ~800 students,
  currently on paper + Excel.
- Timeline: ready Feb 2027, staff test alongside paper in March, live April 2027.
- Hosting: rented cloud servers.
- Price: free setup, under ₹1/student/day, billed every 3 months. Messages and
  the school website domain included.
- App notifications first; SMS/WhatsApp kept to a minimum (OTP codes must go by SMS).
- Online fee payment: an on/off switch per school (Razorpay; money goes to the
  school's own account). OFF for the first school, but built and tested anyway.

## Version 1 scope

Student records (Excel import), classes/sections, attendance, fees + receipts,
notices, parent app, report cards, principal dashboard. Real Play Store + App
Store apps (teacher + parent). Proper foundation with separate data per school.

## Product rules

- **Roles:** Owner and principal assign all roles. One person can hold many roles.
  - Built: roles are Owner, Principal, Office Admin, Accountant, Teacher, Parent.
  - Built: only the Owner can make someone an Owner or Principal.
  - Built: an Owner can't remove their own Owner role (so a school is never left without one).
- **Attendance:** principal chooses once-a-day OR every period (school setting).
- **Receipts:** never deleted. Staff can cancel; who, when and a required reason
  are always saved. *Built and enforced inside the database itself.*
  - Built: cancel reason must be at least 5 letters.
  - Built: receipt numbers look like `RC/2027-28/00001`, in order, no gaps, per school per year.
  - Built: receipts can't be edited either – a mistake = cancel + new receipt.
- **Teacher app** = teaching only (attendance, homework, marks, grades). Any
  admin roles a teacher also holds are used on the admin website. Same login for both.
- **Parents:** one phone number per family; all their children show together
  (even across different schools on our platform).
- **Login (parents and teachers):** OTP first time → set password → phone +
  password after that → forgot = OTP reset. Office can reset a login.
  - Built: passwords at least 6 characters, obvious ones (123456 etc.) refused.
  - Built: max 3 OTPs per phone per 15 minutes; OTP valid 5 minutes, 5 tries.
  - Built: 5 wrong passwords → locked 15 minutes.
  - Built: after a password change, all other phones are logged out.
  - Built: apps stay logged in for 60 days of non-use.
- **Report cards:** our design. Nursery/LKG/UKG = grades + comments; Classes 1–10
  = marks + grades. Subjects, exams and weightage adjustable by admin.
  - Built (database): CBSE 8-point grade scale (A1…E) and a pre-primary scale preloaded.
- **Fees:** fully set by admin – fee types, instalments, fines (flat or per-day,
  with a cap), discounts, concessions (each concession needs a reason and who approved it).
- **Principal dashboard:** today's attendance, fees this month, defaulters,
  teachers present, attention list, 6-month fee chart, quick actions.

## Technical decisions (made by Claude, explained)

- **One database, sealed per school** (PostgreSQL Row-Level Security) rather than a
  separate database per school: cheaper to run and update, and just as safe because
  the database enforces the separation, not our code.
- **Two database users:** an "owner" that only upgrades the database and creates
  schools, and a locked-down "app" user the server runs as. The app user physically
  cannot delete receipts, edit the audit log, create schools or switch off the sealing.
- **Logins are shared across schools** (a person = one phone number), and linked to
  each school separately with their own roles there.
- **Code lives in one folder ("monorepo")** so the server, website and apps always
  agree on the same rules.

## Admin website (7 Nov 2026)

- Excel import postponed (no file from the school yet); students can be added by hand meanwhile.
- A family's phone number can't be changed from the student form, because it is the parents' login.
  Changing it will be a separate, careful action later.
- A teacher with only the Teacher role who opens the admin website is told to use the teacher app.
- Look: "school register" style: ink-blue, ruled tables with a red margin line, green for main actions,
  marigold for things that need attention. Typeface: Atkinson Hyperlegible, chosen for easy reading.
- Staff who leave are made "inactive", never deleted, so their past records stay.

## Teacher app and attendance (7 Nov 2026)

- Only people with the **Teacher** role can use the teacher app. A principal who also teaches gets the Teacher role too.
- **Any teacher can take attendance for any class** (for covering absent colleagues); the record always says who took it.
  *Please confirm this is OK; it can be limited to assigned classes only.*
- Teachers can only take or change **today's** attendance. The principal/office can correct past days (screen coming on the website).
- Every child must be marked before saving. Options: Present, Absent, Late (counts as present), On leave.
- When a child is marked absent, parents get one "Absent today" app message per day. Saving again doesn't repeat it.
  If a child is later changed to present, the message may already have gone; we'll handle corrections when sending is built.
- App IDs are placeholders (`com.aiedu.teacher`) until the company name is final.

## Homework and attendance reports (7 Nov 2026)

- Any teacher can give homework to any class (same as attendance; will follow your decision on that).
  Only the teacher who gave it, or the principal/owner, can change or remove it.
- Each family gets **one** message per homework, even with two children in the class.
- In every-period schools, the **first period marked** each day counts as that day's attendance in reports.
- Monthly register: "Late" counts as present, "Half day" as half, "Leave" is not counted against the child.
  Percentage = present ÷ (present + absent). Below 75% is highlighted (CBSE's board exam requirement).
- The office/principal can correct attendance for past days on the website; their name is saved with the change.

## Still open

- Final product and company name.
- The new GitHub account username (nothing has been pushed anywhere yet).
- SMS provider for OTPs (needs DLT registration – see roadmap).
- Which cloud provider (e.g. DigitalOcean Bangalore, AWS Mumbai, Azure India) – decide by January.
