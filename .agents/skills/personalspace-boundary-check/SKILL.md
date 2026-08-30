# Personalspace boundary check

Kontrola privátní hranice Personalspace před zápisem nebo exportem obsahu
(Lazurio decisions 0091 a 0104; AGENTS.md tohoto repa).

## Kdy použít

- Před každým zápisem do Personalspace jménem Principála.
- Před každým exportem obsahu ven — do Organizace, do chatu s dalšími lidmi,
  do sdíleného repozitáře nebo do jiného nástroje.
- Když si nejsi jistý, jestli poznatek patří do Personalspace, nebo do
  Organizace.

## Postup

1. Ověř, že pracuješ v Personalspace právě jednoho Principála a že Principál
   je vlastník tohoto prostoru. Cizí Personalspace se nemountuje, nečte ani
   nezpřístupňuje — Stewardovi, Adminovi ani platform operatorovi.
2. Zápis dovnitř: osobní kontext, poznámky a paměť Principála patří sem;
   business pravda Organizace sem nepatří — pro tu založ Draft/PR v repu
   dané Organizace.
3. Export ven jen jako vědomý Draft: obsah, který má opustit Personalspace,
   převeď do anonymizované/obecné podoby nebo ho nech Principála výslovně
   schválit. Nikdy nekopíruj secrets, osobní data ani obsah jiné Organizace.
4. Když hranice není jasná, nech obsah v Personalspace a ven pošli jen scoped
   pointer nebo issue — ne kopii obsahu.

## Ověření

- Zapsaný obsah je v Personalspace vlastníka, ne v cizím prostoru.
- Export má podobu vědomého Draftu schváleného Principálem.
- `bun run doctor` na instanci nehlásí porušení privátní hranice.
