# Personalspace GEN3 — pravidla pro agenty

Toto veřejné repo je distribuční template, ne živý Personalspace. Každé repo
vytvořené z template musí být private; v něm je Principálem vždy vlastník
prostoru. Buddy není podmínkou platného Personalspace a jeho hosted onboarding
patří do odděleného CAC-0072. Obsah vytvořené instance považuj za osobní,
dokud vlastník výslovně neurčí jinak.

Personalspace je výhradní intimní prostor právě jednoho Principála a jeho
volitelného Buddyho. Jinému Kolegovi, AI Kolegovi, Stewardovi, Adminovi ani
platformnímu operatorovi ho nenasdílej, nemountuj a nezpřístupňuj. Společná
práce patří do Organizace nebo do vědomě exportovaného Draftu (Lazurio
decision 0091).

Pokud Personalspace obsahuje Buddyho, Buddy je důvěryhodný osobní Agent
Principála s plnou agenturou nad vědomě delegovanými zdroji. Nevyžaduje nové
potvrzení každé akce, kterou pokrývá aktuální trvalý mandát. Jeho morální
kontrakt a mandáty žijí v private secret-free profilu `<login>-buddy` jako
`CONSTITUTION.md` a `MANDATES.md`. Dashboard smí spravovat instalaci, update,
health, backup, restore a rollback hostu; není permission brokerem pro
každodenní rozhodování Buddyho.

Buddy smí změnu mandátu připravit jako Draft. Účinný je jen exact profile
commit, který Principál přijme přes owner-controlled surface mimo Buddy runtime
write custody; Buddy si nemůže sám rozšířit autoritu. Platný přijatý mandát pak
nevyžaduje per-action potvrzení.

Hosted Zulip je intimní privátní prostor právě jednoho Principála a jeho
Buddyho. Jeho obsah se nesmí posílat platform operátorovi, verifieru, jinému
člověku ani jinému Buddymu. Komunikace ven probíhá jiným explicitně zvoleným
kanálem.

Zulip je jediný výchozí chat Buddy instalace. Telegram ani voice nejsou součást
owner bootstrapu, host instalace nebo readiness gate; Telegram si může Principál
později výslovně nastavit přes Hermes settings. Každý GEN2 i GEN3 Buddy používá
vlastní dedikovaný Hetzner VPS, nikdy pooled host. První funkční gate je skutečný
Hermes ↔ gbrain MCP write/read/use tok.

## Ve kterém světě jsi

Tohle je **tvůj** Personalspace — privátní digitální mašina jednoho člověka
(Principála) v širším světě koexistence lidí a strojů. Ten svět drží
hierarchie, přesně ohraničené hranice a definované procesy, ne ad-hoc důvěra.
Co tu platí:

- **Prostor je jen tvůj a tvého volitelného Buddyho.** Bez Buddyho sem vstupuje
  jen Principál. Žádný jiný Kolega, AI Kolega, Steward, Admin ani platformní
  operator tvůj Personalspace ani gbrain nečte.
- **Na své mašině máš plná práva.** Buddy i Task Agenti pracují pod tvými
  účty a přihlášeními a žádné vlastní pravomoce nemají. Task Agenti (Codex,
  Claude Code apod.) tvoří Drafty, dokud je neschválíš; Buddy jedná v rámci
  svých trvalých mandátů (viz níže) a akci, kterou platný mandát jednoznačně
  pokrývá, nepotvrzuješ znovu — Buddy ti ji pravdivě reportuje.
- **Buddy je osobní, ne firemní.** Váže vás intimní kontrakt Principál ↔ Buddy.
  Buddy jedná tvým jménem podle scoped, čitelných a odvolatelných mandátů;
  Dashboard řídí jen životní cyklus hostu, ne jeho každodenní rozhodování.
  Firemní kontext a rozhodnutí patří do Organizace, ne sem.
- **Přístupy drží GitHub a proces, ne vymyšlené mechanismy.** GitHub granty
  jsou jediná autorita přístupů k repozitářům; žádný agent nezavádí druhou
  autoritu, nepojmenovanou roli ani neohraničený přístup. Co nejde zajistit
  mechanizmem, drží pojmenovaný proces a morální kontrakt.

Tenhle text je úplný sám o sobě. Provenienci drží Lazurio decisions `0089`,
`0091`, `0092` a `0094`.

## Doctor tohoto prostoru

Doctor není jeden program (Lazurio decision 0118). Root doctor
v kořeni Lazuria nese standardizované kontroly; tenhle Personalspace si
nese vlastní nezávislý doctor deklarovaný blokem `doctor` v
`personal.gen3.json`. Pull kořenového repa nesmí rozbít prostor s vlastní
konfigurací, takže vlastní kontrola patří do vlastního repa.

Doctor proto musí běžet i **samostatně**: na Buddy VPS nad `<login>_GEN3` žádný
kořen není. Kontroly kořene se v takovém běhu hlásí jako `not_applicable`
s důvodem `owned_by_root` — nikdy jako PASS a nikdy jako FAIL. Co doctor
vlastní, platí beze slevy; co nešlo pozorovat, je `blocked` s návodem na
nápravu a shazuje bránu (`incomplete`, exit 2). Nepřepisuj nepozorovanou
kontrolu na zelenou a nepřidávej `skip` — ten stav ve v3 neexistuje.

Vendorovaná kopie surfacu (`schemas/doctor-report.schema.json`,
`scripts/doctor-surface-lib.mjs`, `scripts/doctor-conformance.mjs`,
`scripts/json-schema-mini.mjs`) se needituje na místě; její původ a otisky drží
`schemas/vendored-doctor-surface.json` a hlídá `bun run check:doctor-surface`.

## Source of truth

- `personal.gen3.json` je strojový root kontrakt Personalspace.
- `modules.manifest.json` deklaruje privátní osobní moduly pod `workspace/`.
- `gbrain/` je gitignored mount samostatného privátního Markdown data repa.
  Není workspace modul ani kopie veřejného software repa.
- `manual/` drží opakovatelné postupy pro bootstrap, migraci a recovery.

## Soukromí a bezpečnost

- Nikdy necommituj secrets, OAuth sessions, tokeny, hesla, privátní klíče,
  cookies ani hodnoty `.env`.
- Nepřesouvej sem firemní nebo klientský source of truth. Trvalá firemní
  rozhodnutí patří do příslušné Organizace/Workspace.
- Personalspace ani gbrain nesdílej s jiným člověkem, AI Kolegou, počítačem ani
  GitHub collaboratorem. Jedinou další identitou uvnitř hranice může být Buddy
  tohoto Principála.
- `secrets/` zůstává pouze lokální a gitignored.
- Nepřidávej `.gitmodules` ani gitlinky. Personalspace, gbrain i osobní moduly
  jsou Doctor-managed gitignored nested repozitáře.

## Napojení na externí aplikace

Osobní napojení na externí aplikace (osobní e-mail, kalendář, úložiště…) se
dělá primárně lokálně definovaným MCP serverem nebo CLI nástrojem na dané
mašině. Nové napojení se nikdy nezřizuje přes ChatGPT/claude.ai konektor ani
sdílený cloudový broker — vážou se na cloudový účet a roznesou osobní
přihlášení přes všechny mašiny; už nainstalovaný konektor se používat smí,
nový agent sám neinstaluje. Definice patří do user-level configu harnessu pod jménem
`personal_<provider>`; OAuth granty, client JSONy a token cache do gitignored
`secrets/<provider>/<scope>/<purpose>` (`0700`/`0600`). Org integrace sem
nepatří — žijí v katalogu své Organizace; izolace platí oběma směry. Postup:
`manual/personal-external-app-integrations.md`; kanonický standard drží
Lazurio root `manual/external-app-integrations.md`.

## Očekávaný mount

```text
<Lazurio-root>/personalspace/<github-username>_GEN3
```

Název adresáře musí odpovídat `owner.github_username + "_GEN3"` a
`repository.mount_path`. Owner repo i gbrain data repo musejí být private.

## Osobní moduly

Privátní nested repozitáře vytvářej pod `workspace/` a deklaruj je
v `modules.manifest.json`. Defaultní přístup je private a moduly se nesmějí
objevit v Organization discovery.

## Agent skills

Opakovatelné osobní postupy Principála a Buddyho patří do `.agents/skills/`
(registry `.agents/skills/manifest.json`; každý skill má `## Kdy použít`,
`## Postup` a `## Ověření`). `.claude/skills` je **Git-tracked odvozený
byte-for-byte mirror** kanonického katalogu — obyčejné soubory
`<slug>/SKILL.md`, žádné symlinky ani junctiony (Lazurio decision
0104; symlink model na Windows nefunguje spolehlivě). Mirror není druhý
source of truth: edituj výhradně `.agents/skills/`, mirror regeneruje
`bun run repair:agent-skills` a paritu hlídá `bun run doctor:agent-skills`
(součást `bun run check`). Mirror commitni ve stejném diffu jako kanonickou
změnu. Osobní skilly jsou privátní obsah Personalspace — nikdy je nekopíruj
do Organizací; obecné poučení převeď do anonymizované podoby přes skill
`personalspace-boundary-check`.
