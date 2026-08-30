# Vytvoření Personalspace GEN3

Tento kanonický owner postup vytvoří private Personalspace bez Buddyho podle
CAC-0071. Funguje na macOS, Linuxu i ve Windows PowerShellu. Nevytváří Buddy
repo, nepřidává blok `buddy` a nemá přepínač `--with-buddy`.

Hosted Buddy má oddělenou generační i trust hranici:

- Buddy GEN2 se pro první piloty nasazuje ručně platform operátorem na
  dedikovaný VPS podle CAC-0072 runbooku;
- Buddy GEN3 bude budoucí deterministický `create-new` tok z Dashboardu;
- ani jedna cesta nesmí instalovat nebo spouštět Buddyho či Hermes lokálně.

## Než vlastník začne

Musejí být splněné všechny tyto gaty:

- `Lazurio/PersonalspaceTemplate_GEN3` je public, má GitHub template flag a
  jeho `main` prošel `bun run check`.
- Veřejný Lazurio root `HumanAndMachines/Lazurio` je naklonovaný v
  `~/Conglomerate`
  a obsahuje mountpoint `personalspace/`.
- GitHub CLI je přihlášené pod účtem budoucího vlastníka Personalspace.

Pokud některý gate chybí, repo zatím negeneruj. Rootový příkaz tyto podmínky
ověřuje fail-closed před jakýmkoli zápisem.

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

Blok `buddy` v souboru nesmí být. Gbrain binding musí mířit na nakonfigurované
`<gbrain-repo>` (výchozí `<login>/<login>-gbrain`) a deklarovat
`visibility: private`.

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
odkazuje doctor v nápravě `BLOCKED gbrain.cli`. Deklarace v manifestu zatím drží
upstream, protože ji veřejné Lazurio schema
[`personal.gen3.schema.json`](https://github.com/HumanAndMachines/Lazurio/blob/main/lazurio/schemas/personal.gen3.schema.json)
pinuje jako `const`; sjednotit obojí je samostatná změna Lazurio rootu.
Aktuální postup drží
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

## Hosted Buddy GEN2 a budoucí Buddy GEN3

Hosted část není pokračování, které by tento owner bootstrap směl spustit.
První Buddy GEN2 piloty provádí platform operátor podle interního provozního
runbooku; veřejný template tento privilegovaný postup nedistribuuje.
Buddy GEN3 `create-new` bude samostatný Dashboard tok; nevzniká rozšířením
lokálního bootstrapu o `--with-buddy`.

První ruční GEN2 VPS se po dokončení Dashboard lifecycle a billingu nemusí
reinstalovat. Platform operator jej může read-only spárovat a po potvrzení
Principálem převzít do správy interním `register-existing-host`. Tento tok
nemění owner data, není součástí bootstrapu a není to GEN1 `adopt-existing`.

Buddy GEN2 i GEN3 jsou důvěryhodní osobní Agenti se stejnou agenturou nad
zdroji, které jim Principál vědomě svěří. Rozdíl generací je v řízení životního
cyklu: GEN2 instaluje a aktualizuje operátor ručně, GEN3 deterministicky
Dashboard. Dashboard neslouží jako per-action permission broker. Morální
kontrakt, červené linie a trvalé mandáty žijí v private profilu
`<login>-buddy` jako `CONSTITUTION.md` a `MANDATES.md`.

### Owner kroky

Vlastník:

1. dokončí a zvaliduje private Personalspace a private gbrain podle tohoto
   manuálu;
2. požádá o hosted Buddyho a vědomě odsouhlasí cenu, region a zdroje, které
   Buddymu deleguje;
3. vlastní private secret-free profil repo `<login>/<login>-buddy`, společně
   s Buddym doplní `CONSTITUTION.md` a `MANDATES.md` a schválí teach-back jeho
   role;
4. přes owner-controlled surface mimo Buddy runtime write custody přijme exact
   profile commit; Buddy může změnu mandátu draftovat, ale nemůže si ji sám
   aktivovat;
5. přijme, že hosted Zulip je privátní safe space právě pro něj a Buddyho;
6. přijme dedikovaný Hetzner VPS jako cílovou topologii GEN2 i GEN3; nejde o
   přechodnou fázi před pooled hostingem;
7. potvrdí, že základní instalace používá pouze Zulip. Telegram ani voice se
   neinstalují; Telegram lze později výslovně nastavit přes Hermes settings;
8. provede vlastní provider login bezpečným kanálem, až ho runbook vyžádá.

Vlastník lokálně neinstaluje ani nespouští Buddyho, Hermes, gateway nebo
hosted Buddy gbrain MCP. Owner-gated lokální gbrain aktivace z předchozí sekce
zůstává samostatnou funkcí Personalspace; nesmí se vydávat za hosted Buddy
runtime. Lokální Buddy checkout je pouze owner custody/editace zdrojů.

### Platform-operator kroky

Platform operátor podle runbooku:

1. přidělí dedikovaný VPS a nastaví backup;
2. nastaví DNS, TLS a tailnet-only admin přístup;
3. vydá per-host least-privilege deployment credential;
4. materializuje pouze tři private owner repozitáře a verzovaný Buddy runtime;
5. uloží secrets, sessions a runtime databáze mimo Git;
6. nejdřív ověří reálný Hermes ↔ gbrain MCP write/read/use tok nad syntetickým
   artefaktem bez osobního obsahu;
7. nastaví Zulip pro právě jednoho Principála a Buddyho, aniž čte nebo
   exportuje jeho soukromý obsah;
8. ověří reálný tok gbrain ↔ Hermes ↔ Zulip, restart po rebootu,
   backup/restore, rollback, profilový kontrakt a absenci checkoutu Organizace.

### Viditelné `BLOCKED` gaty

- **BLOCKED — interní readiness:** CAC-0072 named pilot nesmí pokračovat,
  dokud interní Buddy GEN2 proving host nemá doložený `GO` nad celým
  readiness checklistem.
- **BLOCKED — founder:** konkrétní host čeká na explicitní potvrzení
  ceny/nákupu VPS, regionu, DNS, Tailscale, GitHub credential hranice a
  provider login postupu.
- **BLOCKED — operator evidence:** host není hotový, dokud testy reálného
  runtime, private Zulipu, rebootu, backup/restore, rollbacku,
  no-org-checkoutu, Buddy profilu a secret-free Gitu neprošly. Canned nebo
  placeholder odpověď není `PASS`.
- **BLOCKED — Buddy GEN3 automatizace:** Dashboard `create-new` není připravený
  k použití, dokud stejný machine-readable verification framework neprokáže,
  že deterministicky splní kontrakt odvozený z manuálních Buddy GEN2 hostů.

Tyto gaty neblokují localhost Personalspace bez Buddyho. Runbook ani tento
manuál samy žádnou founder akci neautorizují.

Verifier ani platform operátor neposuzuje jednotlivá Buddy rozhodnutí a
nečte privátní chat nebo gbrain. Ověřuje instalaci, privacy, lifecycle a
obnovitelnost; morální kontrakt přijímá Principál přes teach-back.

Aktuální veřejné Lazurio schema už drží Buddyho jako volitelný blok; hosted
gaty proto neblokují localhost Personalspace bez Buddyho.

## Done definition

- Owner repo i gbrain repo jsou na GitHubu private.
- Checkout, login, remote a mount path se přesně shodují.
- `personal.gen3.json` nemá blok `buddy`.
- Personalspace i gbrain jsou nested repa bez `.gitmodules` a gitlinků.
- `bun run check:instance` a po owner-gated aktivaci také
  `gbrain doctor --json` prošly.
- Žádný secret ani runtime DB/index není trackovaný.
- Hosted Buddy GEN2 ani Buddy GEN3 nejsou podmínkou dokončeného owner
  bootstrapu; jejich `BLOCKED` stav se reportuje odděleně.
