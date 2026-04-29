# Presne prompty (copy-paste)

Skopiruj a posielaj ich presne v tomto poradi.

## Prompt 1

```text
V priecinku c:\GPv2 sprav:
1) git init
2) git add .
3) git commit -m "Initial commit: upload full app with backend"
4) git branch -M main
Potom mi vypis git status -sb.
```

## Prompt 2

```text
V priecinku c:\GPv2 nastav remote:
git remote remove origin (ak existuje)
git remote add origin https://github.com/Martin-Benco/grouppocketfinal.git
Potom vypis git remote -v.
```

## Prompt 3

```text
V priecinku c:\GPv2 spusti:
git push -u origin main
Ak pyta prihlasenie, pouzi:
- username: Martin-Benco
- password: GitHub Personal Access Token (nie bezne heslo)
```

## Prompt 4 (ak push padne na auth)

```text
Push zlyhal na autentifikacii. Daj mi presne kroky pre Windows:
1) kde vytvorit GitHub PAT token
2) ake minimalne opravnenie nastavit
3) co zadat do username
4) co zadat do password
5) aky prikaz potom zopakovat
```

## Prompt 5 (zaverecna kontrola)

```text
Sprav kontrolu v c:\GPv2:
1) git status -sb
2) git log -1 --oneline
3) potvrd, ze kod je pushnuty na https://github.com/Martin-Benco/grouppocketfinal.git
Napis mi kratky finalny report.
```

---

# Presne prompty pre druhy pocitac (clone + pokracovanie prace)

Skopiruj a posielaj ich presne v tomto poradi na druhom PC.

## Prompt A0 (login na GitHub pred clone/push)

```text
Na druhom PC najprv over Git a prihlasenie:
1) git --version
2) git config --global user.name "Martin Benco"
3) git config --global user.email "TVOJ_GITHUB_EMAIL"
4) git credential-manager version

Ak credential-manager chyba, napis mi presne kroky instalacie Git for Windows s Git Credential Manager.
```

## Prompt A0.1 (PAT login cez HTTPS - odporucane)

```text
Daj mi presne kroky na GitHub PAT login cez browser:
1) otvorenie GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)
2) vytvorenie tokenu s minimalnym scope "repo"
3) ulozenie tokenu (kopirovat hned po vytvoreni)
4) spustenie test prikazu v terminali:
   git ls-remote https://github.com/Martin-Benco/grouppocketfinal.git
5) pri vyzve zadat:
   - username: Martin-Benco
   - password: PAT token
6) potvrdit, ze credentials sa ulozili do Windows Credential Manager.
```

## Prompt A0.2 (alternativa: SSH login)

```text
Ak nechcem PAT, nastav mi SSH pristup na GitHub krok po kroku:
1) ssh-keygen -t ed25519 -C "TVOJ_GITHUB_EMAIL"
2) spustenie ssh-agent a pridanie kluca
3) vypis public key a kde ho vlozit na GitHub (Settings > SSH and GPG keys)
4) test: ssh -T git@github.com
5) prepnut remote na SSH:
   git remote set-url origin git@github.com:Martin-Benco/grouppocketfinal.git
```

## Prompt A1 (clone projektu)

```text
Na Windows v PowerShell sprav:
1) cd c:\
2) git clone https://github.com/Martin-Benco/grouppocketfinal.git GPv2
3) cd c:\GPv2
4) git branch -a
5) git status -sb
Napis mi kratky vystup.
```

## Prompt A2 (frontend dependencies)

```text
V c:\GPv2 nainstaluj frontend dependencies:
npm install
Potom vypis, ci install prebehol bez chyby.
```

## Prompt A3 (backend dependencies)

```text
V c:\GPv2\backend nainstaluj backend dependencies:
npm install
Potom vypis, ci install prebehol bez chyby.
```

## Prompt A4 (env subory)

```text
Skontroluj, ci existuju tieto subory:
1) c:\GPv2\.env.local
2) c:\GPv2\backend\.env

Ak chybaju, vytvor mi presne sablony s premennymi (len nazvy klucov, bez tajnych hodnot), aby som ich vedel doplnit.
```

## Prompt A5 (spustenie projektu)

```text
Spusti projekt na druhom PC:
1) v c:\GPv2 -> npm run dev
2) v c:\GPv2\backend -> npm run start:dev

Ak nieco padne, vypis prvu realnu chybu a presny fix krok po kroku.
```

## Prompt A6 (pokracovanie prace na branche main)

```text
Pred zacatim prace v c:\GPv2 vzdy sprav:
1) git checkout main
2) git pull origin main
3) git status -sb

Po kazdej zmene:
1) git add .
2) git commit -m "kratky popis zmeny"
3) git push origin main
```

