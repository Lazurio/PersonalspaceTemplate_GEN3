import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { basename, join, relative, resolve } from "path";

import { runCommand, runJson } from "./command-runner.mjs";
import { renderHumanReport } from "./doctor-personalspace-lib.mjs";
import { DOCTOR_EXIT_CODES, exitCodeForSummaryStatus } from "./doctor-surface-lib.mjs";
import {
  GBRAIN_INSTALL_SOURCE,
  appendMissingLines,
  buildModulesManifest,
  buildPersonalConfig,
  expectedIdentity,
  gitlinkPaths,
  inferMountLayout,
  parseGitHubRemote,
  reposEqual,
  trackedRepoPrivacyIssues,
  validatePersonalState,
} from "./personalspace-lib.mjs";

const gbrainIgnoreLines = [
  ".env",
  ".env.*",
  ".gbrain/",
  ".cache/",
  ".obsidian/workspace*.json",
  ".trash/",
  "*.sqlite",
  "*.sqlite3",
  "*.db",
  "*.db-shm",
  "*.db-wal",
];

export function parseBootstrapArgs(argv) {
  const options = {
    apply: false,
    displayName: null,
    ownerType: "human",
    login: null,
    gbrainRepo: null,
    installGbrain: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--install-gbrain") options.installGbrain = true;
    else if (arg === "--display-name") options.displayName = requireValue(argv, ++index, arg);
    else if (arg === "--owner-type") options.ownerType = requireValue(argv, ++index, arg);
    else if (arg === "--login") options.login = requireValue(argv, ++index, arg);
    else if (arg === "--gbrain-repo") options.gbrainRepo = requireValue(argv, ++index, arg);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Neznámý argument: ${arg}`);
  }
  return options;
}

export function resolveBootstrapRepositoryBindings({ login, personal, options }) {
  const sameOwner = typeof personal?.owner?.github_username === "string"
    && personal.owner.github_username.toLowerCase() === login.toLowerCase();
  if (personal?.buddy !== undefined && personal?.buddy !== null) {
    throw new Error(
      "CAC-0071 bootstrap nepřepisuje Buddy-enabled Personalspace; pokračuj podle odděleného CAC-0072 runbooku.",
    );
  }
  const existingGbrainRepo = sameOwner
    ? personal?.gbrain?.repository?.github_repo ?? null
    : null;
  return {
    gbrainRepo: options.gbrainRepo ?? existingGbrainRepo,
  };
}

/**
 * Jediné `blocked` pozorování, které smí bootstrap vědomě odložit.
 *
 * `gbrain.cli` je jediná věc, kterou vlastník mohl schválně neudělat (neinstaloval
 * CLI). Cokoli jiného, co skončilo `blocked`, je nepozorování, o které nikdo
 * nepožádal — a bootstrap ho nesmí přijmout jen proto, že souhrn vyšel stejně
 * `incomplete`.
 */
export const DEFERRABLE_DOCTOR_BLOCKED_IDS = Object.freeze(["gbrain.cli"]);

/**
 * Smí bootstrap tenhle doctor běh přijmout?
 *
 * Rozhoduje se z REPORTU, ne z exit kódu. Exit 2 znamená „aspoň jeden blocked",
 * ne „gbrain CLI chybí"; dokud se bootstrap díval jen na číslo, přijal i běh,
 * ve kterém po preflightu odešlo `gh` a privacy namountovaného modulu nikdo
 * neověřil — a přesto vypsal `Bootstrap dokončen` a vrátil `applied: true`.
 *
 * Scénář: vlastník spustí `--apply` bez `--install-gbrain`, uprostřed běhu mu
 * vyprší GitHub token. Doctor poctivě vydá `blocked` na `personalspace.repo_private`
 * i `modules.repo_observability`, souhrn je `incomplete`, exit 2. Se starým
 * pravidlem bootstrap skončil zeleně a vlastník odešel s vědomím, že jeho repo
 * je private — což nikdo neviděl.
 */
export function classifyBootstrapDoctorOutcome({ report, exitStatus, installGbrain }) {
  if (!report || typeof report !== "object" || typeof report.summary?.status !== "string") {
    return { accepted: false, reason: "Doctor nevydal čitelný v3 report." };
  }
  const status = report.summary.status;
  const expectedExit = exitCodeForSummaryStatus(status);
  if (Number.isInteger(exitStatus) && exitStatus !== expectedExit) {
    // Report a exit kód si odporují. To není nález doctora, to je vada doctora —
    // a hádat, které z těch dvou čísel platí, je horší než bootstrap zastavit.
    return {
      accepted: false,
      reason: `Doctor porušil invokační kontrakt: souhrn ${status} očekává exit ${expectedExit}, přišel ${exitStatus}.`,
    };
  }
  if (status === "ok" || status === "warn") return { accepted: true, reason: null, deferred: [] };
  if (status !== "incomplete") {
    return { accepted: false, reason: `Doctor po bootstrapu neprošel (souhrn ${status}); viz výpis výše.` };
  }
  const blockedIds = (Array.isArray(report.checks) ? report.checks : [])
    .filter((check) => check?.status === "blocked")
    .map((check) => check.id);
  if (installGbrain) {
    // gbrain CLI se právě instalovalo; když je i tak blocked, je to nález, ne odklad.
    return {
      accepted: false,
      reason: `Doctor skončil INCOMPLETE i po instalaci gbrainu; nepozorováno: ${blockedIds.join(", ") || "neznámé kontroly"}.`,
    };
  }
  const unexpected = blockedIds.filter((id) => !DEFERRABLE_DOCTOR_BLOCKED_IDS.includes(id));
  if (unexpected.length > 0) {
    return {
      accepted: false,
      reason: `Doctor nepozoroval kontroly, jejichž odložení si nikdo nevyžádal: ${unexpected.join(", ")}.`,
    };
  }
  if (blockedIds.length === 0) {
    return { accepted: false, reason: "Souhrn je incomplete, ale žádný check není blocked; report si odporuje." };
  }
  return { accepted: true, reason: null, deferred: blockedIds };
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} vyžaduje hodnotu.`);
  return value;
}

function usage() {
  console.log(`Použití:
  bun run bootstrap -- --display-name "<jméno>" [--owner-type human|ai-colleague]
      [--gbrain-repo <login>/<repo>]
      [--install-gbrain]
      [--apply]

Bez --apply proběhne pouze read-only preflight a výpis plánu.`);
}

function authenticatedLogin(cwd) {
  const { json } = runJson("gh", ["api", "user"], { cwd });
  if (typeof json?.login !== "string" || json.login.trim() === "") {
    throw new Error("GitHub CLI nevrátil přihlášený login.");
  }
  return json.login;
}

function repoInfo(repo, cwd, { allowMissing = false } = {}) {
  const result = runCommand(
    "gh",
    ["repo", "view", repo, "--json", "nameWithOwner,visibility,isTemplate"],
    { cwd, allowFailure: true },
  );
  if (result.status !== 0) {
    if (
      allowMissing
      && /could not resolve|not found|http 404/i.test(`${result.stdout}\n${result.stderr}`)
    ) return null;
    throw new Error(`GitHub repo ${repo} nejde ověřit: ${result.stderr || "bez detailu"}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub repo ${repo} nevrátil validní metadata.`);
  }
}

function assertPrivate(info, expectedRepo) {
  if (!info || !reposEqual(info.nameWithOwner, expectedRepo)) {
    throw new Error(`GitHub metadata neodpovídají repu ${expectedRepo}.`);
  }
  if (String(info.visibility).toLowerCase() !== "private") {
    throw new Error(`Repo ${expectedRepo} musí být private; nalezeno ${info.visibility}.`);
  }
}

function originRemote(cwd) {
  const result = runCommand("git", ["config", "--get", "remote.origin.url"], { cwd });
  if (!parseGitHubRemote(result.stdout)) throw new Error(`Origin v ${cwd} není podporovaný GitHub remote.`);
  return result.stdout;
}

function assertNoGitlinks(cwd) {
  if (existsSync(join(cwd, ".gitmodules"))) {
    throw new Error(`${cwd} obsahuje zakázaný .gitmodules.`);
  }
  const staged = runCommand("git", ["ls-files", "-s"], { cwd }).stdout;
  const gitlinks = gitlinkPaths(staged);
  if (gitlinks.length > 0) throw new Error(`Zakázané gitlinky: ${gitlinks.join(", ")}`);
}

function assertIgnored(cwd, path) {
  const result = runCommand("git", ["check-ignore", "--quiet", "--no-index", path], {
    cwd,
    allowFailure: true,
  });
  if (result.status !== 0) throw new Error(`${path} není gitignored v ${cwd}.`);
}

async function ensureGbrainIgnore(gbrainRoot) {
  const ignorePath = join(gbrainRoot, ".gitignore");
  const current = existsSync(ignorePath) ? await readFile(ignorePath, "utf8") : "";
  const next = appendMissingLines(current, gbrainIgnoreLines);
  if (next !== current) await writeFile(ignorePath, next, "utf8");
}

export async function bootstrapPersonalspace(options, {
  cwd = process.cwd(),
} = {}) {
  const personalspaceRoot = resolve(cwd);
  const signedInLogin = authenticatedLogin(personalspaceRoot);
  if (options.login && options.login.toLowerCase() !== signedInLogin.toLowerCase()) {
    throw new Error(`--login ${options.login} neodpovídá přihlášenému GitHub účtu ${signedInLogin}.`);
  }
  const login = options.login ?? signedInLogin;
  const personalPath = join(personalspaceRoot, "personal.gen3.json");
  let personalTemplate;
  try {
    personalTemplate = JSON.parse(await readFile(personalPath, "utf8"));
  } catch {
    throw new Error("personal.gen3.json nejde přečíst jako validní JSON.");
  }
  const bindings = resolveBootstrapRepositoryBindings({
    login,
    personal: personalTemplate,
    options,
  });
  const identity = expectedIdentity(login, bindings.gbrainRepo);
  const layout = inferMountLayout(personalspaceRoot, login);
  if (!existsSync(join(layout.conglomerateRoot, "launchpad.gen3.json"))) {
    throw new Error("Nad personalspace/ chybí launchpad.gen3.json; checkout není v Lazurio rootu.");
  }
  const ownerRemote = originRemote(personalspaceRoot);
  if (!reposEqual(parseGitHubRemote(ownerRemote), identity.repo)) {
    throw new Error(`Origin musí ukazovat na ${identity.repo}.`);
  }
  assertPrivate(repoInfo(identity.repo, personalspaceRoot), identity.repo);
  assertIgnored(layout.conglomerateRoot, identity.mountPath);
  assertIgnored(personalspaceRoot, "secrets/provider/scope/purpose/credential.txt");
  assertIgnored(personalspaceRoot, "gbrain/.privacy-probe");
  assertIgnored(personalspaceRoot, "buddy/.privacy-probe");
  assertIgnored(personalspaceRoot, "workspace/example-private-module");
  assertNoGitlinks(layout.conglomerateRoot);
  assertNoGitlinks(personalspaceRoot);
  const ownerPrivacyIssues = trackedRepoPrivacyIssues(personalspaceRoot, {
    runCommand,
    label: "Personalspace",
  });
  if (ownerPrivacyIssues.length > 0) {
    throw new Error(`Trackovaný privacy obsah: ${ownerPrivacyIssues.join("; ")}`);
  }

  const gbrainRoot = join(personalspaceRoot, "gbrain");
  let gbrainInfo = repoInfo(identity.gbrainRepo, personalspaceRoot, { allowMissing: true });
  let gbrainRemote = null;
  if (gbrainInfo) assertPrivate(gbrainInfo, identity.gbrainRepo);
  if (existsSync(gbrainRoot)) {
    if (!existsSync(join(gbrainRoot, ".git"))) {
      throw new Error("gbrain/ existuje, ale není samostatný Git checkout.");
    }
    gbrainRemote = originRemote(gbrainRoot);
    if (!reposEqual(parseGitHubRemote(gbrainRemote), identity.gbrainRepo)) {
      throw new Error(`gbrain origin musí ukazovat na ${identity.gbrainRepo}.`);
    }
    assertNoGitlinks(gbrainRoot);
    const gbrainPrivacyIssues = trackedRepoPrivacyIssues(gbrainRoot, {
      runCommand,
      label: "gbrain",
    });
    if (gbrainPrivacyIssues.length > 0) {
      throw new Error(`Trackovaný privacy obsah: ${gbrainPrivacyIssues.join("; ")}`);
    }
  }

  const manifestPath = join(personalspaceRoot, "modules.manifest.json");
  let manifestTemplate;
  try {
    manifestTemplate = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error("modules.manifest.json nejde přečíst jako validní JSON.");
  }
  const personal = buildPersonalConfig(personalTemplate, {
    login,
    displayName: options.displayName,
    ownerType: options.ownerType,
    gbrainRepo: identity.gbrainRepo,
  });
  const manifest = buildModulesManifest(manifestTemplate, login);
  const preflightStateIssues = validatePersonalState(personal, manifest, {
    directoryName: basename(personalspaceRoot),
    ownerRemote,
    gbrainRemote,
  });
  if (preflightStateIssues.length > 0) {
    throw new Error(`Preflight kontrakt není validní: ${preflightStateIssues.join("; ")}`);
  }

  console.log("Personalspace preflight PASS");
  console.log(`- GitHub owner repo: ${identity.repo} (private)`);
  console.log(`- Lokální mount: ${identity.mountPath}`);
  console.log(`- Gbrain data repo: ${identity.gbrainRepo} (${gbrainInfo ? "private, existuje" : "bude vytvořeno jako private"})`);
  console.log(`- Gbrain software: ${GBRAIN_INSTALL_SOURCE}${options.installGbrain ? " (nainstaluje se CLI; aktivace zůstává owner gate)" : " (instalace CLI přeskočena)"}`);
  console.log("- Buddy: není součást CAC-0071; Personalspace zůstává plně validní bez Buddyho");

  if (!options.apply) {
    console.log("Dry-run dokončen. Pro provedení přidej --apply.");
    return { applied: false, identity };
  }

  if (!gbrainInfo) {
    runCommand("gh", [
      "repo",
      "create",
      identity.gbrainRepo,
      "--private",
      "--add-readme",
      "--description",
      "Privátní Markdown paměť Personalspace GEN3.",
    ], { cwd: personalspaceRoot });
    gbrainInfo = repoInfo(identity.gbrainRepo, personalspaceRoot);
    assertPrivate(gbrainInfo, identity.gbrainRepo);
  }
  if (!existsSync(gbrainRoot)) {
    runCommand("gh", ["repo", "clone", identity.gbrainRepo, gbrainRoot], { cwd: personalspaceRoot });
  }
  gbrainRemote = originRemote(gbrainRoot);
  if (!reposEqual(parseGitHubRemote(gbrainRemote), identity.gbrainRepo)) {
    throw new Error(`Naklonovaný gbrain origin musí ukazovat na ${identity.gbrainRepo}.`);
  }
  assertNoGitlinks(gbrainRoot);
  const gbrainPrivacyIssues = trackedRepoPrivacyIssues(gbrainRoot, {
    runCommand,
    label: "gbrain",
  });
  if (gbrainPrivacyIssues.length > 0) {
    throw new Error(`Trackovaný privacy obsah: ${gbrainPrivacyIssues.join("; ")}`);
  }
  await ensureGbrainIgnore(gbrainRoot);

  const stateIssues = validatePersonalState(personal, manifest, {
    directoryName: basename(personalspaceRoot),
    ownerRemote,
    gbrainRemote,
  });
  if (stateIssues.length > 0) {
    throw new Error(`Vygenerovaný kontrakt není validní: ${stateIssues.join("; ")}`);
  }
  await writeFile(personalPath, `${JSON.stringify(personal, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (options.installGbrain) {
    runCommand("bun", ["install", "-g", GBRAIN_INSTALL_SOURCE], {
      cwd: personalspaceRoot,
      inherit: true,
    });
  }

  // Doctor po sobě vrací exit kód podle společného surfacu (decision 0118):
  // 0 = ok|warn, 1 = fail, 2 = incomplete, 3 = report nevznikl. `incomplete`
  // NEsplní bránu, ale když vlastník aktivaci gbrainu vědomě odložil, není to
  // důvod bootstrap shodit — je to důvod říct nahlas, že běh zůstal nedokončený.
  //
  // Bootstrap si proto bere REPORT, ne jen číslo: exit 2 sám o sobě neříká, CO
  // se nepozorovalo, a odložit se smí výhradně to, o co vlastník požádal.
  const doctor = runCommand("bun", ["scripts/doctor-personalspace.mjs", "--json"], {
    cwd: personalspaceRoot,
    allowFailure: true,
  });
  let doctorReport = null;
  try {
    doctorReport = JSON.parse(doctor.stdout);
  } catch {
    throw new Error(
      `Doctor po bootstrapu nevydal čitelný v3 report (exit ${doctor.status}): ${doctor.stderr || "prázdný stdout"}`,
    );
  }
  // Výpis vždycky PŘED rozhodnutím: i běh, který bootstrap zamítne, musí vlastník
  // vidět celý. Report, který nemá tvar v3, se vypíše syrový — přebarvovat ho na
  // lidský výpis by znamenalo tvrdit o něm víc, než se o něm ví.
  console.log(`\n${typeof doctorReport?.summary?.status === "string"
    ? renderHumanReport(doctorReport)
    : doctor.stdout}`);
  const outcome = classifyBootstrapDoctorOutcome({
    report: doctorReport,
    exitStatus: doctor.status,
    installGbrain: options.installGbrain,
  });
  if (!outcome.accepted) throw new Error(outcome.reason);
  if (doctor.status === DOCTOR_EXIT_CODES.incomplete) {
    console.warn(
      `\nDoctor skončil INCOMPLETE: vědomě odložené pozorování ${outcome.deferred.join(", ")} `
      + "(gbrain CLI, které jsi neinstaloval). Bránu to nesplňuje — viz BLOCKED řádky výše.",
    );
  }

  console.log("\nBootstrap dokončen. Zkontroluj diff a publikuj ho vědomě:");
  console.log("  git status --short");
  console.log("  git add personal.gen3.json modules.manifest.json");
  console.log('  git commit -m "Nastav Personalspace GEN3"');
  console.log("  git push");
  console.log("\nGbrain data repo má vlastní necommitnutý .gitignore; zkontroluj a publikuj jej zvlášť.");
  console.log(`  git -C ${relative(personalspaceRoot, gbrainRoot) || "gbrain"} status --short`);
  console.log("\nGbrain CLI není totéž co aktivovaný brain. Podle manual/bootstrap-personalspace.md");
  console.log("vědomě zvol provider a search režim, potom spusť gbrain doctor --json.");
  return { applied: true, identity };
}

if (import.meta.main) {
  try {
    const options = parseBootstrapArgs(Bun.argv.slice(2));
    if (options.help) usage();
    else await bootstrapPersonalspace(options);
  } catch (error) {
    console.error(`Bootstrap selhal: ${error.message}`);
    process.exit(1);
  }
}
