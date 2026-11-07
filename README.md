# aiedu (working name)

A school management platform: student records, attendance, fees and receipts,
notices, report cards, a principal dashboard, and two phone apps (Teacher and Parent).

First customer: a CBSE English-medium school, Nursery–Class 10, about 800 students.
Target: ready February 2027 → staff test it next to paper in March → live in April 2027.

---

## What's in this folder (in plain words)

| Folder | What it is | Status |
|---|---|---|
| `db/migrations/` | **The database design.** Every table, every rule. | ✅ Built and tested |
| `apps/api/` | **The server** – the "brain" every app talks to. Handles logins, checks permissions, saves data. | ✅ Foundation built and tested |
| `packages/shared/` | Rules shared by everything (role names, who can do what). | ✅ Built |
| `apps/admin-web/` | **The admin website** for the owner, principal, office and accountant. | ✅ Login + school setup screens built and tested |
| `apps/teacher-app/` | **Teacher app** (Play Store + App Store): attendance, homework, marks. | ✅ Login, attendance, homework built and tested |
| `apps/parent-app/` | **Parent app** (Play Store + App Store): all children, fees, notices, results. | ⏳ Later |
| `docs/` | Decisions and the build plan. | 📄 |

## The four promises the foundation already keeps (and proves with tests)

1. **Each school's data is sealed off.** The database itself refuses to show
   School A's data to anyone working for School B – even if our code had a bug.
2. **Receipts can never be deleted.** Not by staff, not by the app, not even by
   us with full database access. They can only be **cancelled**, and the database
   forces a **reason**, **who** cancelled, and **when** to be saved.
3. **Login works exactly as decided.** First time: OTP → set password. After
   that: phone + password. Forgot: OTP reset. Office can reset a login.
   Same for parents and teachers. 5 wrong passwords = 15-minute lock.
4. **Every important change is written in an audit log that can't be edited.**

There are 64 automatic checks (`apps/api/test/`) that try to break these
promises. All 64 pass.

## Main building blocks (and why)

| Piece | Choice | Why, simply |
|---|---|---|
| Database | **PostgreSQL** | Very reliable, free, available from every cloud provider; has the "sealed per school" feature built in. |
| Server | **Node.js + TypeScript** | One language across server, website and apps, so it's simpler to maintain. |
| Admin website | **Next.js** | Fast, standard, easy to host. |
| Phone apps | **React Native with Expo** | One codebase builds real Android and iPhone apps for the Play Store and App Store. |
| Passwords | **Argon2** scrambling | Passwords are never stored; even we can't read them. |
| Money | Stored as exact amounts (paise) | No rounding errors in fees, ever. |

## Running it on your Mac (when you're ready)

You need: **Node.js 22**, **pnpm**, and **Docker Desktop**.

```bash
echo "node-linker=hoisted" > .npmrc   # one-time: a setting the phone app needs
pnpm install                       # download the building blocks
pnpm db:up                         # start a database on your Mac
cp .env.example apps/api/.env      # create your settings file (then edit JWT_SECRET)
pnpm db:migrate                    # build the tables
pnpm --filter @aiedu/api create-school -- --code DEMO --name "Demo Public School" \
     --owner-name "Zahid" --owner-phone 9876543210
pnpm dev:api                       # start the server at http://localhost:4000
cp apps/admin-web/.env.example apps/admin-web/.env.local
pnpm dev:web                       # in a second window: the website at http://localhost:3000
```

Open http://localhost:3000, type the owner's number, and use the code printed in the server window.

## What the admin website can do today

- **Log in** with mobile number: code by SMS the first time, then a password; "Forgot password" works.
- **Home**: a checklist of the steps to get the school ready, ticking itself off as you go.
- **School settings**: school details, attendance once a day or every period, online payment on/off.
- **Subjects**: add the common CBSE subjects in one click each, or your own.
- **Classes & sections**: add sections, choose the class teacher, pick subjects per class, choose report card style.
- **Staff & roles**: add staff with one or more roles, make inactive, reset a forgotten login.
- **Students**: add by hand (Excel import later), search, filter by class, edit, mark as left.
  Type a family phone number that already exists and the child joins that family.

- **Attendance**: the whole school for any day (numbers per class, which classes haven't taken it,
  absent children with their parent's phone and how often they've been absent), correcting a past day,
  and the **monthly register** (every child, every day, totals and %, below 75% highlighted), printable on A4.

Fees, notices and exams show "coming in December/January" for now.

The website keeps logins in secure cookies that page code can't read, and every screen only shows what that person's roles allow.

During development, login codes (OTPs) are printed in the server window instead of being sent by SMS.

To run the safety checks you also need an empty test database named `aiedu_test`
(see `apps/api/test/global-setup.ts`), then `pnpm test`.
