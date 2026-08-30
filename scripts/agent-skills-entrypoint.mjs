import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_SKILLS_ENTRYPOINT_SCHEMA =
  "companiesascode.agent_skills_entrypoint.v1";
export const CANONICAL_SKILLS_PATH = ".agents/skills";
export const CLAUDE_SKILLS_PATH = ".claude/skills";
export const CLAUDE_SKILLS_MATERIALIZATION = "tracked-derived-mirror";

const LEGACY_PLACEHOLDER = "../.agents/skills";
// Gitignored OS junk z Finderu/Exploreru; v Git-tracked mirroru neexistuje,
// takže ho drift scan ani Repair nesmí brát jako neznámý obsah — jinak stačí
// otevřít .claude/skills ve Finderu a bun run check zůstane trvale červený.
const IGNORED_MIRROR_ENTRIES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(scriptPath), "..");
// Známé instalační prefixy Gitu. Discovery zůstává bez PATH lookupu (obrana
// proti podvrženému `git` v PATH), ale musí pokrýt i instalace bez admin práv:
// Git for Windows se u korporátního uživatele bez administrátora instaluje do
// %LOCALAPPDATA%\Programs\Git (cílová persona decision 0059), na macOS bývá
// vedle systémového shimu Homebrew.
const TRUSTED_GIT_EXECUTABLES = {
  darwin: ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"],
  linux: ["/usr/bin/git", "/bin/git", "/usr/local/bin/git"],
  win32: [
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files\\Git\\bin\\git.exe",
    "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
    "C:\\Program Files (x86)\\Git\\bin\\git.exe",
    ...(typeof process.env.LOCALAPPDATA === "string" && isAbsolute(process.env.LOCALAPPDATA)
      ? [
        join(process.env.LOCALAPPDATA, "Programs", "Git", "cmd", "git.exe"),
        join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "git.exe"),
      ]
      : []),
  ],
};

function sanitizedGitEnvironment() {
  const environment = {};
  for (const key of [
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
  ]) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  environment.LC_ALL = "C";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_PAGER = "cat";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  environment.GIT_CONFIG_COUNT = "0";
  return environment;
}

function trustedGitExecutable(platform = process.platform) {
  for (const candidate of TRUSTED_GIT_EXECUTABLES[platform] ?? []) {
    try {
      const canonicalPath = realpathSync.native(candidate);
      if (isAbsolute(canonicalPath) && statSync(canonicalPath).isFile()) {
        return canonicalPath;
      }
    } catch {
      // Zkus další system-owned kandidát. Caller-controlled discovery není povolené.
    }
  }
  return null;
}

function publicState({ status, code, problems = [], message }) {
  return {
    schema_version: AGENT_SKILLS_ENTRYPOINT_SCHEMA,
    status,
    code,
    canonical_path: CANONICAL_SKILLS_PATH,
    compatibility_path: CLAUDE_SKILLS_PATH,
    materialization: CLAUDE_SKILLS_MATERIALIZATION,
    problems,
    message,
  };
}

function comparablePath(path, platform = process.platform) {
  const normalized = resolve(path).replaceAll("\\", "/").replace(/\/+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathIsInside(root, target) {
  const relativePath = relative(root, target);
  return (
    relativePath === "" ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !relativePath.startsWith("..\\"))
  );
}

async function lstatOrNull(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function git(root, args) {
  const executable = trustedGitExecutable();
  if (!executable) {
    return { exitCode: 1, stdout: new Uint8Array(), stderr: new Uint8Array() };
  }
  return Bun.spawnSync({
    cmd: [executable, ...args],
    cwd: root,
    env: sanitizedGitEnvironment(),
    stdout: "pipe",
    stderr: "pipe",
  });
}

function output(result) {
  return new TextDecoder().decode(result.stdout).trim();
}

export async function readActiveSkillSlugs(root = process.cwd()) {
  const manifestPath = join(resolve(root), CANONICAL_SKILLS_PATH, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const slugs = [];
  for (const skill of manifest.skills ?? []) {
    if (typeof skill.slug !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skill.slug)) {
      // Slug je součást filesystem cest mirroru; cokoliv mimo kebab-case
      // (tečky, lomítka, "..") by dovolilo traversal mimo kanonický katalog.
      throw new Error(
        `Manifest skill ${typeof skill.slug === "string" ? skill.slug : "<bez slugu>"} musí mít kebab-case slug bez cest.`,
      );
    }
    const expectedPath = `${CANONICAL_SKILLS_PATH}/${skill.slug}/SKILL.md`;
    if (skill.path !== expectedPath) {
      throw new Error(
        `Manifest skill ${skill.slug} musí mít path ${expectedPath}.`,
      );
    }
    slugs.push(skill.slug);
  }
  return [...new Set(slugs)].sort();
}

export function expectedMirrorPaths(slugs) {
  return slugs.map((slug) => `${CLAUDE_SKILLS_PATH}/${slug}/SKILL.md`);
}

function validateGitContract(root, expectedPaths, problems) {
  const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
  if (topLevel.exitCode !== 0) {
    problems.push("Agent-skills mirror lze spravovat jen v samostatném Git checkoutu Personalspace.");
    return;
  }
  try {
    if (
      comparablePath(realpathSync.native(output(topLevel))) !==
      comparablePath(realpathSync.native(root))
    ) {
      problems.push("Agent-skills mirror nesmí převzít Git index nadřazeného repozitáře.");
      return;
    }
  } catch {
    problems.push("Nelze bezpečně svázat agent-skills mirror s Git rootem Organizace.");
    return;
  }

  const ignored = git(root, ["check-ignore", "--no-index", "-q", "--", CLAUDE_SKILLS_PATH]);
  if (ignored.exitCode === 0) {
    problems.push(".claude/skills je Git-tracked odvozený mirror a nesmí být v .gitignore.");
  }

  const tracked = git(root, ["ls-files", "--cached", "--", CLAUDE_SKILLS_PATH]);
  if (tracked.exitCode !== 0) {
    problems.push("Nelze bezpečně načíst Git index pro .claude/skills.");
    return;
  }
  const expected = new Set(expectedPaths);
  for (const path of output(tracked).split("\n").filter(Boolean)) {
    if (!expected.has(path)) {
      problems.push(`Trackovaný ${path} nepatří do odvozeného mirroru aktivních skillů.`);
    }
  }
}

async function mirrorDriftProblems(root, slugs) {
  const problems = [];
  const blocked = [];
  const mirrorRoot = join(root, CLAUDE_SKILLS_PATH);
  const expectedSlugs = new Set(slugs);

  for (const entry of await readdir(mirrorRoot, { withFileTypes: true })) {
    const entryPath = join(mirrorRoot, entry.name);
    if (IGNORED_MIRROR_ENTRIES.has(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      blocked.push(`${CLAUDE_SKILLS_PATH}/${entry.name} je symlink; mirror musí být obyčejné soubory.`);
      continue;
    }
    if (!entry.isDirectory()) {
      problems.push(`${CLAUDE_SKILLS_PATH}/${entry.name} nepatří do mirroru (očekávány jen skill adresáře).`);
      continue;
    }
    if (!expectedSlugs.has(entry.name)) {
      problems.push(`${CLAUDE_SKILLS_PATH}/${entry.name} není aktivní skill a v mirroru nemá být.`);
      continue;
    }
    for (const child of await readdir(entryPath, { withFileTypes: true })) {
      if (IGNORED_MIRROR_ENTRIES.has(child.name)) continue;
      if (child.isSymbolicLink()) {
        blocked.push(
          `${CLAUDE_SKILLS_PATH}/${entry.name}/${child.name} je symlink; mirror musí být obyčejné soubory.`,
        );
      } else if (!child.isFile() || child.name !== "SKILL.md") {
        problems.push(
          `${CLAUDE_SKILLS_PATH}/${entry.name}/${child.name} nepatří do mirroru (očekáván jen SKILL.md).`,
        );
      }
    }
  }

  for (const slug of slugs) {
    const canonicalDirectory = join(root, CANONICAL_SKILLS_PATH, slug);
    const canonicalFile = join(canonicalDirectory, "SKILL.md");
    // Symlink na kanonické straně nesmí projít jako "shodné bajty": mirror by
    // tak nesl obsah zvenčí katalogu. Doctor to musí hlásit stejně zavřeně
    // jako Repair, jinak si obě lane protiřečí.
    const [canonicalDirStat, canonicalStat] = await Promise.all([
      lstatOrNull(canonicalDirectory),
      lstatOrNull(canonicalFile),
    ]);
    if (
      !canonicalDirStat?.isDirectory() || canonicalDirStat.isSymbolicLink() ||
      !canonicalStat?.isFile() || canonicalStat.isSymbolicLink()
    ) {
      blocked.push(
        `${CANONICAL_SKILLS_PATH}/${slug} musí být skutečný adresář s obyčejným SKILL.md (žádné symlinky).`,
      );
      continue;
    }
    const mirrorFile = join(mirrorRoot, slug, "SKILL.md");
    const mirrorStat = await lstatOrNull(mirrorFile);
    if (!mirrorStat) {
      problems.push(`${CLAUDE_SKILLS_PATH}/${slug}/SKILL.md v mirroru chybí.`);
      continue;
    }
    if (!mirrorStat.isFile() || mirrorStat.isSymbolicLink()) {
      continue;
    }
    const [canonicalBytes, mirrorBytes] = await Promise.all([
      readFile(canonicalFile),
      readFile(mirrorFile),
    ]);
    if (!canonicalBytes.equals(mirrorBytes)) {
      problems.push(
        `${CLAUDE_SKILLS_PATH}/${slug}/SKILL.md není byte-for-byte shodný s ${CANONICAL_SKILLS_PATH}/${slug}/SKILL.md.`,
      );
    }
  }

  return { blocked, problems };
}

export async function inspectAgentSkillsEntrypoint(root = process.cwd(), {
  platform = process.platform,
} = {}) {
  const organizationRoot = resolve(root);
  const canonicalPath = join(organizationRoot, CANONICAL_SKILLS_PATH);
  const compatibilityPath = join(organizationRoot, CLAUDE_SKILLS_PATH);
  const compatibilityParent = dirname(compatibilityPath);

  const [canonicalStat, compatibilityStat, compatibilityParentStat] = await Promise.all([
    lstatOrNull(canonicalPath),
    lstatOrNull(compatibilityPath),
    lstatOrNull(compatibilityParent),
  ]);

  if (!canonicalStat?.isDirectory() || canonicalStat.isSymbolicLink()) {
    return publicState({
      status: "blocked",
      code: canonicalStat ? "canonical_not_directory" : "canonical_missing",
      problems: [`${CANONICAL_SKILLS_PATH} musí být skutečný kanonický adresář.`],
      message: "Kanonický agent-skills katalog není bezpečný.",
    });
  }

  const [rootRealPath, canonicalRealPath] = await Promise.all([
    realpath(organizationRoot),
    realpath(canonicalPath),
  ]);
  if (!pathIsInside(rootRealPath, canonicalRealPath)) {
    return publicState({
      status: "blocked",
      code: "canonical_path_escape",
      problems: [`${CANONICAL_SKILLS_PATH} se dostává mimo root Personalspace.`],
      message: "Kanonický agent-skills katalog není bezpečný.",
    });
  }

  let slugs;
  try {
    slugs = await readActiveSkillSlugs(organizationRoot);
  } catch (error) {
    return publicState({
      status: "blocked",
      code: "manifest_invalid",
      problems: [error instanceof Error ? error.message : String(error)],
      message: "Manifest aktivních skillů nelze bezpečně přečíst.",
    });
  }

  const problems = [];
  if (
    compatibilityParentStat &&
    (!compatibilityParentStat.isDirectory() || compatibilityParentStat.isSymbolicLink())
  ) {
    problems.push(".claude musí být skutečný adresář uvnitř rootu Personalspace.");
  } else if (compatibilityParentStat) {
    const parentRealPath = await realpath(compatibilityParent);
    if (!pathIsInside(rootRealPath, parentRealPath)) {
      problems.push(".claude se dostává mimo root Personalspace.");
    }
  }

  validateGitContract(organizationRoot, expectedMirrorPaths(slugs), problems);
  if (problems.length > 0) {
    return publicState({
      status: "blocked",
      code: "entrypoint_contract_invalid",
      problems,
      message: "Claude skills mirror porušuje Git nebo filesystem kontrakt.",
    });
  }

  if (!compatibilityStat) {
    return publicState({
      status: "repair_needed",
      code: "mirror_missing",
      message: `${CLAUDE_SKILLS_PATH} chybí; spusť bun run repair:agent-skills a mirror commitni.`,
    });
  }

  if (compatibilityStat.isSymbolicLink()) {
    return publicState({
      status: "repair_needed",
      code: "mirror_legacy_link",
      message: `${CLAUDE_SKILLS_PATH} je legacy symlink/junction; Repair ho nahradí trackovaným mirrorem.`,
    });
  }

  if (compatibilityStat.isFile()) {
    const contents = (await readFile(compatibilityPath, "utf8"))
      .replace(/^﻿/, "")
      .trim();
    if (contents === LEGACY_PLACEHOLDER) {
      return publicState({
        status: "repair_needed",
        code: "mirror_legacy_placeholder",
        message: `${CLAUDE_SKILLS_PATH} je textový placeholder z Windows checkoutu; Repair ho nahradí mirrorem.`,
      });
    }
    return publicState({
      status: "blocked",
      code: "entrypoint_unexpected_file",
      problems: [`${CLAUDE_SKILLS_PATH} je neznámý soubor; Repair ho nesmaže.`],
      message: "Claude skills mirror nelze bezpečně opravit automaticky.",
    });
  }

  if (!compatibilityStat.isDirectory()) {
    return publicState({
      status: "blocked",
      code: "entrypoint_unknown_type",
      problems: [`${CLAUDE_SKILLS_PATH} má nepodporovaný filesystem typ.`],
      message: "Claude skills mirror nelze bezpečně opravit automaticky.",
    });
  }

  const drift = await mirrorDriftProblems(organizationRoot, slugs);
  if (drift.blocked.length > 0) {
    return publicState({
      status: "blocked",
      code: "mirror_unsafe_content",
      problems: drift.blocked,
      message: "Claude skills mirror obsahuje nebezpečný obsah; oprav ho ručně.",
    });
  }
  if (drift.problems.length > 0) {
    return publicState({
      status: "repair_needed",
      code: "mirror_drift",
      problems: drift.problems,
      message: `${CLAUDE_SKILLS_PATH} není byte-for-byte mirror; spusť bun run repair:agent-skills a commitni.`,
    });
  }

  // Obsahová parita nestačí: mirror soubor mimo Git index by tiše chyběl
  // v commitu i čerstvém checkoutu, i když doctor vidí shodné bajty.
  const tracked = git(organizationRoot, ["ls-files", "--cached", "--", CLAUDE_SKILLS_PATH]);
  if (tracked.exitCode === 0) {
    const trackedSet = new Set(output(tracked).split("\n").filter(Boolean));
    const untracked = expectedMirrorPaths(slugs).filter((path) => !trackedSet.has(path));
    if (untracked.length > 0) {
      return publicState({
        status: "repair_needed",
        code: "mirror_untracked",
        problems: untracked.map((path) => `${path} není v Git indexu.`),
        message: `${CLAUDE_SKILLS_PATH} mirror není celý v Git indexu; spusť bun run repair:agent-skills a commitni.`,
      });
    }
  }

  return publicState({
    status: "ok",
    code: "mirror_ready",
    message: `${CLAUDE_SKILLS_PATH} je byte-for-byte mirror aktivních skillů z ${CANONICAL_SKILLS_PATH}.`,
  });
}

async function removeLegacyLink(path) {
  try {
    await unlink(path);
  } catch {
    // Windows junction se odstraňuje jako adresářový záznam; cíl zůstává nedotčený.
    await rm(path, { recursive: false, force: false });
  }
}

export async function repairAgentSkillsEntrypoint(root = process.cwd(), options = {}) {
  const organizationRoot = resolve(root);
  const before = await inspectAgentSkillsEntrypoint(organizationRoot, options);
  if (before.status === "ok" || before.status === "blocked") return before;

  const compatibilityPath = join(organizationRoot, CLAUDE_SKILLS_PATH);
  if (before.code === "mirror_legacy_link") {
    await removeLegacyLink(compatibilityPath);
  } else if (before.code === "mirror_legacy_placeholder") {
    await unlink(compatibilityPath);
  }

  const slugs = await readActiveSkillSlugs(organizationRoot);
  const expectedSlugs = new Set(slugs);
  await mkdir(compatibilityPath, { recursive: true });

  for (const entry of await readdir(compatibilityPath, { withFileTypes: true })) {
    const entryPath = join(compatibilityPath, entry.name);
    if (IGNORED_MIRROR_ENTRIES.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory()) {
      // Stray soubor přímo v mirroru: inspect ho hlásí jako drift, ale mazat
      // neznámý obsah Repair nesmí — bez tohohle gate by parita nikdy nesešla.
      return publicState({
        status: "blocked",
        code: "mirror_unknown_content",
        problems: [
          `${CLAUDE_SKILLS_PATH}/${entry.name} nepatří do mirroru; Repair ho nesmaže, porovnej a odstraň ručně.`,
        ],
        message: "Claude skills mirror nelze bezpečně regenerovat automaticky.",
      });
    }
    const children = await readdir(entryPath, { withFileTypes: true });
    const onlyMirrorShape = children.every(
      (child) =>
        IGNORED_MIRROR_ENTRIES.has(child.name) ||
        (child.isFile() && !child.isSymbolicLink() && child.name === "SKILL.md"),
    );
    if (!onlyMirrorShape) {
      // Platí i pro aktivní skill adresář: extra obsah vedle SKILL.md by jinak
      // přežil repair a drift by se nikdy nesrovnal (nález z compatibility review).
      return publicState({
        status: "blocked",
        code: "mirror_unknown_content",
        problems: [
          `${CLAUDE_SKILLS_PATH}/${entry.name} obsahuje neznámý obsah; Repair ho nesmaže, porovnej a odstraň ručně.`,
        ],
        message: "Claude skills mirror nelze bezpečně regenerovat automaticky.",
      });
    }
    if (expectedSlugs.has(entry.name)) continue;
    await rm(entryPath, { recursive: true, force: false });
  }

  for (const slug of slugs) {
    const canonicalDirectory = join(organizationRoot, CANONICAL_SKILLS_PATH, slug);
    const canonicalFile = join(canonicalDirectory, "SKILL.md");
    // Symlink na kanonické straně by protáhl do trackovaného mirroru bajty
    // zvenčí katalogu (disclosure) — kopíruje se jen obyčejný soubor
    // v obyčejném adresáři.
    const [canonicalDirStat, canonicalStat] = await Promise.all([
      lstatOrNull(canonicalDirectory),
      lstatOrNull(canonicalFile),
    ]);
    if (
      !canonicalDirStat?.isDirectory() || canonicalDirStat.isSymbolicLink() ||
      !canonicalStat?.isFile() || canonicalStat.isSymbolicLink()
    ) {
      return publicState({
        status: "blocked",
        code: "canonical_unsafe_content",
        problems: [
          `${CANONICAL_SKILLS_PATH}/${slug} musí být skutečný adresář s obyčejným SKILL.md (žádné symlinky).`,
        ],
        message: "Kanonický katalog obsahuje nebezpečný obsah; oprav ho ručně.",
      });
    }
    const mirrorDirectory = join(compatibilityPath, slug);
    const mirrorFile = join(mirrorDirectory, "SKILL.md");
    await mkdir(mirrorDirectory, { recursive: true });
    const mirrorStat = await lstatOrNull(mirrorFile);
    if (mirrorStat && (!mirrorStat.isFile() || mirrorStat.isSymbolicLink())) {
      return publicState({
        status: "blocked",
        code: "mirror_unsafe_content",
        problems: [`${CLAUDE_SKILLS_PATH}/${slug}/SKILL.md není obyčejný soubor; oprav ho ručně.`],
        message: "Claude skills mirror nelze bezpečně regenerovat automaticky.",
      });
    }
    await writeFile(mirrorFile, await readFile(canonicalFile));
  }

  const staged = git(organizationRoot, ["add", "-A", "--", CLAUDE_SKILLS_PATH]);
  if (staged.exitCode !== 0) {
    return publicState({
      status: "blocked",
      code: "mirror_stage_failed",
      problems: [`git add pro ${CLAUDE_SKILLS_PATH} selhal.`],
      message: "Mirror se nepodařilo přidat do Git indexu.",
    });
  }

  return inspectAgentSkillsEntrypoint(organizationRoot, options);
}

function printState(state, json) {
  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  const label = state.status === "ok" ? "ok" : state.status === "repair_needed" ? "repair" : "fail";
  console.log(`${label} - agent-skills-entrypoint: ${state.message}`);
  for (const problem of state.problems) console.log(`  - ${problem}`);
}

async function main() {
  const [command = "check", ...args] = process.argv.slice(2);
  const json = args.includes("--json");
  if (!["check", "repair"].includes(command)) {
    throw new Error("Použití: agent-skills-entrypoint.mjs <check|repair> [--json].");
  }
  const state = command === "repair"
    ? await repairAgentSkillsEntrypoint(defaultRoot)
    : await inspectAgentSkillsEntrypoint(defaultRoot);
  printState(state, json);
  if (state.status !== "ok") process.exitCode = 1;
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const state = publicState({
      status: "blocked",
      code: "entrypoint_operation_failed",
      problems: [error instanceof Error ? error.message : String(error)],
      message: "Kontrola nebo oprava agent-skills mirroru selhala.",
    });
    printState(state, process.argv.includes("--json"));
    process.exitCode = 1;
  }
}
