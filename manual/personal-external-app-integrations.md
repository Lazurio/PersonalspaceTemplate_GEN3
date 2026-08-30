# Osobní napojení na externí aplikace (MCP/CLI)

Personalspace scope GEN3 standardu napojování na externí aplikace: osobní
Gmail, kalendář, úložiště a další služby Principála se připojují **primárně
lokálně definovaným MCP serverem nebo CLI nástrojem na dané mašině**. Nové
napojení se nikdy nezřizuje přes ChatGPT/claude.ai konektor ani sdílený
cloudový broker; už nainstalovaný konektor se používat smí a nový agent sám
neinstaluje. Kanonický standard a per-provider runbooky drží Lazurio
root (`manual/external-app-integrations.md`, `manual/integrations/`); tenhle
manuál drží jen to, co je v osobním scope jinak.

## Proč lokálně

Identita a subscription harnessu (ChatGPT/Claude účet) se smí sdílet napříč
mašinami Principála. Přístupy k externím aplikacím ne: cloudový konektor by
osobní přihlášení roznesl na všechny mašiny včetně pracovních. Každá mašina
drží vlastní OAuth granty a je samostatně revokovatelný přístup.

## Pravidla osobního scope

1. **Definice patří do user-level configu harnessu** — `~/.codex/config.toml`
   pro Codex, user scope pro Claude Code (`claude mcp add --scope user`).
   Osobní integrace se nezapisují do žádného org katalogu (`.mcp.json`
   Organizace) a org agenti je nepoužívají.
2. **Pojmenování `personal_<provider>`** (např. `personal_google`), aby se
   osobní servery nikdy nepletly s org servery `<org_slug>_<provider>`.
   Jeden účet do jedné session: osobní OAuth consent dokončuj vždy osobním
   účtem, org consent org účtem.
3. **Secrets a token custody:** OAuth client JSONy, env soubory a token
   cache patří do gitignored `secrets/<provider>/<scope>/<purpose>` uvnitř
   tohoto Personalspace (adresáře `0700`, soubory `0600`). Tool runtime
   cesty (`~/.config/...`, `~/.google_workspace_mcp/...`) jsou jen cache,
   ne custody source. Nikdy nic z toho necommituj ani neposílej chatem.
4. **Výběr integrace žebříčkem:** oficiální MCP → oficiální CLI →
   reviewnutý open-source s pinned verzí → browser fallback. Scraping a
   cookie-session servery jsou zakázané i v osobním scope — ban osobního
   účtu je pořád ban. Když MCP/CLI cesta chybí, použij browser fallback
   nebo existující nainstalovaný konektor; nový konektor nezřizuj.
5. **Izolace vůči Organizacím platí oběma směry.** Osobní data nepatří do
   org workflow a org data se nečtou osobními přihlášeními. Když úkol
   potřebuje org službu, řeš to v katalogu té Organizace, ne tady.
6. **Buddy** používá osobní integrace pod účty a mandáty svého Principála;
   custody tokenů zůstává v tomto Personalspace (nebo na dedikovaném VPS
   Buddyho), nikdy ve sdílené infrastruktuře ani u třetí strany.

## Onboarding nové osobní integrace

1. Vyber tvar podle žebříčku a per-provider runbooku v Lazurio rootu.
2. Přidej server/CLI do user-level configu pod jménem `personal_<provider>`;
   secret hodnoty jen přes jména env proměnných a custody cesty.
3. OAuth consent dokonči v prohlížeči osobním účtem; ověř, že session patří
   správnému účtu.
4. Smoke test: čtení (výpis labelů, poslední události…) a zápis **na
   jednorázovém cíli** (draft adresovaný sobě, scratch složka) — scopes
   jsou defaultně read i write. Artefakt po ověření ukliď. Write agenta je
   vždy Draft: co vytvoří, musí být vratné a editovatelné, a nevratnou
   publikaci (odeslání, zveřejnění, mazání, přepis ostrého obsahu) dělá
   Principál nebo agent jen na jeho explicitní pokyn.
5. Při vyřazení: odhlásit v harnessu, revokovat grant u poskytovatele,
   smazat lokální cache. Closeout metadata-only.

## Co udělený grant znamená (a co approval mode neochrání)

Udělený OAuth grant je **schopnost mašiny, ne jednoho agenta**. Token
v lokálním úložišti může použít kterýkoli proces, který na něj dosáhne —
CLI nástroj, Buddy, skript, jiný harness. Approval mode nebo permission
pravidla jsou gate uvnitř jednoho harnessu, ne hranice vůči ostatním
procesům na mašině.

Prakticky z toho plyne:

- **Nevratné a drahé scopes neuděluj vůbec** (mazání, správa oprávnění,
  admin operace nad osobním účtem). Neudělený scope je jediná spolehlivá
  ochrana; ostatní vrstvy jsou procesní.
- **Custody a revokace jsou skutečné hranice:** token store a env soubor
  v `secrets/…` s módy `0700`/`0600`, revokace u poskytovatele při
  podezření, per-machine granty (nikdy nekopírovat mezi mašinami).
- **Buddy** používá tvoje osobní integrace pod tvými mandáty; na nevratné
  operace platí stejné pravidlo Draft → Publikace jako pro Task Agenty.
- CLI běžící v shellu není gatované MCP approvalem — allowlistuj jen čtecí
  příkazy a nevratné operace potvrzuj vědomě.

## Zpětná vazba je povinná

Standard a runbooky jsou živý komunitní majetek HumanAndMachine — nikdo je
denně nepřetestovává. Když se Principál při instalaci zasekne nebo runbook
neodpovídá realitě poskytovatele, agent pošle opravný PR na
[`HumanAndMachines/Lazurio`](https://github.com/HumanAndMachines/Lazurio)
(bez známého řešení aspoň issue).
Upstream jde **jen generalizované, anonymizované poučení** — nikdy osobní
kontext, jména účtů, obsah schránky ani cokoli z tohoto Personalspace.
