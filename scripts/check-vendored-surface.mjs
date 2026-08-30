// Brána nad vendorovaným společným surfacem doctorů (decision 0118).
//
// Personalspace doctor musí běžet SAMOSTATNĚ — na Buddy VPS není žádný Lazurio
// root, ze kterého by šel surface naimportovat. Snapshot je proto nutný, ale
// nesmí být tichý: kdo do něj sáhne, musí přepsat i sha256
// v schemas/vendored-doctor-surface.json, a tím je cizí soubor upravený na místě
// vidět v diffu. Runtime drift chytá root doctor (children[].outcome =
// schema_invalid); tahle brána chytá drift v repu.

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const provenancePath = "schemas/vendored-doctor-surface.json";
const provenance = JSON.parse(await readFile(join(root, provenancePath), "utf8"));
const failures = [];

if (provenance.schema_version !== "humanandmachines.vendored-doctor-surface.v1") {
  failures.push(`${provenancePath}: neznámá schema_version`);
}
if (!provenance.source?.snapshot || !provenance.source?.decision) {
  failures.push(`${provenancePath}: kopie bez snapshot identity a decisionu není provenance, jen tvrzení`);
}
if (!Array.isArray(provenance.files) || provenance.files.length === 0) {
  failures.push(`${provenancePath}: chybí seznam vendorovaných souborů`);
}

for (const entry of provenance.files ?? []) {
  let content;
  try {
    content = await readFile(join(root, entry.path));
  } catch (error) {
    failures.push(`${entry.path}: vendorovaný soubor chybí (${error.message})`);
    continue;
  }
  const digest = createHash("sha256").update(content).digest("hex");
  if (digest === entry.sha256) continue;
  // Rozdíl jen v koncích řádků není edit, ale chybějící `-text` v .gitattributes.
  // Bez téhle diagnostiky vypadá Windows checkout jako by někdo přepsal všechny
  // čtyři vendorované soubory najednou.
  const normalized = createHash("sha256")
    .update(content.toString("utf8").replaceAll("\r\n", "\n"))
    .digest("hex");
  if (normalized === entry.sha256) {
    failures.push(
      `${entry.path}: obsah sedí, ale konce řádků ne (CRLF). Doplň pro tenhle soubor `
      + "`-text` do .gitattributes; byte-identická kopie nesmí záviset na OS checkoutu.",
    );
    continue;
  }
  failures.push(
    `${entry.path}: sha256 ${digest} neodpovídá zaznamenanému ${entry.sha256}. `
    + "Compatibility snapshot se needituje na místě — přenes celý reviewovaný "
    + "surface a aktualizuj všechny otisky společně.",
  );
}

if (failures.length > 0) {
  console.error("Vendorovaný doctor surface FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `Vendorovaný doctor surface PASS (${provenance.files.length} souborů, `
  + `snapshot ${provenance.source.snapshot}, decision ${provenance.source.decision})`,
);
