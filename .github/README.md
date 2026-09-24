# Freezers ESPORT Team Hub

Responzivní webová aplikace pro CS2 tým Freezers ESPORT. Vanilla HTML, CSS a JavaScript; JSON soubory slouží jako datové úložiště. Není potřeba externí databáze ani build krok.

## Spuštění

Otevřete složku `outputs` ve webovém serveru, například pomocí VS Code Live Server nebo příkazem `python -m http.server 8000`, a přejděte na `http://localhost:8000`. Nepoužívejte `file://`: načítání JSON přes `fetch` prohlížeč blokuje.

## Moduly

- Přehled týmu, nadcházející události, statistiky, roster a partneři
- Kalendář s měsíčním, týdenním a denním přepnutím; tvorba i mazání událostí
- RSVP, odeslání omluvenky a evidence docházky
- Upozornění oranžovým zvýrazněním po pěti neomluvených absencích
- Playbook rozdělený podle map včetně videí a místních mapových obrázků
- Interní tipovačka s body bez sázek o peníze
- Veřejný přehled a roster; chráněný kalendář, playbook a členská sekce po přihlášení username, heslem a GitHub tokenem
- Owner může zakládat členy a další adminy
- Změna hesla a odhlášení
- Automatické ukládání do Local Storage, export a import JSON zálohy, cookies pro drobné preference a synchronizace souborů přes GitHub Contents API

## GitHub synchronizace

Tlačítko **Přihlásit se** je vpravo nahoře. Veřejný přehled a soupiska jsou dostupné bez účtu; kalendář, playbook a členský portál zobrazí přihlášení. Po úspěšném přihlášení se aplikace připojí k GitHubu. Výchozí repozitář je `feitmenn/freezers` podle odkazů na mapy v dodaném playbooku; případné nastavení lze změnit v **Administrace → GitHub Sync**. Token potřebuje `Contents: read and write` pouze na cílovém repozitáři. Změny v kalendáři, playbooku, RSVP, docházce, omluvenkách, účtech a logu se zapisují jako Git commity.

Token se drží pouze v paměti aktuální karty; při obnovení stránky ho znovu vložte. Ostatní nastavení synchronizace je uloženo lokálně v prohlížeči. Přímé volání GitHub API z prohlížeče znamená, že token může být během použití viditelný uživateli prohlížeče. Tato architektura se proto hodí pro soukromý týmový dashboard na důvěryhodných zařízeních. Pro veřejně dostupnou aplikaci s více uživateli použijte serverless proxy nebo vlastní backend, který ověří identitu a token uloží jako serverový secret.

## Přihlášení a oprávnění

Výchozí účet je **FILAS** s rolí **owner**; z bezpečnostních důvodů po prvním přihlášení změň výchozí heslo v **Administrace → Účty / admini**. Owner zde může zakládat členy i další adminy. Nové účty se zapisují do `admins.json` s náhodnou solí a PBKDF2 hashem; hesla se neukládají jako prostý text. `users.json` byl z aplikace odstraněn.

Přihlašovací obrazovka a kontrola rolí běží v prohlížeči. Protože aplikace nemá server, nejde tímto způsobem bezpečně vynutit identitu ani oprávnění: hash účtu je dostupný v nasazeném JSON souboru a uživatel může upravit klientský kód. GitHub token je skutečná hranice přístupu k repozitáři; zadávej ho jen lidem, kterým smíš povolit zápis. Pro veřejný web nebo skutečné zabezpečení použij serverless autentizační proxy.

## Datové soubory

Zachovány jsou poskytnuté formáty `calendar.json`, `roster.json`, `playbook.json`, `rsvps.json`, `attendance.json`, `admins.json` a `staff.json`. Pro omluvenky a logy aplikace přidává `excuses.json` a `activity.json`. Mapy a obrázky partnerů jsou v `assets/`.


## Místní úložiště a soubory

V **Administrace → Data & zálohy** stáhněte kompletní JSON zálohu nebo nahrajte existující zálohu. Změny se automaticky drží v Local Storage daného prohlížeče. Tlačítko **Obnovit původní data** odstraní jen místní změny a znovu načte přiložené JSON soubory. Cookies si pamatují pouze jméno a vybraný pohled kalendáře; neukládají týmová data ani tokeny.
