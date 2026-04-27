# Backend Setup Guide

## 1. Inštalácia závislostí

```bash
cd backend
npm install
```

## 2. Firebase Service Account Setup

Backend potrebuje Firebase Admin SDK credentials pre prístup k Firestore.

### Krok 1: Získajte Service Account Key

1. Choďte do [Firebase Console](https://console.firebase.google.com/project/gpv2-8a948)
2. Kliknite na ⚙️ **Settings** > **Project settings**
3. Choďte na záložku **Service accounts**
4. Kliknite na **Generate new private key**
5. Stiahne sa JSON súbor (napr. `gpv2-8a948-firebase-adminsdk-xxxxx.json`)

### Krok 2: Nastavte Environment Variable

Vytvorte `.env` súbor v `backend/` adresári:

```bash
cd backend
touch .env
```

Pridajte do `.env`:

```env
PORT=3001
FRONTEND_URL=http://localhost:3000
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"gpv2-8a948",...}
```

**Dôležité:** 
- Skopírujte CELÝ obsah JSON súboru a vložte ho ako jeden riadok do `FIREBASE_SERVICE_ACCOUNT`
- Alebo použite nástroj na konverziu JSON na jeden riadok

### Alternatívne: Použitie JSON súboru

Ak chcete použiť priamo JSON súbor, upravte `backend/src/firebase/firebase.service.ts`:

```typescript
import * as admin from 'firebase-admin';
import * as serviceAccount from './path-to-your-service-account.json';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});
```

## 3. Spustenie Backendu

### Development Mode (s hot reload)
```bash
npm run start:dev
```

### Production Mode
```bash
npm run build
npm run start:prod
```

Backend beží na `http://localhost:3001`

## 4. Overenie

Po spustení by ste mali vidieť:
```
[Nest] INFO  [NestFactory] Starting Nest application...
[Nest] INFO  [InstanceLoader] AppModule dependencies initialized
[Nest] INFO  [InstanceLoader] UsersModule dependencies initialized
[Nest] INFO  [InstanceLoader] FirebaseModule dependencies initialized
[Nest] INFO  [NestApplication] Nest application successfully started
```

## Troubleshooting

### Chyba: "Firebase service account not configured"
- Skontrolujte, či máte `.env` súbor v `backend/` adresári
- Skontrolujte, či `FIREBASE_SERVICE_ACCOUNT` obsahuje platný JSON

### Chyba: "Port 3001 already in use"
- Zmeňte port v `.env`: `PORT=3002`
- Alebo zastavte proces, ktorý používa port 3001

### Chyba pri npm install
- Skontrolujte, či máte Node.js verziu 18+ (`node --version`)
- Vymažte `node_modules` a `package-lock.json` a skúste znova
