# Arscio server (on the Curavo AWS server) and Android apps

Addresses
- Office website: https://arscio.52-64-125-90.sslip.io
- For the apps:   https://arscio-api.52-64-125-90.sslip.io

## A. Put Arscio on the server (about 10 minutes)

On the Mac, in Terminal:

```
cd ~/Desktop/arscio
scp deploy/out/arscio-test.tar.gz ubuntu@52.64.125.90:~
```

Use the same login you use for Curavo. If you normally log in with a key file, add it the same way,
for example `scp -i ~/.ssh/YOUR-KEY.pem deploy/out/arscio-test.tar.gz ubuntu@52.64.125.90:~`.

Then log into the server and run:

```
tar -xzf arscio-test.tar.gz
cd arscio-test
sudo ./setup-arscio.sh
```

It shows 8 steps with a ✓ for each. At the end it prints the office website address and the
**test password** used by every demo login. It never touches Curavo's files or service, and checks
that Curavo is still running at the end.

Useful later:
- See all logins again: `sudo cat /opt/arscio/logins.txt`
- Is it running: `systemctl status arscio-api arscio-web arscio-control`
- Rebuild a fresh demo school: `sudo ./setup-arscio.sh --reset-demo`
- Update to a newer package (keeps data): copy and unpack the new package, run `sudo ./setup-arscio.sh`
- Remove Arscio completely: `sudo ./remove-arscio.sh`

## B. Build the Android apps (on the Mac, about 20 minutes each, mostly waiting)

```
cd ~/Desktop/arscio
pnpm build:android teacher
```

The first time it asks you to:
1. Log in to Expo with the company account (admin@arscio.in, team "arscios-team"). Your password is typed in Terminal; nobody else sees it.
2. Create the project on expo.dev: "Create a project", name **Arscio Teacher**, slug **arscio-teacher**,
   then paste the project ID it shows.
3. Say **yes** when asked to create an Android Keystore (the app's signing key, kept by Expo).

When the build finishes, Expo shows a download link. Then do the same for the parent app:

```
pnpm build:android parent
```

(name **Arscio Parent**, slug **arscio-parent**)

## C. Install on an Android phone

1. Open the download link on the phone, or send it on WhatsApp.
2. Tap the downloaded file. Android asks to allow installing from this source (Chrome or WhatsApp): allow it.
3. If Google Play Protect warns that the app is unknown, tap **More details → Install anyway**.
   It warns because the app isn't from the Play Store yet.
4. Open **Arscio Teacher** or **Arscio Parent**, log in with a demo mobile number and the test password.

## D. The control panel (only for us)

The control panel is where we add schools and watch the server. It is **not on the internet**: it
only listens inside the server, and you reach it through an SSH "tunnel" from your Mac (the same way
as the Curavo control panel, but on port 8102).

1. On the Mac, in Terminal (leave this window open while you use the panel):
   ```
   ssh -i ~/Projects/ARZ-licence-keys/curavo-cloud-key.pem -L 8102:127.0.0.1:4102 ubuntu@52.64.125.90
   ```
2. In the browser on the Mac, open **http://localhost:8102**
3. The password is on the server, readable only by an administrator:
   ```
   sudo cat /opt/arscio/control-password.txt
   ```
   To make a new one: `sudo ./setup-arscio.sh --new-control-password` (from the unpacked package folder).

What it has:
- **Health**: a plain summary at the top (everything working, or what needs attention), the services
  (running or not, since when, restarts), memory, disk, database size, backups, background jobs,
  crashes in the last 30 days, and server errors.
- **Schools**: onboard a school (school name, short code, board, owner's name, mobile and email, session).
  It shows a one-time password for the owner: give it privately; they must choose their own after
  logging in. Also: pause a school (nobody there can use Arscio until resumed; nothing is deleted),
  resume it, and give the owner a new one-time password.
- **Activity**: the last 14 days: people using Arscio, attendance taken, receipts, marks, messages, errors.

## E. Backups

Every night at 2:30 am (India time) the whole database is backed up to `/var/backups/arscio`
(the last 14 nights are kept). Photos and documents are inside the database, so they are included.
The control panel shows whether last night's backup worked.

- Make one now: `sudo /opt/arscio/arscio-backup.sh`
- Copy the newest one to the Mac (in Terminal on the Mac):
  ```
  scp -i ~/Projects/ARZ-licence-keys/curavo-cloud-key.pem "ubuntu@52.64.125.90:/var/backups/arscio/arscio-*.dump" ~/Desktop/arscio-backups/
  ```
  (first: `mkdir -p ~/Desktop/arscio-backups`, and on the server `sudo chmod o+r /var/backups/arscio/*.dump`
  is NOT needed if you use `sudo cp` to your home folder first: `sudo cp /var/backups/arscio/arscio-*.dump ~ && sudo chown ubuntu ~/arscio-*.dump`)
- Restoring is written at the top of `/opt/arscio/arscio-backup.sh`.

## F. Going live for the first school

1. **Disk**: in AWS (EC2 → Volumes), enlarge the server's disk from 20 GB to 40 GB (no downtime), then on
   the server: `sudo growpart /dev/nvme0n1 1 && sudo resize2fs /dev/nvme0n1p1` (check the name with `lsblk`).
2. **Domain**: at Hostinger (hPanel → Domains → arscio.in → DNS / Nameservers), add two records of type **A**: name `app` and name `api`,
   both with the value `52.64.125.90`. Wait 10-30 minutes.
3. Build a new package on the Mac (`pnpm package:server`), copy and unpack it on the server, then:
   ```
   sudo ./setup-arscio.sh --start-real --domain arscio.in
   ```
   This removes the demo school and test logins (asks you to type START), switches logins to
   passwords (no SMS), and moves Arscio to **https://app.arscio.in** (website) and
   **https://api.arscio.in** (apps). Curavo is not touched.
4. Open the control panel and **Onboard a school**. Give the owner their one-time password.
5. Build the apps for the real address (they talk to api.arscio.in and log in by password):
   ```
   pnpm build:android teacher live
   pnpm build:android parent live
   ```
