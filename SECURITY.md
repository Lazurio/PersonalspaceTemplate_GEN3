# Security

Personalspace instance i gbrain data repo musejí být private. Veřejné je pouze
toto anonymizované template repo a software upstream `garrytan/gbrain`.

Do issue, PR ani logu nevkládej obsah osobní paměti, credentials, OAuth
sessions, tokeny nebo privátní klíče. Bezpečnostní nález nahlas vlastníkovi
repozitáře privátním kanálem; veřejný issue použij jen pro reprodukci bez
citlivých dat.

Lokální gate:

```text
bun run check
bun run doctor
```

Doctor nekontroluje jen `.gitignore`: čte Git index Personalspace i gbrain
data repa a fail-closed odmítne trackované secret paths, credentials, runtime
databáze/cache, high-confidence token patterny a symlinky, které by scanner
musel následovat mimo repo.
