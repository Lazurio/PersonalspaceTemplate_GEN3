import path from "path";

export const OWNER_PLACEHOLDER = "owner-github-username";
export const DISPLAY_NAME_PLACEHOLDER = "Owner Display Name";
export const PERSONALSPACE_TEMPLATE_REPO = "Lazurio/PersonalspaceTemplate_GEN3";
export const PERSONAL_SCHEMA_VERSION = "humanandmachines.personal.gen3.v1";
export const PERSONALSPACE_TEMPLATE_VERSION = "humanandmachines.personalspace-template.v1";
export const GBRAIN_SOFTWARE_REPO = "garrytan/gbrain";
export const GBRAIN_INSTALL_SOURCE = "github:garrytan/gbrain";
export const NESTED_REPO_STRATEGY = "doctor-managed-nested-repo";
/**
 * Deklarace vlastního doctora tohohle mountu (Lazurio decision 0118).
 * Root doctor podle ní podřízené doctory NAJDE — discovery je deklarací
 * v manifestu, ne hádáním konvenční cesty. Chybějící blok znamená „tenhle mount
 * vlastního doctora nemá", nikdy „doctor je jinde", a proto se tu deklarace
 * vynucuje: jinak by se z vypnutého doctora stalo ticho místo vady.
 */
export const DOCTOR_DECLARATION_SCHEMA_VERSION = "humanandmachines.doctor.declaration.v1";
export const DOCTOR_SCOPE_TYPE = "personalspace";
export const DOCTOR_COMMAND = Object.freeze(["bun", "scripts/doctor-personalspace.mjs", "--json"]);

const githubLoginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const repoNamePattern = /^[A-Za-z0-9_.-]+$/;

export function isValidGitHubLogin(value) {
  return typeof value === "string" && githubLoginPattern.test(value);
}

export function normalizeRepoSlug(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\.git$/i, "");
  const parts = trimmed.split("/");
  if (
    parts.length !== 2
    || !isValidGitHubLogin(parts[0])
    || !repoNamePattern.test(parts[1])
  ) return null;
  return `${parts[0]}/${parts[1]}`;
}

export function parseGitHubRemote(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const remote = value.trim();
  const scpMatch = remote.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (scpMatch) return normalizeRepoSlug(`${scpMatch[1]}/${scpMatch[2]}`);

  try {
    const parsed = new URL(remote);
    if (parsed.hostname.toLowerCase() !== "github.com") return null;
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length !== 2) return null;
    return normalizeRepoSlug(`${parts[0]}/${parts[1]}`);
  } catch {
    return null;
  }
}

export function reposEqual(left, right) {
  const a = normalizeRepoSlug(left);
  const b = normalizeRepoSlug(right);
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export function parseFsckObjectFindings(output) {
  const objects = [];
  const unexpected = [];
  for (const rawLine of String(output ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(dangling|unreachable)\s+(blob|commit|tag|tree)\s+([0-9a-f]+)$/i);
    if (!match) {
      unexpected.push(line);
      continue;
    }
    objects.push({
      reachability: match[1].toLowerCase(),
      type: match[2].toLowerCase(),
      object: match[3].toLowerCase(),
    });
  }
  return { objects, unexpected };
}

export function parseLsTreeLongEntries(output) {
  return String(output ?? "")
    .split("\u0000")
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\s+(-|\d+)\t([\s\S]+)$/);
      if (!match) return null;
      const [, mode, type, object, sizeText, file] = match;
      return { mode, type, object, sizeText, file };
    })
    .filter(Boolean);
}

export function expectedIdentity(login, gbrainRepo = null) {
  if (!isValidGitHubLogin(login)) {
    throw new Error(`Neplatný GitHub login: ${JSON.stringify(login)}`);
  }
  const normalizedGbrain = normalizeRepoSlug(
    gbrainRepo?.includes("/") ? gbrainRepo : `${login}/${gbrainRepo ?? `${login}-gbrain`}`,
  );
  if (!normalizedGbrain) throw new Error("Neplatný název gbrain data repa.");
  const [gbrainOwner] = normalizedGbrain.split("/");
  if (gbrainOwner.toLowerCase() !== login.toLowerCase()) {
    throw new Error("Gbrain data repo musí patřit stejnému GitHub účtu jako Personalspace.");
  }
  const ownerRepo = `${login}/${login}_GEN3`;
  if (normalizedGbrain.toLowerCase() === ownerRepo.toLowerCase()) {
    throw new Error("Gbrain data repo musí být jiné repo než Personalspace owner repo.");
  }
  return {
    login,
    repo: ownerRepo,
    directory: `${login}_GEN3`,
    mountPath: `personalspace/${login}_GEN3`,
    gbrainRepo: normalizedGbrain,
  };
}

export function inferMountLayout(cwd, login, pathApi = path) {
  const identity = expectedIdentity(login);
  const absolute = pathApi.resolve(cwd);
  const directory = pathApi.basename(absolute);
  const mountpoint = pathApi.basename(pathApi.dirname(absolute));
  if (directory.toLowerCase() !== identity.directory.toLowerCase()) {
    throw new Error(`Checkout musí být v adresáři ${identity.directory}, ne ${directory}.`);
  }
  if (mountpoint.toLowerCase() !== "personalspace") {
    throw new Error("Personalspace checkout musí být přímo pod mountpointem personalspace/.");
  }
  return {
    personalspaceRoot: absolute,
    conglomerateRoot: pathApi.dirname(pathApi.dirname(absolute)),
    relativeMount: identity.mountPath,
  };
}

export function buildPersonalConfig(template, {
  login,
  displayName,
  ownerType = "human",
  gbrainRepo = null,
} = {}) {
  const identity = expectedIdentity(login, gbrainRepo);
  if (typeof displayName !== "string" || displayName.trim() === "") {
    throw new Error("Display name musí být neprázdný text.");
  }
  if (!["human", "ai-colleague"].includes(ownerType)) {
    throw new Error("Owner type musí být human nebo ai-colleague.");
  }
  const output = structuredClone(template);
  output.owner = {
    github_username: login,
    display_name: displayName.trim(),
    type: ownerType,
  };
  delete output.buddy;
  output.repository = {
    github_repo: identity.repo,
    mount_path: identity.mountPath,
    visibility: "private",
    mount_strategy: NESTED_REPO_STRATEGY,
  };
  output.gbrain = {
    ...(output.gbrain ?? {}),
    path: "gbrain",
    repository: {
      github_repo: identity.gbrainRepo,
      visibility: "private",
      mount_strategy: NESTED_REPO_STRATEGY,
    },
    software: {
      github_repo: GBRAIN_SOFTWARE_REPO,
      install_source: GBRAIN_INSTALL_SOURCE,
    },
    default_shared: false,
    human_editor: output.gbrain?.human_editor ?? "obsidian",
    agent_access: "mcp-only",
  };
  // Deklarace doctora se materializuje vždy, i kdyby ji šablona ztratila. Instance
  // bez ní by pro root doctora neexistovala jako doctor a její kontroly by nikdo
  // nespustil ani nepostrádal.
  output.doctor = {
    schema_version: DOCTOR_DECLARATION_SCHEMA_VERSION,
    command: [...DOCTOR_COMMAND],
    timeout_ms: Number.isInteger(template?.doctor?.timeout_ms) ? template.doctor.timeout_ms : 120000,
    scope_type: DOCTOR_SCOPE_TYPE,
  };
  return output;
}

export function buildModulesManifest(template, login) {
  const output = structuredClone(template);
  output.personal_generation = "gen3";
  output.owner = login;
  output.module_slots = (output.module_slots ?? []).map((slot) => ({
    ...slot,
    required_roles: (slot.required_roles ?? []).filter((role) => role !== "buddy"),
  }));
  return output;
}

export function validatePersonalState(config, manifest, {
  directoryName = null,
  ownerRemote = null,
  gbrainRemote = null,
} = {}) {
  const failures = [];
  if (config?.schema_version !== PERSONAL_SCHEMA_VERSION) {
    failures.push(`schema_version musí být ${PERSONAL_SCHEMA_VERSION}`);
  }
  if (config?.personal_generation !== "gen3") {
    failures.push("personal_generation musí být gen3");
  }
  const login = config?.owner?.github_username;
  if (!isValidGitHubLogin(login)) {
    failures.push("owner.github_username není validní GitHub login");
    return failures;
  }
  const identity = expectedIdentity(login);
  const declaredGbrainRepo = config?.gbrain?.repository?.github_repo;
  let gbrainIdentity = null;
  if (typeof declaredGbrainRepo !== "string" || !normalizeRepoSlug(declaredGbrainRepo)) {
    failures.push("gbrain.repository.github_repo musí být explicitní owner/repo");
  } else {
    try {
      gbrainIdentity = expectedIdentity(login, declaredGbrainRepo);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (config.owner?.display_name === DISPLAY_NAME_PLACEHOLDER || !config.owner?.display_name?.trim()) {
    failures.push("owner.display_name stále obsahuje placeholder nebo je prázdný");
  }
  if (!["human", "ai-colleague"].includes(config.owner?.type)) {
    failures.push("owner.type musí být human nebo ai-colleague");
  }
  if (!reposEqual(config.repository?.github_repo, identity.repo)) {
    failures.push(`repository.github_repo musí být ${identity.repo}`);
  }
  if (config.repository?.mount_path !== identity.mountPath) {
    failures.push(`repository.mount_path musí být ${identity.mountPath}`);
  }
  if (String(config.repository?.visibility).toLowerCase() !== "private") {
    failures.push("repository.visibility musí být private");
  }
  if (config.repository?.mount_strategy !== NESTED_REPO_STRATEGY) {
    failures.push(`repository.mount_strategy musí být ${NESTED_REPO_STRATEGY}`);
  }
  if (directoryName && directoryName.toLowerCase() !== identity.directory.toLowerCase()) {
    failures.push(`checkout adresář musí být ${identity.directory}`);
  }
  if (ownerRemote && !reposEqual(parseGitHubRemote(ownerRemote), identity.repo)) {
    failures.push(`origin remote musí ukazovat na ${identity.repo}`);
  }
  if (config.buddy !== undefined) {
    failures.push(
      "CAC-0071 validátor necertifikuje Buddy-enabled Personalspace; použij oddělený CAC-0072 hosted validátor a runtime/privacy gate",
    );
  }
  if (config.gbrain?.path !== "gbrain") failures.push("gbrain.path musí být gbrain");
  if (String(config.gbrain?.repository?.visibility).toLowerCase() !== "private") {
    failures.push("gbrain.repository.visibility musí být private");
  }
  if (config.gbrain?.repository?.mount_strategy !== NESTED_REPO_STRATEGY) {
    failures.push(`gbrain.repository.mount_strategy musí být ${NESTED_REPO_STRATEGY}`);
  }
  if (config.gbrain?.software?.github_repo !== GBRAIN_SOFTWARE_REPO) {
    failures.push(`gbrain software repo musí být ${GBRAIN_SOFTWARE_REPO}`);
  }
  if (config.gbrain?.software?.install_source !== GBRAIN_INSTALL_SOURCE) {
    failures.push(`gbrain install source musí být ${GBRAIN_INSTALL_SOURCE}`);
  }
  if (config.gbrain?.default_shared !== false) {
    failures.push("gbrain.default_shared musí být false");
  }
  if (config.gbrain?.agent_access !== "mcp-only") {
    failures.push("gbrain.agent_access musí být mcp-only");
  }
  if (gbrainRemote && gbrainIdentity && !reposEqual(parseGitHubRemote(gbrainRemote), gbrainIdentity.gbrainRepo)) {
    failures.push(`gbrain origin remote musí ukazovat na ${gbrainIdentity.gbrainRepo}`);
  }
  failures.push(...doctorDeclarationIssues(config));
  if (config.privacy?.default_share !== "private") {
    failures.push("privacy.default_share musí být private");
  }
  if (config.privacy?.agent_boundary !== "personal-context-only") {
    failures.push("privacy.agent_boundary musí být personal-context-only");
  }
  if (config.privacy?.shared_outputs !== "metadata-only") {
    failures.push("privacy.shared_outputs musí být metadata-only");
  }
  if (config.modules_manifest_path !== "modules.manifest.json") {
    failures.push("modules_manifest_path musí být modules.manifest.json");
  }
  if (config.workspace_path !== "workspace") {
    failures.push("workspace_path musí být workspace");
  }
  if (config.secrets?.path !== "secrets" || config.secrets?.git !== "ignored") {
    failures.push("secrets musí deklarovat path secrets a git ignored");
  }
  if (!Array.isArray(config.shared_spaces)) {
    failures.push("shared_spaces musí být pole");
  } else if (config.shared_spaces.length !== 0) {
    failures.push("shared_spaces musí zůstat prázdné; Personalspace je jen pro Principála a jeho Buddyho");
  }
  if (manifest?.owner !== login) failures.push("modules.manifest.json owner musí odpovídat GitHub loginu");
  if (manifest?.personal_generation !== "gen3") {
    failures.push("modules.manifest.json personal_generation musí být gen3");
  }
  if (!Array.isArray(manifest?.module_slots)) {
    failures.push("modules.manifest.json module_slots musí být pole");
  }
  if (
    config.buddy === undefined
    && Array.isArray(manifest?.module_slots)
    && manifest.module_slots.some((slot) => slot.required_roles?.includes("buddy"))
  ) {
    failures.push("modul bez buddy bindingu nesmí vyžadovat roli buddy");
  }
  return failures;
}

/**
 * Personalspace musí svého doctora deklarovat. Bez deklarace ho root doctor
 * nenajde a chybějící kontrola se změní v ticho — přesně v tu tichou zelenou,
 * kterou společný surface zakazuje.
 */
export function doctorDeclarationIssues(config) {
  const failures = [];
  const declaration = config?.doctor;
  if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) {
    failures.push("personal.gen3.json musí deklarovat blok doctor (decision 0118)");
    return failures;
  }
  if (declaration.schema_version !== DOCTOR_DECLARATION_SCHEMA_VERSION) {
    failures.push(`doctor.schema_version musí být ${DOCTOR_DECLARATION_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(declaration.command) || declaration.command.length === 0) {
    failures.push("doctor.command musí být neprázdné argv");
  } else if (declaration.command.some((part) => typeof part !== "string" || part.trim() === "")) {
    failures.push("doctor.command smí obsahovat jen neprázdné řetězce");
  }
  if (declaration.scope_type !== DOCTOR_SCOPE_TYPE) {
    failures.push(`doctor.scope_type musí být ${DOCTOR_SCOPE_TYPE}`);
  }
  if (declaration.timeout_ms !== undefined
    && (!Number.isInteger(declaration.timeout_ms) || declaration.timeout_ms < 1000)) {
    failures.push("doctor.timeout_ms musí být celé číslo aspoň 1000");
  }
  return failures;
}

export function gitlinkPaths(lsFilesStageOutput) {
  if (typeof lsFilesStageOutput !== "string") return [];
  return lsFilesStageOutput
    .split(/\r?\n/)
    .filter((line) => line.startsWith("160000 "))
    .map((line) => line.split(/\s+/).at(-1))
    .filter(Boolean);
}

export function unexpectedRepositoryCollaborators(logins, ownerLogin) {
  const owner = String(ownerLogin ?? "").toLowerCase();
  return [...new Set((logins ?? [])
    .map((login) => String(login).trim())
    .filter(Boolean)
    .filter((login) => login.toLowerCase() !== owner))]
    .sort((left, right) => left.localeCompare(right));
}

export function pendingRepositoryInvitationLabels(lines) {
  return [...new Set((lines ?? [])
    .map((line) => String(line).trim())
    .filter(Boolean)
    .map((line) => {
      const [id, login, ...extra] = line.split("\t");
      if (!/^\d+$/.test(id) || !isValidGitHubLogin(login) || extra.length > 0) {
        return "nečitelná čekající pozvánka";
      }
      return `${login} (#${id})`;
    }))]
    .sort((left, right) => left.localeCompare(right));
}

export function appendMissingLines(existing, requiredLines) {
  const normalized = typeof existing === "string" ? existing.replace(/\r\n/g, "\n") : "";
  const present = new Set(normalized.split("\n").map((line) => line.trim()));
  const missing = requiredLines.filter((line) => !present.has(line.trim()));
  const base = normalized.length === 0 ? "" : `${normalized.replace(/\n*$/, "\n")}`;
  return missing.length > 0 ? `${base}${missing.join("\n")}\n` : base;
}

export function trackedPathPrivacyIssues(paths, { label = "repo" } = {}) {
  const issues = [];
  for (const rawPath of paths) {
    const file = String(rawPath).replaceAll("\\", "/");
    const lowerFile = file.toLowerCase();
    const basename = file.split("/").at(-1) ?? file;
    const lowerBasename = basename.toLowerCase();
    if (
      lowerFile === "secrets"
      || lowerFile.startsWith("secrets/")
      || lowerFile.includes("/secrets/")
    ) {
      issues.push(`${label}: ${file} je trackovaný secret path`);
    }
    if (
      (lowerBasename === ".env"
        || (lowerBasename.startsWith(".env.")
          && ![".env.example", ".env.template"].includes(lowerBasename)))
      || [".pem", ".key", ".p12", ".pfx"].some((suffix) => lowerBasename.endsWith(suffix))
      || basename === ".git-credentials"
      || basename === ".npmrc"
    ) {
      issues.push(`${label}: ${file} je zakázaný trackovaný credential soubor`);
    }
    if (
      lowerFile === ".gbrain"
      || lowerFile.startsWith(".gbrain/")
      || lowerFile === ".cache"
      || lowerFile.startsWith(".cache/")
      || lowerFile.includes("/.cache/")
      || /(?:^|\/)\.obsidian\/workspace.*\.json$/i.test(file)
      || lowerFile.startsWith(".trash/")
      || lowerFile.includes("/.trash/")
      || /\.(?:sqlite3?|db)(?:-(?:shm|wal))?$/i.test(basename)
    ) {
      issues.push(`${label}: ${file} je zakázaná trackovaná runtime cache/databáze`);
    }
  }
  return issues;
}

export function trackedTextPrivacyIssues(file, text, { label = "repo" } = {}) {
  return privacyTextPatternFindings(text)
    .map((kind) => `${label}: ${file} obsahuje pattern ${kind}`);
}

export function privacyTextPatternFindings(text) {
  const patterns = [
    ["privátní klíč", new RegExp(["BEGIN", "(?: RSA| OPENSSH| EC)?", " PRIVATE KEY"].join(""), "i")],
    ["GitHub token", new RegExp(`\\b${["gh", "[pousr]", "_"].join("")}[A-Za-z0-9_]{24,}\\b`)],
    ["GitHub fine-grained token", new RegExp(`\\b${["github", "_pat_"].join("")}[A-Za-z0-9_]{24,}\\b`)],
    ["AWS access key", new RegExp(`\\b${["AK", "IA"].join("")}[A-Z0-9]{16}\\b`)],
    ["OpenAI API key", new RegExp(`\\b${["s", "k-"].join("")}(?:proj-)?[A-Za-z0-9_-]{24,}\\b`)],
    ["Anthropic API key", new RegExp(`\\b${["s", "k-ant-"].join("")}[A-Za-z0-9_-]{24,}\\b`)],
    ["credential v URL", /:\/\/[^:/\s]+:[^@\s]+@/i],
    ["Bearer token", new RegExp(`\\b${["Bearer", "\\s+"].join("")}[A-Za-z0-9._~+/-]{20,}={0,2}\\b`, "i")],
  ];
  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([kind]) => kind);
}

export function trackedRepoPrivacyIssues(cwd, {
  runCommand,
  label = "repo",
} = {}) {
  if (typeof runCommand !== "function") throw new Error("trackedRepoPrivacyIssues vyžaduje runCommand.");
  const failures = [];
  const result = runCommand("git", ["ls-files", "-s", "-z"], { cwd, allowFailure: true });
  if (result.status !== 0) return [`${label}: nejde ověřit trackované soubory.`];
  const entries = result.stdout
    .split("\u0000")
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t([\s\S]+)$/);
      return match ? { mode: match[1], blob: match[2], file: match[3] } : null;
    })
    .filter(Boolean);
  failures.push(...trackedPathPrivacyIssues(entries.map(({ file }) => file), { label }));
  for (const { mode, blob, file } of entries) {
    if (mode === "120000") {
      failures.push(`${label}: ${file} je trackovaný symlink; privacy scan jej odmítá fail-closed`);
      continue;
    }
    const sizeResult = runCommand("git", ["cat-file", "-s", blob], { cwd, allowFailure: true });
    const size = Number(sizeResult.stdout);
    if (sizeResult.status !== 0 || !Number.isFinite(size)) {
      failures.push(`${label}: ${file} nejde velikostně ověřit`);
      continue;
    }
    if (size > 1_000_000) {
      failures.push(`${label}: ${file} je větší než 1 MB a nejde bezpečně zahrnout do privacy scanu`);
      continue;
    }
    const blobResult = runCommand("git", ["cat-file", "blob", blob], { cwd, allowFailure: true });
    if (blobResult.status !== 0) {
      failures.push(`${label}: ${file} nejde přečíst z Git indexu`);
      continue;
    }
    failures.push(...trackedTextPrivacyIssues(file, blobResult.stdout, { label }));
  }
  return failures;
}
