# Wibed – evidence pracovní docházky

Single Page aplikace pro evidenci příchodů a odchodů, monitorování přesčasů a banky přesčasů.
HTML + Vanilla JS (ES moduly), Firebase (Authentication + Firestore), TailwindCSS z CDN.
**Bez build kroku a bez závislostí.** Běží na GitHub Pages: <https://luso999.github.io/Wibed-work-attendance/>

## Funkce

- **Příchod / Odchod** jedním klepnutím. Čas se předvyplní aktuálním, lze ho změnit a zapisovat i zpětně pro libovolné datum.
- **Pravidla:** fond 8 h/den. Za každých celých 6 h pobytu se odečte 30 min přestávky (`floor(pobyt / 6 h) * 30 min`).
  Fond i přestávku si každý uživatel může změnit v nastavení.
- **Typy dnů:** Pracovní, Dovolená, Nemoc, Lékař (započtou 8 h, netvoří přesčas) a Náhradní volno (započte 8 h a odečte 8 h z banky).
- **Banka přesčasů:** součet denních přesčasů (mohou být i záporné) minus čerpání. Výběr náhradního volna po hodinách, nad zůstatek nelze vybrat.
- **Měsíční přehled:** fond (pracovní dny × 8 h, bez víkendů a **státních svátků ČR**), odpracováno, přesčas, čerpání a úprava jednotlivých dnů.
- Práce o víkendu nebo ve svátek má fond 0 h, celá odpracovaná doba je tedy přesčas.
- **Plán docházky:** pevné odchody pro lichý a sudý týden. Ostatní dny se dopočítají tak, aby měsíc vyšel přesně do fondu (viz níže).
- **Částečná nepřítomnost** (např. 6 h práce + 2 h lékař) a **doplnění docházky** jedním klepnutím.
- **Export CSV** zobrazeného měsíce (UTF-8 s BOM, středník – otevře se správně v Excelu).
- Tmavý a světlý režim (výchozí podle systému, volba se pamatuje), **PWA** (instalace na plochu, offline shell, offline data díky cache Firestore).

## Struktura

```
index.html            aplikační shell (všechny obrazovky)
manifest.json, sw.js  PWA
firestore.rules       bezpečnostní pravidla Firestore
js/firebase-config.js ← SEM vložte konfiguraci Firebase
js/calc.js            čisté výpočty (pravidla v konstantě RULES)
js/plan.js            čisté výpočty plánu měsíce (ISO týden, parita, rozložení deficitu)
js/plan-view.js       UI záložky Plán
js/csv.js             export CSV
js/app.js             UI a logika obrazovek
js/auth.js, js/store.js, js/firebase.js, js/theme.js, js/ui.js
tests/                unit testy (Node i prohlížeč)
scripts/make-icons.py generátor PNG ikon
```

Data ve Firestore:

- `users/{uid}/attendance/{YYYY-MM-DD}` → `{ type, arrival, departure, note, updatedAt }`
- `users/{uid}/overtimeBank/{id}` → `{ date, minutes, note, createdAt }` (výběry z banky)
- `users/{uid}/settings/plan` → nastavení plánu (viz níže)
- `users/{uid}/planOverrides/{YYYY-MM-DD}` → `{ absenceType, absenceHours, arriveAt, leaveAt, workedHours, clearFixed, note }` (výjimky dnů;
  `clearFixed` = `'arrival' | 'leave' | 'both'`, `note` max. 200 znaků – oddělená od poznámky v docházce)

U záznamu docházky slouží `type` jako typ nepřítomnosti. `absenceHours` (v hodinách, prázdné = celý den) určuje
částečnou nepřítomnost a `filled: true` označuje automaticky doplněný záznam.

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

## Plánování docházky (záložka Plán)

Plán se nikam neukládá. Pokaždé se znovu spočítá z nastavení, výjimek a skutečné docházky. Banka přesčasů do něj nevstupuje,
každý měsíc se vyrovnává na nulu samostatně.

**Nastavení** (`settings/plan`, každý uživatel má vlastní):

| Pole | Výchozí | Význam |
|---|---|---|
| `anchorMode` | `arrival` | kotva plánu: `arrival` = pevný příchod a dopočítává/posouvá se odchod, `departure` = pevný odchod a dopočítává/posouvá se příchod |
| `anchorTime` | 06:00 | čas kotvy (dřívější `startTime` se načte jako příchod) |
| `earliestArrival`, `latestDeparture` | 05:00, 17:00 | hranice plánovače v obou režimech – posouvaný konec je nepřekročí |
| `coreStart`, `coreEnd` | 09:00, 14:00 | pevná pracovní doba (jen pro varování a minimum zkrácení) |
| `dailyFundHours` | 8 | denní fond, platí pro **celou aplikaci** (přesčasy, banka, měsíční fond) |
| `maxWorkedHoursPerDay` | 10 | strop odpracovaných hodin běžného dne |
| `breakAfterHours`, `breakLengthMinutes` | 6, 30 | polední přestávka: za každých celých `breakAfterHours` pobytu se odečte `breakLengthMinutes` (0 = bez přestávky). Platí pro **celou aplikaci**. |
| `ruleVersions` | 1 verze | historie pravidel výpočtu `[{ from, dailyFundHours, breakAfterHours, breakLengthMinutes }]` – každý den se počítá podle verze platné k jeho datu |
| `parityFlip` | false | prohodí lichý a sudý týden |
| `schedule.odd/even.{1–5}` | prázdné | `{ arriveAt, leaveAt }` – volitelný pevný příchod a odchod pro den lichého/sudého ISO týdne. Dřívější formát (jen čas odchodu) se načte jako `leaveAt`. |

**Rozvrh dne a kotva:** prázdné pole na straně kotvy se doplní kotvou, druhé se dopočítá.

| Zadáno | Režim „příchod“ | Režim „odchod“ |
|---|---|---|
| nic (běžný den) | příchod = kotva, odchod se posouvá | odchod = kotva, příchod se posouvá |
| jen odchod | příchod = kotva → **plně pevný den** | odchod pevný, příchod se posouvá |
| jen příchod | příchod pevný, odchod se posouvá | odchod = kotva → **plně pevný den** |
| oba časy | **plně pevný den** | **plně pevný den** |

Při přepnutí režimu aplikace ukáže, co se změní, a převede čas kotvy tak, aby běžný den zůstal stejný
(příchod 06:00 ↔ odchod 14:30 při fondu 8 h a přestávce 30 min).

Pevný odchod před `coreEnd` nebo příchod po `coreStart` aplikace označí upozorněním „porušuješ pevnou pracovní dobu“.
Uložit ho ale jde, je to jen upozornění.

**Výpočet:**

1. Pracovní dny jsou po–pá bez státních svátků. Dny s uzavřenou docházkou berou skutečnost. Celodenní nepřítomnost je pevný den s plným fondem.
   Proběhlý pracovní den bez záznamu se počítá jako 0 h a nabídne se k doplnění.
2. Plně pevný den (oba konce dané rozvrhem, výjimkou, kotvou nebo dnešním skutečným příchodem) má odpracováno = pobyt minus přestávka.
   Nikdy se neprodlužuje. Částečná nepřítomnost v takový den proběhne uvnitř okna a pracovní blok se o ni zkrátí.
3. Běžný den (jeden konec pevný) má základ = fond − hodiny nepřítomnosti. Posouvá se jen nefixovaný konec.
   Je-li dnes zaznamenaný skutečný příchod, použije se místo plánovaného.
4. Deficit (fond − skutečnost − pevné dny − základy) se rozloží rovnoměrně po 15 min na běžné dny.
   Zbylé dávky jdou na dny rozprostřené přes celý měsíc, zbytek pod 15 min dostane jeden den uprostřed, takže měsíc vyjde přesně na nulu.
   Stropy (`maxWorkedHoursPerDay`, `latestDeparture` při posouvání odchodu, `earliestArrival` při posouvání příchodu)
   přelijí hodiny na ostatní dny. Když to nestačí, plán ukáže, kolik hodin chybí.
5. Přebytek běžné dny rovnoměrně zkrátí, nejvýš na odchod v `coreEnd` (resp. příchod v `coreStart` v režimu odchodu).
   Zbytek plán ohlásí jako „přebývá“. Porušení pevné doby i hranic u pevných časů je jen upozornění.
6. Hodiny se převádějí na odchod nejmenším pobytem, který dá požadované hodiny. Kvůli přestávce dá například 6:00 h práce pobyt 6:30 h
   (při výchozím pravidle přestávky).
7. Parita se určuje podle ISO týdne každého dne zvlášť, i když týden přesahuje hranici měsíců.

**Tabulka plánu:** sloupce Příchod, Odchod, Plán (h) a Skutečnost (h). U proběhlých dnů jsou časy skutečné,
u budoucích plánované (kurzívou, tlumeně).

**Výjimky dnů:** klepnutím na dnešní nebo budoucí den v plánu nastavíte nepřítomnost (celý den nebo hodiny), pevný příchod či odchod,
pevné hodiny práce, poznámku k plánu, nebo **zrušíte pevný čas z rozvrhu** pro ten den (zvlášť příchod a odchod). Proběhlé dny
výjimku nemají – upravuje se jejich docházka.

- Priorita konců dne: skutečný příchod > výjimka (`arriveAt`/`leaveAt`) > rozvrh (pokud ho `clearFixed` nezrušil) > kotva.
  `clearFixed` ruší jen časy z rozvrhu, ne kotvu. Den se zrušeným pevným časem se stane běžným a podílí se na rozložení deficitu
  (štítek „bez pevného odchodu“).
- Odchod musí být po příchodu (jinak výjimku nejde uložit); odchod před koncem pevné doby je jen upozornění.
- **Zrušit výjimku** smaže dokument a den se vrátí do stavu podle rozvrhu.
- **Zrušit pevné časy v rozsahu…** vytvoří či doplní výjimky (`clearFixed`) pro dnešní a budoucí pracovní dny v rozsahu, které daný
  pevný čas v rozvrhu mají. Akci jde jedním krokem vrátit (tlačítko Vrátit); zápis i vrácení jsou atomické.
- Poznámka k plánu se ukazuje v řádku plánu (na mobilu rozbalitelně) a v kartě „Dnes“ na hlavní obrazovce.

**Doplnit docházku:** v dialogu dne nebo hromadně v plánu (s náhledem) nastaví odchod tak, aby den vyšel přesně do fondu.
Pobyt = nejmenší pobyt pro (fond − nepřítomnost), u běžného dne 8:30. V režimu příchodu (nebo při zaznamenaném příchodu)
se odchod dopočítá od příchodu, v režimu odchodu se příchod dopočítá zpět od odchodu.
Záznam dostane štítek „doplněno“, který se zobrazí i v CSV. Ruční úprava časů štítek zruší.

## Lokální spuštění

```bash
python3 -m http.server 8000
# → http://localhost:8000/
```

Aplikaci nelze otevřít přímo ze souboru (`file://`), protože ES moduly a service worker vyžadují HTTP server.

## Testy

Výpočetní moduly `js/calc.js` a `js/plan.js` (a export CSV) mají unit testy bez jakýchkoli závislostí:

```bash
node --test          # Node.js 20+
```

Alternativně v prohlížeči: spusťte lokální server a otevřete <http://localhost:8000/tests/run.html>.

## Ochrana historie při změně pravidel

Změna denního fondu nebo pravidla přestávky by jinak přepočítala i uzavřené dny a banku přesčasů. Proto se před uložením otevře
potvrzovací dialog s dopočtenou změnou zůstatku banky (před → po) a počtem dotčených uzavřených dnů. Zvolíte:

- **Platí od** (výchozí dnes): uloží se nová verze pravidel s datem platnosti, starší dny se dál počítají podle původních pravidel.
- **Zpětně pro všechna data**: pravidla se přepíší pro celou historii.

Bez potvrzení se změna neuloží. Přehled platnosti pravidel je v nastavení pod přestávkou.

## Úprava pravidel

Výchozí interval a délka přestávky i výchozí denní fond jsou na jednom místě, v konstantě `RULES` v [`js/calc.js`](js/calc.js).
Každý uživatel si je může přepsat v **Plán → Nastavení pracovní doby a plánu** – s datem platnosti (viz Ochrana historie).
Státní svátky ČR (včetně pohyblivého Velkého pátku a Velikonočního pondělí) počítá funkce `czechHolidays`.

## Ikony

PNG ikony se generují skriptem bez externích knihoven: `python3 scripts/make-icons.py`.
