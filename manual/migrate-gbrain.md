# Migrace existujícího gbrainu

Použij až po vytvoření validního private `<github-login>/<github-login>_GEN3`
a samostatného private gbrain data repa.

## Cílový mount

```text
personalspace/<github-login>_GEN3/gbrain
```

`gbrain/` je samostatný Git checkout. Personalspace super-repo jej celé
ignoruje; Markdown se commituje v gbrain data repu, ne v super-repu.

Pokud má Personalspace Buddy binding, tento CAC-0071 postup nepoužívej.
Pokračuj podle odděleného CAC-0072 runbooku; localhost bootstrap nesmí
Buddy-enabled manifest přepsat ani aktivovat hosted runtime.

## Migrační checklist

1. Urči dnešní kanonický Markdown source a zastav aktivní writery.
2. Udělej read-only inventář secrets, runtime DB/indexů a osobních dat.
3. Přenes pouze Markdown/source soubory do checkoutu `gbrain/`.
4. Neimportuj `.env`, tokeny, OAuth sessions, databáze ani indexy.
5. Aktualizuj Obsidian/editor vault na nový checkout.
6. Zkontroluj `git -C gbrain status --short` a publikuj jen schválené source
   soubory.
7. Po owner-gated inicializaci a volbě search režimu spusť na povoleném
   runtime hostu
   `gbrain import ./gbrain` a `gbrain doctor --json`.
8. Ověř známý zápis přes gbrain/MCP bez kopírování jeho obsahu do logu.
9. Starý source vyřaď až po ověření všech writerů a rollbacku.

`bun run doctor` navíc ověří private visibility, remote, nested repo hranici
a zákaz submodulů.
