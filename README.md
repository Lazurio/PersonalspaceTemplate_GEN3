# PersonalspaceTemplate_GEN3

Veřejný GitHub template pro jeden **privátní** Personalspace GEN3 člověka nebo
AI kolegy. Tento distribuční repo vznikl clean-room publikací bez historie,
PR refů a attached surfaces původního pracovního repa; auditní kontrakt drží
[`manual/public-readiness-audit.md`](manual/public-readiness-audit.md).
Personalspace funguje plnohodnotně bez Buddyho a owner bootstrap Buddyho
nevytváří ani nespouští. Buddy patří k Osobnímu Prostředí (Lazurio decision
0210): je to nabrífovaný Hermes Agent z forku `Lazurio/hermes-agent`, který
v Osobním Prostředí svého člověka běží jako jeho součást, s pamětí v gbrainu
nad vaultem tohoto Personalspace. Kdo Osobní Prostředí nemá, Buddyho nemá.
Samostatný hostovaný Buddy na dedikované VPS, Resident distribuce Buddyho
i chat přes Zulip skončily.

Buddy je důvěryhodný osobní zástupce svého člověka. Roli mu dává `SOUL.md`
v private secret-free profilu `<github-login>/<github-login>-buddy`. Mandáty
jsou trvalé, scoped a odvolatelné; nový nebo širší mandát člověk potvrzuje
v Dashboardu Lazurio účtem s čerstvým ověřením, mimo Osobní Prostředí, ve
kterém Buddy běží (Lazurio decisions 0089 a 0180). Buddy si mandát sám
nevydá ani nerozšíří; denní akce uvnitř platného mandátu nové potvrzení
nepotřebují. Všechny přímé konverzace s Buddym jsou jedna konverzace napříč
bublinou Lazuria a kanály, jako je Telegram. Spolu s pamětí patří do
Personalspace; Lazurio ověřuje provoz a obnovitelnost Osobního Prostředí, ne
obsah konverzací.

Personalspace je výhradní intimní trust boundary právě tohoto člověka a
jeho Buddyho. Jinému Kolegovi, AI Kolegovi, Stewardovi, Adminovi ani
provozovateli platformy či hostingu se nemountuje ani nenasdílí. Společná
práce patří do Organizace nebo do vědomě exportovaného Draftu (Lazurio
decision 0091).

Toto repo je template, ne živý osobní prostor. Výsledné repo musí být vždy
private a pojmenované přesně:

```text
<github-login>/<github-login>_GEN3
```

V direct-pull Lazurio rootu
[`HumanAndMachines/Lazurio`](https://github.com/HumanAndMachines/Lazurio) se
mountuje do:

```text
personalspace/<github-login>_GEN3
```

## Nejrychlejší bezpečná cesta

Z kořene Lazuria spusť stejný Bun příkaz v macOS/Linux shellu
i Windows PowerShellu:

```text
bun run personalspace:create -- --display-name "<jméno>" --apply --install-gbrain
```

Na Lazurio Environmentu stačí `lazurio personalspace install` (nebo Nastavení
→ Obsah Environmentu v Launchpadu): Lazurio Platform repo z template založí,
naklonuje do Lazurio Folderu a spustí tentýž bootstrap níže (bez
`--install-gbrain`, instalace gbrain CLI zůstává volbou vlastníka).

Pokud už repo z template existuje a je naklonované ve správném mountu, spusť
uvnitř něj:

```text
bun run bootstrap -- --display-name "<jméno>" --apply --install-gbrain
bun run doctor
```

Bootstrap před zápisem živě ověří GitHub login, private visibility, remote
a mount path. Založí nebo připojí samostatné private
`<github-login>/<github-login>-gbrain`, zatímco software instaluje z veřejného
`garrytan/gbrain`. Nepoužívá `.gitmodules` ani gitlinky.

Pozn. k původu software: fork-of-record, ze kterého se gbrain konzumuje, je
`Lazurio/gbrain` (fork toho upstreamu) — doctor na něj odkazuje ve své nápravě
a Buddy v Osobním Prostředí bere gbrain z něj (Lazurio decision 0210).
Výchozí deklarace `gbrain.software.*` v template zatím drží upstream; validátor
i veřejné Lazurio schema
[`personal.gen3.schema.json`](https://github.com/HumanAndMachines/Lazurio/blob/main/lazurio/schemas/personal.gen3.schema.json)
přijímají obě vazby.

`--install-gbrain` instaluje gbrain CLI, ale záměrně za vlastníka nevolí
embedding provider, search režim ani nákladový profil a neimportuje osobní
data. Tyto owner-gated kroky navazují podle
[`manual/bootstrap-personalspace.md`](manual/bootstrap-personalspace.md) a
aktuálního upstream `INSTALL_FOR_AGENTS.md`.

Bootstrap Buddy repo nevytváří, nepodporuje `--with-buddy` a manifest
s blokem `buddy` odmítne přepsat. Jak Buddy v Osobním Prostředí souvisí
s Personalspace a jak vypadá jeho blok v `personal.gen3.json`, popisuje
sekce „Buddy v Osobním Prostředí“ v
[`manual/bootstrap-personalspace.md`](manual/bootstrap-personalspace.md).

## Co kam patří

- `personal.gen3.json` — vlastník, privacy hranice a repo kontrakty; výchozí
  template nemá blok `buddy`, Personalspace s Buddym ho deklaruje.
- `personalspace.template.json` — veřejný marker původu a verze bootstrapu.
- `modules.manifest.json` — owner-scoped sloty privátních osobních modulů
  a jejich `module_port_pool` (vyhrazený rozsah 23000–23099; osobní modul
  zakládá `lazurio module create personalspace/<slug>`).
- `workspace/` — gitignored/nested privátní repozitáře osobních aplikací.
- `gbrain/` — celý gitignored mount samostatného private Markdown data repa.
- `buddy/` — gitignored mount private secret-free profilu Buddyho, jen když
  vlastník Buddyho má.
- `manual/` — bootstrap, migrace a recovery.

Existující instance, které historicky nasdílely repo jinému GitHub účtu,
projdou jednorázovým odebráním grantů podle
[`manual/revoke-legacy-sharing.md`](manual/revoke-legacy-sharing.md). `bun run
doctor` pak fail-closed ověřuje skutečné GitHub collaborators u owner, gbrain a
materializovaných osobních modulových rep; prázdné `shared_spaces` samo
nestačí.

## Doctor: vlastní, ale napojitelný

Doctor není jeden program (Lazurio decision 0118). Root doctor v kořeni
Lazuria nese *standardizované* kontroly; tenhle Personalspace si nese
**vlastní nezávislý doctor**, který root najde podle bloku `doctor` v
`personal.gen3.json` a zavolá. Důvod je vlastnický, ne technický: pull kořenového
repa nesmí rozbít prostor, který má vlastní konfiguraci.

Z toho plyne, že doctor musí umět běžet i **samostatně**. V Lazurio Folderu
(třeba v Osobním Prostředí) nad `<login>_GEN3` Git checkout rootu není
a v samostatném checkoutu nad ním nemusí být nic z Lazuria — rodičovský
adresář se přitom `personalspace` klidně jmenovat může. Kontroly kořene
(`launchpad.gen3.json`, ignorovaný mount, gitlinky kořene) se proto hlásí jako
`not_applicable` s důvodem `owned_by_root` (pod Lazurio Folderem
`no_such_mount`). Nejsou PASS (netvrdíme, co jsme
nepozorovali) a nejsou FAIL (nevlastníme je). Co doctor opravdu vlastní —
privacy repozitářů, nested klony `gbrain/` a `buddy/`, dostupnost `gbrain` CLI,
materializace profilu — platí dál a beze slevy.

| příkaz | k čemu |
| --- | --- |
| `bun run check` | automaticky rozliší distribuční template a materializovanou privátní instanci; v CI instance běží statické privacy a kontraktní kontroly bez přístupu ke gbrainu |
| `bun run check:instance` | statické kontroly plus živý lokální Doctor nad private GitHub repy a mounty |
| `bun run doctor` | lidský výpis včetně `BLOCKED` a `N/A` řádků |
| `bun run doctor:json` | v3 report na stdout; přesně to, co spouští root doctor |
| `bun run doctor:conformance` | konformní test surfacu proti tomuhle doctorovi |
| `bun run check:doctor-surface` | vendorovaná kopie surfacu + testy doctora (součást `bun run check`) |

Exit kódy: `0` = ok\|warn · `1` = fail · `2` = incomplete (aspoň jedna kontrola
`blocked`, tedy nepozorovaná) · `3` = report vůbec nevznikl. **`incomplete` nikdy
nesplní bránu** — chybějící `gbrain` CLI se hlásí jako `blocked` s návodem na
nápravu, ne jako tiché PASS.

Společný surface (schéma reportu, odvození souhrnu, konformní harness) je
byte-identický self-contained compatibility snapshot; jeho identitu a otisky drží
[`schemas/vendored-doctor-surface.json`](schemas/vendored-doctor-surface.json).
Snapshot je nutný právě proto, že nad Personalspace nemusí být Lazurio root,
ze kterého by šel surface naimportovat.

## Co se nikdy necommituje

- Secrets, OAuth sessions, API tokeny, hesla, privátní klíče, cookies nebo
  provider credentials.
- Lokální databáze, indexy, runtime cache ani obsah jakéhokoli cizího
  Personalspace. Cizí Personalspace se nesdílí ani nemountuje.
- `.gitmodules` nebo gitlinky.

Detailní postup a ruční fallback drží
[`manual/bootstrap-personalspace.md`](manual/bootstrap-personalspace.md).
Buddy přichází s Osobním Prostředím (Lazurio decision 0210); není skrytou
funkcí tohoto bootstrapu.

## Licence

Template je source-available pod
[FSL-1.1-Apache-2.0](LICENSE.md), stejně jako Lazurio.
