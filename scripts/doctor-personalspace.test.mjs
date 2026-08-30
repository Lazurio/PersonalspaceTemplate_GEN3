// Konformní test Personalspace doctora (Lazurio decision 0118).
//
// Founder 2026-07-29: „doctorové musí mít nějaký společný surface, přes který se
// napojují. Tohle by mělo být jasně definováno a testováno." Bez tohohle souboru
// je surface jen próza — každý producent by si „v3 report" vyložil po svém a root
// by se to dozvěděl až v okamžiku, kdy na tom závisí brána.
//
// Dvě věci se tu drží nezávisle na sobě:
//   1. samostatný běh — kontroly kořene jsou not_applicable/owned_by_root,
//      nikdy PASS a nikdy FAIL;
//   2. konformita se surfacem — validní v3 report, odvozený souhrn, exit kód.

import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFERRABLE_DOCTOR_BLOCKED_IDS,
  classifyBootstrapDoctorOutcome,
} from "./bootstrap-personalspace.mjs";
import { checkDoctorProcessConformance, checkReportConformance } from "./doctor-conformance.mjs";
import {
  DOCTOR_EXIT_CODES,
  exitCodeForSummaryStatus,
  loadDoctorReportSchema,
  summarizeStatus,
} from "./doctor-surface-lib.mjs";
import {
  GBRAIN_FORK_OF_RECORD,
  GBRAIN_UPSTREAM,
  ROOT_CHECK_OWNER,
  collectPersonalspaceChecks,
  detectRootContext,
  buildPersonalspaceReport,
  runPersonalspaceDoctor,
} from "./doctor-personalspace-lib.mjs";
import {
  DOCTOR_COMMAND,
  DOCTOR_DECLARATION_SCHEMA_VERSION,
  DOCTOR_SCOPE_TYPE,
  GBRAIN_INSTALL_SOURCE,
  GBRAIN_SOFTWARE_REPO,
  NESTED_REPO_STRATEGY,
  PERSONAL_SCHEMA_VERSION,
} from "./personalspace-lib.mjs";

const repoRoot = join(import.meta.dirname, "..");
const schema = loadDoctorReportSchema(repoRoot);
const LOGIN = "example-owner";
const ROOT_CHECK_IDS = ["root.launchpad_manifest", "root.mount_ignored", "root.no_gitlinks"];

const tempRoots = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function personalManifest(overrides = {}) {
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
    privacy: {
      default_share: "private",
      agent_boundary: "personal-context-only",
      shared_outputs: "metadata-only",
    },
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
      repository: {
        github_repo: `${LOGIN}/${LOGIN}-gbrain`,
        visibility: "private",
        mount_strategy: NESTED_REPO_STRATEGY,
      },
      software: { github_repo: GBRAIN_SOFTWARE_REPO, install_source: GBRAIN_INSTALL_SOURCE },
      default_shared: false,
      human_editor: "obsidian",
      agent_access: "mcp-only",
    },
    secrets: { path: "secrets", git: "ignored" },
    shared_spaces: [],
    ...overrides,
  };
}

const modulesManifest = { personal_generation: "gen3", owner: LOGIN, module_slots: [] };

/**
 * Fixture má tvar Buddy VPS: `<tmp>/personalspace/<login>_GEN3` a nad ním NIC.
 * Rodičovský adresář se opravdu jmenuje `personalspace` — přesně proto nesmí
 * detekce kořene věřit jménu adresáře.
 */
async function fixture({ withRoot = false, withGbrainMount = true, modules = [] } = {}) {
  const base = await mkdtemp(join(tmpdir(), "personalspace-doctor-"));
  tempRoots.push(base);
  const cwd = join(base, "personalspace", `${LOGIN}_GEN3`);
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, "personal.gen3.json"), JSON.stringify(personalManifest(), null, 2));
  await writeFile(join(cwd, "modules.manifest.json"), JSON.stringify({
    ...modulesManifest,
    module_slots: modules.map((path) => ({ path })),
  }, null, 2));
  for (const path of modules) await mkdir(join(cwd, path, ".git"), { recursive: true });
  if (withGbrainMount) await mkdir(join(cwd, "gbrain", ".git"), { recursive: true });
  if (withRoot) await writeFile(join(base, "launchpad.gen3.json"), JSON.stringify({ schema_version: "x" }));
  return { base, cwd };
}

/** Stub běhu příkazů. Doctor musí jít otestovat bez živého GitHubu — ale nikdy tak, že by si nepozorovanou věc přepsal na PASS. */
function stubRunCommand({ absent = [], ghVisibility = "PRIVATE", collaborators = LOGIN } = {}) {
  return (command, args = [], options = {}) => {
    const missing = (stderr) => ({ status: 1, stdout: "", stderr, error: new Error(stderr) });
    if (absent.includes(command)) return missing(`spawn ${command} ENOENT`);
    if (command === "git") {
      if (args[0] === "config") {
        const repo = String(options.cwd ?? "").replaceAll("\\", "/").endsWith("/gbrain")
          ? `${LOGIN}-gbrain`
          : `${LOGIN}_GEN3`;
        return { status: 0, stdout: `git@github.com:${LOGIN}/${repo}.git`, stderr: "", error: null };
      }
      if (args[0] === "check-ignore") return { status: 0, stdout: "", stderr: "", error: null };
      if (args[0] === "ls-files") return { status: 0, stdout: "", stderr: "", error: null };
      return { status: 0, stdout: "", stderr: "", error: null };
    }
    if (command === "gh") {
      if (args[0] === "api" && args[1] === "user") return { status: 0, stdout: LOGIN, stderr: "", error: null };
      if (args[0] === "repo") {
        return { status: 0, stdout: JSON.stringify({ nameWithOwner: args[2], visibility: ghVisibility }), stderr: "", error: null };
      }
      if (args.includes("--paginate") && args.some((arg) => String(arg).endsWith("/collaborators"))) {
        return { status: 0, stdout: collaborators, stderr: "", error: null };
      }
      return { status: 0, stdout: "", stderr: "", error: null };
    }
    if (command === "gbrain") return { status: 0, stdout: "usage", stderr: "", error: null };
    return missing(`neznámý příkaz ${command}`);
  };
}

/**
 * Stub pro namountované osobní moduly. Každý slot dostane vlastní chování podle
 * své cesty: `visibility` pro živý stav repa, `unobservable` pro modul, o kterém
 * GitHub zrovna nic neřekne.
 */
function stubWithModules(modules, base = {}) {
  const inner = stubRunCommand(base);
  return (command, args = [], options = {}) => {
    const cwd = String(options.cwd ?? "").replaceAll("\\", "/");
    const slot = Object.keys(modules).find((path) => cwd.endsWith(`/${path}`));
    if (slot) {
      const spec = modules[slot];
      const repoName = slot.split("/").pop();
      if (command === "git" && args[0] === "config") {
        return { status: 0, stdout: `git@github.com:${LOGIN}/${repoName}.git`, stderr: "", error: null };
      }
      if (command === "gh") {
        if (spec.unobservable) {
          return { status: 1, stdout: "", stderr: "gh: HTTP 502", error: new Error("gh: HTTP 502") };
        }
        if (args[0] === "repo") {
          return {
            status: 0,
            stdout: JSON.stringify({ nameWithOwner: `${LOGIN}/${repoName}`, visibility: spec.visibility ?? "PRIVATE" }),
            stderr: "",
            error: null,
          };
        }
      }
    }
    return inner(command, args, options);
  };
}

async function report(options = {}, stub = {}) {
  const { cwd } = await fixture(options);
  return runPersonalspaceDoctor({ cwd, commandRunner: stubRunCommand(stub) });
}

function byId(result, id) {
  const check = result.checks.find((entry) => entry.id === id);
  expect(check, `chybí check ${id}`).toBeDefined();
  return check;
}

test("gbrain origin remote se čte z gbrain mountu, ne z Personalspace", async () => {
  const { cwd } = await fixture();
  const seen = [];
  const runner = (command, args = [], options = {}) => {
    if (command === "git" && args[0] === "config") seen.push(options.cwd);
    return stubRunCommand()(command, args, options);
  };
  await runPersonalspaceDoctor({ cwd, commandRunner: runner });
  expect(seen.some((path) => String(path).endsWith("gbrain"))).toBe(true);
});

test("bez kořene nad sebou jsou kořenové kontroly not_applicable, nikdy PASS a nikdy FAIL", async () => {
  const result = await report({ withRoot: false });
  for (const id of ROOT_CHECK_IDS) {
    const check = byId(result, id);
    expect(check.status).toBe("not_applicable");
    expect(check.not_applicable_reason).toBe("owned_by_root");
    expect(check.owner).toBe(ROOT_CHECK_OWNER);
  }
  expect(result.summary.not_applicable).toBeGreaterThanOrEqual(ROOT_CHECK_IDS.length);
});

test("not_applicable nekazí zelenou; standalone Personalspace bez blokátorů je ok", async () => {
  const result = await report({ withRoot: false });
  expect(result.summary.fail).toBe(0);
  expect(result.summary.blocked).toBe(0);
  expect(result.summary.status).toBe("ok");
  expect(exitCodeForSummaryStatus(result.summary.status)).toBe(DOCTOR_EXIT_CODES.ok);
});

test("s kořenem nad sebou se kořenové kontroly opravdu spustí", async () => {
  const result = await report({ withRoot: true });
  for (const id of ROOT_CHECK_IDS) {
    expect(byId(result, id).status).toBe("ok");
  }
});

test("detekce kořene nevěří jménu adresáře, ale přítomnosti launchpad.gen3.json", async () => {
  const withoutRoot = await fixture({ withRoot: false });
  const withRoot = await fixture({ withRoot: true });
  expect(detectRootContext(withoutRoot.cwd, LOGIN).mounted).toBe(false);
  expect(detectRootContext(withoutRoot.cwd, LOGIN).reason).toContain("launchpad.gen3.json");
  expect(detectRootContext(withRoot.cwd, LOGIN).mounted).toBe(true);
});

test("chybějící gbrain CLI je blocked s remedy na fork-of-record, ne tiché PASS", async () => {
  const result = await report({}, { absent: ["gbrain"] });
  const check = byId(result, "gbrain.cli");
  expect(check.status).toBe("blocked");
  expect(check.blocked_reason?.length).toBeGreaterThan(0);
  expect(check.remedy).toContain(GBRAIN_FORK_OF_RECORD);
  expect(check.remedy).toContain(GBRAIN_UPSTREAM);
  expect(check.remedy).not.toContain(`github:${GBRAIN_UPSTREAM}`);
  expect(result.summary.status).toBe("incomplete");
  expect(exitCodeForSummaryStatus(result.summary.status)).toBe(DOCTOR_EXIT_CODES.incomplete);
});

test("nedostupný gh je blocked, ne fail — nepozorování není nález", async () => {
  const result = await report({}, { absent: ["gh"] });
  expect(byId(result, "github.session").status).toBe("blocked");
  expect(byId(result, "personalspace.repo_private").status).toBe("blocked");
  expect(byId(result, "gbrain.collaborators").status).toBe("blocked");
  expect(result.summary.fail).toBe(0);
  expect(result.summary.status).toBe("incomplete");
});

test("veřejné owner repo zůstává tvrdý fail i ve standalone běhu", async () => {
  const result = await report({ withRoot: false }, { ghVisibility: "PUBLIC" });
  expect(byId(result, "personalspace.repo_private").status).toBe("fail");
  expect(result.summary.status).toBe("fail");
  expect(exitCodeForSummaryStatus(result.summary.status)).toBe(DOCTOR_EXIT_CODES.fail);
});

test("cizí collaborator na owner repu je fail, ne warn", async () => {
  const result = await report({}, { collaborators: `${LOGIN}\nplatform-operator` });
  const check = byId(result, "personalspace.collaborators");
  expect(check.status).toBe("fail");
  expect(check.details?.join(" ")).toContain("platform-operator");
});

test("chybějící gbrain mount je fail a závislé kontroly jsou blocked", async () => {
  const result = await report({ withGbrainMount: false });
  expect(byId(result, "gbrain.mount").status).toBe("fail");
  expect(byId(result, "gbrain.tracked_privacy").status).toBe("blocked");
  // Privacy samotného GitHub repa na mountu nezávisí, takže se ověřit dá.
  expect(byId(result, "gbrain.repo_private").status).toBe("ok");
});

test("chybějící Buddy mount je fakt, ne vada", async () => {
  const result = await report();
  const check = byId(result, "buddy.mount");
  expect(check.status).toBe("not_applicable");
  expect(check.not_applicable_reason).toBe("no_such_mount");
});

test("nečitelný root kontrakt je fail s reportem, ne mlčení", async () => {
  const base = await mkdtemp(join(tmpdir(), "personalspace-doctor-broken-"));
  tempRoots.push(base);
  const cwd = join(base, "personalspace", `${LOGIN}_GEN3`);
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, "personal.gen3.json"), "{ tohle není JSON");
  const result = await runPersonalspaceDoctor({ cwd, commandRunner: stubRunCommand() });
  expect(byId(result, "personalspace.profile_materialization").status).toBe("fail");
  expect(checkReportConformance(result, { schema })).toEqual([]);
});

test("report je konformní se společným surfacem ve všech testovaných situacích", async () => {
  const variants = [
    await report({ withRoot: false }),
    await report({ withRoot: true }),
    await report({}, { absent: ["gh", "git", "gbrain"] }),
    await report({ withGbrainMount: false }, { ghVisibility: "PUBLIC" }),
  ];
  for (const variant of variants) {
    expect(checkReportConformance(variant, { schema })).toEqual([]);
    expect(variant.schema_version).toBe("companiesascode.doctor.report.v3");
    expect(variant.scope.type).toBe(DOCTOR_SCOPE_TYPE);
    expect(variant.checks.some((check) => check.status === "skip")).toBe(false);
  }
});

test("souhrn se odvozuje jedinou funkcí, nevyplňuje se ručně", async () => {
  const result = await report({}, { absent: ["gbrain"] });
  expect(result.summary.status).toBe(summarizeStatus(result.checks));
  const forged = buildPersonalspaceReport({ cwd: repoRoot, checks: result.checks });
  expect(forged.summary).toEqual(result.summary);
});

test("kontrolní test: kdyby kořenové kontroly ve standalone fail-closed padaly, brána by hlásila vadu instalace, která se nikdy nestala", async () => {
  const { cwd } = await fixture({ withRoot: false });
  const checks = collectPersonalspaceChecks({
    cwd,
    personal: personalManifest(),
    manifest: modulesManifest,
    runCommand: stubRunCommand(),
  });
  const rootChecks = checks.filter((check) => ROOT_CHECK_IDS.includes(check.id));
  expect(rootChecks).toHaveLength(ROOT_CHECK_IDS.length);
  expect(rootChecks.every((check) => check.status === "not_applicable")).toBe(true);
  expect(summarizeStatus(checks)).toBe("ok");
});

test("doctor je konformní i jako PROCES: argv + cwd dovnitř, v3 report na stdout, exit kód podle reportu", async () => {
  const { cwd } = await fixture({ withRoot: false });
  // PATH bez git/gh/gbrain: běh je hermetický a bez sítě. Nepozorované kontroly
  // musí skončit jako blocked → incomplete → exit 2, ne jako tichá zelená.
  const emptyBin = await mkdtemp(join(tmpdir(), "personalspace-doctor-bin-"));
  tempRoots.push(emptyBin);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
  );
  env.PATH = process.platform === "win32"
    ? `${emptyBin};${process.env.SystemRoot ?? "C:\\Windows"}\\System32`
    : emptyBin;

  const { failures, report: produced } = checkDoctorProcessConformance({
    command: [process.execPath, join(repoRoot, "scripts", "doctor-personalspace.mjs"), "--json"],
    cwd,
    schema,
    spawn: (command, args, options) => spawnSync(command, args, { ...options, env }),
  });
  expect(failures).toEqual([]);
  expect(produced?.scope?.absolute_path).toBeTruthy();
  expect(produced.summary.status).toBe("incomplete");
});

test("bez --json vrací doctor lidský výpis a stejný exit kód", async () => {
  const { cwd } = await fixture({ withRoot: false });
  const emptyBin = await mkdtemp(join(tmpdir(), "personalspace-doctor-human-bin-"));
  tempRoots.push(emptyBin);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
  );
  env.PATH = process.platform === "win32"
    ? `${emptyBin};${process.env.SystemRoot ?? "C:\\Windows"}\\System32`
    : emptyBin;
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, "scripts", "doctor-personalspace.mjs")],
    { cwd, encoding: "utf8", env },
  );
  expect(result.stdout).toContain("Personalspace Doctor:");
  expect(result.status).toBe(DOCTOR_EXIT_CODES.incomplete);
  expect(() => JSON.parse(result.stdout)).toThrow();
});

// --- Nález nesmí přebít nepozorování (osobní moduly) ---------------------------

test("konkrétní fail modulu nesmí smazat nepozorovaný modul z reportu", async () => {
  const { cwd } = await fixture({
    modules: ["modules/public", "modules/dark"],
  });
  const result = await runPersonalspaceDoctor({
    cwd,
    commandRunner: stubWithModules({
      "modules/public": { visibility: "PUBLIC" },
      "modules/dark": { unobservable: true },
    }),
  });
  const privacy = byId(result, "modules.repo_private");
  expect(privacy.status).toBe("fail");
  expect(privacy.details?.join(" ")).toContain("public");
  // Druhý fakt musí přežít: modul, o kterém GitHub nic neřekl, nesmí zmizet.
  const observability = byId(result, "modules.repo_observability");
  expect(observability.status).toBe("blocked");
  expect(observability.blocked_reason).toContain("modules/dark");
  expect(result.summary.blocked).toBeGreaterThanOrEqual(1);
  expect(checkReportConformance(result, { schema })).toEqual([]);
});

test("žádný pozorovaný modul není OK — nula pozorování není nález", async () => {
  const { cwd } = await fixture({ modules: ["modules/dark"] });
  const result = await runPersonalspaceDoctor({
    cwd,
    commandRunner: stubWithModules({ "modules/dark": { unobservable: true } }),
  });
  expect(byId(result, "modules.repo_private").status).toBe("blocked");
  expect(byId(result, "modules.repo_observability").status).toBe("blocked");
  expect(result.summary.status).toBe("incomplete");
});

test("pozorované private moduly jsou ok a žádnou pozorovatelnost neblokují", async () => {
  const { cwd } = await fixture({ modules: ["modules/first", "modules/second"] });
  const result = await runPersonalspaceDoctor({
    cwd,
    commandRunner: stubWithModules({
      "modules/first": { visibility: "PRIVATE" },
      "modules/second": { visibility: "PRIVATE" },
    }),
  });
  expect(byId(result, "modules.repo_private").status).toBe("ok");
  expect(result.checks.some((check) => check.id === "modules.repo_observability")).toBe(false);
  expect(result.summary.status).toBe("ok");
});

// --- Bootstrap přijímá jen vědomě odložené pozorování --------------------------

test("bootstrap přijme incomplete jen kvůli vědomě odloženému gbrain CLI", async () => {
  const result = await report({}, { absent: ["gbrain"] });
  expect(result.checks.filter((check) => check.status === "blocked").map((check) => check.id))
    .toEqual([...DEFERRABLE_DOCTOR_BLOCKED_IDS]);
  const outcome = classifyBootstrapDoctorOutcome({
    report: result,
    exitStatus: exitCodeForSummaryStatus(result.summary.status),
    installGbrain: false,
  });
  expect(outcome.accepted).toBe(true);
  expect(outcome.deferred).toEqual([...DEFERRABLE_DOCTOR_BLOCKED_IDS]);
});

test("bootstrap odmítne incomplete, když se nepozorovalo něco, o co nikdo nepožádal", async () => {
  const result = await report({}, { absent: ["gh"] });
  const outcome = classifyBootstrapDoctorOutcome({
    report: result,
    exitStatus: exitCodeForSummaryStatus(result.summary.status),
    installGbrain: false,
  });
  expect(outcome.accepted).toBe(false);
  expect(outcome.reason).toContain("personalspace.repo_private");
});

test("bootstrap odmítne incomplete i tehdy, když se gbrain zrovna instaloval", async () => {
  const result = await report({}, { absent: ["gbrain"] });
  const outcome = classifyBootstrapDoctorOutcome({
    report: result,
    exitStatus: exitCodeForSummaryStatus(result.summary.status),
    installGbrain: true,
  });
  expect(outcome.accepted).toBe(false);
  expect(outcome.reason).toContain("gbrain.cli");
});

test("bootstrap odmítne běh, kde si exit kód a report odporují", async () => {
  const result = await report({ withRoot: false });
  expect(result.summary.status).toBe("ok");
  const outcome = classifyBootstrapDoctorOutcome({
    report: result,
    exitStatus: DOCTOR_EXIT_CODES.incomplete,
    installGbrain: false,
  });
  expect(outcome.accepted).toBe(false);
  expect(outcome.reason).toContain("invokační kontrakt");
});

test("PROCESNÍ regrese: reálný běh doctora bez git/gh/gbrain bootstrap NEsmí přijmout", async () => {
  const { cwd } = await fixture({ withRoot: false });
  // Stejně hermetický běh jako konformita procesu: prázdný PATH, žádná síť.
  // Doctor poctivě vydá blocked na věci, které nikdo odložit nechtěl — bootstrap
  // je nesmí spolknout jen proto, že souhrn vyšel `incomplete` a exit 2.
  const emptyBin = await mkdtemp(join(tmpdir(), "personalspace-doctor-bin-"));
  tempRoots.push(emptyBin);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
  );
  env.PATH = process.platform === "win32"
    ? `${emptyBin};${process.env.SystemRoot ?? "C:\\Windows"}\\System32`
    : emptyBin;

  const run = spawnSync(
    process.execPath,
    [join(repoRoot, "scripts", "doctor-personalspace.mjs"), "--json"],
    { cwd, encoding: "utf8", env },
  );
  expect(run.status).toBe(DOCTOR_EXIT_CODES.incomplete);
  const produced = JSON.parse(run.stdout);
  const outcome = classifyBootstrapDoctorOutcome({
    report: produced,
    exitStatus: run.status,
    installGbrain: false,
  });
  expect(outcome.accepted).toBe(false);
  expect(outcome.reason).toContain("odložení si nikdo nevyžádal");
});

test("bootstrap odmítne běh, ze kterého žádný report nevznikl", () => {
  const outcome = classifyBootstrapDoctorOutcome({
    report: null,
    exitStatus: DOCTOR_EXIT_CODES.no_report,
    installGbrain: false,
  });
  expect(outcome.accepted).toBe(false);
  expect(outcome.reason).toContain("report");
});
