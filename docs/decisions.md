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

## Brand and school identity (7 Nov 2026)

- Product name: **AIEdu**. Brand "Sprout A": Emerald #0E7C5F, Forest #0B2A22, Signal Gold #F5B700,
  Bright Emerald #19B984, Mint #E3EFE8, Mist #F3F8F5. Fonts: Sora (headings), Manrope (text).
- Everyone who works in the system (admin website, teacher app) sees **AIEdu**.
- Only what families see carries the **school's identity**: the school's public website, the parent app and later
  the student app (school name and logo inside), and receipts/report cards (school logo, name, colour,
  affiliation number, with a small "Powered by AIEdu"). *Assumed for receipts/report cards; tell me if different.*
- Store icons stay AIEdu: Teacher app = emerald icon, Parent app = gold icon (from the design export).
- School logos: PNG, JPG or WebP under 300 KB. SVG is refused because it can carry hidden scripts.

## Fees (7 Nov 2026)

- Setup is four steps: fee types, instalments (due date, grace days, late fine: none / once / per day with a maximum),
  amount per class per instalment, then "apply fees to students" (safe to repeat; only adds what's missing).
- Changing fees later only changes lines nobody has paid towards yet, and only if the box is ticked.
- **Late fine is per instalment, not per fee type.** The counter is shown the suggested fine and can reduce or waive it.
- Concessions: percent or rupees, on one fee type or all, always with a reason and who gave it.
  A concession never reduces a line below what's already been paid.
- Receipts: two copies on one A4 (parent's copy and office copy), amount in words in Indian style (lakh/crore).
- Defaulters = anything past its due date plus grace days, biggest amounts first.
- Fines are recorded on receipts but are not part of the "year billed / year collected" fee totals.

## Notices, messages and the parent app (7 Nov 2026)

- Notices go to: everyone, all parents, all staff, parents of chosen classes, or of chosen sections.
  Each family gets one copy even with several children in the audience.
- Notices are never deleted; they can be **withdrawn** (they disappear from apps; the record stays).
- Every message (notice, homework, "absent today") lands in the person's **Messages** in the app and is
  also sent as a **phone notification** (Expo's free push service). No SMS for these.
- "Absent today" is not sent if the teacher corrected the child to present before it went out.
- The parent app is **"AIEdu Parent"** (gold icon) for every school; inside it shows the selected child's
  **school logo, name and colour**. Parents with children in several schools switch between them.
- A school can later get **its own app build** (own name/icon in the stores, locked to that school) from the
  same code: one folder per school in `apps/parent-app/brands/`.
- Online fee payment in the parent app: shows "pay at the office" until it's built (Razorpay switch is ready).

## Still open

- Final product and company name.
- The new GitHub account username (nothing has been pushed anywhere yet).
- SMS provider for OTPs (needs DLT registration – see roadmap).
- Which cloud provider (e.g. DigitalOcean Bangalore, AWS Mumbai, Azure India) – decide by January.
