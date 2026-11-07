# aiedu Teacher app

Android + iPhone app built with Expo (React Native). One set of code makes both apps.
Teaching only: today it does **login**, **attendance** and **homework**; marks come next.
Only people with the **Teacher** role can use it. Same mobile number and password as the school website.

## What a teacher sees

1. **Log in**: mobile number, SMS code the first time, then their own password.
2. **Today**: the date and their classes (class-teacher sections first), each showing
   "Not taken yet" or "Done: 38 present, 2 absent".
3. **Attendance register**: tap **Everyone present**, then tap **A** (absent), **Late** or **Leave**
   for the few who need it. The bottom bar counts as you go. **Save** only works when every child is marked.
4. If the school takes attendance **every period**, period buttons 1, 2, 3… appear at the top.
5. **Take attendance for another class**: for covering a colleague's class. Their name is saved with it.
6. **Homework**: choose the class (their own classes first) and subject, write it, pick Tomorrow / Day after /
   In a week / No date, and send. Every family in the class gets one message. "Homework I gave" lists the last
   two weeks; a teacher can remove their own (tap Remove, then tap again).
7. Parents of children marked absent are queued an "Absent today" message (sent once the parent app exists).

## Try it on your own phone (when you're ready)

1. Install **Expo Go** from the Play Store or App Store.
2. On your Mac, start the server (see the main README), then:
   ```bash
   cp apps/teacher-app/.env.example apps/teacher-app/.env   # put your Mac's Wi-Fi address in it
   pnpm --filter @aiedu/teacher-app start
   ```
3. Scan the QR code that appears with your phone's camera. Phone and Mac must be on the same Wi-Fi.

## Putting it on the Play Store and App Store (later)

Done with Expo's build service (EAS). Needs the Apple Developer and Google Play accounts.
The app IDs are placeholders (`com.aiedu.teacher`) until the company name is final.
