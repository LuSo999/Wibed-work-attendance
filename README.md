# Wibed – evidence pracovní docházky

Single Page aplikace pro evidenci příchodů a odchodů, monitorování přesčasů a banky přesčasů.
HTML + Vanilla JS (ES moduly), Firebase (Authentication + Firestore), TailwindCSS z CDN.
**Bez build kroku a bez závislostí.** Běží na GitHub Pages: <https://luso999.github.io/Wibed-work-attendance/>

## Funkce

- **Příchod / Odchod** jedním klepnutím. Čas se předvyplní aktuálním, lze ho změnit a zapisovat i zpětně pro libovolné datum.
- **Pravidla:** fond 8 h/den. Za každých celých 6 h pobytu se odečte 30 min přestávky (`floor(pobyt / 6 h) * 30 min`).
- **Typy dnů:** Pracovní, Dovolená, Nemoc, Lékař (započtou 8 h, netvoří přesčas) a Náhradní volno (započte 8 h a odečte 8 h z banky).
- **Banka přesčasů:** součet denních přesčasů (mohou být i záporné) minus čerpání. Výběr náhradního volna po hodinách, nad zůstatek nelze vybrat.
- **Měsíční přehled:** fond (pracovní dny × 8 h, bez víkendů a **státních svátků ČR**), odpracováno, přesčas, čerpání a úprava jednotlivých dnů.
- Práce o víkendu nebo ve svátek má fond 0 h, celá odpracovaná doba je tedy přesčas.
- **Export CSV** zobrazeného měsíce (UTF-8 s BOM, středník – otevře se správně v Excelu).
- Tmavý a světlý režim (výchozí podle systému, volba se pamatuje), **PWA** (instalace na plochu, offline shell, offline data díky cache Firestore).

## Struktura

```
index.html            aplikační shell (všechny obrazovky)
manifest.json, sw.js  PWA
firestore.rules       bezpečnostní pravidla Firestore
js/firebase-config.js ← SEM vložte konfiguraci Firebase
js/calc.js            čisté výpočty (pravidla v konstantě RULES)
js/csv.js             export CSV
js/app.js             UI a logika obrazovek
js/auth.js, js/store.js, js/firebase.js, js/theme.js, js/ui.js
tests/                unit testy (Node i prohlížeč)
scripts/make-icons.py generátor PNG ikon
```

Data ve Firestore:

- `users/{uid}/attendance/{YYYY-MM-DD}` → `{ type, arrival, departure, note, updatedAt }`
- `users/{uid}/overtimeBank/{id}` → `{ date, minutes, note, createdAt }` (výběry z banky)

Zůstatek banky se neukládá, vždy se dopočítává z dat, takže nemůže vzniknout nesoulad.

## Nasazení krok za krokem

### 1. Vytvoření Firebase projektu

1. Otevřete <https://console.firebase.google.com/> → **Create a project** (Přidat projekt).
2. Zadejte název (např. `wibed-dochazka`). Google Analytics není potřeba.
3. Na přehledu projektu klikněte na ikonu **Web `</>`**, zadejte přezdívku aplikace. Firebase Hosting **nezaškrtávejte** a potvrďte **Register app**.
4. Zobrazí se objekt `firebaseConfig` – nechte si ho otevřený (krok 4).

### 2. Zapnutí Authentication

1. V levém menu **Build → Authentication → Get started**.
2. Záložka **Sign-in method**:
   - **Email/Password** → Enable → Save.
   - **Google** → Enable → vyberte *Project support email* → Save.

### 3. Vytvoření databáze Firestore

1. **Build → Firestore Database → Create database**.
2. Zvolte umístění (např. `eur3 (europe-west)`). Umístění nelze později změnit.
3. Zvolte **Start in production mode** (pravidla nahradíte v kroku 5).

### 4. Vložení firebaseConfig

1. **⚙ Project settings → General → Your apps → SDK setup and configuration → Config**.
2. Zkopírujte hodnoty do [`js/firebase-config.js`](js/firebase-config.js) místo placeholderů `YOUR_…`:

   ```js
   export const firebaseConfig = {
     apiKey: 'AIza…',
     authDomain: 'wibed-dochazka.firebaseapp.com',
     projectId: 'wibed-dochazka',
     storageBucket: 'wibed-dochazka.firebasestorage.app',
     messagingSenderId: '1234567890',
     appId: '1:1234567890:web:abc…',
   };
   ```

   Tyto hodnoty nejsou tajné a smí být v repozitáři. Data chrání pravidla Firestore a přihlášení.
   Dokud config chybí, aplikace místo přihlášení zobrazí obrazovku s instrukcí.

### 5. Nasazení firestore.rules

**Varianta A – v konzoli (nejjednodušší):** **Firestore Database → Rules**, vložte obsah souboru
[`firestore.rules`](firestore.rules) a klikněte na **Publish**.

**Varianta B – Firebase CLI:**

```bash
npm install -g firebase-tools
firebase login
firebase init firestore      # zvolte existující projekt, rules soubor: firestore.rules
firebase deploy --only firestore:rules
```

Pravidla povolují čtení a zápis pouze do `users/{uid}/**` a jen přihlášenému uživateli se stejným `uid`.

### 6. Authorized domains

**Authentication → Settings → Authorized domains → Add domain** → `luso999.github.io`.
(`localhost` je tam ve výchozím stavu, lokální vývoj tedy funguje hned.)

### 7. Zapnutí GitHub Pages

1. Commitněte a pushněte změny (včetně vyplněného `js/firebase-config.js`) do větve `main`.
2. Na GitHubu: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Branch **`main`**, složka **`/ (root)`** → **Save**.
4. Po minutě až dvou je aplikace na <https://luso999.github.io/Wibed-work-attendance/>.

Soubor `.nojekyll` zajistí, že GitHub Pages servíruje soubory tak, jak jsou.

> **Aktualizace verze:** service worker načítá vlastní soubory „network-first“, takže online uživatelé vždy dostanou aktuální verzi.
> Pokud změníte seznam souborů aplikace, upravte pole `SHELL` (a případně `VERSION`) v `sw.js`.

## Lokální spuštění

```bash
python3 -m http.server 8000
# → http://localhost:8000/
```

Aplikaci nelze otevřít přímo ze souboru (`file://`), protože ES moduly a service worker vyžadují HTTP server.

## Testy

Výpočetní modul `js/calc.js` (a export CSV) má unit testy bez jakýchkoli závislostí:

```bash
node --test          # Node.js 20+
```

Alternativně v prohlížeči: spusťte lokální server a otevřete <http://localhost:8000/tests/run.html>.

## Úprava pravidel

Délka fondu, interval a délka přestávky jsou na jednom místě, v konstantě `RULES` v [`js/calc.js`](js/calc.js).
Státní svátky ČR (včetně pohyblivého Velkého pátku a Velikonočního pondělí) počítá funkce `czechHolidays`.

## Ikony

PNG ikony se generují skriptem bez externích knihoven: `python3 scripts/make-icons.py`.
