import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { runCommand } from "./command-runner.mjs";
import {
  DISPLAY_NAME_PLACEHOLDER,
  GBRAIN_INSTALL_SOURCE,
  GBRAIN_SOFTWARE_REPO,
  NESTED_REPO_STRATEGY,
  OWNER_PLACEHOLDER,
  PERSONAL_SCHEMA_VERSION,
  PERSONALSPACE_TEMPLATE_REPO,
  PERSONALSPACE_TEMPLATE_VERSION,
  doctorDeclarationIssues,
  expectedIdentity,
  gitlinkPaths,
  isValidGitHubLogin,
  reposEqual,
  trackedPathPrivacyIssues,
  trackedTextPrivacyIssues,
} from "./personalspace-lib.mjs";

const root = join(import.meta.dirname, "..");
const failures = [];
const personal = JSON.parse(await readFile(join(root, "personal.gen3.json"), "utf8"));
const modules = JSON.parse(await readFile(join(root, "modules.manifest.json"), "utf8"));
const marker = JSON.parse(await readFile(join(root, "personalspace.template.json"), "utf8"));
const ignore = await readFile(join(root, ".gitignore"), "utf8");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const workflow = await readFile(join(root, ".github", "workflows", "checks.yml"), "utf8");

const login = personal.owner?.github_username;
expect(isValidGitHubLogin(login) && login !== OWNER_PLACEHOLDER, "owner.github_username musí být materializovaný GitHub login");
expect(
  typeof personal.owner?.display_name === "string"
    && personal.owner.display_name.trim() !== ""
    && personal.owner.display_name !== DISPLAY_NAME_PLACEHOLDER,
  "owner.display_name musí být materializovaný",
);
expect(["human", "ai-colleague"].includes(personal.owner?.type), "owner.type musí být human nebo ai-colleague");
expect(personal.schema_version === PERSONAL_SCHEMA_VERSION, "personal schema version driftuje");
expect(personal.personal_generation === "gen3", "personal_generation musí být gen3");

let identity = null;
try {
  identity = expectedIdentity(login, personal.gbrain?.repository?.github_repo);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}
if (identity) {
  expect(reposEqual(personal.repository?.github_repo, identity.repo), "owner repo neodpovídá materializované identitě");
  expect(personal.repository?.mount_path === identity.mountPath, "owner mount neodpovídá materializované identitě");
  expect(modules.owner === login, "modules manifest owner neodpovídá materializované identitě");
}
expect(personal.repository?.visibility === "private", "owner repo declaration musí zůstat private");
expect(personal.repository?.mount_strategy === NESTED_REPO_STRATEGY, "owner repo musí být Doctor-managed nested repo");
expect(personal.gbrain?.repository?.visibility === "private", "gbrain repo declaration musí zůstat private");
expect(personal.gbrain?.repository?.mount_strategy === NESTED_REPO_STRATEGY, "gbrain musí být Doctor-managed nested repo");
const acceptedGbrainSoftware = new Set([GBRAIN_SOFTWARE_REPO, "Lazurio/gbrain"]);
expect(acceptedGbrainSoftware.has(personal.gbrain?.software?.github_repo), "gbrain software repo není schválený upstream ani fork-of-record");
expect(
  personal.gbrain?.software?.install_source === `github:${personal.gbrain?.software?.github_repo}`,
  "gbrain install source neodpovídá deklarovanému software repu",
);
expect(personal.gbrain?.default_shared === false, "gbrain.default_shared musí být false");
expect(personal.gbrain?.agent_access === "mcp-only", "gbrain.agent_access musí být mcp-only");
expect(personal.privacy?.default_share === "private", "privacy.default_share musí být private");
expect(personal.privacy?.agent_boundary === "personal-context-only", "privacy.agent_boundary driftuje");
expect(personal.privacy?.shared_outputs === "metadata-only", "privacy.shared_outputs driftuje");
expect(Array.isArray(personal.shared_spaces) && personal.shared_spaces.length === 0, "shared_spaces musí zůstat prázdné");
expect(personal.secrets?.path === "secrets" && personal.secrets?.git === "ignored", "secrets custody musí zůstat gitignored");
for (const issue of doctorDeclarationIssues(personal)) failures.push(issue);

if (personal.buddy !== undefined) {
  expect(personal.buddy?.repository?.visibility === "private", "Buddy profile repo declaration musí být private");
  expect(personal.buddy?.repository?.mount_strategy === NESTED_REPO_STRATEGY, "Buddy profile musí být Doctor-managed nested repo");
  expect(personal.buddy?.runtime?.local_execution === "forbidden", "Buddy runtime nesmí běžet v lokálním Personalspace");
  expect(
    personal.buddy?.runtime?.deployment_target === "owner-dedicated-personalspace-vps",
    "Buddy runtime musí zůstat na owner-dedicated Personalspace VPS",
  );
}

expect(marker.schema_version === PERSONALSPACE_TEMPLATE_VERSION, "template marker version driftuje");
expect(marker.template_repo === PERSONALSPACE_TEMPLATE_REPO, "template marker repo driftuje");
expect(marker.personal_schema_version === PERSONAL_SCHEMA_VERSION, "template marker personal schema driftuje");
expect(packageJson.packageManager === "bun@1.4.2", "packageManager musí vlastnit exact Bun 1.4.2");
expect(packageJson.engines?.bun === "1.4.0", "engines.bun musí odpovídat exact Bun 1.4.2");
expect(workflow.includes("bun-version-file: package.json"), "CI musí číst Bun verzi z package.json");

const ignoreLines = new Set(ignore.split(/\r?\n/));
for (const path of ["gbrain/", "buddy/", "secrets/"]) {
  expect(ignoreLines.has(path), `${path} musí být gitignored`);
}
expect(ignoreLines.has("workspace/*"), "workspace nested repa musí být gitignored");
expect(!existsSync(join(root, ".gitmodules")), ".gitmodules je zakázaný");
const staged = runCommand("git", ["ls-files", "-s"], { cwd: root }).stdout;
expect(gitlinkPaths(staged).length === 0, "Personalspace obsahuje zakázaný gitlink");

const files = runCommand(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: root },
).stdout.split(/\r?\n/).filter(Boolean);
for (const issue of trackedPathPrivacyIssues(files, { label: "Personalspace" })) failures.push(issue);
for (const file of files) {
  const fullPath = join(root, file);
  if (!existsSync(fullPath)) continue;
  try {
    const content = await readFile(fullPath, "utf8");
    for (const issue of trackedTextPrivacyIssues(file, content, { label: "Personalspace" })) failures.push(issue);
  } catch {
    // Binární nebo nečitelný soubor se do textového no-secret skenu nezapočítá.
  }
}

if (failures.length > 0) {
  console.error("Static Personalspace contract FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Static Personalspace contract PASS (${files.length} trackovaných a nových souborů)`);

function expect(condition, message) {
  if (!condition) failures.push(message);
}
