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

