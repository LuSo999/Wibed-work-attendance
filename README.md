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
- **Setup wizard** (7 steps with examples and a live plan preview); the question mark in the top bar starts it any time.
- **Home screen shortcuts (Android):** Arrival, Departure and Compact overview; the lightweight views `?view=compact` and `?view=quick` also work offline.
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
js/onboarding.js      setup wizard
js/csv.js             CSV export
js/app.js             UI and screen logic
js/auth.js, js/store.js, js/firebase.js, js/theme.js, js/ui.js
tests/                unit tests (Node and browser)
scripts/make-icons.py PNG icon generator (app and shortcuts)
```

Data in Firestore:

- `users/{uid}/attendance/{YYYY-MM-DD}` → `{ type, arrival, departure, note, updatedAt }`
- `users/{uid}/overtimeBank/{id}` → `{ date, minutes, note, createdAt }` (bank withdrawals)
- `users/{uid}/settings/plan` → plan settings (see below)
- `users/{uid}/settings/app` → `{ language: 'cs' | 'en', czHolidays: true | false, onboardingDone }` (app settings)
- `users/{uid}/planOverrides/{YYYY-MM-DD}` → `{ absenceType, absenceHours, arriveAt, leaveAt, workedHours, clearFixed, anchorStrength, note }` (day exceptions;
  `clearFixed` = `'arrival' | 'leave' | 'both'`, `anchorStrength` = `'soft' | 'off'` (anchor relaxed for the day), `note` max. 200 characters – separate from the attendance note)

In an attendance record, `type` is the absence type. `absenceHours` (in hours, empty = whole day) marks a
partial absence and `filled: true` marks an automatically filled record.

The bank balance is never stored, it is always computed from the data, so it can never get out of sync. With **Carry overtime over between
months** turned off (⚙ Settings → Rules) only the current month counts (card "Overtime this month"); no data changes and the option can be switched back any time.

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
| `anchorStrength` | `hard` | anchor strength: `hard` = fixed (previous behaviour, also for settings without the field), `soft` = around (the anchor moves when the month cannot be balanced otherwise), `off` = no anchor (target hours only, see below) |
| `anchorTime` | 06:00 | anchor time (the older `startTime` is loaded as arrival) |
| `earliestArrival`, `latestDeparture` | 05:00, 17:00 | planner bounds in both modes – the moved end never crosses them |
| `coreStart`, `coreEnd` | 09:00, 14:00 | core working time (only for warnings and the minimum shortening) |
| `dailyFundHours` | 8 | daily hours, applies to the **whole app** (overtime, bank, monthly hours) |
| `maxWorkedHoursPerDay` | 10 | cap of worked hours on a regular day |
| `breakAfterHours`, `breakLengthMinutes` | 6, 30 | lunch break: for every full `breakAfterHours` of stay, `breakLengthMinutes` is deducted (0 = no break). Applies to the **whole app**. |
| `ruleVersions` | 1 version | history of calculation rules `[{ from, dailyFundHours, breakAfterHours, breakLengthMinutes }]` – every day is computed with the version valid on its date |
| `parityFlip` | false | swaps odd and even weeks |
| `carryOverOvertime` | true | carry overtime over between months: `false` = every month starts at zero (bank balance, zeroing on the Today card, withdrawals and time off in lieu only from that month's overtime). Older settings without the field = carry-over on. |
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

**Plan settings** (odd and even week schedule, anchor, core time, bounds, daily hours, break, public holidays and language) are in the
panel behind the gear **⚙ Settings** on the Plan page – a modal window on desktop, a bottom sheet on mobile. The panel has the tabs
**Schedule** and **Rules** (also operable with the arrow keys). Changes of daily hours, break and holidays go through the impact dialog (see History protection).

**Summary:** on mobile Projected, Deviation and Average are visible, the rest (Required, Worked, Plan remaining) after tapping "More figures".

**Anchor strength** (⚙ Settings → Rules, choice Fixed / Around / Off; a day exception takes precedence):

- **Fixed** (`hard`): the anchor never moves. With a surplus a regular day cannot be shorter than the stay `coreEnd` − anchor, so the plan
  may report "the month cannot be balanced".
- **Around** (`soft`): first the month is balanced by moving the other end of the day (as with a fixed anchor). If a remainder is left,
  a second pass moves the anchor end too, evenly in 15 min steps – with a surplus the arrival at the latest to `coreStart` (or the departure
  at the earliest to `coreEnd`), always covering the whole core time; with missing hours up to `earliestArrival` / `latestDeparture`.
  Such days get the `relaxed` flag and the "anchor moved" tag.
- **Off** (`off`): no anchor. Regular days only get target hours within limits: at least the worked time for the stay `coreEnd − coreStart`
  (minus the break by the rule, e.g. 08:00–14:00 = 6:00 stay → 5:30), at most `maxWorkedHoursPerDay` and the stay
  `latestDeparture − earliestArrival`. Instead of times the table shows the window "by HH:MM / from HH:MM" and the "no anchor" tag. Before
  arrival the Today card shows the window and target hours; after a recorded arrival it computes the departure from the actual arrival.
  Filling in attendance for past days still uses the anchor time.
- Days with fixed times from the schedule (e.g. a pick-up) and exceptions with fixed times or hours stay fixed in all modes.
- **Temporary relaxation:** "Relax the anchor for this day" (around / off) in the day dialog and in bulk with **Relax the anchor in a range…**
  (today's and future work days where the anchor sets an end of the day; undoable in one step).
- **Suggestion:** when the month cannot be balanced and relaxing the anchor would help, the Plan offers "The month cannot be balanced because
  of the fixed anchor. Relax it for the remaining days?" with a preview (how many hours get balanced, which days change). **Relax** creates
  `anchorStrength: 'soft'` exceptions for the remaining regular days (undoable in one step), **Keep** hides the notice for that month until
  the page is reloaded (nothing is stored). If relaxing does not help (only fixed days remain or even moving the anchor does not balance the
  month), the notice says so.

**Plan table:** columns Arrival, Departure, Plan (h) and Actual (h). Past days show actual times,
future days planned ones (italic, muted). Weeks are separated by a prominent header (week number, odd/even, date range) and rows have a
subtly different tint for odd (warm) and even (cool) weeks; the parity is always written as well (O/E badge), it does not rely on colour only.
Weekends stay visible but muted. Today is highlighted (outline and a "today" tag) and scrolled into view when the Plan page opens.
The state of a day (planned, fixed day, exception, missing record…) is shown by tags in the Type column.

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

**Day progress** (`dayProgress`), refreshed every 30 s:

- **The bar** shows the elapsed stay out of the planned stay (planned departure − arrival), 0–100 %, and never goes down over time.
  Without a planned departure it shows worked / goal and never drops below the last shown value of the same day.
- **The text "Worked X / Y"** follows the break rule from the settings, so at the interval boundary (6 h of stay by default) it drops by the
  break length. Below it a small note says, until the break is deducted, "A 0:30 break is deducted after 6:00 of stay (at 12:00)",
  afterwards "including a 0:30 break" (values follow the configured rule).
- **"to departure"** is the countdown to the planned departure.

**Undo:** the confirmation of a record is a small notice at the bottom (takes no space) with an **Undo** link that disappears after 8 s.
Undo restores the previous state of the day (or deletes the record if there was none).

**Sync status:** an icon with a label in the top bar – *Saved* (everything is on the server), *Waiting to send* (`hasPendingWrites` in the
Firestore snapshot metadata) or *Offline* (no connection; writes are stored on the device and sent later).

## Setup wizard

The wizard opens **automatically** only for a user who has **no** attendance records and has not finished or skipped it yet
(`settings/app.onboardingDone`). The existence of records is checked by **querying the server** (`getDocsFromServer`, not the cache); when
offline or on an error the wizard is not shown. It can be started **manually** any time with the **?** in the top bar (which also links to
the README in the current language).

Steps (Back / Next / Skip, step indicator, keyboard operable, Escape = skip):

1. Welcome and language choice (Czech by default); for a language other than Czech the question whether to turn off Czech public holidays (`czHolidays`).
2. Fixed arrival (the departure is computed) or fixed departure, and its time. **Examples** with a "Use this example" button prefill the settings
   (still editable): picking up a child from kindergarten at a fixed time on different days by week, commuting by a fixed train (fixed departure),
   regular working hours without fixed days.
3. Daily hours and the break rule with an explanation and default values.
4. Days with a fixed departure in odd and even weeks.
5. The odd/even week indicator and swapping it.
6. How to record arrival/departure and the shortcuts on Android.
7. Done, with a link to the Plan.

Steps with settings show a live plan preview computed by `plan.js` (`samplePlan`) on the sample month February 2027 without attendance.
The settings are saved only with Done; Skip only stores `onboardingDone`. If the user already has attendance, a change of daily hours or
the break from the wizard applies from today (older days are not recalculated).

## Shortcuts and compact views

A PWA on Android cannot offer real home screen widgets. Instead the app has **shortcuts** (long-press the icon on the home screen)
and lightweight views that can also be opened as separate browser bookmarks:

| Address | What it does |
|---|---|
| `./?action=arrive` | **Arrival** shortcut: records today's arrival at the current time with one tap and shows a confirmation with "Undo" |
| `./?action=leave` | **Departure** shortcut: the same for the departure |
| `./?view=compact` | **Compact overview** shortcut: only the Today card (arrival, plan, bank zeroing, countdown), the bank, the time field and the buttons, no navigation, ~360 px wide |
| `./?view=quick` | only the time field and the Arrival / Departure buttons |

- If today already has an arrival (or departure), the app asks before overwriting it. The record is written only after sign-in and loading the
  data, and the `action` parameter is then removed from the address so that a reload does not repeat it.
- The service worker caches these addresses (`SHELL` in `sw.js`, matched with `ignoreSearch` when the network is down), so they work offline;
  the records are sent once online.
- The shortcut names in the manifest are Czech (the manifest is not translated, see Language and holidays).

### Adding to the home screen and shortcuts in Chrome on Android

1. Open <https://luso999.github.io/Wibed-work-attendance/> in **Chrome** and sign in.
2. Menu **⋮ → Add to home screen → Install** (or the "Install app" prompt at the bottom of the screen).
3. On the home screen **long-press the Docházka icon** – the shortcuts **Příchod** (Arrival), **Odchod** (Departure) and **Kompaktní přehled** (Compact overview) appear.
4. A shortcut can be dragged to the home screen as a separate icon (long-press and drag), so recording an arrival is a single tap.
5. A lightweight view with just the buttons: open `…/Wibed-work-attendance/?view=quick` and add it via **⋮ → Add to home screen**
   (this creates a bookmark that opens the app directly in this view).

Shortcuts are read from `manifest.json` at install time; after a manifest change you sometimes need to uninstall and reinstall the app.

## Language and holidays

- The default language is **always Czech** (the browser language is not detected). The choice is stored in the browser (`localStorage`) and, for a
  signed-in user, in `settings/app`, so it applies on all devices.
- Texts live in the dictionaries `js/i18n/cs.js` and `js/i18n/en.js`. Plurals use `Intl.PluralRules`, dates, months, days and numbers use `Intl`.
  The pure modules (`calc.js`, `plan.js`, `csv.js`) never return texts, only messages `{ key, params }` translated by the UI.
- **The PWA manifest and the home screen name stay in Czech.** The manifest is a static file read by the browser at install time and it cannot
  be switched per user language without a build step or a server. Everything inside the app switches.
- **Czech public holidays** (`czHolidays`, on by default): when turned off, holidays count as regular work days (required hours, plan, overtime).
  On every language change the app asks "Turn off Czech public holidays?" (if they are on), and once after the first sign-in
  of a user who does not use Czech. The option is also in the settings (Plan → ⚙ Settings → Rules → App).
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
Every user can override them in **Plan → ⚙ Settings → Rules** – with a validity date (see History protection).
Czech public holidays (including the movable Good Friday and Easter Monday) are computed by `czechHolidays`; their names are
dictionary keys (`holiday.*`). Turning them on and off is controlled by `configureHolidays({ enabled })`.

## Icons

PNG icons are generated by a script without external libraries: `python3 scripts/make-icons.py`.
