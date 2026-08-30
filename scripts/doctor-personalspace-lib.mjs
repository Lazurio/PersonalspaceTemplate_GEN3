// Kontroly Personalspace doctora (Lazurio decision 0118).
//
// Doctor není jeden program. Root doctor v kořeni Lazuria orchestruje a nese
// STANDARDIZOVANÉ kontroly; každé namountované repo si nese VLASTNÍ nezávislý
// doctor, který root najde přes blok `doctor` v manifestu a zavolá. Tenhle soubor
// je ten vlastní doctor Personalspace — a musí umět běžet i samostatně: na Buddy
// VPS je v `<login>_GEN3` Personalspace a nad ním už nic.
//
// Slovník stavů je společný surface, ne lokální vynález:
//   not_applicable = strukturálně mimo scope tohohle doctora (FAKT, zelenou nekazí)
//   blocked        = mělo to běžet, nešlo to pozorovat (kazí zelenou VŽDY)
// Kontroly kořene proto ve standalone běhu nejsou ani PASS, ani FAIL — jsou
// `not_applicable` s důvodem `owned_by_root`. Netvrdíme, co jsme nepozorovali.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { runCommand as defaultRunCommand } from "./command-runner.mjs";
import {
  DOCTOR_REPORT_SCHEMA_VERSION_V3,
  buildSummary,
} from "./doctor-surface-lib.mjs";
import {
  expectedIdentity,
  gitlinkPaths,
  inferMountLayout,
  parseGitHubRemote,
  pendingRepositoryInvitationLabels,
  reposEqual,
  trackedRepoPrivacyIssues,
  unexpectedRepositoryCollaborators,
  validatePersonalState,
} from "./personalspace-lib.mjs";

/** Kdo kontroly kořene vlastní MÍSTO tohohle doctora, když nad ním kořen je. */
export const ROOT_CHECK_OWNER = "root doctor";
/** Vlastník kontrol, jejichž předmět v téhle topologii prostě neexistuje. */
export const SELF_CHECK_OWNER = "personalspace doctor";

export const GH_AUTH_REMEDY = "Přihlas se jako vlastník: `gh auth login` a znovu spusť doctor.";

/**
 * Náprava odkazuje na fork-of-record `Lazurio/gbrain`, ne přímo na upstream —
 * to je zdroj, ze kterého gbrain konzumujeme. Upstream se přitom nemaže, jmenuje:
 * fork bez uvedené provenience je nedohledatelný a člověk u konzole neví, čí
 * kód si instaluje.
 *
 * Pozor na zbylý rozpor: `gbrain.software.install_source` v manifestu zatím
 * deklaruje upstream, protože ho `personal.gen3.schema.json` v
 * Lazurio schema pinuje jako `const`. Sjednocení je samostatná
 * změna Lazurio rootu; tichý fork kontraktu tady by byl horší než viditelný rozpor.
 */
export const GBRAIN_FORK_OF_RECORD = "Lazurio/gbrain";
export const GBRAIN_UPSTREAM = "garrytan/gbrain";
export const GBRAIN_CLI_REMEDY =
  `Nainstaluj gbrain CLI z fork-of-record \`${GBRAIN_FORK_OF_RECORD}\` `
  + `(fork upstreamu \`${GBRAIN_UPSTREAM}\`): \`bun install -g github:${GBRAIN_FORK_OF_RECORD}\`.`;

function check(id, status, severity, title, message, extra = {}) {
  const entry = { id, status, severity, title, message };
  if (extra.paths?.length) entry.paths = extra.paths;
  if (extra.details?.length) entry.details = extra.details;
  if (status === "blocked") {
    entry.blocked_reason = extra.blocked_reason;
    entry.remedy = extra.remedy;
  }
  if (status === "not_applicable") {
    entry.not_applicable_reason = extra.not_applicable_reason;
    entry.owner = extra.owner;
  }
  return entry;
}

const ok = (id, severity, title, message, extra) => check(id, "ok", severity, title, message, extra);
const fail = (id, severity, title, message, extra) => check(id, "fail", severity, title, message, extra);
const blocked = (id, severity, title, message, extra) => check(id, "blocked", severity, title, message, extra);
const notApplicable = (id, severity, title, message, extra) =>
  check(id, "not_applicable", severity, title, message, extra);

/**
 * Je nad tímhle checkoutem Lazurio root?
 *
 * Detekce stojí na PŘÍTOMNOSTI kořenového manifestu, ne na názvu adresáře — a to
 * je celý rozdíl oproti staré fail-closed asercí. Buddy VPS má checkout v
 * `/srv/personalspace/<login>_GEN3`, takže rodičovský adresář se `personalspace`
 * opravdu jmenuje; kořen tam ale žádný není a nikdy nebude. Kdyby detekce věřila
 * jménu, doctor by na hostu hlásil chybějící `launchpad.gen3.json` jako vadu
 * instalace, která se nikdy nestala.
 */
export function detectRootContext(cwd, login, { fileExists = existsSync } = {}) {
  let layout = null;
  try {
    layout = inferMountLayout(cwd, login);
  } catch (error) {
    return {
      mounted: false,
      layout: null,
      reason: `Checkout není namountovaný pod Lazurio rootem (${error.message})`,
    };
  }
  if (!fileExists(join(layout.conglomerateRoot, "launchpad.gen3.json"))) {
    return {
      mounted: false,
      layout,
      reason: "Nad mountpointem personalspace/ není launchpad.gen3.json; žádný Lazurio root tu není.",
    };
  }
  return { mounted: true, layout, reason: null };
}

/**
 * Spustí příkaz jen jako POZOROVÁNÍ. Rozlišení „příkaz odpověděl ne" od „příkaz
 * vůbec neodpověděl" je to, co drží hranici fail vs blocked.
 */
function observe(runCommand, command, args, cwd) {
  const result = runCommand(command, args, { cwd, allowFailure: true });
  return {
    ran: Number.isInteger(result.status) && !result.error,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** `git check-ignore` má tři odpovědi: ignorováno (0), neignorováno (1), neodpověděl. */
function probeIgnored(runCommand, cwd, probe) {
  const result = observe(runCommand, "git", ["check-ignore", "--quiet", "--no-index", probe], cwd);
  if (!result.ran || (result.status !== 0 && result.status !== 1)) {
    return { observed: false, ignored: false, probe, detail: result.stderr };
  }
  return { observed: true, ignored: result.status === 0, probe, detail: "" };
}

function gitlinkCheck(runCommand, id, cwd, label, severity = "required") {
  if (existsSync(join(cwd, ".gitmodules"))) {
    return fail(id, severity, `Gitlinky (${label})`, `${label}: .gitmodules je zakázaný.`, {
      paths: [".gitmodules"],
    });
  }
  const result = observe(runCommand, "git", ["ls-files", "-s"], cwd);
  if (!result.ran || result.status !== 0) {
    return blocked(id, severity, `Gitlinky (${label})`, `${label}: git index nešel přečíst.`, {
      blocked_reason: result.stderr || "git ls-files -s neodpověděl",
      remedy: "Ověř, že jde o Git checkout a že je dostupné `git`.",
    });
  }
  const gitlinks = gitlinkPaths(result.stdout);
  if (gitlinks.length > 0) {
    return fail(id, severity, `Gitlinky (${label})`, `${label}: zakázané gitlinky.`, {
      details: gitlinks,
    });
  }
  return ok(id, severity, `Gitlinky (${label})`, `${label}: žádný .gitmodules ani gitlink.`);
}

function privacyCheck(runCommand, id, cwd, label) {
  const probe = observe(runCommand, "git", ["ls-files", "-s", "-z"], cwd);
  if (!probe.ran || probe.status !== 0) {
    return blocked(id, "required", `Trackovaný obsah (${label})`, `${label}: trackované soubory nešly vypsat.`, {
      blocked_reason: probe.stderr || "git ls-files -s -z neodpověděl",
      remedy: "Ověř, že jde o Git checkout a že je dostupné `git`.",
    });
  }
  const issues = trackedRepoPrivacyIssues(cwd, { runCommand, label });
  if (issues.length > 0) {
    return fail(id, "required", `Trackovaný obsah (${label})`, `${label}: trackovaný obsah porušuje privacy kontrakt.`, {
      details: issues,
    });
  }
  return ok(id, "required", `Trackovaný obsah (${label})`, `${label}: žádný trackovaný secret, symlink ani runtime cache.`);
}

function liveRepoCheck(runCommand, { id, repo, cwd, label }) {
  const result = observe(runCommand, "gh", ["repo", "view", repo, "--json", "nameWithOwner,visibility"], cwd);
  if (!result.ran || result.status !== 0) {
    return blocked(id, "required", `Privacy repa (${label})`, `${label}: GitHub repo ${repo} nešlo živě ověřit.`, {
      blocked_reason: result.stderr || "gh repo view neodpověděl",
      remedy: GH_AUTH_REMEDY,
    });
  }
  let info;
  try {
    info = JSON.parse(result.stdout);
  } catch {
    return blocked(id, "required", `Privacy repa (${label})`, `${label}: GitHub repo ${repo} nevrátilo čitelná metadata.`, {
      blocked_reason: "gh repo view nevrátil validní JSON",
      remedy: GH_AUTH_REMEDY,
    });
  }
  const problems = [];
  if (!reposEqual(info.nameWithOwner, repo)) {
    problems.push(`GitHub repo neodpovídá ${repo} (nalezeno ${info.nameWithOwner}).`);
  }
  if (String(info.visibility).toLowerCase() !== "private") {
    problems.push(`${repo} není private (${info.visibility}).`);
  }
  if (problems.length > 0) {
    return fail(id, "required", `Privacy repa (${label})`, `${label}: repo neodpovídá private kontraktu.`, {
      details: problems,
    });
  }
  return ok(id, "required", `Privacy repa (${label})`, `${label}: ${repo} je private a odpovídá deklaraci.`);
}

function collaboratorsCheck(runCommand, { id, repo, ownerLogin, cwd, label }) {
  const collaborators = observe(
    runCommand,
    "gh",
    ["api", "--paginate", `repos/${repo}/collaborators`, "--jq", ".[].login"],
    cwd,
  );
  const invitations = observe(
    runCommand,
    "gh",
    ["api", "--paginate", `repos/${repo}/invitations`, "--jq", ".[] | [.id, .invitee.login] | @tsv"],
    cwd,
  );
  const unobserved = [];
  if (!collaborators.ran || collaborators.status !== 0) unobserved.push("collaborators");
  if (!invitations.ran || invitations.status !== 0) unobserved.push("invitations");
  if (unobserved.length > 0) {
    return blocked(id, "required", `Sdílení repa (${label})`, `${label}: sdílení repa ${repo} nešlo živě ověřit.`, {
      blocked_reason: `Nepozorováno: ${unobserved.join(", ")}.`,
      remedy: GH_AUTH_REMEDY,
    });
  }
  const problems = [];
  const unexpected = unexpectedRepositoryCollaborators(
    collaborators.stdout.split(/\r?\n/),
    ownerLogin,
  );
  if (unexpected.length > 0) {
    problems.push(`Zakázaní collaborators: ${unexpected.join(", ")}.`);
  }
  const pending = pendingRepositoryInvitationLabels(invitations.stdout.split(/\r?\n/));
  if (pending.length > 0) {
    problems.push(`Zakázané čekající pozvánky: ${pending.join(", ")}.`);
  }
  if (problems.length > 0) {
    return fail(id, "required", `Sdílení repa (${label})`, `${label}: ${repo} je sdílené mimo vlastníka.`, {
      details: [...problems, "Odeber je podle manual/revoke-legacy-sharing.md."],
    });
  }
  return ok(id, "required", `Sdílení repa (${label})`, `${label}: ${repo} má přístup jen vlastník.`);
}

function originRemote(runCommand, cwd) {
  const result = observe(runCommand, "git", ["config", "--get", "remote.origin.url"], cwd);
  if (!result.ran || result.status !== 0) return null;
  return result.stdout;
}

/**
 * Kontroly Lazurio rootu. Když nad checkoutem root JE, běží doopravdy;
 * když není, jsou to `not_applicable` s důvodem `owned_by_root`. Nikdy PASS —
 * doctor by tvrdil, že ověřil něco, co ani nemohl vidět.
 */
function rootChecks(runCommand, context, mountPath) {
  const ids = [
    ["root.launchpad_manifest", "Kořenový manifest", "launchpad.gen3.json nad personalspace/"],
    ["root.mount_ignored", "Ignorovaný mount", "mountpoint Personalspace v kořeni"],
    ["root.no_gitlinks", "Gitlinky kořene", "kořen bez .gitmodules a gitlinků"],
  ];
  if (!context.mounted) {
    return ids.map(([id, title, subject]) =>
      notApplicable(id, "required", title, `Nekontrolováno tady: ${subject}. ${context.reason}`, {
        not_applicable_reason: "owned_by_root",
        owner: ROOT_CHECK_OWNER,
      }));
  }

  const root = context.layout.conglomerateRoot;
  const checks = [
    ok("root.launchpad_manifest", "required", "Kořenový manifest", "Nad personalspace/ je launchpad.gen3.json."),
  ];
  const probe = probeIgnored(runCommand, root, mountPath ?? context.layout.relativeMount);
  if (!probe.observed) {
    checks.push(blocked("root.mount_ignored", "required", "Ignorovaný mount", "Nešlo ověřit, že kořen mount ignoruje.", {
      blocked_reason: probe.detail || "git check-ignore v kořeni neodpověděl",
      remedy: "Spusť doctor z kořene Lazuria nebo oprav jeho Git checkout.",
    }));
  } else if (!probe.ignored) {
    checks.push(fail("root.mount_ignored", "required", "Ignorovaný mount", `${probe.probe} není gitignored v kořeni.`));
  } else {
    checks.push(ok("root.mount_ignored", "required", "Ignorovaný mount", `${probe.probe} je v kořeni gitignored.`));
  }
  checks.push(gitlinkCheck(runCommand, "root.no_gitlinks", root, "kořen"));
  return checks;
}

/**
 * Všechny kontroly Personalspace doctora v jednom poli. `runCommand` je vstřikované
 * schválně: doctor smí být otestovaný bez živého GitHubu, ale nikdy ne tak, že by
 * si nepozorovanou věc přepsal na PASS.
 */
export function collectPersonalspaceChecks({
  cwd,
  personal,
  manifest,
  runCommand,
  fileExists = existsSync,
}) {
  const checks = [];
  const login = personal?.owner?.github_username;

  let identity = null;
  let identityError = null;
  try {
    identity = expectedIdentity(login, personal?.gbrain?.repository?.github_repo);
  } catch (error) {
    identityError = error.message;
  }
  checks.push(identity
    ? ok("personalspace.identity", "required", "Identita vlastníka", `Vlastník ${identity.login}, owner repo ${identity.repo}, gbrain repo ${identity.gbrainRepo}.`)
    : fail("personalspace.identity", "required", "Identita vlastníka", `Identitu vlastníka nejde odvodit: ${identityError}`));

  const context = detectRootContext(cwd, login, { fileExists });
  checks.push(...rootChecks(runCommand, context, identity?.mountPath));

  const ownerRemote = originRemote(runCommand, cwd);
  const gbrainRoot = join(cwd, "gbrain");
  const gbrainMounted = fileExists(join(gbrainRoot, ".git"));
  const gbrainRemote = gbrainMounted ? originRemote(runCommand, gbrainRoot) : null;

  // Remotes se sem záměrně nepředávají: pozorování remotu má vlastní kontroly
  // (`*.origin_remote`), které umí rozlišit „ukazuje jinam" od „nešlo přečíst".
  // Kdyby je validovala i tahle agregace, jedna vada by se hlásila dvakrát.
  const stateFailures = validatePersonalState(personal, manifest, {
    directoryName: basename(resolve(cwd)),
  });
  checks.push(stateFailures.length > 0
    ? fail("personalspace.profile_materialization", "required", "Materializace profilu", "personal.gen3.json / modules.manifest.json neodpovídá kontraktu Personalspace.", { details: stateFailures, paths: ["personal.gen3.json", "modules.manifest.json"] })
    : ok("personalspace.profile_materialization", "required", "Materializace profilu", "Profil je materializovaný: bez placeholderů, se správným adresářem a remotes.", { paths: ["personal.gen3.json", "modules.manifest.json"] }));

  const session = observe(runCommand, "gh", ["api", "user", "--jq", ".login"], cwd);
  if (!session.ran || session.status !== 0 || session.stdout.trim() === "") {
    checks.push(blocked("github.session", "runtime", "Přihlášený GitHub účet", "Přihlášený GitHub účet nešlo zjistit.", {
      blocked_reason: session.stderr || "gh api user neodpověděl",
      remedy: GH_AUTH_REMEDY,
    }));
  } else if (identity && session.stdout.trim().toLowerCase() !== identity.login.toLowerCase()) {
    checks.push(fail("github.session", "runtime", "Přihlášený GitHub účet", `Přihlášený GitHub účet ${session.stdout.trim()} není vlastník ${identity.login}.`));
  } else {
    checks.push(ok("github.session", "runtime", "Přihlášený GitHub účet", `Přihlášený GitHub účet je ${session.stdout.trim()}.`));
  }

  if (ownerRemote === null) {
    checks.push(blocked("personalspace.origin_remote", "required", "Origin remote Personalspace", "Origin remote Personalspace nešel přečíst.", {
      blocked_reason: "git config --get remote.origin.url neodpověděl",
      remedy: "Ověř, že jde o Git checkout s nastaveným origin remote.",
    }));
  } else if (identity && !reposEqual(parseGitHubRemote(ownerRemote), identity.repo)) {
    checks.push(fail("personalspace.origin_remote", "required", "Origin remote Personalspace", `Origin remote neukazuje na ${identity.repo}.`));
  } else {
    checks.push(ok("personalspace.origin_remote", "required", "Origin remote Personalspace", "Origin remote odpovídá deklarovanému owner repu."));
  }

  if (identity) {
    checks.push(liveRepoCheck(runCommand, { id: "personalspace.repo_private", repo: identity.repo, cwd, label: "Personalspace" }));
    checks.push(collaboratorsCheck(runCommand, { id: "personalspace.collaborators", repo: identity.repo, ownerLogin: identity.login, cwd, label: "Personalspace" }));
    checks.push(liveRepoCheck(runCommand, { id: "gbrain.repo_private", repo: identity.gbrainRepo, cwd, label: "gbrain" }));
    checks.push(collaboratorsCheck(runCommand, { id: "gbrain.collaborators", repo: identity.gbrainRepo, ownerLogin: identity.login, cwd, label: "gbrain" }));
  } else {
    const unknownIdentity = {
      blocked_reason: "Identita vlastníka nejde odvodit z personal.gen3.json.",
      remedy: "Oprav owner.github_username a gbrain.repository.github_repo v personal.gen3.json.",
    };
    checks.push(blocked("personalspace.repo_private", "required", "Privacy repa (Personalspace)", "Bez identity vlastníka nejde owner repo ověřit.", unknownIdentity));
    checks.push(blocked("personalspace.collaborators", "required", "Sdílení repa (Personalspace)", "Bez identity vlastníka nejde sdílení owner repa ověřit.", unknownIdentity));
    checks.push(blocked("gbrain.repo_private", "required", "Privacy repa (gbrain)", "Bez identity vlastníka nejde gbrain repo ověřit.", unknownIdentity));
    checks.push(blocked("gbrain.collaborators", "required", "Sdílení repa (gbrain)", "Bez identity vlastníka nejde sdílení gbrain repa ověřit.", unknownIdentity));
  }

  const ignoreProbes = [
    "secrets/provider/scope/purpose/credential.txt",
    "gbrain",
    "buddy",
    "workspace/example-private-module",
  ].map((probe) => probeIgnored(runCommand, cwd, probe));
  const unobservedProbes = ignoreProbes.filter((probe) => !probe.observed);
  const leaking = ignoreProbes.filter((probe) => probe.observed && !probe.ignored);
  if (unobservedProbes.length > 0) {
    checks.push(blocked("personalspace.gitignore", "required", "Gitignore hranice", "Nešlo ověřit, že runtime mounty a secrets jsou gitignored.", {
      blocked_reason: `Nepozorováno: ${unobservedProbes.map((probe) => probe.probe).join(", ")}.`,
      remedy: "Ověř, že jde o Git checkout a že je dostupné `git`.",
      paths: [".gitignore"],
    }));
  } else if (leaking.length > 0) {
    checks.push(fail("personalspace.gitignore", "required", "Gitignore hranice", "Runtime mount nebo secrets nejsou gitignored.", {
      details: leaking.map((probe) => `${probe.probe} není gitignored.`),
      paths: [".gitignore"],
    }));
  } else {
    checks.push(ok("personalspace.gitignore", "required", "Gitignore hranice", "secrets/, gbrain/, buddy/ i osobní moduly jsou gitignored.", { paths: [".gitignore"] }));
  }

  checks.push(gitlinkCheck(runCommand, "personalspace.no_gitlinks", cwd, "Personalspace"));
  checks.push(privacyCheck(runCommand, "personalspace.tracked_privacy", cwd, "Personalspace"));

  if (!gbrainMounted) {
    checks.push(fail("gbrain.mount", "required", "Mount gbrain", "gbrain/ není samostatný Git checkout private data repa.", { paths: ["gbrain"] }));
    const noMount = {
      blocked_reason: "gbrain/ mount neexistuje.",
      remedy: "Naklonuj private gbrain data repo do gitignored gbrain/ podle manual/bootstrap-personalspace.md.",
    };
    checks.push(blocked("gbrain.origin_remote", "required", "Origin remote gbrain", "Bez mountu nejde gbrain origin remote ověřit.", noMount));
    checks.push(blocked("gbrain.no_gitlinks", "required", "Gitlinky (gbrain)", "Bez mountu nejde gbrain index ověřit.", noMount));
    checks.push(blocked("gbrain.tracked_privacy", "required", "Trackovaný obsah (gbrain)", "Bez mountu nejde trackovaný obsah gbrainu ověřit.", noMount));
  } else {
    checks.push(ok("gbrain.mount", "required", "Mount gbrain", "gbrain/ je samostatný Git checkout.", { paths: ["gbrain"] }));
    if (gbrainRemote === null) {
      checks.push(blocked("gbrain.origin_remote", "required", "Origin remote gbrain", "Origin remote gbrainu nešel přečíst.", {
        blocked_reason: "git config --get remote.origin.url v gbrain/ neodpověděl",
        remedy: "Nastav v gbrain/ origin remote na private gbrain data repo.",
      }));
    } else if (identity && !reposEqual(parseGitHubRemote(gbrainRemote), identity.gbrainRepo)) {
      checks.push(fail("gbrain.origin_remote", "required", "Origin remote gbrain", `Origin remote gbrainu neukazuje na ${identity.gbrainRepo}.`));
    } else {
      checks.push(ok("gbrain.origin_remote", "required", "Origin remote gbrain", "Origin remote gbrainu odpovídá deklarovanému data repu."));
    }
    checks.push(gitlinkCheck(runCommand, "gbrain.no_gitlinks", gbrainRoot, "gbrain"));
    checks.push(privacyCheck(runCommand, "gbrain.tracked_privacy", gbrainRoot, "gbrain"));
  }

  const gbrainCli = observe(runCommand, "gbrain", ["--help"], cwd);
  checks.push(gbrainCli.ran && gbrainCli.status === 0
    ? ok("gbrain.cli", "runtime", "gbrain CLI", "gbrain CLI je dostupné; runtime zdraví ověř samostatně přes `gbrain doctor --json`.")
    : blocked("gbrain.cli", "runtime", "gbrain CLI", "gbrain CLI není na PATH, takže o paměti Principála nevíme nic.", {
      blocked_reason: gbrainCli.stderr || "`gbrain --help` neodpověděl",
      remedy: GBRAIN_CLI_REMEDY,
    }));

  const buddyRoot = join(cwd, "buddy");
  if (!fileExists(buddyRoot)) {
    checks.push(notApplicable("buddy.mount", "optional", "Mount Buddy profilu", "Buddy není podmínkou platného Personalspace a v tomhle checkoutu není namountovaný.", {
      not_applicable_reason: "no_such_mount",
      owner: SELF_CHECK_OWNER,
    }));
  } else if (!fileExists(join(buddyRoot, ".git"))) {
    checks.push(fail("buddy.mount", "required", "Mount Buddy profilu", "buddy/ existuje, ale není samostatný Git checkout private profil repa.", { paths: ["buddy"] }));
  } else {
    checks.push(ok("buddy.mount", "required", "Mount Buddy profilu", "buddy/ je samostatný Git checkout.", { paths: ["buddy"] }));
  }

  checks.push(...moduleRepoChecks(runCommand, { cwd, manifest, identity, fileExists }));
  return checks;
}

/**
 * Osobní moduly nesou DVA nezávislé fakty, a proto dva checky.
 *
 * `modules.repo_private` je NÁLEZ nad tím, co se povedlo pozorovat.
 * `modules.repo_observability` je NEPOZOROVÁNÍ — které moduly se ověřit nedaly.
 *
 * Scénář, kvůli kterému jsou oddělené: vlastník má namountované dva moduly.
 * Jeden je omylem public, u druhého GitHub API zrovna vrátí 502. Dokud oba fakty
 * nesl jeden check, vyhrál konkrétní nález: report skončil `fail` s detailem
 * o public modulu a druhý modul z něj zmizel úplně (`blocked` = 0). Vlastník
 * public modul opraví, doctor zezelená — a o modulu, který nikdo nikdy neviděl,
 * se nedozví nic. Nález nesmí přebít nepozorování; oba musí přežít do v3 reportu.
 */
function moduleRepoChecks(runCommand, { cwd, manifest, identity, fileExists }) {
  const slots = Array.isArray(manifest?.module_slots) ? manifest.module_slots : [];
  const mounted = slots.filter((slot) => slot?.path && fileExists(join(cwd, slot.path, ".git")));
  if (mounted.length === 0) {
    return [notApplicable("modules.repo_private", "optional", "Privacy osobních modulů", "Žádný osobní modul není namountovaný, takže není co ověřovat.", {
      not_applicable_reason: "no_such_mount",
      owner: SELF_CHECK_OWNER,
    })];
  }
  const problems = [];
  const unobserved = [];
  const unobservedPaths = new Set();
  let observed = 0;
  for (const slot of mounted) {
    const moduleRoot = join(cwd, slot.path);
    const remote = originRemote(runCommand, moduleRoot);
    if (remote === null) {
      unobserved.push(`${slot.path}: origin remote nešel přečíst.`);
      unobservedPaths.add(slot.path);
      continue;
    }
    const repo = parseGitHubRemote(remote);
    if (!repo) {
      problems.push(`${slot.path}: origin není podporovaný GitHub remote.`);
      continue;
    }
    const privacy = liveRepoCheck(runCommand, { id: "modules.repo_private", repo, cwd: moduleRoot, label: slot.path });
    const sharing = collaboratorsCheck(runCommand, { id: "modules.repo_private", repo, ownerLogin: identity?.login, cwd: moduleRoot, label: slot.path });
    for (const result of [privacy, sharing]) {
      if (result.status === "blocked") {
        unobserved.push(`${slot.path}: ${result.blocked_reason}`);
        unobservedPaths.add(slot.path);
      }
      if (result.status === "fail") problems.push(...(result.details ?? [result.message]));
    }
    // Modul je pozorovaný, jen když se povedly OBĚ pozorování. Částečně viděný
    // modul do počtu ověřených nepatří — jinak by zpráva tvrdila víc, než víme.
    if (privacy.status !== "blocked" && sharing.status !== "blocked") observed += 1;
  }

  const checks = [];
  if (problems.length > 0) {
    checks.push(fail("modules.repo_private", "required", "Privacy osobních modulů", "Namountovaný osobní modul neodpovídá private kontraktu.", { details: problems }));
  } else if (observed > 0) {
    checks.push(ok(
      "modules.repo_private",
      "required",
      "Privacy osobních modulů",
      `Ověřeno private a jen pro vlastníka: ${observed} z ${mounted.length} namountovaných osobních modulů.`,
    ));
  } else {
    // Žádný modul se pozorovat nepodařilo. `ok` by tu byl nález z nuly pozorování.
    checks.push(blocked("modules.repo_private", "required", "Privacy osobních modulů", "Privacy žádného z namountovaných osobních modulů se nepodařilo ověřit.", {
      blocked_reason: unobserved.join(" ") || "Žádný modul nešel pozorovat.",
      remedy: GH_AUTH_REMEDY,
    }));
  }
  if (unobserved.length > 0) {
    checks.push(blocked(
      "modules.repo_observability",
      "required",
      "Pozorovatelnost osobních modulů",
      `Nepozorováno: ${unobservedPaths.size} z ${mounted.length} namountovaných osobních modulů.`,
      { blocked_reason: unobserved.join(" "), remedy: GH_AUTH_REMEDY },
    ));
  }
  return checks;
}

/** v3 report Personalspace doctora. Souhrn se odvozuje, nikdy nevyplňuje ručně. */
export function buildPersonalspaceReport({ cwd, checks, generatedAt = new Date().toISOString() }) {
  const absolute = resolve(cwd);
  return {
    schema_version: DOCTOR_REPORT_SCHEMA_VERSION_V3,
    generated_at: generatedAt,
    scope: {
      type: "personalspace",
      path: ".",
      name: basename(absolute),
      absolute_path: absolute,
    },
    summary: buildSummary(checks),
    checks,
  };
}

async function readManifest(cwd, file) {
  try {
    return { value: JSON.parse(await readFile(join(cwd, file), "utf8")), error: null };
  } catch (error) {
    return { value: null, error: `${file}: ${error.message}` };
  }
}

/** Celý běh doctora: přečti kontrakt, posbírej kontroly, postav v3 report. */
export async function runPersonalspaceDoctor({
  cwd = process.cwd(),
  commandRunner = defaultRunCommand,
  fileExists = existsSync,
} = {}) {
  const root = resolve(cwd);
  const personal = await readManifest(root, "personal.gen3.json");
  const manifest = await readManifest(root, "modules.manifest.json");
  const manifestErrors = [personal.error, manifest.error].filter(Boolean);

  // Nečitelný kontrakt je VADA, ne nepozorování: Personalspace bez svého root
  // kontraktu není „neověřený", je rozbitý. Report ale vznikne — mlčení by rodič
  // klasifikoval jako `no_report` a nikdo by se nedozvěděl proč.
  if (manifestErrors.length > 0) {
    return buildPersonalspaceReport({
      cwd: root,
      checks: [fail(
        "personalspace.profile_materialization",
        "required",
        "Materializace profilu",
        "Root kontrakt Personalspace nejde přečíst.",
        { paths: ["personal.gen3.json", "modules.manifest.json"], details: manifestErrors },
      )],
    });
  }

  return buildPersonalspaceReport({
    cwd: root,
    checks: collectPersonalspaceChecks({
      cwd: root,
      personal: personal.value,
      manifest: manifest.value,
      runCommand: commandRunner,
      fileExists,
    }),
  });
}

const HUMAN_LABELS = {
  ok: "OK",
  warn: "WARN",
  fail: "FAIL",
  blocked: "BLOCKED",
  not_applicable: "N/A",
};

/** Lidský výpis. Nepozorované a nevlastněné kontroly musí být vidět, ne zmizet. */
export function renderHumanReport(report) {
  const summary = report.summary;
  const lines = [
    `Personalspace Doctor: ${summary.status.toUpperCase()}`,
    `- ok ${summary.ok}, warn ${summary.warn}, fail ${summary.fail}, blocked ${summary.blocked}, not_applicable ${summary.not_applicable}`,
  ];
  if (summary.status === "incomplete") {
    lines.push("- incomplete = něco se nepodařilo pozorovat; bránu to nesplňuje.");
  }
  for (const check of report.checks) {
    lines.push(`[${HUMAN_LABELS[check.status] ?? check.status}] ${check.id} — ${check.message}`);
    for (const detail of check.details ?? []) lines.push(`    · ${detail}`);
    if (check.status === "blocked") {
      lines.push(`    důvod: ${check.blocked_reason}`);
      lines.push(`    náprava: ${check.remedy}`);
    }
    if (check.status === "not_applicable") {
      lines.push(`    důvod: ${check.not_applicable_reason}; vlastní: ${check.owner}`);
    }
  }
  return lines.join("\n");
}
