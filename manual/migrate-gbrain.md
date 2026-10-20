# Migrace existujícího gbrainu

Použij až po vytvoření validního private `<github-login>/<github-login>_GEN3`
a samostatného private gbrain data repa.

## Cílový mount

```text
personalspace/<github-login>_GEN3/gbrain
```

`gbrain/` je samostatný Git checkout. Personalspace super-repo jej celé
ignoruje; Markdown se commituje v gbrain data repu, ne v super-repu.

Má-li Personalspace Buddyho, je Buddy v Osobním Prostředí jedním z aktivních
writerů gbrainu (přes MCP, Lazurio decision 0210): podle kroku 1 ho před
migrací zastav a podle kroku 8 po ní ověř jeho zápis a čtení. Bootstrap
manifest s blokem `buddy` nepřepisuje.

## Migrační checklist

1. Urči dnešní kanonický Markdown source a zastav aktivní writery.
2. Udělej read-only inventář secrets, runtime DB/indexů a osobních dat.
3. Přenes pouze Markdown/source soubory do checkoutu `gbrain/`.
4. Neimportuj `.env`, tokeny, OAuth sessions, databáze ani indexy.
5. Aktualizuj Obsidian/editor vault na nový checkout.
6. Zkontroluj `git -C gbrain status --short` a publikuj jen schválené source
   soubory.
7. Po owner-gated inicializaci a volbě search režimu spusť tam, kde gbrain
   běží (s Buddym v Osobním Prostředí),
   `gbrain import ./gbrain` a `gbrain doctor --json`.
8. Ověř známý zápis přes gbrain/MCP bez kopírování jeho obsahu do logu.
9. Starý source vyřaď až po ověření všech writerů a rollbacku.

`bun run doctor` navíc ověří private visibility, remote, nested repo hranici
a zákaz submodulů.
