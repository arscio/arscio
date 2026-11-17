# Arscio Parent app

Android + iPhone app (Expo / React Native). The store app is **"Arscio Parent"** with the gold icon,
and it serves every school. Inside, it takes on the **school's identity**: the selected child's school
logo, name and colour. A parent with children in two schools sees each school's look as they switch.

## What a parent sees

- **Log in** with the family mobile number (SMS code the first time, then their own password).
- **Home**: the school band (logo, name, colour) with a tab for each child, then:
  - **Attendance**: today's status and this month's numbers; opens a colour calendar for any month.
  - **Fees**: what's still to pay, what's overdue, each instalment, and every receipt (the receipt is
    shown as the school issued it). "Pay at the school office" for now; online payment arrives when the
    school switches it on.
  - **Homework**: the last 30 days, with subject, who gave it and the due date.
  - **Messages**: notices, homework and "absent today" alerts, newest first, unread ones highlighted.
- **Phone notifications** for the same messages (once the app is published through Expo's build service).

## A school's own app (later)

See `brands/README.md`. Copy `brands/arscio` to a new folder with the school's icon and name, set
`lockToSchoolId`, and build with `APP_BRAND=<folder>`. Same code, the school's own store listing.

## Try it on your phone

Same as the teacher app: install **Expo Go**, set `EXPO_PUBLIC_API_URL` in `.env` to your Mac's Wi-Fi
address, then `pnpm --filter @arscio/parent-app start` and scan the QR code.
(Notifications need the published app, not Expo Go.)
