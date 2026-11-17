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
  - Built: receipt numbers look like `GV/2026-27/11/0142`: school code, session, month, then a running
    number that continues through the whole session (no restart each month), so no receipt can go missing unseen.
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
- App IDs are placeholders (`com.arscio.teacher`) until the company name is final.

## Homework and attendance reports (7 Nov 2026)

- Any teacher can give homework to any class (same as attendance; will follow your decision on that).
  Only the teacher who gave it, or the principal/owner, can change or remove it.
- Each family gets **one** message per homework, even with two children in the class.
- In every-period schools, the **first period marked** each day counts as that day's attendance in reports.
- Monthly register: "Late" counts as present, "Half day" as half, "Leave" is not counted against the child.
  Percentage = present ÷ (present + absent). Below 75% is highlighted (CBSE's board exam requirement).
- The office/principal can correct attendance for past days on the website; their name is saved with the change.

## Brand and school identity (7 Nov 2026)

- Product name: **Arscio**. Logo: the A monogram with the leaf (unchanged shape).
- (Replaced 7 Nov 2026 by the new look below; the old Emerald/Gold palette is retired.)
- Everyone who works in the system (admin website, teacher app) sees **Arscio**.
- Only what families see carries the **school's identity**: the school's public website, the parent app and later
  the student app (school name and logo inside), and receipts/report cards (school logo, name, colour,
  affiliation number, with a small "Powered by Arscio"). *Assumed for receipts/report cards; tell me if different.*
- Store icons stay Arscio: Teacher app = emerald icon, Parent app = gold icon (from the design export).
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
- The parent app is **"Arscio Parent"** (gold icon) for every school; inside it shows the selected child's
  **school logo, name and colour**. Parents with children in several schools switch between them.
- A school can later get **its own app build** (own name/icon in the stores, locked to that school) from the
  same code: one folder per school in `apps/parent-app/brands/`.
- Online fee payment in the parent app: shows "pay at the office" until it's built (Razorpay switch is ready).

## New look (7 Nov 2026, approved by Zahid)

- Light mode only. Palette "Peacock": Peacock #0B7FA6 (brand, buttons), Lagoon #22B3C4 (present, paid),
  Saffron #F2A33A (needs attention, the leaf), Sky #7FD3EE and Cloud #EEF4F7 (backgrounds, glass),
  Deep peacock #0B3B4C (text). Navy removed. Red only for errors.
- Fonts: Bricolage Grotesque (headings), Figtree (text).
- Parent app and public site: the "impressive" look. Soft colour glows, frosted-glass cards, a floating
  glass menu bar, raised buttons that press in.
- Office website: calm and easy on the eyes. A soft raised menu panel, white sheets, ledger-style tables
  with a pale saffron margin line, the student shown as an ID card, payment in a raised panel.
- Teacher app: same look as the parent app, Arscio branded (staff side).
- Student photos are round everywhere. The photo uploaded at admission appears automatically.
  (Uploading photos is added with the admission screen.)
- Receipts print with very little ink: white header, thin school-colour lines, outlined crest and
  "FEE RECEIPT" tag, a "PAID" stamp, and "Powered by Arscio" centred at the very bottom.
- App icons: teacher app = white A on peacock; parent app = white A on saffron; office = peacock A on white.

## Numbering (7 Nov 2026)

- Admission number is permanent for the student's whole time at school: school code / year joined /
  running number, e.g. `GV/2021/0187`. The principal sets the format; the system gives the next number;
  the admission office can type old numbers from paper records.
- Class, section and roll are a separate yearly label (e.g. "6 A, Roll 07") that changes on promotion.
- Receipt number: see Fees above (`GV/2026-27/11/0142`).

## Exams, marks and report cards (7 Nov 2026)

- The principal/owner sets up terms, the exams in each term, maximum marks, weightage and which
  classes write each exam (website, "Exams & report cards").
- Term score per subject = weighted average of that term's exams (weightage used as a proportion,
  so it still works if it doesn't add to exactly 100). Year score = average of the terms. Absent
  (AB) counts as 0. A missing mark leaves the score blank ("pending"); nothing is guessed.
- Grades from the school's scale (CBSE 8-point by default; Nursery/KG get grades only).
- Teachers enter marks in the teacher app only for subjects they teach in that class; the class
  teacher can enter every subject of their class and writes the report card remark.
- The principal can lock an exam's marks; after that only the principal can change them.
- Parents see a term's report card in the app only after the principal presses "Publish to
  parents". Each family then gets one app message.
- Printed report card: one A4 page per child, low ink like receipts, school identity on top,
  three signature lines (class teacher, principal, parent), "Powered by Arscio" at the bottom.

## Principal dashboard and staff attendance (7 Nov 2026)

- Home for the owner/principal is now the dashboard. It shows:
  - Four tiles: students present today, teachers present, fees collected this month, overdue fees.
  - "Needs attention": classes without attendance today, staff attendance not marked, students
    absent 3 days in a row, students below 75% this month, overdue fees, marks still to enter.
  - A 6-month fee collection chart and the largest overdue amounts.
  - Quick actions: collect fee, send a notice, staff attendance.
- Office staff still see the setup checklist on Home; the principal sees it as a small reminder until done.
- Staff attendance is marked once a day on the website by the office (everyone starts as present).
  It can be changed for today and the last 7 days, never for a future day.
- Fixed: a person who works at two schools saw their own entry from the other school on the staff
  list. Every staff list now shows only the current school.

## Timetable, teacher leave and cover (built 7 Nov 2026)

- Timetable (website, School setup, Timetable; principal/owner):
  - The school chooses how it repeats: the same every week (Mon-Sat, working days adjustable)
    or a Day 1..N cycle that moves on each working day from a chosen "Day 1" date.
  - Periods per day and bell times.
  - Each class has a grid of subject and teacher per period. A teacher can't be put in two
    classes at the same time.
  - One-off changes for a single date: "no classes" (holiday, exam or event day) or "follow
    another day's timetable". No-class days don't move the Day 1..N cycle on.
- Leave: teachers apply in the teacher app for a full day (one or more days), the first or second
  half, or chosen periods, with a reason. Leave can be applied for up to 3 days late. The owner and
  principal get an app message, approve or don't approve on the website ("Leave and cover"), and
  the teacher is told. A teacher can cancel pending leave, or approved leave that hasn't started.
- Cover: on approval, the teacher's periods for those days show as "needs a substitute". For each
  one the principal sees the teachers who are free then (not teaching, not covering, not on
  leave), least busy first, and assigns one with a tap. The substitute gets an app message and
  sees the period on their Today screen marked "Cover". If leave is withdrawn, the cover for it
  is removed.
- Attendance: a teacher can now take attendance only for their own classes (class teacher,
  subject teacher, or in the timetable) or a class they've been assigned to cover that day. The
  office can still mark any class on the website. The teacher app's "another class" button is gone.
- The dashboard's "Needs attention" shows periods needing a substitute today and waiting leave requests.

## Digital student file (built 7 Nov 2026)

- Website: Students, open a student, "Student file" tab. Only the office (students.manage) sees it;
  teachers see only the photo, name and roll number in their apps, never documents.
- Photo: taken or chosen at admission (or later from the file). It is shrunk to a small JPG and shows
  automatically on the ID card, receipts, report cards, the teacher app and the parent app.
  The photo link carries a secret signature, so apps can show it without anyone guessing other links.
- Admission number: given automatically when the box is left blank, in the format the principal sets
  in School settings (default GV/2027/0187 = school code / joining year / running number). Numbers run
  per joining year. A school moving from an old register can set "next number" to carry on.
  Numbers already typed in by hand are skipped. The office can still type one for older students.
- Aadhaar: only the last 4 digits are kept (shown as XXXX XXXX 4821). A copy of the card is optional.
- Documents: each one has a clear label made from its kind, the class where it applies and an
  optional note, e.g. "Previous school marksheet (Class 6)". Grouped as Admission documents, Report
  cards (newest year first), Certificates issued, Other. PDF, JPG or PNG up to 10 MB; big phone
  photos are shrunk before upload. The server checks what each file really is.
- View on screen without downloading (PDFs and photos open in a viewer), download one document,
  or download the whole file as a ZIP with folders.
- Nothing is ever deleted: "Replace" keeps the older copy under "earlier versions". The database
  itself refuses deletion of documents.
- Checklist: School settings has a table of documents against classes; the principal ticks what each
  class must bring. Defaults: birth certificate and parent's ID for all; previous school TC and
  marksheet from Class 2 up. Each student's file shows what is still missing.
- Files are stored inside the database, so they are sealed per school like everything else and are
  included in every backup.

## Certificates and registers (built 8 Nov 2026)

- From a student's file: "Issue a certificate" makes a transfer, bonafide or character certificate
  as a PDF, gives it a serial number (e.g. GV/TC/2026-27/0001; numbers restart each school year),
  saves it under "Certificates issued" in the file and opens it ready to print.
- The form fills in what Arscio knows: class, first admission and class, date of birth in words,
  working days and days present, fees still due (printed as "No" for dues paid), the next class.
  The office adds the reason for leaving, conduct, subjects and remarks.
- Transfer certificate: issuing it marks the student as left (or passed out if they finished the
  school's last class) from the leaving date, so they drop off attendance lists. Only one TC per
  student; after that only a "duplicate copy" with its own serial number.
- Bonafide only for students studying now; it can carry the student's photo.
- Signatures (School settings, "Certificates and signatures"): for each certificate the principal
  chooses a printed signature or signing by hand, and whether the principal or the owner/director
  signs. Printed signatures are uploaded once (photo of the signature, name and title). A signature
  in use can't be removed. Hand-signed certificates leave space above the line.
- Certificates follow the low-ink look of receipts: white header, outlined crest and title,
  "Powered by Arscio" small at the bottom.
- Students, "Registers": the admission and withdrawal register (every student ever admitted: admission
  number and date, name, date of birth, parents, address, class admitted, date of leaving, class
  left, reason, TC number), filterable by year of admission and studying/left, printable in
  landscape. A second tab lists every certificate issued.

## Moving to a new school year (built 8 Nov 2026)

- Website, School setup, "New school year" (owner and principal). Three steps:
  1. Prepare: name and dates are suggested (e.g. 2027-28, 1 April to 31 March). Sections are copied;
     optionally the same class and subject teachers, this year's timetable, and the fee structure
     (same amounts, due dates a year later). Classes that will receive students but have no section
     are highlighted; sections can be added. A prepared year can be removed until it starts.
  2. Decide: everyone moves up by default; students in the last class pass out. For exceptions,
     choose "stays" (same class next year) or "leaving". Choose the section where a class has more
     than one.
  3. Start: in one go, each student's report card for the year (published terms only) is made as a
     PDF and filed in their file ("Class 6 report card", 2026-27, with the result "Promoted to Class 7");
     students are placed in next year's sections with new roll numbers (alphabetical, or keep this
     year's order); leavers and passed-out students are marked; the new year becomes current; fees
     for the new year are created from the fee structure.
- Undo: the same day, as long as no attendance has been taken and no fees collected in the new
  year. Report cards already filed stay (they are not filed twice if the move is done again).
- Every move is recorded (who, when, how many moved, left, passed out).

## Excel import and export (built 8 Nov 2026)

- Website, School setup, "Excel import and export". Needs the new "Excel import and export" right:
  the owner and principal have it, and can give it to anyone on the staff (Staff & roles, Edit,
  "Login and access"). This replaces the one-time Excel import idea.
- Download: students and families (by class, studying or left), staff, attendance register for one
  class and month (P/A/L per day with totals), fees due and paid (plus one line per student),
  receipts between two dates, marks for a term (one sheet per exam), admission and withdrawal
  register, certificates issued, teacher leave. Fee downloads also need the fee reports right.
  Files have a coloured heading row, frozen headings, filters, proper dates and money.
- Import students and families, staff, or marks, from any .xlsx or .csv file:
  1. Choose the file. Title rows above the headings are fine; the headings are found automatically.
  2. Match the columns. Arscio guesses from the headings ("Name of Student", "Mobile No.", "D.O.B",
     "Sex", "Sec"...); the person checks and corrects.
  3. Check: every row is checked without saving anything, with plain reasons for each problem
     (unknown class, no such section, bad mobile number, impossible date, duplicate admission
     number). Then import: problem rows are left out; fix the file and import again later.
- What it understands: classes written as 7, VII, 7th, Class 7, 7A, VII-B; dates as 14/03/2013,
  14-03-2013, 14 Mar 2013 or Excel dates; mobile numbers with spaces, +91 or 0; gender as M/F/Boy/Girl.
  Brothers and sisters with the same mobile number become one family. Blank admission numbers get
  new ones. Only the last 4 digits of Aadhaar are kept. Students already in Arscio are skipped.
- Staff import also needs the right to give roles, and can't give roles the person can't give.
- Marks: choose the exam and class; download a sheet already listing the class's students and
  subjects, fill it in (AB for absent), import. Locked exams can't be imported into.
- Templates for students and staff, with an example row and a "How to fill" sheet.
- Every import is listed under "Past imports" and can be undone: students (until they have
  attendance, marks, fees or documents), staff (until they are used), marks (put back as before,
  unless the exam is locked).

## Logins without SMS (built 16 Nov 2026)

For the first real school there is no SMS (no DLT registration yet), so the server can run in
**password mode** (`LOGIN_MODE=password`). The old SMS-code flow still works with `LOGIN_MODE=otp`.

- **Owner:** we create the school and the owner login (`create-school --owner-email ...`); the
  script prints a one-time password once. The owner must choose their own after logging in.
- **Staff:** only the owner or principal adds staff. Each gets an optional email, their mobile
  number, and a first password the principal gives (the website makes an easy-to-read one and
  shows a printable slip once). Staff log in with the email **or** the mobile number. The first
  login goes straight to "Choose your own password"; nothing else works until that is done.
- **Forgot password (staff):** the principal gives a new one from Staff (they must change it again).
  A principal cannot change the owner's login or remove the owner.
- **Teacher leaves:** "Remove access" on Staff. They are logged out of every phone and computer at
  once; their records stay. "Give access again" undoes it.
- **Parents:** log in with the admission number, typed any way (GV/2027/0187, gv20270187). The first
  password is the child's date of birth as DDMMYYYY (05/08/2015 also works). Then they must choose
  their own; a date of birth can't be the new password. One login per family: any child's number
  works and all children appear. A child's date of birth can never open a staff member's login.
- **Wrong tries:** 5 wrong passwords lock the login for 15 minutes (for parents, also by admission
  number before their first login).
- **Forgot password (parents):** owner, principal or office uses "Reset to date of birth" on the new
  **Parent logins** page. That page also lists students with no date of birth (their parents can't
  log in yet) and prints **login slips**: 8 per A4 page, one per family, with a QR code to download
  the app (`APP_DOWNLOAD_URL`), or only for families not logged in yet.
- **Change password:** on the website menu and in both apps (My account); needs the old password and
  logs out other devices.
- Every reset or new password is written to the audit log.

## Exams, marks, class tests and assignments (built 16 Nov 2026)

- **The principal sets each exam:** which classes write it, first and last exam day, the date marks
  must be submitted by, and internal marks for the subjects that have them (e.g. written 80 +
  internal 20). Teachers see an upcoming exam in their app; marks open on the first exam day.
- **Who enters marks:** the teacher of that subject in that class. If two or more teach it, the
  principal picks one on the Marks tab (until then nobody can). If nobody teaches it, the class
  teacher does. The principal can always enter or correct marks.
- **Save and Submit:** "Save draft" is private. "Submit" needs every student to have marks or
  Absent; parents then see the marks at once, marked "Provisional, can change until <date>", and
  each family gets a message with their child's marks.
- **7 days to correct:** counted from the first submission. Every correction is recorded (old and
  new marks, who, when) and that family is told. Submitted marks can't be blanked. After 7 days the
  marks are final; the principal can reopen for 3 more days.
- **Late teachers:** shown on the Marks tab ("Late"), with a filter.
- **Class tests:** a teacher's own tests for a subject they teach (or any subject of their class as
  class teacher). "Publish" sends each family the marks. Shown to parents, never counted.
- **Assignments:** from the due day the teacher ticks Done / Late / Not for each child and sends the
  result to parents (once; after that a changed tick tells only that family).
- **Parent app:** a Marks section with every submitted exam subject and class tests, and
  "Handed in / Not handed in" on homework.

## Results day (built 16 Nov 2026)

- **For each class** (Results day tab) the principal chooses which exams count and how much: one
  exam only, all equally, or own weights (e.g. 10 / 30 / 10 / 50, used as proportions); the pass
  rule (minimum % in every subject and overall, 33/33 by default); and the result date. The same
  rules can be copied to other classes.
- **How it is worked out:** each exam's (written + internal) / (max) as a %, absent = 0; a subject =
  weighted average; overall = average of subjects; grade from the school's scale. A student with
  any mark missing gets no marksheet until it is entered.
- **Marksheets:** one A4 page: marks per exam, subject result and grade, overall, result, attendance,
  class teacher's remark, how the result was worked out, the principal's signature (uploaded in
  School settings) and a QR code with a code like K7Q2-M9XD-4TPA. Scanning it opens
  `<website>/verify/<code>`, which shows what the school issued (needs `PUBLIC_WEB_URL`).
  Remaking marksheets keeps each code.
- **On the result date** the server makes the marksheets by itself and tells every family whose
  marksheet is ready. Parents download it in the app (Marks screen).
- **Below the pass rule:** held. The family is told to meet the school. The principal confirms each
  one with an optional note printed on it ("Promoted on review", "Not promoted"); then the family
  gets it and is told.
- **Office:** downloads a whole class in one PDF, signed or blank to sign by hand (held ones are
  left out until confirmed).

## Name and logo: Arscio (decided 17 Nov 2026)

- The product is called **Arscio** (said AR-skee-o), from Latin *ars* (skill, craft) + *scio* (I know):
  "I know the craft". The company will have its own, different name.
- History: "Klasvi" was chosen first the same day but the board rejected it; "airedu" was dropped because
  "AIR EDUCATION" is already a registered trademark. The board wanted a name starting with "Ar".
- Checked: arscio.com is unregistered (official .com register) and a web search found no company or app
  called Arscio. IP India search (17 Nov): no "ARSCIO"; nearest marks in our classes are ARSCOR (class 9)
  and ARSCCOM (class 41), judged low risk. Bought arscio.in, arscio.com and arscio.online at Hostinger
  (17 Nov 2026). To do: file the trademark in classes 9, 41 and 42.
- Apps: "Arscio Teacher" (com.arscio.teacher) and "Arscio Parent" (com.arscio.parent).
- Logo: the original A with a new leaf is back. Teacher icon: Peacock with white A and gold leaf;
  parent icon: gold with white A and peacock leaf. Brand files are in packages/brand.
- Everything technical is named arscio too (renamed from the working name "aiedu" on 17 Nov 2026, before
  anything went on the server): project folder, packages (@arscio/...), database (arscio, arscio_owner,
  arscio_app), server folders (/opt/arscio, /var/backups/arscio), services (arscio-api, arscio-web,
  arscio-control, arscio-backup) and app slugs (arscio-teacher, arscio-parent).

## Trial hosting and the control panel (built 17 Nov 2026)

- **Trial on the Curavo server.** The first school (about 900 students, 35 teaching staff, 10 office staff;
  so roughly 1,000+ parent logins) runs on the existing Curavo AWS server next to Curavo, with memory
  limits so Curavo is never squeezed. Disk enlarged from 20 GB to 40 GB (17 Nov 2026, snapshot
  "before-arscio-resize" taken first). The setup adds a 2 GB swap file as a memory cushion.
- **Sized for that school (17 Nov 2026):** limits count per person, not per internet address, because the
  whole staff shares the school Wi-Fi and many parents share one Jio/Airtel address (login: 20 tries a
  minute per person; app use: 300 requests a minute per person). Database connections are budgeted
  (website/apps 12, background jobs 4, control panel 3, of the 30 PostgreSQL allows). Watch memory in the
  control panel on the first results day; if it runs tight, move to a bigger server (t4g.medium). A dedicated server comes with the market launch (and before the
  AWS credits end on 4 May 2027).
- **Real-school mode:** `setup-arscio.sh --start-real --domain arscio.in` removes the demo, switches logins
  to passwords (no SMS) and uses app.arscio.in (website) and api.arscio.in (apps).
- **Control panel** (only for the Arscio team): listens only inside the server (127.0.0.1:4102), reached
  through an SSH tunnel (`-L 8102:127.0.0.1:4102`), plus its own password (stored hashed; the plain
  password is in /opt/arscio/control-password.txt, root only).
  - Schools: onboard (school, classes, settings, owner login with a one-time password; email or mobile),
    pause / resume (staff and parents of a paused school see "This school's Arscio account is paused"),
    new owner password (logs them out everywhere). Usage per school: students, staff, families logged in,
    last used, file storage.
  - Health: plain-language warnings at the top; services, crashes (from the system log), server errors
    (every unexpected error is kept: time, page, message, school; no personal data), memory, disk,
    database size, backups, background jobs (phone notifications, results day).
  - Activity: 14 days of use, and everything done in the panel.
- **Backups:** every night at 2:30 am IST, the whole database (photos and documents are inside it) to
  /var/backups/arscio, last 14 kept, each checked by reading it back; the panel warns if a backup failed
  or is more than a day old. Tested: a backup restored into an empty database with all data.
  Still to decide: an off-server copy (e.g. weekly to the Mac, like Curavo).

## Still open

- Final product and company name.
- The new GitHub account username (nothing has been pushed anywhere yet).
- SMS provider for OTPs (needs DLT registration – see roadmap). Not needed to start: the first school uses password mode.
- Which cloud provider (e.g. DigitalOcean Bangalore, AWS Mumbai, Azure India) – decide by January.
