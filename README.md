# GroupPocket

Webová aplikácia na správu skupinových výdavkov a rozdeľovanie platieb. Mobile-first rozhranie, autentifikácia cez Firebase a vlastný backend nad Firestore.

## Tech stack

| Vrstva | Technológie |
|--------|-------------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| UI | Radix Slot, CVA, lucide-react, vlastné komponenty (tlačidlá, modal) |
| Auth & dáta (klient) | Firebase Auth, Firestore, Storage |
| Backend | NestJS 10, `firebase-admin` (overenie ID tokenu, Firestore) |
| Hosting / pravidlá | Firebase Hosting (`out/`), `firestore.rules`, `storage.rules` |

**Poznámka:** V pôvodnom zámere figuroval aj Stripe (Premium). V závislostiach zatiaľ nie je zapojený — bude súčasťou ďalšej fázy.

## Architektúra a tok dát

1. **Prihlásenie:** Klient (`lib/firebase/auth.ts`, `AuthContext`) drží stav používateľa z Firebase Auth.
2. **API volania:** `lib/api/client.ts` pripája `Authorization: Bearer <idToken>` (povinne pre `/users`; voliteľne pre QuickSplit) a volá `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`).
3. **Backend:** `AuthGuard` overí token cez Admin SDK; `UsersController` povoľuje prístup len k vlastnému `uid` (Firestore `users/{userId}`). **QuickSplit** ide výhradne cez Nest + Admin SDK (`quicksplits` v Firestore; klient nemá priame Firestore pravidlá na túto kolekciu).
4. **Profilový obrázok:** Nahratie do Storage (`profiles/{uid}`) na klientovi → URL sa uloží cez `POST /users/:id/profile-image` do Firestore.

```
[Prehliadač]
    ├─► Firebase (Auth, Storage upload)
    └─► NestJS :3001 ──► Firestore users/{uid}, quicksplits/…
```

## Štruktúra projektu

```
GPv2/
├── app/
│   ├── layout.tsx          # Poppins, metadata, AuthProvider
│   ├── page.tsx            # Hlavná SPA: 4 taby, registrácia, účet (plná logika)
│   ├── globals.css
│   ├── join/page.tsx       # Pripojenie cez ?splitId=&joinToken= (static export)
│   ├── quicksplit/         # Placeholder route + layout (TopNav)
│   ├── pockety/
│   ├── ucet/
│   └── premium/
├── components/
│   ├── auth/               # LoginForm, SocialAuth*, RegistrationFlow
│   ├── quicksplit/         # QuickSplitScreen (split, QR, manuálna suma)
│   ├── navigation/       # TopNav (kontext aktivného tabu)
│   └── ui/                 # button, modal
├── contexts/
│   └── AuthContext.tsx
├── hooks/
│   └── useSwipe.ts         # Swipe medzi tabmi (použité na `/`)
├── lib/
│   ├── api/client.ts       # fetchWithAuth, users.*, quicksplits.*
│   ├── quicksplit/session.ts  # sessionStorage tokenov (host + tvorca)
│   ├── firebase/           # config, auth pomocníky
│   └── utils.ts
├── backend/
│   ├── src/
│   │   ├── main.ts         # CORS (FRONTEND_URL), ValidationPipe, port
│   │   ├── app.module.ts
│   │   ├── auth/           # auth.guard, optional-auth.guard
│   │   ├── firebase/
│   │   ├── users/          # controller, service, DTO
│   │   └── quicksplits/    # REST + Firestore quicksplits/{id}/participants
│   ├── SETUP.md
│   └── RIESENIE.md         # Service account troubleshooting
├── firestore.rules
├── storage.rules
├── firebase.json           # hosting public: out, rewrites SPA
├── next.config.js          # output: 'export', images.unoptimized
├── QUICK_START.md
└── package.json
```

## Navigácia a routy

| Cesta | Účel |
|-------|------|
| **`/`** | **Hlavná aplikácia:** horná navigácia (QuickSplit, Pockety, Účet, Premium), horizontálny panel s prepínaním tabov, **swipe** medzi tabmi, prihlásenie / onboarding / profil na záložke Účet. |
| **`/join`** | Formulár na pripojenie k QuickSplitu (query `splitId`, `joinToken`), uloženie session tokenov a presmerovanie na `/`. |
| `/quicksplit`, `/pockety`, `/ucet`, `/premium` | Jednoduché placeholder stránky so `TopNav` a `initialTab` zodpovedajúcim segmentu. Slúžia ako kostra pre budúce deep linky; **plná funkcionalita účtu je na `/`.** Tlačidlá v `TopNav` na týchto routách menia len lokálny stav tabu (nie URL) — pre produkčné deep linky bude vhodné doplniť `next/link` alebo presmerovanie na `/`. |

Poradie tabov v kóde: `quicksplit` → `pockety` → `ucet` → `premium` (zhodné v `TopNav.tsx`, `app/page.tsx`, `useSwipe.ts`).

## Premenné prostredia

### Frontend — `.env.local` (root)

Povinné pre beh klienta (bez `NEXT_PUBLIC_FIREBASE_API_KEY` aplikácia pri štarte spadne — pozri `lib/firebase/config.ts`):

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=gpv2-8a948.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=gpv2-8a948
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

Voliteľné:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Backend — `backend/.env` alebo súbor

- `PORT` (default 3001)
- `FRONTEND_URL` (default `http://localhost:3000`) — CORS
- Autentifikácia Admin SDK: **jedna** z možností  
  - `FIREBASE_SERVICE_ACCOUNT` = JSON na jednom riadku, alebo  
  - `FIREBASE_SERVICE_ACCOUNT_PATH` = absolútna/relatívna cesta k JSON, alebo  
  - súbor `backend/service-account.json` (viď `RIESENIE.md`)

## REST API (NestJS)

Všetky endpointy pod `users` vyžadujú hlavičku `Authorization: Bearer <Firebase ID token>`.

| Metóda | Cesta | Popis |
|--------|--------|--------|
| GET | `/users/:id` | Profilové dáta z Firestore (iba vlastné `id`) |
| PUT | `/users/:id` | Čiastočná aktualizácia (`fullName`, `phoneNumber`, `iban`, `residence`, …) |
| POST | `/users/:id/profile-image` | Telo `{ "imageUrl": "..." }` — uloženie URL po nahratí do Storage |

### QuickSplit (bez OCR v klientovi)

Prístup cez hlavičky `X-Join-Token` (pozvánka), `X-Admin-Token` (úpravy splitu — len tvorca), `X-Participant-Secret` (úprava vlastných platobných údajov pri hostovi). Voliteľné `Authorization` ak je používateľ prihlásený.

| Metóda | Cesta | Popis |
|--------|--------|--------|
| POST | `/quicksplits` | Vytvorenie splitu (`totalCents`, voliteľné `creatorDisplayName`). Vráti `splitId`, `joinToken`, `adminToken`, `creatorParticipantId`, `creatorParticipantSecret`. |
| GET | `/quicksplits/mine` | Zoznam splitov vlastníka (vyžaduje Bearer). |
| GET | `/quicksplits/:id` | Detail + účastníci + výpočet podielov (Bearer a/alebo join/admin token). |
| PATCH | `/quicksplits/:id` | `totalCents`, `payerParticipantId` (vyžaduje admin token alebo vlastníka). |
| POST | `/quicksplits/:id/join` | Pripojenie (`displayName`) + hlavička `X-Join-Token`. Vráti `participantId`, `participantSecret`. |
| PATCH | `/quicksplits/:id/participants/:participantId/payment` | Telo `{ "iban": "SK…" \| null }`. **IBAN platiteľa** môže meniť len platiteľ (Bearer = `userUid` riadku alebo join + jeho `participantSecret`). Ostatní účastníci: join+secret alebo admin token (tvorca). |
| PATCH | `/quicksplits/:id/participants/:participantId/paid` | `{ "paid": true \| false }` — len daný účastník (join+secret alebo Bearer). |
| GET | `/quicksplits/:id/activities?afterId=&limit=` | Staršie upozornenia (pagination). |

**Upozornenia:** ukladajú sa do `quicksplits/{id}/activities` (join, zmena sumy/platiteľa, IBAN, označenie platby…).

**OCR:** tlačidlo „Naskenovať bloček“ je zatiaľ placeholder; plánované Document AI Enterprise OCR + parsovanie sumy na backende.

**Backend env (voliteľné):** `QUICKSPLIT_TOKEN_PEPPER` — soľ na hashovanie tokenov (v produkcii nastav vlastnú hodnotu).

## Skripty

```bash
# Frontend
npm install
npm run dev              # http://localhost:3000
npm run build            # statický export do out/
npm run deploy           # build + firebase deploy

# Backend (z rootu)
npm run backend:install
npm run backend:dev
npm run backend:build
```

Podrobnejší postup: [QUICK_START.md](./QUICK_START.md), backend: [backend/SETUP.md](./backend/SETUP.md).

## Fázy vývoja

### Fáza 0 — základ a navigácia (hotovo)

- Mobile-first layout, horná navigácia so štyrmi tabmi
- Placeholder obsah pre QuickSplit, Pockety, Premium na domovskej stránke

### Fáza 1 — identita a účet (čiastočne hotovo)

- Firebase Auth (email/heslo, sociálne prihlásenie cez existujúce komponenty)
- Onboarding `RegistrationFlow` po novom účte
- Záložka Účet na `/`: profil, úprava polí, heslo, odhlásenie, obrázok cez Storage + API
- NestJS + Firestore `users`, pravidlá v `firestore.rules` / `storage.rules`

### Fáza 2 — doménová logika (rozbehnuté)

- **QuickSplit:** rovnomerné delenie, platiteľ (default tvorca), pozvánka QR/odkaz (`/join`), session tokeny pre hostí, uloženie vo Firestore, „pay me“ text podľa IBAN platiteľa (profil alebo doplnenie v split-e). **OCR bločkov** — zatiaľ nie.
- Pockety: peňaženky / skupinové rozpočty
- Premium: platby (napr. Stripe), limity free vs paid

### Fáza 3 — tvrdší produkčný standard

- Deep linky a jednotné správanie URL ↔ aktívny tab
- Chybové stavy, offline, testy E2E
- Monitoring, rate limiting, prípadné Cloud Functions

## Firebase

- Konzola projektu: [Firebase Console – gpv2-8a948](https://console.firebase.google.com/project/gpv2-8a948)
- Web app konfigurácia → hodnoty do `.env.local`
- Service account pre backend → [Service accounts](https://console.firebase.google.com/project/gpv2-8a948/settings/serviceaccounts/adminsdk)

## Statický export

`next.config.js` má `output: 'export'`. Hosting očakáva priečinok `out/` a SPA rewrite na `index.html` (`firebase.json`). Dynamické serverové routy Next bez generovania statických ciest nepoužívať bez úpravy stratégie.

---

*GroupPocket — interný názov balíka v `package.json`: `grouppocket`.*
