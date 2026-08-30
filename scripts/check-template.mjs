import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

import { runCommand } from "./command-runner.mjs";
import {
  DISPLAY_NAME_PLACEHOLDER,
  DOCTOR_COMMAND,
  DOCTOR_DECLARATION_SCHEMA_VERSION,
  DOCTOR_SCOPE_TYPE,
  GBRAIN_INSTALL_SOURCE,
  GBRAIN_SOFTWARE_REPO,
  NESTED_REPO_STRATEGY,
  OWNER_PLACEHOLDER,
  PERSONAL_SCHEMA_VERSION,
  PERSONALSPACE_TEMPLATE_REPO,
  PERSONALSPACE_TEMPLATE_VERSION,
  gitlinkPaths,
  trackedPathPrivacyIssues,
  trackedTextPrivacyIssues,
} from "./personalspace-lib.mjs";

const root = join(import.meta.dirname, "..");
const failures = [];
const personal = JSON.parse(await readFile(join(root, "personal.gen3.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(root, "modules.manifest.json"), "utf8"));
const marker = JSON.parse(await readFile(join(root, "personalspace.template.json"), "utf8"));
const ignore = await readFile(join(root, ".gitignore"), "utf8");
const readme = await readFile(join(root, "README.md"), "utf8");
const license = await readFile(join(root, "LICENSE.md"), "utf8");

expect(personal.owner?.github_username === OWNER_PLACEHOLDER, "owner placeholder driftuje");
expect(personal.schema_version === PERSONAL_SCHEMA_VERSION, "personal schema version driftuje");
expect(personal.owner?.display_name === DISPLAY_NAME_PLACEHOLDER, "display-name placeholder driftuje");
expect(personal.buddy === undefined, "veřejný template nesmí vytvářet fiktivního Buddyho");
expect(personal.repository?.visibility === "private", "owner repo declaration musí být private");
expect(personal.repository?.mount_strategy === NESTED_REPO_STRATEGY, "owner repo musí být Doctor-managed nested repo");
expect(personal.gbrain?.repository?.visibility === "private", "gbrain repo declaration musí být private");
expect(personal.gbrain?.repository?.mount_strategy === NESTED_REPO_STRATEGY, "gbrain repo musí být Doctor-managed nested repo");
expect(personal.gbrain?.software?.github_repo === GBRAIN_SOFTWARE_REPO, "gbrain software repo driftuje");
expect(personal.gbrain?.software?.install_source === GBRAIN_INSTALL_SOURCE, "gbrain install source driftuje");
expect(Array.isArray(personal.shared_spaces) && personal.shared_spaces.length === 0, "shared_spaces musí zůstat prázdné");
expect(personal.doctor?.schema_version === DOCTOR_DECLARATION_SCHEMA_VERSION, "šablona musí deklarovat blok doctor (decision 0118)");
expect(
  JSON.stringify(personal.doctor?.command) === JSON.stringify([...DOCTOR_COMMAND]),
  "doctor.command driftuje od skutečného vstupního bodu doctora",
);
expect(personal.doctor?.scope_type === DOCTOR_SCOPE_TYPE, "doctor.scope_type musí být personalspace");
expect(existsSync(join(root, personal.doctor?.command?.[1] ?? "")), "deklarovaný doctor entrypoint musí existovat");
expect(manifest.owner === OWNER_PLACEHOLDER, "modules manifest owner placeholder driftuje");
expect(!(manifest.module_slots ?? []).some((slot) => slot.required_roles?.includes("buddy")), "slot bez Buddyho nesmí vyžadovat roli buddy");
expect(ignore.split(/\r?\n/).includes("gbrain/"), "super-repo musí celé gbrain/ ignorovat");
expect(ignore.split(/\r?\n/).includes("buddy/"), "super-repo musí volitelný Buddy checkout ignorovat");
expect(ignore.split(/\r?\n/).includes("workspace/*"), "super-repo musí osobní module checkouty ignorovat");
expect(ignore.split(/\r?\n/).includes("!workspace/.gitkeep"), "template musí zachovat workspace/.gitkeep");
expect(ignore.split(/\r?\n/).includes("secrets/"), "super-repo musí secrets/ ignorovat");
expect(!existsSync(join(root, "gbrain", "README.md")), "template nesmí trackovat obsah runtime gbrain mountu");
expect(!existsSync(join(root, ".gitmodules")), ".gitmodules je zakázaný");
expect(!existsSync(join(root, "manual", "mount-shared-personalspace.md")), "návod na mount cizího Personalspace je zakázaný");
expect(!existsSync(join(root, "manual", "share-with-colleague.md")), "návod na sdílení Personalspace je zakázaný");
expect(readme.includes("private") && readme.includes("garrytan/gbrain"), "README musí vysvětlit private custody a software source");
expect(license.includes("FSL-1.1-Apache-2.0"), "chybí výslovná FSL licence");
expect(marker.schema_version === PERSONALSPACE_TEMPLATE_VERSION, "template marker version driftuje");
expect(marker.template_repo === PERSONALSPACE_TEMPLATE_REPO, "template marker repo driftuje");
expect(marker.personal_schema_version === PERSONAL_SCHEMA_VERSION, "template marker personal schema driftuje");

const staged = runCommand("git", ["ls-files", "-s"], { cwd: root }).stdout;
const gitlinks = gitlinkPaths(staged);
expect(gitlinks.length === 0, `template obsahuje gitlinky: ${gitlinks.join(", ")}`);
const workspaceIgnore = runCommand(
  "git",
  ["check-ignore", "--quiet", "--no-index", "workspace/example-private-module"],
  { cwd: root, allowFailure: true },
);
expect(workspaceIgnore.status === 0, "workspace/example-private-module musí být gitignored");

const files = runCommand(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: root },
).stdout.split(/\r?\n/).filter(Boolean);
for (const issue of trackedPathPrivacyIssues(files, { label: "template" })) {
  expect(false, issue);
}
const text = [];
for (const file of files) {
  const fullPath = join(root, file);
  if (!existsSync(fullPath)) continue;
  try {
    const content = await readFile(fullPath, "utf8");
    text.push(`${file}\n${content}`);
    for (const issue of trackedTextPrivacyIssues(file, content, { label: "template" })) {
      expect(false, issue);
    }
  } catch {
    // Binární nebo nečitelný soubor se do textového no-secret skenu nezapočítá.
  }
}
const corpus = text.join("\n");
const forbidden = [
  ["absolutní macOS home cesta", new RegExp(`/${["Users", "[^/\\s]+"].join("/")}/`)],
  ["absolutní Windows home cesta", new RegExp(`${"C:"}\\\\${"Users"}\\\\`, "i")],
  ["interní klientská cesta", new RegExp(["Client", "Companies"].join(""), "i")],
  ["privátní klíč", new RegExp(["BEGIN", "(?: RSA| OPENSSH| EC)?", " PRIVATE KEY"].join(""), "i")],
  ["GitHub token", new RegExp(`\\b${["gh", "[pousr]", "_"].join("")}[A-Za-z0-9_]{24,}\\b`)],
  ["GitHub fine-grained token", new RegExp(`\\b${["github", "_pat_"].join("")}[A-Za-z0-9_]{24,}\\b`)],
  ["AWS access key", new RegExp(`\\b${["AK", "IA"].join("")}[A-Z0-9]{16}\\b`)],
];
for (const [label, pattern] of forbidden) {
  expect(!pattern.test(corpus), `no-secret scan našel ${label}`);
}
const windowsHomePattern = forbidden.find(([label]) => label === "absolutní Windows home cesta")?.[1];
expect(
  windowsHomePattern?.test(["C:", "Users", "example", "repo"].join("\\")),
  "Windows path scanner musí zachytit běžnou cestu s jedním backslashem",
);

if (failures.length > 0) {
  console.error("Template contract FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Template contract PASS (${files.length} souborů, bez gitlinků a známých secret patternů)`);

function expect(condition, message) {
  if (!condition) failures.push(message);
}
