# Ako získať Firebase Service Account

## Krok 1: Otvorte Firebase Console

Choďte na: https://console.firebase.google.com/project/gpv2-8a948/settings/serviceaccounts/adminsdk

**ALEBO:**

1. Choďte na: https://console.firebase.google.com/project/gpv2-8a948
2. Kliknite na ⚙️ **Settings** (vľavo hore)
3. Kliknite na **Project settings**
4. Choďte na záložku **Service accounts**

## Krok 2: Vygenerujte nový kľúč

1. V sekcii **Firebase Admin SDK** kliknite na **Generate new private key**
2. Zobrazí sa varovanie - kliknite **Generate key**
3. Stiahne sa JSON súbor (napr. `gpv2-8a948-firebase-adminsdk-xxxxx-xxxxxxxxxx.json`)

## Krok 3: Uložte súbor

1. Premenujte súbor na `service-account.json`
2. Presuňte ho do `backend/` adresára

**Výsledok:**
```
backend/
  ├── service-account.json  ← TU MUSÍ BYŤ
  ├── package.json
  └── src/
```

## Krok 4: Overenie

Spustite backend znova:
```bash
npm run start:dev
```

Ak je všetko OK, uvidíte:
```
[Nest] INFO  [NestApplication] Nest application successfully started
```

## Bezpečnosť

⚠️ **DÔLEŽITÉ:** 
- `service-account.json` obsahuje citlivé údaje
- NIKDY ho necommitnite do Gitu (už je v `.gitignore`)
- NIKDY ho nezdieľajte
