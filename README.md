**English** · [Čeština](README.cs.md)

# Wibed – work attendance tracking

**[▶ Open the app / Otevřít aplikaci](https://luso999.github.io/Wibed-work-attendance/)**

A single page app for recording arrivals and departures, tracking overtime and an overtime bank.
HTML + vanilla JS (ES modules), Firebase (Authentication + Firestore), TailwindCSS from a CDN.
**No build step and no dependencies.** Runs on GitHub Pages: <https://luso999.github.io/Wibed-work-attendance/>

## Features

- **Arrival / Departure** with one tap (two separate buttons). The time is prefilled with the current time and can be changed; another date,
  the day type, absence and note are in the collapsible **More** section. After recording, a short confirmation with an **Undo** link appears.
- **"Today" card:** planned arrival and departure, **bank zeroing** (when to leave so that the bank balance is 0), progress of the day
  towards the required hours with a countdown to departure, and the plan note.
- **Sync status** in the top bar: saved / waiting to send / offline (from Firestore metadata).
- **Rules:** 8 h per day. For every full 6 h of stay a 30 min break is deducted (`floor(stay / 6 h) * 30 min`).
  Every user can change the daily hours and the break in the settings.
- **Day types:** Work, Vacation, Sick leave, Doctor (credit 8 h, no overtime) and Time off in lieu (credits 8 h and takes 8 h from the bank).
- **Overtime bank:** sum of daily overtime (may be negative) minus withdrawals. Time off can be withdrawn by the hour, never above the balance.
- **Monthly overview:** required hours (work days × 8 h, without weekends and **Czech public holidays**), worked time, overtime, usage and editing of single days.
- Work on a weekend or a holiday has 0 required hours, so all worked time is overtime.
- **Attendance plan:** fixed departures for odd and even weeks. Other days are computed so that the month meets the required hours exactly (see below).
- **Partial absence** (e.g. 6 h work + 2 h doctor) and **fill in attendance** with one tap.
- **CSV export** of the displayed month (UTF-8 with BOM, semicolon – opens correctly in Excel).
- **Czech and English** (the default is always Czech), switch in the top bar, on the sign-in screen and in the settings; changes apply immediately without a reload.
- **Czech public holidays** can be turned off (e.g. when working abroad) – all calculations then behave as if there were no holidays.
- **History protection:** changing the daily hours, the break or the holidays shows the impact on the bank and closed days before saving.
- Dark and light theme (system default, the choice is remembered), **PWA** (install to home screen, offline shell, offline data thanks to the Firestore cache).

## Structure

```
index.html            app shell (all screens)
manifest.json, sw.js  PWA
firestore.rules       Firestore security rules
js/firebase-config.js ← PUT your Firebase configuration HERE
js/calc.js            pure calculations (rules in the RULES constant, holiday configuration)
js/plan.js            pure monthly plan calculations (ISO week, parity, deficit distribution)
js/i18n.js            translations: t(), setLanguage(), date and number formats via Intl
js/i18n/cs.js, en.js  dictionaries (key → text)
js/plan-view.js       UI of the Plan tab
js/csv.js             CSV export
js/app.js             UI and screen logic
js/auth.js, js/store.js, js/firebase.js, js/theme.js, js/ui.js
tests/                unit tests (Node and browser)
scripts/make-icons.py PNG icon generator
```

Data in Firestore:

- `users/{uid}/attendance/{YYYY-MM-DD}` → `{ type, arrival, departure, note, updatedAt }`
- `users/{uid}/overtimeBank/{id}` → `{ date, minutes, note, createdAt }` (bank withdrawals)
- `users/{uid}/settings/plan` → plan settings (see below)
- `users/{uid}/settings/app` → `{ language: 'cs' | 'en', czHolidays: true | false, onboardingDone }` (app settings)
- `users/{uid}/planOverrides/{YYYY-MM-DD}` → `{ absenceType, absenceHours, arriveAt, leaveAt, workedHours, clearFixed, note }` (day exceptions;
  `clearFixed` = `'arrival' | 'leave' | 'both'`, `note` max. 200 characters – separate from the attendance note)

In an attendance record, `type` is the absence type. `absenceHours` (in hours, empty = whole day) marks a
partial absence and `filled: true` marks an automatically filled record.

The bank balance is never stored, it is always computed from the data, so it can never get out of sync.

## Step-by-step deployment

### 1. Create a Firebase project

1. Open <https://console.firebase.google.com/> → **Create a project**.
2. Enter a name (e.g. `wibed-attendance`). Google Analytics is not needed.
3. On the project overview click the **Web `</>`** icon, enter an app nickname. **Do not** tick Firebase Hosting and confirm **Register app**.
4. The `firebaseConfig` object is displayed – keep it open (step 4).

### 2. Enable Authentication

1. In the left menu **Build → Authentication → Get started**.
2. **Sign-in method** tab:
   - **Email/Password** → Enable → Save.
   - **Google** → Enable → choose a *Project support email* → Save.

### 3. Create the Firestore database

1. **Build → Firestore Database → Create database**.
2. Choose a location (e.g. `eur3 (europe-west)`). The location cannot be changed later.
3. Choose **Start in production mode** (you replace the rules in step 5).

### 4. Insert firebaseConfig

1. **⚙ Project settings → General → Your apps → SDK setup and configuration → Config**.
2. Copy the values into [`js/firebase-config.js`](js/firebase-config.js) instead of the `YOUR_…` placeholders:

   ```js
   export const firebaseConfig = {
     apiKey: 'AIza…',
     authDomain: 'wibed-attendance.firebaseapp.com',
     projectId: 'wibed-attendance',
     storageBucket: 'wibed-attendance.firebasestorage.app',
     messagingSenderId: '1234567890',
     appId: '1:1234567890:web:abc…',
   };
   ```

   These values are not secret and may be in the repository. The data is protected by the Firestore rules and sign-in.
   While the config is missing, the app shows a screen with instructions instead of the sign-in.

### 5. Deploy firestore.rules

**Option A – in the console (simplest):** **Firestore Database → Rules**, paste the content of
[`firestore.rules`](firestore.rules) and click **Publish**.

**Option B – Firebase CLI:**

```bash
npm install -g firebase-tools
firebase login
firebase init firestore      # choose the existing project, rules file: firestore.rules
firebase deploy --only firestore:rules
```

The rules allow reading and writing only `users/{uid}/**` and only to the signed-in user with the same `uid`.

### 6. Authorized domains

**Authentication → Settings → Authorized domains → Add domain** → `luso999.github.io`.
(`localhost` is there by default, so local development works right away.)

### 7. Enable GitHub Pages

1. Commit and push the changes (including the filled `js/firebase-config.js`) to the `main` branch.
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Branch **`main`**, folder **`/ (root)`** → **Save**.
4. After a minute or two the app is available at <https://luso999.github.io/Wibed-work-attendance/>.

The `.nojekyll` file makes GitHub Pages serve the files as they are.

> **Updating the version:** the service worker loads the app's own files "network-first", so online users always get the current version.
> If you change the list of app files, update the `SHELL` array (and possibly `VERSION`) in `sw.js`.

## Attendance planning (Plan tab)

The plan is never stored. It is always recomputed from the settings, the exceptions and the actual attendance. The overtime bank does not
enter it, every month is balanced to zero on its own.

**Settings** (`settings/plan`, per user):

| Field | Default | Meaning |
|---|---|---|
| `anchorMode` | `arrival` | plan anchor: `arrival` = fixed arrival and the departure is computed/moved, `departure` = fixed departure and the arrival is computed/moved |
| `anchorTime` | 06:00 | anchor time (the older `startTime` is loaded as arrival) |
| `earliestArrival`, `latestDeparture` | 05:00, 17:00 | planner bounds in both modes – the moved end never crosses them |
| `coreStart`, `coreEnd` | 09:00, 14:00 | core working time (only for warnings and the minimum shortening) |
| `dailyFundHours` | 8 | daily hours, applies to the **whole app** (overtime, bank, monthly hours) |
| `maxWorkedHoursPerDay` | 10 | cap of worked hours on a regular day |
| `breakAfterHours`, `breakLengthMinutes` | 6, 30 | lunch break: for every full `breakAfterHours` of stay, `breakLengthMinutes` is deducted (0 = no break). Applies to the **whole app**. |
| `ruleVersions` | 1 version | history of calculation rules `[{ from, dailyFundHours, breakAfterHours, breakLengthMinutes }]` – every day is computed with the version valid on its date |
| `parityFlip` | false | swaps odd and even weeks |
| `schedule.odd/even.{1–5}` | empty | `{ arriveAt, leaveAt }` – optional fixed arrival and departure for a day of an odd/even ISO week. The older format (departure only) is loaded as `leaveAt`. |

**Day schedule and anchor:** an empty field on the anchor side is filled with the anchor, the other one is computed.

| Given | Mode "arrival" | Mode "departure" |
|---|---|---|
| nothing (regular day) | arrival = anchor, departure moves | departure = anchor, arrival moves |
| departure only | arrival = anchor → **fully fixed day** | departure fixed, arrival moves |
| arrival only | arrival fixed, departure moves | departure = anchor → **fully fixed day** |
| both times | **fully fixed day** | **fully fixed day** |

When switching the mode, the app shows what will change and converts the anchor time so that a regular day stays the same
(arrival 06:00 ↔ departure 14:30 with 8 h and a 30 min break).

A fixed departure before `coreEnd` or an arrival after `coreStart` is flagged with the warning "you are breaking the core working time".
It can still be saved, it is only a warning.

**Calculation:**

1. Work days are Mon–Fri without public holidays (if enabled). Days with closed attendance use the actual values. A whole-day absence is a fixed day with full hours.
   A past work day without a record counts as 0 h and is offered to be filled in.
2. A fully fixed day (both ends given by the schedule, an exception, the anchor or today's actual arrival) has worked = stay minus break.
   It is never extended. A partial absence on such a day happens inside the window and shortens the work block.
3. A regular day (one end fixed) has a base = daily hours − absence hours. Only the non-fixed end moves.
   If an actual arrival is recorded today, it is used instead of the planned one.
4. The deficit (required − actual − fixed days − bases) is spread evenly in 15 min steps over the regular days.
   Remaining steps go to days spread across the month, a remainder under 15 min goes to one day in the middle, so the month comes out exactly at zero.
   Caps (`maxWorkedHoursPerDay`, `latestDeparture` when moving the departure, `earliestArrival` when moving the arrival)
   spill hours to other days. If that is not enough, the plan shows how many hours are missing.
5. A surplus shortens the regular days evenly, at most to a departure at `coreEnd` (or an arrival at `coreStart` in departure mode).
   The rest is reported as a "surplus". Breaking the core time or the bounds with fixed times is only a warning.
6. Hours are converted to a departure using the smallest stay that gives the required hours. Because of the break, 6:00 h of work needs a 6:30 h stay
   (with the default break rule).
7. Parity is determined by the ISO week of each day separately, even when the week crosses a month boundary.

**Plan table:** columns Arrival, Departure, Plan (h) and Actual (h). Past days show actual times,
future days planned ones (italic, muted).

**Day exceptions:** tap today or a future day in the plan to set an absence (whole day or hours), a fixed arrival or departure,
fixed working hours, a plan note, or to **clear a fixed time from the schedule** for that day (arrival and departure separately). Past days
(and today once its attendance is closed) have no exceptions – their attendance is edited instead (`canEditOverride` in `plan.js`).

- End priority: actual arrival > exception (`arriveAt`/`leaveAt`) > schedule (unless cleared by `clearFixed`) > anchor.
  `clearFixed` only clears schedule times, not the anchor. A day with a cleared fixed time becomes regular and takes part in the deficit distribution
  (tag "no fixed departure").
- The departure must be after the arrival (otherwise the exception cannot be saved); a departure before the end of core time is only a warning.
- **Remove exception** deletes the document and the day returns to the schedule.
- **Clear fixed times in a range…** creates or extends exceptions (`clearFixed`) for today's and future work days in the range that have
  this fixed time in the schedule. The action can be undone in one step (Undo button); both the write and the undo are atomic.
- The plan note is shown in the plan row (expandable on mobile) and in the "Today" card on the main screen.

**Fill in attendance:** in the day dialog or in bulk in the plan (with a preview) sets the departure so that the day meets the required hours exactly.
Stay = the smallest stay for (daily hours − absence), 8:30 for a regular day. In arrival mode (or with a recorded arrival)
the departure is computed from the arrival, in departure mode the arrival is computed back from the departure.
The record gets the "filled" tag, which also appears in the CSV. Editing the times manually removes the tag.

## Main page (Overview)

At the top there is the overtime bank and the **Today** card, below it the time field and the two buttons **Arrival** and **Departure**.
Everything else (another date, day type, absence, note) is under **More**. When recording for a date other than today, a notice with a
link back to today is shown above the buttons.

**Bank zeroing** (`bankZeroing` in `plan.js`):

- goal worked time of the day = daily hours − absence of the day − bank balance (without today's unfinished day, including withdrawals);
  partial time off in lieu is drawn from the bank, so it is not subtracted from the goal,
- departure = arrival + the smallest stay for the goal according to the break rule,
- the arrival is the actual one, otherwise the planned one (marked "estimate"),
- positive balance → earlier departure, negative → "stay until HH:MM", goal ≤ 0 → "you can leave right after arriving",
- on a day with a fixed departure, "Bank after the planned departure: ±H:MM" is shown as well,
- crossing the bounds (core time, latest departure) is only a warning.

**Day progress** (`dayProgress`): worked time from the arrival until now (minus the break) out of the goal of daily hours − absence and a
countdown to the planned departure; refreshed every 30 s.

**Undo:** the confirmation of a record is a small notice at the bottom (takes no space) with an **Undo** link that disappears after 8 s.
Undo restores the previous state of the day (or deletes the record if there was none).

**Sync status:** an icon with a label in the top bar – *Saved* (everything is on the server), *Waiting to send* (`hasPendingWrites` in the
Firestore snapshot metadata) or *Offline* (no connection; writes are stored on the device and sent later).

## Language and holidays

- The default language is **always Czech** (the browser language is not detected). The choice is stored in the browser (`localStorage`) and, for a
  signed-in user, in `settings/app`, so it applies on all devices.
- Texts live in the dictionaries `js/i18n/cs.js` and `js/i18n/en.js`. Plurals use `Intl.PluralRules`, dates, months, days and numbers use `Intl`.
  The pure modules (`calc.js`, `plan.js`, `csv.js`) never return texts, only messages `{ key, params }` translated by the UI.
- **The PWA manifest and the home screen name stay in Czech.** The manifest is a static file read by the browser at install time and it cannot
  be switched per user language without a build step or a server. Everything inside the app switches.
- **Czech public holidays** (`czHolidays`, on by default): when turned off, holidays count as regular work days (required hours, plan, overtime).
  On every language change the app asks "Turn off Czech public holidays?" (if they are on), and once after the first sign-in
  of a user who does not use Czech. The option is also in the settings (Plan → Settings → App).
- A holiday change always applies **retroactively** to all dates, so the impact on the bank and the number of affected closed days is shown before saving.
- The CSV export has headers in the current language, a semicolon separator, UTF-8 with BOM and a decimal comma (Czech) or point (English).

## Running locally

```bash
python3 -m http.server 8000
# → http://localhost:8000/
```

The app cannot be opened directly from a file (`file://`), because ES modules and the service worker need an HTTP server.

## Tests

The calculation modules `js/calc.js` and `js/plan.js`, the CSV export and the dictionaries have unit tests without any dependencies.
The test `tests/i18n.test.js` checks that every key is in both dictionaries and that no hard-coded Czech text is left in the code or in `index.html`:

```bash
node --test          # Node.js 20+
```

Alternatively in the browser: start a local server and open <http://localhost:8000/tests/run.html> (without the dictionary test, which reads files).

## History protection when rules change

Changing the daily hours, the break rule or the public holidays would otherwise recalculate closed days and the overtime bank as well. Therefore a
confirmation dialog with the computed bank balance change (before → after) and the number of affected closed days opens before saving. You choose:

- **Valid from** (default today): a new rule version with a validity date is stored, older days keep using the original rules.
- **Retroactively for all dates**: the rules are overwritten for the whole history.

Without confirmation the change is not saved. An overview of rule validity is in the settings under the break. Holidays have no validity date
(they always apply retroactively), so the dialog only shows the impact.

## Changing the rules

The default break interval and length and the default daily hours are in one place, the `RULES` constant in [`js/calc.js`](js/calc.js).
Every user can override them in **Plan → Working time and plan settings** – with a validity date (see History protection).
Czech public holidays (including the movable Good Friday and Easter Monday) are computed by `czechHolidays`; their names are
dictionary keys (`holiday.*`). Turning them on and off is controlled by `configureHolidays({ enabled })`.

## Icons

PNG icons are generated by a script without external libraries: `python3 scripts/make-icons.py`.
