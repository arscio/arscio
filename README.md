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
| `apps/admin-web/` | **The admin website** for the owner, principal, office and accountant. | ⏳ Next |
| `apps/teacher-app/` | **Teacher app** (Play Store + App Store): attendance, homework, marks. | ⏳ Later |
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

There are 35 automatic checks (`apps/api/test/`) that try to break these
promises. All 35 pass.

## Main building blocks (and why)

| Piece | Choice | Why, simply |
|---|---|---|
| Database | **PostgreSQL** | Very reliable, free, available from every cloud provider; has the "sealed per school" feature built in. |
| Server | **Node.js + TypeScript** | One language across server, website and apps, so it's simpler to maintain. |
| Admin website | **Next.js** (planned) | Fast, standard, easy to host. |
| Phone apps | **React Native with Expo** (planned) | One codebase builds real Android and iPhone apps for the Play Store and App Store. |
| Passwords | **Argon2** scrambling | Passwords are never stored; even we can't read them. |
| Money | Stored as exact amounts (paise) | No rounding errors in fees, ever. |

## Running it on your Mac (when you're ready)

You need: **Node.js 22**, **pnpm**, and **Docker Desktop**.

```bash
pnpm install                       # download the building blocks
pnpm db:up                         # start a database on your Mac
cp .env.example apps/api/.env      # create your settings file (then edit JWT_SECRET)
pnpm db:migrate                    # build the tables
pnpm --filter @aiedu/api create-school -- --code DEMO --name "Demo Public School" \
     --owner-name "Zahid" --owner-phone 9876543210
pnpm dev:api                       # start the server at http://localhost:4000
```

During development, login codes (OTPs) are printed in the server window instead of being sent by SMS.

To run the safety checks you also need an empty test database named `aiedu_test`
(see `apps/api/test/global-setup.ts`), then `pnpm test`.
