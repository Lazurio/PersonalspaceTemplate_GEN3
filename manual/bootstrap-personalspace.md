# Vytvoření Personalspace GEN3

Tento kanonický owner postup vytvoří private Personalspace bez Buddyho.
Funguje na macOS, Linuxu i ve Windows PowerShellu. Nevytváří Buddy repo,
nepřidává blok `buddy` a nemá přepínač `--with-buddy`.

Buddy k tomuto postupu nepatří: přichází s Osobním Prostředím (Lazurio
decision 0210). Jak s Personalspace souvisí, popisuje sekce „Buddy v Osobním
Prostředí“ níže.

## Než vlastník začne

Musejí být splněné všechny tyto gaty:

- `Lazurio/PersonalspaceTemplate_GEN3` je public, má GitHub template flag a
  jeho `main` prošel `bun run check`.
- Nad mountpointem `personalspace/` je Lazurio: buď veřejný Lazurio root
  `HumanAndMachines/Lazurio` naklonovaný v `~/Conglomerate`, nebo Lazurio
  Folder, který zakládá Lazurio Platform (viz „Automaticky z Lazurio
  Platform" níže).
- GitHub CLI je přihlášené pod účtem budoucího vlastníka Personalspace.

Pokud některý gate chybí, repo zatím negeneruj. Rootový příkaz tyto podmínky
ověřuje fail-closed před jakýmkoli zápisem.

### Co bootstrap kontroluje nad `personalspace/`

Bootstrap i doctor poznají rodiče mountu podle souboru, nikdy podle jména
adresáře:

| Nad `personalspace/` | Poznávací soubor | Kořenové Git kontroly (mount ignorovaný, žádné gitlinky) |
| --- | --- | --- |
| Lazurio root checkout | `launchpad.gen3.json` | vždy; bez Gitu bootstrap skončí chybou |
| Lazurio Folder Platformy | `.lazurio/preferences.json` | jen když Folder leží v nějakém Git repozitáři; jinak nemá mount kam uniknout |
| nic z toho | — | bootstrap odmítne pokračovat |

Folder má přednost před `launchpad.gen3.json`: Folder předaný hostingem smí
nést legacy `launchpad.gen3.json`, ale Git checkout rootu to není. Doctor
v takovém Folderu hlásí kořenové kontroly jako `not_applicable` /
`no_such_mount`. Všechny kontroly samotného Personalspace (origin, private
repo, gitignore, gitlinky, trackovaný obsah, gbrain) běží všude stejně.

## Automaticky z Lazurio Platform

`lazurio personalspace install` (i Nastavení → Obsah Environmentu
v Launchpadu) dělá kroky 2–7 tohoto manuálu za vlastníka, jen když
`<login>/<login>_GEN3` na GitHubu ještě neexistuje a Platform ho právě
založila:

1. vygeneruje private `<login>/<login>_GEN3` z tohoto template;
2. naklonuje ho do `<Lazurio-Folder>/personalspace/<login>_GEN3`;
3. ověří, že je checkout čistý a nese marker `personalspace.template.json`,
   a spustí v něm tentýž bootstrap:
   `bun run bootstrap -- --login <login> --display-name "<jméno>" --apply`
   (jméno z GitHub profilu, jinak login). Bez `--install-gbrain`: instalace
   gbrain CLI zůstává volbou vlastníka, a doctor proto skončí `incomplete`
   jen kvůli vědomě odloženému `gbrain.cli`;
4. commitne a pushne `personal.gen3.json` a `modules.manifest.json` do
   `main` nového repa a `.gitignore` do `main` gbrain repa (krok 7). Repo
   vzniklo v tomtéž běhu, takže jde o dokončení založení, ne o přepis cizí
   práce.

Když bootstrap selže, Platform nic necommitne ani nepushne, nic nemaže a
nahlásí důvod a další krok: opravit příčinu a v checkoutu spustit bootstrap
znovu (založené gbrain repo i jeho klon přijme), pak publikovat podle kroku 7.

## Existující Personalspace s placeholdery

Personalspace založený dřív bez bootstrapu nese placeholdery
`owner-github-username` a `Owner Display Name`. Jeho `main` je Publikace
vlastníka, proto ho Lazurio Platform nepřepisuje: `lazurio personalspace
install` jen nahlásí stav a další krok. Bootstrap umí běžet z task worktree
a změnu pak vlastník přijme pull requestem:

```text
git -C personalspace/<login>_GEN3 worktree add -b agent/name-owner ../.worktrees/name-owner
cd personalspace/.worktrees/name-owner
bun run bootstrap -- --login <login> --display-name "<jméno>" --apply
git add personal.gen3.json modules.manifest.json
git commit -m "Nastav Personalspace GEN3"
git push -u origin HEAD
gh pr create --fill
```

Z task worktree bootstrap zapisuje jen do worktree. Mount, `gbrain/`
i osobní moduly čte a zakládá v primárním checkoutu, kde Personalspace
opravdu leží; primární checkout a jeho `main` zůstanou netknuté. Nově
založený `gbrain/.gitignore` publikuj zvlášť podle kroku 7.

## 1. Ověř účet vlastníka

Přihlas GitHub CLI pod účtem, který bude Personalspace vlastnit:

```text
gh auth status
gh api user --jq .login
```

Druhý příkaz musí vrátit přesně `<login>`.

Repo bude patřit vlastníkovi, ne Organizaci Lazurio ani účtu, který
template spravuje.

## 2. Vygeneruj private owner repo

Na GitHubu otevři template a zvol **Use this template** → **Create a new
repository**. Nastav:

```text
Owner: <login>
Repository name: <login>_GEN3
Visibility: Private
```

Ekvivalent přes GitHub CLI:

```text
gh repo create <login>/<login>_GEN3 --private --template Lazurio/PersonalspaceTemplate_GEN3
```

I když je upstream public, výsledná instance musí být vždy private.

## 3. Naklonuj repo do Lazurio rootu

macOS/Linux shell:

```text
mkdir -p "$HOME/Conglomerate/personalspace"
gh repo clone <login>/<login>_GEN3 "$HOME/Conglomerate/personalspace/<login>_GEN3"
cd "$HOME/Conglomerate/personalspace/<login>_GEN3"
```

Windows PowerShell:

```text
New-Item -ItemType Directory -Force "$HOME\Conglomerate\personalspace" | Out-Null
gh repo clone <login>/<login>_GEN3 "$HOME\Conglomerate\personalspace\<login>_GEN3"
Set-Location "$HOME\Conglomerate\personalspace\<login>_GEN3"
```

Nepřidávej `.gitmodules` ani gitlink. Owner repo, gbrain a osobní moduly jsou
Doctor-managed gitignored nested repozitáře.

## 4. Spusť nejdřív read-only preflight

Stejný příkaz funguje v macOS/Linux shellu i PowerShellu:

```text
bun run bootstrap -- --display-name "<display-name>" --login <login>
```

Pro AI Kolegu přidej k dry-runu i apply příkazu
`--owner-type ai-colleague`; člověk používá výchozí `human`.

Preflight musí potvrdit:

- owner repo `<login>/<login>_GEN3`;
- mount `personalspace/<login>_GEN3`;
- private visibility owner repa;
- budoucí private gbrain repo `<login>/<login>-gbrain`;
- žádný Buddy binding.

Když preflight ukáže jiný login, remote nebo mount, nepřidávej `--apply`.

## 5. Dosaď identitu a vytvoř gbrain

Po kontrole spusť:

```text
bun run bootstrap -- --display-name "<display-name>" --login <login> --apply --install-gbrain
```

Bootstrap:

1. dosadí identitu do `personal.gen3.json` a `modules.manifest.json`;
2. zachová `personal.gen3.json` bez bloku `buddy`;
3. vytvoří nebo ověří private `<gbrain-repo>`; bez `--gbrain-repo` je výchozí
   hodnota `<login>/<login>-gbrain`;
4. naklonuje gbrain data repo do gitignored `gbrain/`;
5. nainstaluje CLI z deklarovaného `gbrain.software.install_source`;
6. spustí live `bun run doctor`.

Bootstrap nezačne importovat osobní data, nevolí embedding provider ani search
režim a sám nic necommitne ani nepushne.

Doctor po bootstrapu vrací exit kód podle společného surfacu doctorů
(Lazurio decision 0118): `0` = ok|warn, `1` = fail, `2` = incomplete.
Bez `--install-gbrain` je běh typicky **incomplete**, protože `gbrain` CLI není
na PATH a doctor o paměti nic nepozoroval. Scénář: vlastník bootstrapuje večer
bez gbrainu, doctor napíše `BLOCKED gbrain.cli` s návodem na instalaci a
bootstrap dojede — ale nikde netvrdí, že je hotovo. Zelenou dá až běh, ve kterém
gbrain CLI opravdu odpoví.

Bootstrap se přitom rozhoduje z **reportu, ne z exit kódu**: přijme jedině
`incomplete`, ve kterém není nic jiného `blocked` než vědomě odložené
`gbrain.cli`. Scénář, kvůli kterému to tak je: vlastníkovi uprostřed `--apply`
vyprší GitHub token. Doctor poctivě vydá `BLOCKED personalspace.repo_private`
a souhrn `incomplete` — což je stejný exit 2 jako u odloženého gbrainu. Kdyby
bootstrap koukal jen na číslo, napsal by `Bootstrap dokončen` a vlastník by
odešel s vědomím, že jeho repo je private. To nikdo neviděl, takže bootstrap
v takovém případě skončí chybou a řekne, které kontroly se nepozorovaly.

## 6. Zkontroluj konfiguraci bez Buddyho

`personal.gen3.json` musí obsahovat hodnoty konkrétního vlastníka a nesmí
obsahovat blok `buddy`. Musí obsahovat mimo jiné:

```json
{
  "owner": {
    "github_username": "<login>",
    "display_name": "<display-name>",
    "type": "human"
  },
  "repository": {
    "github_repo": "<login>/<login>_GEN3",
    "mount_path": "personalspace/<login>_GEN3",
    "visibility": "private",
    "mount_strategy": "doctor-managed-nested-repo"
  },
  "doctor": {
    "schema_version": "humanandmachines.doctor.declaration.v1",
    "command": ["bun", "scripts/doctor-personalspace.mjs", "--json"],
    "timeout_ms": 120000,
    "scope_type": "personalspace"
  }
}
```

Blok `doctor` je discovery vlastního doctora tohohle prostoru (decision 0118).
Root doctor podle něj podřízené doctory najde a zavolá; kdyby se hádala
konvenční cesta, chybějící doctor by se změnil v ticho místo ve vadu. Scénář:
vlastník smaže blok, aby si „vypnul otravné kontroly" — root pak Personalspace
prostě přeskočí a jeho brána vyjde zeleně, aniž by kdokoli ověřil, že owner repo
je pořád private. Proto deklaraci vynucuje `validatePersonalState`.

V příkladu je lidský vlastník. U AI Kolegy musí být po použití
`--owner-type ai-colleague` hodnota `owner.type` přesně `ai-colleague`.

Blok `buddy` v souboru po bootstrapu není; Personalspace s Buddym ho dostane
později (sekce „Buddy v Osobním Prostředí“). Gbrain binding musí mířit na
nakonfigurované `<gbrain-repo>` (výchozí `<login>/<login>-gbrain`) a
deklarovat `visibility: private`.

## 7. Publikuj oba private repozitáře vědomě

Owner repo:

```text
git status --short
git add personal.gen3.json modules.manifest.json
git commit -m "Nastav Personalspace GEN3"
git push
```

Gbrain repo:

```text
git -C gbrain status --short
git -C gbrain add .gitignore
git -C gbrain commit -m "Ignoruj lokální gbrain runtime"
git -C gbrain push
```

Každý push je publikace do privátního repa vlastníka. Před commitem ověř diff
a nepřidávej `.env`, secrets, tokeny, OAuth/session data, runtime DB ani index.

## 8. Ověř privacy a Doctor gate

```text
gh repo view <login>/<login>_GEN3 --json visibility --jq .visibility
gh repo view <gbrain-repo> --json visibility --jq .visibility
bun run check:instance
```

`<gbrain-repo>` nahraď přesně hodnotou
`gbrain.repository.github_repo` z `personal.gen3.json`; tím zůstává postup
správný i pro `--gbrain-repo` a migrované instance. Obě GitHub kontroly musí
vrátit `PRIVATE` a Doctor musí skončit:

```text
Personalspace Doctor PASS
```

## 9. Aktivuj gbrain až po owner volbě

`--install-gbrain` instaluje jen CLI, a to z hodnoty
`gbrain.software.install_source` v manifestu. Fork-of-record, ze kterého se
gbrain konzumuje, je `Lazurio/gbrain` — fork veřejného upstreamu
`garrytan/gbrain`; upstream se tím nemaže, jen se jmenuje. Právě na fork-of-record
odkazuje doctor v nápravě `BLOCKED gbrain.cli` a z něj bere gbrain i Buddy
v Osobním Prostředí (Lazurio decision 0210). Výchozí deklarace v template zatím
drží upstream; validátor i veřejné Lazurio schema
[`personal.gen3.schema.json`](https://github.com/HumanAndMachines/Lazurio/blob/main/lazurio/schemas/personal.gen3.schema.json)
přijímají obě vazby. Aktuální postup drží
[`garrytan/gbrain/INSTALL_FOR_AGENTS.md`](https://github.com/garrytan/gbrain/blob/master/INSTALL_FOR_AGENTS.md).
Provider, embedding a search režim mají privacy i nákladový dopad, proto je
volí vlastník.

Základní owner-gated tok:

```text
gbrain init --pglite
gbrain search modes
gbrain config set search.mode <ownerem-zvolený-režim>
gbrain doctor --json
gbrain import ./gbrain
gbrain doctor --json
codex mcp add gbrain -- gbrain serve
```

U prázdného brainu lze import přeskočit. Runtime cache zůstává mimo Git.

## Buddy v Osobním Prostředí

Buddy není pokračování tohoto owner bootstrapu a bootstrap ho nezakládá.
Buddy patří k Osobnímu Prostředí (Lazurio decision 0210): je to nabrífovaný
Hermes Agent, který běží v Osobním Prostředí svého člověka jako jeho součást,
ne na vlastní Mašině. Kdo Osobní Prostředí nemá, Buddyho nemá. Samostatný
hostovaný Buddy na dedikované VPS, Resident distribuce Buddyho, ruční
`CAC-0072` runbook pro Buddy hosty i chat přes Zulip skončily; nový Buddy
tak už nevzniká.

V Osobním Prostředí platí:

- Hermes Agent se instaluje z forku `Lazurio/hermes-agent` oficiální cestou
  upstreamu, se zdrojem z forku a přesným commitem, který pinuje Machines.
  gbrain se bere z forku `Lazurio/gbrain`.
- Buddy je jeden a běží v Osobním Prostředí. Checkout tohoto Personalspace na
  vlastním počítači vlastníka druhého Buddyho nespouští.
- Buddy pracuje z Lazurio Folderu jako ostatní agenti, bez sandboxu a
  s plnými právy Osobního Prostředí. Tahy mu zadává jen jeho člověk; obsah
  zvenku jsou pro Buddyho data, ne pokyny.
- Paměť je gbrain nad vaultem v `gbrain/` tohoto Personalspace a Buddy s ní
  pracuje výhradně přes MCP (`gbrain.agent_access: mcp-only`).
- Roli dává Buddymu `SOUL.md` z private secret-free profilu
  `<login>/<login>-buddy` (profile distribution Hermesu), namountovaného
  v gitignored `buddy/`. Secrets do profilu ani do Gitu nepatří.
- Mandáty jsou trvalé, scoped a odvolatelné (0089). Nový nebo širší mandát
  potvrzuje člověk v Dashboardu Lazurio účtem s čerstvým ověřením, mimo Osobní
  Prostředí, ve kterém Buddy běží (0180); Buddy si ho sám nevydá ani
  nerozšíří.
- Všechny přímé konverzace člověka s Buddym jsou jedna konverzace. Spolu
  s pamětí jsou obsahem Personalspace. Nikdo z provozu Lazuria nečte
  konverzace ani gbrain a neposuzuje jednotlivá rozhodnutí Buddyho; ověřuje se
  provoz, privacy a obnovitelnost Osobního Prostředí.

Dosah Buddyho, kanály, bublinu a orchestraci drží Lazurio decision 0210;
tento manuál popisuje jen vazbu na Personalspace.

### Blok `buddy` v `personal.gen3.json`

Personalspace s Buddym ho deklaruje blokem `buddy`. Ten se přidává pull
requestem do Personalspace, až má vlastník Buddyho v Osobním Prostředí;
bootstrap ho nezakládá a manifest s ním odmítne přepsat. Tvar podle 0210:

```json
{
  "buddy": {
    "slug": "<buddy-slug>",
    "gbrain_path": "gbrain",
    "path": "buddy",
    "repository": {
      "github_repo": "<login>/<login>-buddy",
      "visibility": "private",
      "mount_strategy": "doctor-managed-nested-repo"
    },
    "runtime": {
      "deployment_target": "owner-personal-environment"
    },
    "hermes": {
      "software_repo": "Lazurio/hermes-agent",
      "profile_format": "hermes-profile-distribution",
      "profile_path": "buddy"
    }
  }
}
```

Doctor (`personalspace.profile_materialization`) i statická kontrola instance
ověří, že profilové repo patří vlastníkovi a je private, že Buddy běží
v Osobním Prostředí vlastníka a že Hermes je z forku. Pole skončeného modelu
odmítnou s odkazem na 0210: `runtime.deployment_target:
owner-dedicated-personalspace-vps`, `runtime.local_execution` a
`runtime.github_repo` (runtime z Resident distribuce). Deklarace v manifestu
přitom není důkaz běhu: jestli Buddy v Osobním Prostředí opravdu běží, se
prokazuje operací.

## Done definition

- Owner repo i gbrain repo jsou na GitHubu private.
- Checkout, login, remote a mount path se přesně shodují.
- `personal.gen3.json` nemá blok `buddy`.
- Personalspace i gbrain jsou nested repa bez `.gitmodules` a gitlinků.
- `bun run check:instance` a po owner-gated aktivaci také
  `gbrain doctor --json` prošly.
- Žádný secret ani runtime DB/index není trackovaný.
- Buddy není podmínkou dokončeného owner bootstrapu; přichází s Osobním
  Prostředím.
