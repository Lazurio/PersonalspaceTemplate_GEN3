# PersonalspaceTemplate_GEN3

Veřejný GitHub template pro jeden **privátní** Personalspace GEN3 člověka nebo
AI kolegy. Tento distribuční repo vznikl clean-room publikací bez historie,
PR refů a attached surfaces původního pracovního repa; auditní kontrakt drží
[`manual/public-readiness-audit.md`](manual/public-readiness-audit.md).
Personalspace funguje plnohodnotně bez Buddyho. Owner bootstrap
Buddyho nevytváří ani nespouští:

- hosted Buddy GEN2 se pro první piloty nasazuje ručně platform operátorem
  podle odděleného CAC-0072 runbooku;
- Buddy GEN3 bude budoucí deterministický `create-new` tok z Dashboardu;
- Ručně vzniklý GEN2 host se po dokončení Dashboard lifecycle a billingu může
  bez reinstalace převzít do správy interním `register-existing-host`; není to
  součást owner bootstrapu ani GEN1 `adopt-existing`.

Obě generace jsou tentýž typ důvěryhodného osobního Agenta. GEN3 Buddyho
neuzavírá do per-action approval workflow; přidává deterministickou instalaci,
update, health, backup, restore a rollback. Agenturu drží morální kontrakt,
`CONSTITUTION.md`, odvolatelné trvalé mandáty v `MANDATES.md` a owner
teach-back. Hosted Zulip je privátní safe space právě pro Principála a jeho
Buddyho; platforma ověřuje provoz a obnovitelnost, ne obsah konverzace.

Účinný mandát je exact profile commit přijatý Principálem přes owner-controlled
surface mimo Buddy runtime write custody. Buddy smí změnu draftovat, ale nemůže
si sám vydat širší autoritu; denní akce uvnitř přijatého mandátu nové potvrzení
nepotřebují.

Hosted základ používá pouze Zulip na vlastním dedikovaném Hetzner VPS jednoho
Principála. Telegram ani voice se při instalaci nezapínají; Telegram je jen
pozdější výslovná Hermes integrace vlastníka. První runtime gate je skutečný
Hermes ↔ gbrain MCP write/read/use tok a teprve potom celý gbrain ↔ Hermes ↔
Zulip průchod.

Personalspace je výhradní intimní trust boundary právě tohoto Principála a
jeho volitelného Buddyho. Jinému Kolegovi, AI Kolegovi, Stewardovi, Adminovi
ani platformnímu operatorovi se nemountuje ani nenasdílí. Společná práce patří
do Organizace nebo do vědomě exportovaného Draftu (Lazurio decision
0091).

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
`Lazurio/gbrain` (fork toho upstreamu) — doctor na něj odkazuje ve své nápravě.
Deklarace `gbrain.software.*` v manifestu zatím drží upstream, protože ji
veřejné Lazurio schema
[`personal.gen3.schema.json`](https://github.com/HumanAndMachines/Lazurio/blob/main/lazurio/schemas/personal.gen3.schema.json)
pinuje jako `const`; sjednocení je samostatná změna Lazurio rootu, ne tichý
fork kontraktu tady.

`--install-gbrain` instaluje gbrain CLI, ale záměrně za vlastníka nevolí
embedding provider, search režim ani nákladový profil a neimportuje osobní
data. Tyto owner-gated kroky navazují podle
[`manual/bootstrap-personalspace.md`](manual/bootstrap-personalspace.md) a
aktuálního upstream `INSTALL_FOR_AGENTS.md`.

Bootstrap CAC-0071 Buddy repo nevytváří, nepodporuje `--with-buddy` a
existující Buddy-enabled manifest odmítne přepsat. Kanonický manuál obsahuje
samostatnou hosted sekci s odkazem na manuální CAC-0072 runbook, oddělením
owner a platform-operator kroků a viditelnými `BLOCKED` gaty.

## Co kam patří

- `personal.gen3.json` — vlastník, privacy hranice a repo kontrakty; výchozí
  template nemá blok `buddy`.
- `personalspace.template.json` — veřejný marker původu a verze bootstrapu.
- `modules.manifest.json` — owner-scoped sloty privátních osobních modulů.
- `workspace/` — gitignored/nested privátní repozitáře osobních aplikací.
- `gbrain/` — celý gitignored mount samostatného private Markdown data repa.
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

Z toho plyne, že doctor musí umět běžet i **samostatně**. Na Buddy VPS je
v `<login>_GEN3` Personalspace a nad ním už nic — a rodičovský adresář se
`personalspace` klidně jmenovat může, kořen tam přesto žádný není. Kontroly
kořene (`launchpad.gen3.json`, ignorovaný mount, gitlinky kořene) se proto hlásí
jako `not_applicable` s důvodem `owned_by_root`. Nejsou PASS (netvrdíme, co jsme
nepozorovali) a nejsou FAIL (nevlastníme je). Co doctor opravdu vlastní —
privacy repozitářů, nested klony `gbrain/` a `buddy/`, dostupnost `gbrain` CLI,
materializace profilu — platí dál a beze slevy.

| příkaz | k čemu |
| --- | --- |
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
Snapshot je nutný právě proto, že na Buddy VPS žádný Lazurio root není.

## Co se nikdy necommituje

- Secrets, OAuth sessions, API tokeny, hesla, privátní klíče, cookies nebo
  provider credentials.
- Lokální databáze, indexy, runtime cache ani obsah jakéhokoli cizího
  Personalspace. Cizí Personalspace se nesdílí ani nemountuje.
- `.gitmodules` nebo gitlinky.

Detailní postup a ruční fallback drží
[`manual/bootstrap-personalspace.md`](manual/bootstrap-personalspace.md).
Hosted Buddy GEN2 navazuje pouze přes CAC-0072 runbook odkazovaný v tomto
manuálu; není součástí localhost/template slice. Buddy GEN3 `create-new` je
budoucí Dashboard tok, ne skrytá funkce tohoto bootstrapu.

## Licence

Template je source-available pod
[FSL-1.1-Apache-2.0](LICENSE.md), stejně jako Lazurio.
