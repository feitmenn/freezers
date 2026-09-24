# Freezers ESPORT Team Hub

Responzivní webová aplikace pro CS2 tým Freezers ESPORT. Vanilla HTML, CSS a JavaScript; JSON soubory slouží jako datové úložiště. Není potřeba externí databáze ani build krok.

## Spuštění

Veřejný web publikujte pouze ze složky `site/`. Datové JSON soubory ani Worker nikdy nekopírujte do veřejného statického webu. Pro lokální náhled spusťte webový server v `site/`; přihlášení a synchronizace začnou fungovat po nasazení Workeru a nastavení `site/config.js`.

## Moduly

- Přehled týmu, nadcházející události, statistiky, roster a partneři
- Kalendář s měsíčním, týdenním a denním přepnutím; tvorba i mazání událostí
- RSVP, odeslání omluvenky a evidence docházky
- Upozornění oranžovým zvýrazněním po pěti neomluvených absencích
- Playbook rozdělený podle map včetně videí a místních mapových obrázků
- Interní tipovačka s body bez sázek o peníze
- Veřejný přehled a roster; členové se přihlásí pouze username a heslem, bez GitHub tokenu
- Administrace umí přidávat a upravovat hráče v rosteru, měnit jméno, roli, sestavu i profily a hráče odebrat
- Owner může zakládat členy a další adminy a nastavovat adminům práva pro roster, kalendář, docházku, playbook, synchronizaci, účty a zálohy
- Změna hesla a odhlášení
- Serverové ukládání přes GitHub JSON soubory, AES-GCM šifrované zálohy a cookies jen pro drobné preference

## GitHub synchronizace

Přihlašovací obrazovka žádá jen username a heslo. GitHub token zůstává jako Cloudflare Worker secret na serverové straně; do HTML/JavaScriptu ani do prohlížeče se neposílá. Data se mezi webem a Workerem přenášejí přes HTTPS a po jednorázové migraci se v privátním GitHub úložišti ukládají šifrovaná pomocí AES-GCM. Hash hesla používá PBKDF2-SHA256.

**Nasazení zabezpečené služby:** použij privátní GitHub repozitář pro JSON soubory a statický web nasazuj zvlášť pouze ze `site/`. Ve `worker/wrangler.toml` nastav `REPO_OWNER`, `REPO_NAME`, `REPO_BRANCH`, `DATA_PATH` a přesnou adresu webu v `ALLOWED_ORIGIN`. Ve složce `worker/` proveď `npx wrangler login`; pak nastav secrets příkazy `npx wrangler secret put GITHUB_TOKEN`, `npx wrangler secret put SESSION_SECRET` a `npx wrangler secret put DATA_ENCRYPTION_KEY`. Poslední dvě hodnoty vygeneruj jako náhodné, tajné hodnoty; encryption key musí mít 64 hex znaků (32 bajtů). Potom spusť `npx wrangler deploy` a jeho URL vlož do `site/config.js` jako `window.FREEZERS_API_URL`. Přihlas se jako FILAS a v **Administrace → Služba** jednou spusť **Zašifrovat týmová data**. Nastav také rate limit pro `/api/login` v Cloudflare.

Worker nepoužívá externí databázi; soubory v privátním GitHub repozitáři jsou úložištěm. Cloudflare Worker drží token a šifrovací klíč jako server secrets. Nikdy nedávej privátní data repozitář do veřejného Pages adresáře.

## Přihlášení a oprávnění

Výchozí účet je **FILAS** s rolí **owner**; z bezpečnostních důvodů po prvním přihlášení změň výchozí heslo v **Administrace → Účty / admini**. Owner zde může zakládat členy i další adminy. Nové účty se zapisují do `admins.json` s náhodnou solí a PBKDF2 hashem; hesla se neukládají jako prostý text. `users.json` aplikace nepoužívá; účty jsou ve spravovaném `admins.json`.

Přihlašování, kontrola oprávnění a GitHub zápisy se ověřují ve Workeru. Účetní hashe jsou v zašifrovaném JSON souboru. Oprávnění UI jsou kontrolována také API při zápisu.

## Datové soubory

Zachovány jsou poskytnuté formáty `calendar.json`, `roster.json`, `playbook.json`, `rsvps.json`, `attendance.json`, `admins.json` a `staff.json`. Pro omluvenky a logy aplikace přidává `excuses.json` a `activity.json`. Mapy a obrázky partnerů jsou v `assets/`.


## Místní úložiště a soubory

V **Administrace → Data & zálohy** stáhni nebo obnov AES-GCM šifrovanou zálohu. Po připojení Workeru se týmová data neukládají do Local Storage.
