# Riešenie chyby: Firebase service account not configured

## Problém
Backend sa nespúšťa, lebo chýba Firebase Service Account.

## Riešenie (3 minúty)

### Krok 1: Získajte Service Account JSON

1. **Otvorte tento link:**
   https://console.firebase.google.com/project/gpv2-8a948/settings/serviceaccounts/adminsdk

2. **Kliknite na "Generate new private key"**

3. **Potvrďte** (kliknite "Generate key")

4. **Stiahne sa JSON súbor** (napr. `gpv2-8a948-firebase-adminsdk-xxxxx.json`)

### Krok 2: Uložte súbor

1. **Premenujte súbor** na `service-account.json`

2. **Presuňte ho** do `backend/` adresára

**Výsledok:**
```
backend/
  ├── service-account.json  ← TU MUSÍ BYŤ!
  ├── package.json
  └── src/
```

### Krok 3: Spustite backend znova

```bash
npm run start:dev
```

## Overenie

Ak je všetko OK, uvidíte:
```
[Nest] INFO  [NestApplication] Nest application successfully started
```

## Bezpečnosť

⚠️ **DÔLEŽITÉ:**
- `service-account.json` obsahuje citlivé údaje
- NIKDY ho necommitnite do Gitu (už je v `.gitignore`)
- NIKDY ho nezdieľajte
