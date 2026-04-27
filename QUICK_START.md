# Quick Start Guide

## Spustenie celej aplikácie

### 1. Frontend (Next.js)

```bash
# V root adresári projektu
npm install
npm run dev
```

Frontend beží na: `http://localhost:3000`

### 2. Backend (NestJS)

**Krok 1: Inštalácia**
```bash
cd backend
npm install
```

**Krok 2: Firebase Service Account**

Stiahnite si Firebase Service Account JSON:
1. [Firebase Console](https://console.firebase.google.com/project/gpv2-8a948/settings/serviceaccounts/adminsdk)
2. Kliknite "Generate new private key"
3. Uložte JSON súbor ako `backend/service-account.json`

**Krok 3: Spustenie**
```bash
npm run start:dev
```

Backend beží na: `http://localhost:3001`

### 3. Obe aplikácie naraz (2 terminály)

**Terminál 1 (Frontend):**
```bash
npm run dev
```

**Terminál 2 (Backend):**
```bash
cd backend
npm run start:dev
```

## Overenie

1. Otvorte `http://localhost:3000` v prehliadači
2. Prihláste sa
3. Mala by sa načítať stránka bez chýb v konzole

## Problémy?

- **Backend nebeží?** → Skontrolujte `backend/SETUP.md`
- **Chyby v konzole?** → Uistite sa, že oba servery bežia
- **Firebase chyby?** → Skontrolujte `.env.local` (frontend) a `service-account.json` (backend)
