# Public-readiness audit

Distribuční target je `Lazurio/PersonalspaceTemplate_GEN3`. Veřejné je pouze
template repo; každý Personalspace vytvořený z něj musí zůstat private.

## Clean-room původ

Veřejné repo nevzniklo forkem ani přepnutím visibility historického pracovního
repozitáře. Publikační snapshot se připravil z ověřeného aktuálního stromu,
zbavil private a deprecated user-facing odkazů a vložil do nového GitHub
repository networku jako jediný anonymizovaný root commit. Nepřenášely se:

- staré branche, tagy, notes ani `refs/pull/*`;
- issues, PR diskuse, reviews nebo přílohy;
- Actions runy, logy, artifacty nebo cache;
- releases, LFS, wiki, Pages, Discussions, Projects nebo environments;
- webhooks, deploy keys, secrets, variables nebo GitHub App vazby;
- původní author/committer e-mailová metadata.

Tento řez je záměrný. Provider-managed PR refy a attached surfaces nejdou
důvěryhodně odstranit přepisem běžné Git historie, takže původní private repo
zůstává oddělený auditní archiv a není distribuční autoritou.

## Statický Git gate

`bun run audit:history` kontroluje všechny dosažitelné commity a unikátní
bloby, názvy souborů a refů, commit messages, anotované tagy i dangling
objekty. Gate odmítá známé secret/token/private-key patterny, interní absolutní
cesty, zakázané privacy cesty, symlinky, gitlinky a nepřiměřeně velké bloby.
Audit loguje pouze počet e-mailových identit, nikdy jejich hodnoty.

`bun run check` navíc ověřuje template marker, private deklarace owner/gbrain
repozitářů, nulový Buddy binding, oddělené nested repozitáře, vendorované
doctor otisky, cross-platform testy a byte-identický agent-skill mirror.

## GitHub surface gate

Při prvním zveřejnění a po každé změně provider topologie se metadata-only
readbackem ověřuje:

1. přesný `nameWithOwner`, public visibility, default branch, `is_template`
   a expected HEAD;
2. úplný seznam Git refs a nulová neočekávaná branch/tag/PR historie;
3. Actions runy, logy, artifacty a cache;
4. issues, PR, releases, deployments, environments, Pages, wiki,
   Discussions, Projects a Packages;
5. rulesety, branch protection, collaborators/invitations, deploy keys,
   webhooks, Actions/Codespaces secret a variable **názvy** a dostupné GitHub
   App vazby;
6. clean clone a nový `bun run check` mimo publikační checkout.

Hodnoty secrets, tokenů, OAuth URL/kódů, cookies nebo credentials se při
auditu nikdy nečtou ani nelogují. Pokud nelze povrch pozorovat, stav není PASS.

## Rollback

Jakýkoli nález osobních metadat, secretu nebo neočekávaného provider surface
ruší public-readiness verdikt. První bezpečný krok je vrátit nové repo na
private, zmrazit další zápisy a zastavit consumer cutover. Oprava vznikne jako
nový clean-room snapshot nebo přes přesně doloženou provider nápravu; nález se
nezakrývá přepisem canonical branche.

Public template nikdy neautorizuje veřejnou Personalspace instanci. Bootstrap
i doctor dál fail-closed vyžadují private owner, gbrain a materializované
osobní modulové repozitáře.
