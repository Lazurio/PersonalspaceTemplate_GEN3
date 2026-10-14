// Bootstrap a doctor nad tím, co stojí nad `personalspace/` (LazurioPlatform#377).
//
// Lazurio Platform zakládá Personalspace v Lazurio Folderu (`.lazurio/`,
// `AGENTS.md`, `manual/`), který není Git checkout Lazurio rootu. Bootstrap ho
// musí poznat a spustit jen kontroly, které tam mají smysl; pod Lazurio rootem
// běží beze slevy všechno jako dřív. Procesní testy spouštějí skutečný
// bootstrap nad kopií téhle šablony se skutečným gitem a falešným `gh`
// (lokální bare repozitáře, žádná síť). Jména jsou syntetická.

import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runPersonalspaceDoctor, SELF_CHECK_OWNER } from "./doctor-personalspace-lib.mjs";
import {
  DOCTOR_COMMAND,
  DOCTOR_DECLARATION_SCHEMA_VERSION,
  DOCTOR_SCOPE_TYPE,
  GBRAIN_INSTALL_SOURCE,
  GBRAIN_SOFTWARE_REPO,
  NESTED_REPO_STRATEGY,
  OWNER_PLACEHOLDER,
  PERSONAL_SCHEMA_VERSION,
  classifyMountParent,
  gitWorkTreeOf,
  primaryCheckoutOf,
} from "./personalspace-lib.mjs";

const repoRoot = join(import.meta.dirname, "..");
const LOGIN = "example-owner";
const ROOT_CHECK_IDS = ["root.launchpad_manifest", "root.mount_ignored", "root.no_gitlinks"];
const posixTest = test.skipIf(process.platform === "win32");

const tempRoots = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporary(prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(path);
  return path;
}

/** Lazurio Folder, jak ho zakládá Platform: jeho stav, AGENTS.md, manual/. */
async function writeFolder(folder, { legacyLaunchpad = false } = {}) {
  await mkdir(join(folder, ".lazurio"), { recursive: true });
  await writeFile(join(folder, ".lazurio", "preferences.json"), "{}\n");
  await writeFile(join(folder, "AGENTS.md"), "# Lazurio Folder\n");
  await mkdir(join(folder, "manual"), { recursive: true });
  await mkdir(join(folder, "personalspace"), { recursive: true });
  if (legacyLaunchpad) await writeFile(join(folder, "launchpad.gen3.json"), "{}\n");
}

// ---- Rozpoznání rodiče --------------------------------------------------------

test("rodič mountu: Lazurio Folder podle .lazurio/preferences.json, root podle launchpad.gen3.json, jinak nic", async () => {
  const base = await temporary("personalspace-parent-");
  const folder = join(base, "folder");
  const legacy = join(base, "legacy");
  const root = join(base, "root");
  const nothing = join(base, "nothing");
  await writeFolder(folder);
  await writeFolder(legacy, { legacyLaunchpad: true });
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "launchpad.gen3.json"), "{}\n");
  await mkdir(nothing, { recursive: true });
  expect(classifyMountParent(folder)).toBe("folder");
  // Folder předaný hostingem smí nést legacy launchpad.gen3.json; root to není.
  expect(classifyMountParent(legacy)).toBe("folder");
  expect(classifyMountParent(root)).toBe("root");
  expect(classifyMountParent(nothing)).toBe(null);
});

test("Git working tree: inside, outside jen na výslovnou odpověď gitu, jinak unknown", () => {
  const answer = (result) => () => ({ stdout: "", stderr: "", error: null, ...result });
  expect(gitWorkTreeOf("/x", { runCommand: answer({ status: 0, stdout: "true" }) })).toBe("inside");
  expect(gitWorkTreeOf("/x", {
    runCommand: answer({ status: 128, stderr: "fatal: not a git repository (or any of the parent directories): .git" }),
  })).toBe("outside");
  // Chybějící git ani prázdná odpověď nejsou „tady žádný repozitář není".
  expect(gitWorkTreeOf("/x", {
    runCommand: answer({ status: 1, stderr: "spawn git ENOENT", error: new Error("ENOENT") }),
  })).toBe("unknown");
  expect(gitWorkTreeOf("/x", { runCommand: answer({ status: 0, stdout: "" }) })).toBe("unknown");
});

test("primární checkout: z task worktree adresář nad společným .git, jinak cwd", () => {
  const files = new Set(["/f/personalspace/.worktrees/naming/.git", "/f/personalspace/x_GEN3/.git/HEAD", "/f/personalspace/x_GEN3/.git"]);
  const fileExists = (path) => files.has(path);
  const runCommand = () => ({ status: 0, stdout: "/f/personalspace/x_GEN3/.git\n", stderr: "", error: null });
  expect(primaryCheckoutOf("/f/personalspace/.worktrees/naming", { runCommand, fileExists })).toBe("/f/personalspace/x_GEN3");
  expect(primaryCheckoutOf("/f/personalspace/x_GEN3", { runCommand, fileExists })).toBe("/f/personalspace/x_GEN3");
  const failing = () => ({ status: 128, stdout: "", stderr: "fatal", error: null });
  expect(primaryCheckoutOf("/f/personalspace/.worktrees/naming", { runCommand: failing, fileExists }))
    .toBe("/f/personalspace/.worktrees/naming");
});

// ---- Doctor pod Lazurio Folderem ---------------------------------------------

function namedPersonal() {
  return {
    schema_version: PERSONAL_SCHEMA_VERSION,
    personal_generation: "gen3",
    owner: { github_username: LOGIN, display_name: "Vzorový vlastník", type: "human" },
    repository: {
      github_repo: `${LOGIN}/${LOGIN}_GEN3`,
      mount_path: `personalspace/${LOGIN}_GEN3`,
      visibility: "private",
      mount_strategy: NESTED_REPO_STRATEGY,
    },
    privacy: { default_share: "private", agent_boundary: "personal-context-only", shared_outputs: "metadata-only" },
    doctor: {
      schema_version: DOCTOR_DECLARATION_SCHEMA_VERSION,
      command: [...DOCTOR_COMMAND],
      timeout_ms: 120000,
      scope_type: DOCTOR_SCOPE_TYPE,
    },
    modules_manifest_path: "modules.manifest.json",
    workspace_path: "workspace",
    gbrain: {
      path: "gbrain",
      repository: { github_repo: `${LOGIN}/${LOGIN}-gbrain`, visibility: "private", mount_strategy: NESTED_REPO_STRATEGY },
      software: { github_repo: GBRAIN_SOFTWARE_REPO, install_source: GBRAIN_INSTALL_SOURCE },
      default_shared: false,
      human_editor: "obsidian",
      agent_access: "mcp-only",
    },
    secrets: { path: "secrets", git: "ignored" },
    shared_spaces: [],
  };
}

/** Pojmenovaný Personalspace v Lazurio Folderu; gbrain namountovaný. */
async function folderPersonalspace(options = {}) {
  const base = await temporary("personalspace-folder-doctor-");
  const folder = join(base, "Lazurio");
  await writeFolder(folder, options);
  const cwd = join(folder, "personalspace", `${LOGIN}_GEN3`);
  await mkdir(join(cwd, "gbrain", ".git"), { recursive: true });
  await writeFile(join(cwd, "personal.gen3.json"), JSON.stringify(namedPersonal(), null, 2));
  await writeFile(join(cwd, "modules.manifest.json"), JSON.stringify({ personal_generation: "gen3", owner: LOGIN, module_slots: [] }));
  return { folder, cwd };
}

/** Stub příkazů; `folderTree` je odpověď gitu na „je Folder v repozitáři?". */
function stub({ folder, folderTree, ignoredInFolderRepo = true }) {
  return (command, args = [], options = {}) => {
    const done = (stdout = "", status = 0, stderr = "") => ({ status, stdout, stderr, error: null });
    if (command === "git") {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        if (options.cwd !== folder) return done("true");
        return folderTree === "inside"
          ? done("true")
          : folderTree === "outside"
            ? done("", 128, "fatal: not a git repository (or any of the parent directories): .git")
            : { status: 1, stdout: "", stderr: "spawn git ENOENT", error: new Error("ENOENT") };
      }
      if (args[0] === "config") {
        const repo = String(options.cwd).endsWith("/gbrain") ? `${LOGIN}-gbrain` : `${LOGIN}_GEN3`;
        return done(`git@github.com:${LOGIN}/${repo}.git`);
      }
      if (args[0] === "check-ignore") {
        if (options.cwd === folder) return ignoredInFolderRepo ? done() : done("", 1);
        return done();
      }
      return done();
    }
    if (command === "gh") {
      if (args[0] === "api" && args[1] === "user") return done(LOGIN);
      if (args[0] === "repo") return done(JSON.stringify({ nameWithOwner: args[2], visibility: "PRIVATE" }));
      if (args.some((arg) => String(arg).endsWith("/collaborators"))) return done(LOGIN);
      return done();
    }
    if (command === "gbrain") return done("usage");
    return { status: 1, stdout: "", stderr: `neznámý příkaz ${command}`, error: new Error(command) };
  };
}

test("doctor pod Lazurio Folderem mimo Git: kořenové kontroly jsou no_such_mount, nikdy blocked a nikdy fail", async () => {
  for (const legacyLaunchpad of [false, true]) {
    const { folder, cwd } = await folderPersonalspace({ legacyLaunchpad });
    const report = await runPersonalspaceDoctor({ cwd, commandRunner: stub({ folder, folderTree: "outside" }) });
    for (const id of ROOT_CHECK_IDS) {
      const check = report.checks.find((entry) => entry.id === id);
      expect([legacyLaunchpad, id, check.status, check.not_applicable_reason, check.owner])
        .toEqual([legacyLaunchpad, id, "not_applicable", "no_such_mount", SELF_CHECK_OWNER]);
      expect(check.message).toContain("Lazurio Folder");
    }
    expect(report.summary.status).toBe("ok");
  }
});

test("doctor pod Lazurio Folderem uvnitř Git repozitáře hlídá mount proti němu", async () => {
  const { folder, cwd } = await folderPersonalspace();
  const leaking = await runPersonalspaceDoctor({
    cwd,
    commandRunner: stub({ folder, folderTree: "inside", ignoredInFolderRepo: false }),
  });
  expect(leaking.checks.find((check) => check.id === "root.mount_ignored").status).toBe("fail");
  expect(leaking.summary.status).toBe("fail");
  const guarded = await runPersonalspaceDoctor({ cwd, commandRunner: stub({ folder, folderTree: "inside" }) });
  expect(guarded.checks.find((check) => check.id === "root.mount_ignored").status).toBe("ok");
  expect(guarded.checks.find((check) => check.id === "root.no_gitlinks").status).toBe("ok");
  // Nepozorovaný Git nad Folderem je blocked, ne tiché „není co hlídat".
  const unknown = await runPersonalspaceDoctor({ cwd, commandRunner: stub({ folder, folderTree: "unknown" }) });
  expect(unknown.checks.find((check) => check.id === "root.mount_ignored").status).toBe("blocked");
  expect(unknown.summary.status).toBe("incomplete");
});

// ---- Skutečný bootstrap jako proces ------------------------------------------

const fakeGh = `#!/bin/sh
R="$FAKE_GH_REMOTES"
L="$FAKE_GH_LOGIN"
case "$1 $2" in
  "api user")
    if [ "$3" = "--jq" ]; then echo "$L"; else echo "{\\"login\\":\\"$L\\",\\"id\\":12345}"; fi
    exit 0 ;;
  "repo view")
    if [ -d "$R/$3.git" ]; then
      echo "{\\"nameWithOwner\\":\\"$3\\",\\"visibility\\":\\"PRIVATE\\",\\"isTemplate\\":false}"
      exit 0
    fi
    echo "GraphQL: Could not resolve to a Repository with the name '$3'. (repository)" >&2
    exit 1 ;;
  "repo create")
    mkdir -p "$R/$(dirname "$3")" && git init --quiet --bare "$R/$3.git" || exit 1
    work=$(mktemp -d)
    git -C "$work" init --quiet && echo "# $3" > "$work/README.md" \\
      && git -C "$work" add README.md && git -C "$work" commit --quiet -m init \\
      && git -C "$work" push --quiet "$R/$3.git" HEAD:refs/heads/main || exit 1
    rm -rf "$work"
    exit 0 ;;
  "repo clone")
    git clone --quiet "git@github.com:$3.git" "$4"
    exit $? ;;
esac
case "$*" in
  *"/collaborators"*) echo "$L"; exit 0 ;;
  *"/invitations"*) exit 0 ;;
esac
echo "fake gh: neznámé volání $*" >&2
exit 1
`;

function which(command) {
  const found = spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`${command} není na PATH`);
  return found.stdout.trim();
}

/**
 * Svět jednoho běhu: bare repozitáře jako GitHub (git@github.com: přes
 * `insteadOf`), PATH jen s gitem, bunem a falešným gh — bez gbrainu, takže
 * `gbrain.cli` je vědomě odložené jako u vlastníka bez `--install-gbrain`.
 */
async function world() {
  const base = await temporary("personalspace-bootstrap-");
  const remotes = join(base, "remotes");
  const home = join(base, "home");
  const bin = join(base, "bin");
  await mkdir(remotes, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "gh"), fakeGh);
  await chmod(join(bin, "gh"), 0o755);
  await symlink(process.execPath, join(bin, "bun"));
  await symlink(which("git"), join(bin, "git"));
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "5",
    GIT_CONFIG_KEY_0: `url.${remotes}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "git@github.com:",
    GIT_CONFIG_KEY_1: "protocol.file.allow",
    GIT_CONFIG_VALUE_1: "always",
    GIT_CONFIG_KEY_2: "user.name",
    GIT_CONFIG_VALUE_2: "Fixture",
    GIT_CONFIG_KEY_3: "user.email",
    GIT_CONFIG_VALUE_3: "fixture@example.invalid",
    GIT_CONFIG_KEY_4: "init.defaultBranch",
    GIT_CONFIG_VALUE_4: "main",
    FAKE_GH_REMOTES: remotes,
    FAKE_GH_LOGIN: LOGIN,
  };
  const git = (cwd, ...args) => {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  // Kopie téhle šablony (i s necommitnutou prací) jako vygenerované private repo.
  const work = join(base, "template");
  const files = git(repoRoot, "ls-files", "--cached", "--others", "--exclude-standard").split("\n").filter(Boolean);
  for (const file of files) {
    if (!existsSync(join(repoRoot, file))) continue;
    await mkdir(dirname(join(work, file)), { recursive: true });
    await cp(join(repoRoot, file), join(work, file));
  }
  git(work, "init", "--quiet");
  git(work, "add", "--all");
  git(work, "commit", "--quiet", "-m", "template");
  const bare = join(remotes, LOGIN, `${LOGIN}_GEN3.git`);
  await mkdir(dirname(bare), { recursive: true });
  git(base, "init", "--quiet", "--bare", bare);
  git(work, "push", "--quiet", bare, "HEAD:refs/heads/main");
  /** Klon Personalspace do `<parent>/personalspace/<login>_GEN3`. */
  const clone = async (parent) => {
    const space = join(parent, "personalspace", `${LOGIN}_GEN3`);
    await mkdir(dirname(space), { recursive: true });
    git(base, "clone", "--quiet", `git@github.com:${LOGIN}/${LOGIN}_GEN3.git`, space);
    return space;
  };
  const bootstrap = (cwd) => spawnSync(
    "bun",
    ["run", "bootstrap", "--", "--login", LOGIN, "--display-name", "Vzorový vlastník", "--apply"],
    { cwd, env, encoding: "utf8" },
  );
  return { base, remotes, env, git, clone, bootstrap };
}

const owner = async (space) => JSON.parse(await readFile(join(space, "personal.gen3.json"), "utf8")).owner;
const manifestOwner = async (space) => JSON.parse(await readFile(join(space, "modules.manifest.json"), "utf8")).owner;

posixTest("bootstrap v Lazurio Folderu mimo Git pojmenuje vlastníka a založí gbrain", async () => {
  const run = await world();
  const folder = join(run.base, "Lazurio");
  await writeFolder(folder);
  const space = await run.clone(folder);
  const result = run.bootstrap(space);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout).toContain("Lazurio Folder mimo Git");
  expect(result.stdout).toContain("Bootstrap dokončen");
  // Doctor skončil incomplete jen kvůli vědomě odloženému gbrain CLI.
  expect(result.stderr).toContain("gbrain.cli");
  expect(await owner(space)).toEqual({ github_username: LOGIN, display_name: "Vzorový vlastník", type: "human" });
  expect(await manifestOwner(space)).toBe(LOGIN);
  expect(existsSync(join(run.remotes, LOGIN, `${LOGIN}-gbrain.git`))).toBe(true);
  expect(run.git(join(space, "gbrain"), "config", "--get", "remote.origin.url"))
    .toBe(`git@github.com:${LOGIN}/${LOGIN}-gbrain.git`);
  expect(await readFile(join(space, "gbrain", ".gitignore"), "utf8")).toContain(".gbrain/");
  // Nic necommitnul ani nepushnul: publikace zůstává vědomý krok.
  expect(run.git(space, "status", "--porcelain")).toContain("personal.gen3.json");
  expect(run.git(space, "log", "--oneline").split("\n")).toHaveLength(1);
}, 120_000);

posixTest("pod Lazurio rootem zůstávají všechny kořenové Git kontroly", async () => {
  const run = await world();
  // Root bez Gitu: mount nejde ověřit jako ignorovaný, bootstrap nic nezapíše.
  const bare = join(run.base, "bare-root");
  await mkdir(bare, { recursive: true });
  await writeFile(join(bare, "launchpad.gen3.json"), "{}\n");
  const unguarded = await run.clone(bare);
  const refused = run.bootstrap(unguarded);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("není gitignored");
  expect(await owner(unguarded)).toMatchObject({ github_username: OWNER_PLACEHOLDER });
  // Root checkout, který mount ignoruje: projde jako dřív.
  const root = join(run.base, "root");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "launchpad.gen3.json"), "{}\n");
  await writeFile(join(root, ".gitignore"), "personalspace/\n");
  run.git(root, "init", "--quiet");
  run.git(root, "add", "--all");
  run.git(root, "commit", "--quiet", "-m", "root");
  const space = await run.clone(root);
  const result = run.bootstrap(space);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout).toContain("Lazurio root (launchpad.gen3.json)");
  expect(await manifestOwner(space)).toBe(LOGIN);
}, 120_000);

posixTest("Lazurio Folder uvnitř cizího Git repozitáře, který mount neignoruje, bootstrap odmítne", async () => {
  const run = await world();
  run.git(run.base, "init", "--quiet");
  const folder = join(run.base, "Lazurio");
  await writeFolder(folder);
  const space = await run.clone(folder);
  const result = run.bootstrap(space);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("není gitignored");
  expect(await owner(space)).toMatchObject({ github_username: OWNER_PLACEHOLDER });
  expect(existsSync(join(run.remotes, LOGIN, `${LOGIN}-gbrain.git`))).toBe(false);
}, 120_000);

posixTest("z task worktree bootstrap zapíše jen do worktree a gbrain založí v primárním checkoutu", async () => {
  const run = await world();
  const folder = join(run.base, "Lazurio");
  await writeFolder(folder);
  const space = await run.clone(folder);
  const worktree = join(folder, "personalspace", ".worktrees", "name-owner");
  run.git(space, "worktree", "add", "--quiet", "-b", "agent/name-owner", worktree);
  const result = run.bootstrap(worktree);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout).toContain("Task worktree");
  expect(result.stdout).toContain("pull request");
  expect(await manifestOwner(worktree)).toBe(LOGIN);
  expect((await owner(worktree)).github_username).toBe(LOGIN);
  // Primární checkout (main vlastníka) zůstal netknutý.
  expect(await manifestOwner(space)).toBe(OWNER_PLACEHOLDER);
  expect(run.git(space, "status", "--porcelain")).toBe("");
  expect(existsSync(join(space, "gbrain", ".git"))).toBe(true);
  expect(existsSync(join(worktree, "gbrain"))).toBe(false);
}, 120_000);
