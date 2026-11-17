# Arscio demo: try a whole school on your Mac and phone

This builds a full pretend school, **Green Valley Public School**, and runs the office website on your Mac
and the teacher and parent apps on your phone. Use it to act out a school day and find what needs fixing.

Password for **every** login: **Demo#2027**

---

## 1. One-time setup (about 15 minutes)

On the Mac:

1. **Node.js 22.13 or newer.** Open Terminal and type `node -v`. If it says v22.13 or higher, skip.
   Otherwise install it from <https://nodejs.org> (the "LTS" button) or with `brew install node@22`.
2. **A database.** Either:
   - **Docker Desktop** from <https://www.docker.com/products/docker-desktop/>, installed and open, or
   - **Homebrew** from <https://brew.sh>; the start script then installs PostgreSQL by itself.

On each phone you want to use (iPhone or Android):

3. Install **Expo Go** from the App Store or Google Play (free).
4. Connect the phone to the **same Wi-Fi** as the Mac.

## 2. Start the demo

Open **Terminal** and go to the project folder:

```
cd ~/Desktop/arscio
```

**Window 1: database, demo school, server and office website**

```
pnpm demo:start
```

The first time, it asks you to type `yes` (it wipes the local database and builds the demo school).
After a minute or two the office website opens at <http://localhost:3000>. Leave this window open.

- To start again later **without** wiping what you did: `pnpm demo:start --keep`
- To get a fresh demo school again: `pnpm demo:start` and type `yes`

**Window 2: teacher app** (Terminal menu, New Window, then `cd ~/Desktop/arscio`)

```
pnpm demo:teacher
```

**Window 3: parent app**

```
pnpm demo:parent
```

Each shows a QR code. On **iPhone**, point the Camera at it and tap the banner. On **Android**, open Expo Go
and tap "Scan QR code". The app opens inside Expo Go. To switch between the teacher and parent apps,
shake the phone and choose "Go home", then scan the other code. Two phones make it easier.

If macOS asks "Allow incoming network connections?" for **node**, click **Allow**.

## 3. Who can log in

### Office website (http://localhost:3000)

| Role | Name | Mobile | What they see |
|---|---|---|---|
| Owner | Zahid | 98765 43210 | Everything, both schools |
| Principal | Dr. Anjali Bora | 90000 00001 | Everything in Green Valley |
| Office admin | Pranjal Deka | 90000 00002 | Students, files, notices, Excel import and export |
| Accountant | Ritu Agarwal | 90000 00003 | Fees, receipts, fee reports |
| Teacher + accountant | Hemanta Baishya | 91000 00014 | Teacher app, and fees on the website |

### Teacher app

| Teacher | Mobile | Teaches | Class teacher of |
|---|---|---|---|
| Ruma Choudhury | 91000 00001 | All of Nursery | Nursery |
| Gitanjali Sarma | 91000 00002 | All of LKG | LKG |
| Dipankar Nath | 91000 00003 | All of UKG | UKG |
| Sabina Begum | 91000 00004 | English 1 to 3 | Class 1 |
| Moitri Das | 91000 00005 | English 4 and 5, EVS 5 | Class 5 |
| Pallavi Hazarika | 91000 00006 | Hindi 1 to 5 | |
| Jyoti Bora | 91000 00007 | Assamese 1 to 5 | |
| Anup Kalita | 91000 00008 | Mathematics 1 to 3 | Class 3 |
| Rashmi Goswami | 91000 00009 | Mathematics 4 and 5, EVS 4 | Class 4 |
| Nitumoni Deka | 91000 00010 | EVS 1 to 3 | Class 2 |
| **Rina Das** | 91000 00011 | English 6 to 8 | Class 6 (**on leave on the next school day**) |
| Farhan Ali | 91000 00012 | English 9 and 10 | Class 10 |
| **Bikash Roy** | 91000 00013 | Mathematics 6 to 8 | Class 7 (has a leave request waiting) |
| Hemanta Baishya | 91000 00014 | Mathematics 9 and 10 | |
| Tara Devi | 91000 00015 | Science 6 to 8 | Class 8 |
| Kaushik Medhi | 91000 00016 | Science 9 and 10 | Class 9 |
| Mridul Saikia | 91000 00017 | Social Science 6 to 10 | |
| Babita Thakuria | 91000 00018 | Hindi 6 to 10 | |
| Lakhimi Gogoi | 91000 00019 | Assamese 6 to 10 | |

### Parent app

| Parent | Mobile | Children |
|---|---|---|
| **Imran Hussain** | 98765 00011 | Arif (Class 6), Sana (Class 4), and Zara at a second school (Brahmaputra Valley Academy) |
| Rafiqul Ahmed | 98001 00074 | Sana (Nursery), Tanya (LKG) |
| Pradip Roy | 98001 00518 | Deepshikha (LKG), Debojit (Class 1) |
| Nurul Rahman | 98001 02072 | Tanmoy (Class 4), Riya (Class 8) |
| Gautam Saikia | 98001 00777 | Imdad (UKG) |
| Sanjib Paul | 98001 01110 | Barsha (Class 1) |
| Pankaj Sinha | 98001 02701 | Ishita (Class 6) |
| Mukul Roy | 98001 03108 | Ananya (Class 7) |
| Hemen Barman | 98001 03996 | Chayanika (Class 10) |

Every parent can log in. For any other family, open the student on the website: the family mobile number is
on their Details page, and the password is still Demo#2027.

## 4. What is already in the demo school

- Nursery to Class 10, one section each, **10 students per class (130 students)**, 115 families
  (some with two children here), 19 teachers, timetable with 6 periods Monday to Saturday.
- **Attendance** from 1 September to the last school day. A few students are below 75%, and one in Class 8
  has been absent 3 days in a row (the dashboard flags them).
- **Fees**: Term 1 (due 15 July) mostly paid, some half paid, some not paid (overdue); Term 2 due 15 November,
  about a third paid; Term 3 in February. Sana has a 10% sibling concession.
- **Exams**: Term 1 (Periodic Test 1 and Half Yearly; grades for Nursery to UKG) marked and **published**,
  so report cards are ready in the parent app. Term 2 exams are set up for later.
- Homework for the next school day, 4 notices (everyone, parents, Class 10, staff), past and pending leave.
- No school on Sundays and on 15 August, 2 October and Diwali (20 and 21 October).

## 5. Act out a school day

Do these in order on a **weekday**; on a Sunday the apps correctly say there is no school. Note
anything confusing in the table at the end.

**Morning, before 9:00**
1. **Principal** (website): Home shows "periods need a substitute": Rina Das is on leave. Open
   *Leave and cover*, give each of Rina's periods to a free teacher.
2. **Bikash Roy** (teacher app): open the app; a cover period appears on his Today screen if you gave him one.
3. **Principal**: approve or refuse Bikash's waiting leave request. Bikash gets a message.

**First period**
4. **Each class teacher** (teacher app): take attendance for their class. Try Tara Devi (Class 8); mark a few absent.
5. **Principal**: watch Home fill in: students present, classes done.
6. **Office admin**: *Staff attendance*, mark today's staff.
7. **Imran Hussain** (parent app): see that Arif is present today.

**During the day**
8. **A teacher**: give homework to one class. **Parent** of that class sees it.
9. **Accountant** (website): *Fees & receipts*, collect Term 2 fees for Arif, print the receipt.
   Imran's app shows it as paid. Try a part payment for another student.
10. **Accountant**: cancel a wrong receipt, with a reason.
11. **Principal**: send a notice to Class 6 parents only; check that Imran sees it and Nurul Rahman (Class 4 and 8) doesn't.

**Office work**
12. **Office admin**: add a new student with a photo; leave the admission number empty (it gets the next one).
13. Open the student's *Student file*, add a birth certificate (a phone photo of any paper is fine), view it, download it.
14. Issue a **bonafide certificate**; then issue a **transfer certificate** for another student and check
    *Students, Registers*.
15. *Excel import and export*: download the Class 5 students list; download the attendance register for
    Class 8 for this month; import a few students from your own Excel file.

**Exams**
16. **Bikash Roy**: Term 2 marks appear only once Periodic Test 2's date has come. For practice, the principal
    can change that exam's date in *Exams* to today, then Bikash enters marks for Class 7 Mathematics.
17. **Principal**: open *Report cards* for Class 6, print one; publish when ready. Parents see it.

**End of year (try it, then undo it)**
18. **Principal**: *New school year*, prepare next year, mark one student as leaving, start it.
    Look at a student's file: last year's report card is filed. Then click **Undo**.

## 6. Notes while testing

| # | Who (role) | Screen | What happened | What I expected |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |

## 7. If something goes wrong

- **The phone app says it can't reach the school / network error**: the phone and Mac must be on the
  same Wi-Fi; on the Mac allow "incoming connections" for node (System Settings, Network, Firewall).
  Office or guest Wi-Fi often blocks phones from talking to each other; a phone hotspot for the Mac works.
- **QR code doesn't open the app**: update Expo Go from the store (it needs the latest version).
- **"Port already in use"**: close the old Terminal windows, then start again.
- **Website shows an error**: look at the last lines of `.demo-logs/api.log` and send them to me.
- **Login asks for an SMS code**: the demo prints codes in Window 1 (look for "OTP").
