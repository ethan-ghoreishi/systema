# Systema: one iPhone and Mac acceptance check

Allow about 20 minutes. Use only the disposable trip **ZZ Reliability test**.
This covers the remaining physical-device checks and recent Stops, Visited,
Moments and booking improvements. Parser edge cases, ZIP restoration, old PHP
receivers and database migrations are covered by automation; do not repeat them
with your travel records.

Use your normal Mac browser and the installed iPhone app. Keep the NAS reachable
on both devices, using your usual Wi-Fi or Tailscale connection. Settings must
already have your normal NAS configuration; no receiver changes are needed.
If sync reports a fault, stop the cross-device checks and keep the disposable
trip until the fault is understood. Do not clear browser storage or restore an
old backup to resolve it.

## 1. Update both devices and create the fixture on Mac (3 minutes)

- Open [Systema](https://ethan-ghoreishi.github.io/systema/) on Mac. Go back to
  the trips Home screen, then open **Settings**. After the release update has
  applied, **Version** should show this release's commit. Repeat in the installed
  iPhone app. Both must show the same version before continuing. If an old
  version remains, return to Home, leave the app and reopen it while online.
- On Mac, return to Home and choose **New trip → Day trip**. In Edit trip,
  enter **Bologna** in **Add a city**, then press the adjacent **+** (Add city).
  The Bologna leg should appear.
- Set **Arrival** to **5 November 2026, 09:00**, **Departure** to
  **6 November 2026, 19:00**, and the leg's time zone to **Europe/Rome**. Accept
  the suggested zone with **Yes**, or use **set the zone**. If doing this after
  6 November, use today's date for Arrival and tomorrow for Departure instead.
  Set **Custom name (optional)** to **ZZ Reliability test** and **Status** to
  **Active**, then press **Done**. Expect the named trip and four bottom tabs.
- Choose **Plan → Paste plan**, paste the following, then press **Done**:

  ```markdown
  # Bologna

  ## Route

  ### Piazza Maggiore

  Location: 44.4938, 11.3426
  Test square. Look for the arcade entrance.

  ### Archiginnasio

  Location: 44.4935, 11.3431
  Test courtyard.
  ```

- Choose **Stops → List → Extract 2 stops from the plan**. Expect Piazza
  Maggiore first and Archiginnasio second. Return Home, then **Settings →
  Backup → Sync now** on Mac. Expect a successful sync. Repeat **Sync now** on
  iPhone, return Home and open **ZZ Reliability test → Stops**. Expect both stops.

## 2. Google Maps handoff and return, in both iPhone modes (3 minutes)

- In the installed iPhone app, choose **Stops → List → Piazza Maggiore → Directions in Google Maps**.
  Google Maps should open directions to the saved pin in central Bologna.
  Do not start navigation. Return using the app switcher. Expect the same Stop
  detail, with Plan, Stops, Expenses and Export fully visible after the keyboard
  is closed. Opening Maps must not mark the Stop visited.
- In Stop detail, expand **Map location**. Expect latitude **44.4938** and
  longitude **11.3426**. Choose **Find by name instead**. Expect a Bologna-qualified
  search. Return to Systema, then use the header's **Stops** back button. Expect
  the list at the same place. Choose **Map**; the pins and lines represent the
  planned sequence, not walking directions.
- Open the same Systema URL in iPhone **Safari**. Safari and the installed app
  can have separate local storage. If the trip is missing, use Safari's
  **Settings → Sync now** first. Open **ZZ Reliability test → Stops → List** and
  repeat just the **Piazza Maggiore → Directions in Google Maps → return** handoff. Expect the entire
  tab bar above Safari's controls. Continue the remaining steps in the installed app.

## 3. Visited remembers visits without changing the plan (2 minutes)

- In **Stops → List**, mark **Archiginnasio** visited first, then **Piazza Maggiore**.
  Choose **Visited**. Expect Archiginnasio before Piazza Maggiore. Choose **List**;
  expect the original planned order, Piazza Maggiore first.
- Choose **Visited → Archiginnasio → Change visit time**. Set **Actual visit time**
  to **5 November 2026, 10:00** (or your fixture's Arrival date at 10:00), then
  **Save visit time**. Expect that time in Europe/Rome. Open **Change visit time**
  again and choose **Clear visit time**. Expect the Stop to stay visited, labelled
  **Visit time unknown**, without a numbered position among timed visits.
  Return using the header's **Stops** button.

## 4. Capture a real-camera Moment, dismiss the keyboard and resume (3 minutes)

- Tap the top sparkle button (**What happened?**). Enter **Courtyard music** in
  **Place or event** and **Keyboard and camera test** in **Why it mattered**.
  Expect **Now** and the current Bologna time without having to enter a date.
- Choose **Archiginnasio** under **Part of a planned stop?**, then **Take photo**.
  Photograph a harmless object and accept the photo. Expect **1 photo to add**
  and your typed text still present after returning from the camera. Press **Save**.
  Expect one Moment attached to Archiginnasio, without marking another place visited.
  Briefly turn on Airplane Mode with Wi-Fi off and open Archiginnasio's detail.
  Expect its note and saved test photo to remain available offline. Restore the network.
- Open **Stops → List → Piazza Maggiore**. Type **North arcade test** into **Notes**.
  Dismiss the keyboard with its Done control, or tap the heading. Expect **Saved ✓**
  briefly and the complete four-tab bar. Switch to another app for 10 seconds,
  return, scroll, and rotate the phone then back where the OS permits it. Expect
  no half-hidden icons or lost note. A portrait-locked installed app may stay portrait.

## 5. Historical Moments and truthful export (2 minutes)

- On iPhone, tap the pencil (**Edit trip**). Set Bologna **Arrival** to
  **16 October 2026, 09:00**, **Departure** to **17 October 2026, 19:00**, and
  **Status → Done**, then **Done**. This changes only the disposable trip.
- Tap **What happened?**, enter **An undated conversation**, then **Save** without
  opening the date controls. Expect **Event time unknown** under **Stops → Visited**.
- Open that Moment, choose **change → When did it happen? → Approximate date**,
  enter **16 October 2026** in **When**, then **Save**. Expect **Around Fri 16 Oct**,
  without an invented clock time. Reopen it, choose **change → Not sure when → Save**.
  Expect **Event time unknown** again.
- Choose **Export → Preview trip pack**. Expect this Moment explicitly untimed,
  Archiginnasio's visit time unknown, and the camera Moment keeping its original
  timestamp. Changing trip dates must not rewrite existing history.

## 6. A reservation, a decimal comma payment and one Expenses row (2 minutes)

- Open the pencil (**Edit trip**). Set **Departure** to **13 February 2027, 19:00**
  first, then **Arrival** to **12 February 2027, 09:00**. Set **Status → Planning**,
  then **Done**. Expect Before you go to return while the existing history stays intact.
  Choose **Plan → Before you go → Ticket out → Book it**. Enter
  **TEST-REF-1250** in **Booking reference**, leave **What it cost, for everyone**
  blank, then **Save**. Expect **booked**, with no new paid expense.
- Expand **… already sorted** if Ticket out has moved there. Open its **Price it** button.
  Set **Paid in → GBP** and paste **12,50** into **What it cost, for everyone**.
  Press **Save**. Expect **£12.50** recorded in Expenses, not £1,250.
- Choose **Expenses** and open the paid **Outbound flight** row. Expect **£12.5**
  in the amount display. Using the keypad, press **Delete** until it is empty,
  then **1 → 3 → . → 5 → 0 → Save**. Expect one paid row worth **£13.50**.
  Return to **Plan**, expand **… already sorted**, and open Ticket out with **Edit**.
  Expect **13.5** in its amount field. Press **Cancel**. Do not enter it a second time in Expenses.

## 7. The real NAS carries the changes and protects an open draft (4 minutes)

- On iPhone go Home, then **Settings → Backup → Sync now**. Expect success and no
  failed photo. On Mac, **Settings → Sync now**, then open the disposable trip.
  Expect the £13.50 payment, untimed Moment, visited Stop and photo to have arrived.
  If **Check NAS copy** is quick for your library, run it once; it should report
  no missing files. For a large library, leave the full check for later.
- On iPhone open **Stops → List → Piazza Maggiore**. Put iPhone into Airplane
  Mode with Wi-Fi off, leaving that detail open. Expect its saved note to remain
  visible offline. On Mac open the same Stop and change **Notes** to
  **Mac entrance correction**. Wait for **Saved ✓**, then go Home and
  **Settings → Sync now** on Mac. Expect a successful sync.
- Turn Airplane Mode off on iPhone and restore your normal Wi-Fi/Tailscale
  connection. Return to the same open Stop detail and wait 10 seconds. Coming
  back online schedules a sync. Keep the old draft on screen for the next action.
- Add **phone addition** to the old iPhone note. Once the remote correction has
  synced, expect **Autosave paused**, an alert that the field changed elsewhere,
  and your draft still visible. Copy it if wanted, then choose **Reload saved
  details (discards draft)**. Expect **Mac entrance correction**. If the remote
  change has not arrived, stop here and report the sync result rather than
  continuing to type. The automated suite separately verifies deletion while
  a detail remains open, so there is no need to reproduce that race manually.

## 8. Safe cleanup (1 minute)

- On iPhone leave the Stop, open the pencil (**Edit trip**), verify the title is
  **ZZ Reliability test**, then choose **Delete trip** and confirm.
  Expect only that disposable trip to disappear. Go **Home → Settings → Sync now**.
- On Mac run **Settings → Sync now**. Expect **ZZ Reliability test** to disappear.
  If you used iPhone Safari separately in check 2, sync there too. Leave all real
  trips, the NAS settings and existing backup files alone. The harmless test
  photo remains in the phone's Photos library if the camera saved it; remove
  that photograph separately only if you want to.

If anything fails, note the device, Safari or installed mode, Settings Version,
step number and exact message. For the clipped navigation fault, take a
screenshot before closing the app, including whether the keyboard was just open.
