import { expect, test } from "bun:test";
import { posix, win32 } from "path";

import {
  BUDDY_DEPLOYMENT_TARGET,
  BUDDY_HERMES_SOFTWARE_REPO,
  BUDDY_PROFILE_FORMAT,
  DOCTOR_COMMAND,
  DOCTOR_DECLARATION_SCHEMA_VERSION,
  DOCTOR_SCOPE_TYPE,
  NESTED_REPO_STRATEGY,
  PERSONAL_SCHEMA_VERSION,
  appendMissingLines,
  buddyStateIssues,
  buildModulesManifest,
  buildPersonalConfig,
  doctorDeclarationIssues,
  expectedIdentity,
  PERSONAL_MODULE_PORT_POOL,
  gitlinkPaths,
  inferMountLayout,
  modulePortPoolIssues,
  parseGitHubRemote,
  parseFsckObjectFindings,
  parseLsTreeLongEntries,
  pendingRepositoryInvitationLabels,
  trackedPathPrivacyIssues,
  trackedRepoPrivacyIssues,
  trackedTextPrivacyIssues,
  unexpectedRepositoryCollaborators,
  validatePersonalState,
} from "./personalspace-lib.mjs";
import {
  parseBootstrapArgs,
  resolveBootstrapRepositoryBindings,
} from "./bootstrap-personalspace.mjs";

const personalTemplate = {
  schema_version: PERSONAL_SCHEMA_VERSION,
  personal_generation: "gen3",
  owner: {
    github_username: "owner-github-username",
    display_name: "Owner Display Name",
    type: "human",
  },
  repository: {},
  privacy: {
    default_share: "private",
    agent_boundary: "personal-context-only",
    shared_outputs: "metadata-only",
  },
  modules_manifest_path: "modules.manifest.json",
  workspace_path: "workspace",
  gbrain: {
    path: "gbrain",
    default_shared: false,
    human_editor: "obsidian",
    agent_access: "mcp-only",
  },
  secrets: {
    path: "secrets",
    custody_pattern: "personalspace/<owner>_GEN3/secrets/<provider>/<scope>/<purpose>",
    git: "ignored",
  },
  shared_spaces: [],
};

test("GitHub remote parser podporuje HTTPS, SCP SSH a ssh URL", () => {
  expect(parseGitHubRemote("https://github.com/example/example_GEN3.git")).toBe("example/example_GEN3");
  expect(parseGitHubRemote("git@github.com:example/example_GEN3.git")).toBe("example/example_GEN3");
  expect(parseGitHubRemote("ssh://git@github.com/example/example_GEN3.git")).toBe("example/example_GEN3");
  expect(parseGitHubRemote("https://example.test/example/example_GEN3")).toBeNull();
});

test("identity používá přesný owner repo a výchozí gbrain repo", () => {
  expect(expectedIdentity("example")).toEqual({
    login: "example",
    repo: "example/example_GEN3",
    directory: "example_GEN3",
    mountPath: "personalspace/example_GEN3",
    gbrainRepo: "example/example-gbrain",
  });
  expect(() => expectedIdentity("other", "example/example-gbrain")).toThrow();
  expect(() => expectedIdentity("example", "example/example_GEN3")).toThrow();
});

test("bootstrap rerun zachová custom gbrain binding bez tichého resetu", () => {
  const existing = {
    owner: { github_username: "example" },
    gbrain: { repository: { github_repo: "example/private-memory" } },
  };
  expect(resolveBootstrapRepositoryBindings({
    login: "example",
    personal: existing,
    options: {
      installGbrain: false,
      gbrainRepo: null,
    },
  })).toEqual({
    gbrainRepo: "example/private-memory",
  });
  expect(resolveBootstrapRepositoryBindings({
    login: "example",
    personal: existing,
    options: {
      installGbrain: false,
      gbrainRepo: "example/new-memory",
    },
  })).toEqual({
    gbrainRepo: "example/new-memory",
  });
});

test("bootstrap odmítne přepsat Personalspace s blokem buddy (decision 0210)", () => {
  expect(() => resolveBootstrapRepositoryBindings({
    login: "example",
    personal: {
      owner: { github_username: "example" },
      buddy: { repository: { github_repo: "example/example-buddy" } },
    },
    options: {
      installGbrain: false,
      gbrainRepo: null,
    },
  })).toThrow("decision 0210");
  expect(() => resolveBootstrapRepositoryBindings({
    login: "example",
    personal: {
      owner: { github_username: "owner-github-username" },
      buddy: { slug: "stale-buddy", gbrain_path: "gbrain" },
    },
    options: {
      installGbrain: false,
      gbrainRepo: null,
    },
  })).toThrow("decision 0210");
});

test("bootstrap ignoruje template placeholder binding jiného ownera", () => {
  expect(resolveBootstrapRepositoryBindings({
    login: "example",
    personal: personalTemplate,
    options: {
      installGbrain: false,
      gbrainRepo: null,
    },
  })).toEqual({
    gbrainRepo: null,
  });
});

test("history audit rozliší benigní dangling objekty od neočekávaného fsck nálezu", () => {
  expect(parseFsckObjectFindings([
    `dangling commit ${"a".repeat(40)}`,
    `unreachable blob ${"b".repeat(40)}`,
  ].join("\n"))).toEqual({
    objects: [
      { reachability: "dangling", type: "commit", object: "a".repeat(40) },
      { reachability: "unreachable", type: "blob", object: "b".repeat(40) },
    ],
    unexpected: [],
  });
  expect(parseFsckObjectFindings("broken link from tree deadbeef")).toEqual({
    objects: [],
    unexpected: ["broken link from tree deadbeef"],
  });
  expect(parseLsTreeLongEntries([
    `100644 blob ${"c".repeat(40)} 12\tarchive/secrets/č\n.txt`,
    `100644 blob ${"d".repeat(40)} 42\tkeys/credentials.pem`,
    "",
  ].join("\u0000"))).toEqual([
    {
      mode: "100644",
      type: "blob",
      object: "c".repeat(40),
      sizeText: "12",
      file: "archive/secrets/č\n.txt",
    },
    {
      mode: "100644",
      type: "blob",
      object: "d".repeat(40),
      sizeText: "42",
      file: "keys/credentials.pem",
    },
  ]);
});

test("mount inference je shodný pro POSIX a Windows cesty", () => {
  expect(inferMountLayout("/home/user/Conglomerate/personalspace/example_GEN3", "example", posix)).toEqual({
    personalspaceRoot: "/home/user/Conglomerate/personalspace/example_GEN3",
    conglomerateRoot: "/home/user/Conglomerate",
    relativeMount: "personalspace/example_GEN3",
  });
  expect(inferMountLayout("D:\\Home\\Example\\Conglomerate\\personalspace\\example_GEN3", "example", win32)).toEqual({
    personalspaceRoot: "D:\\Home\\Example\\Conglomerate\\personalspace\\example_GEN3",
    conglomerateRoot: "D:\\Home\\Example\\Conglomerate",
    relativeMount: "personalspace/example_GEN3",
  });
});

test("bootstrap vytvoří validní Personalspace bez Buddyho", () => {
  const personal = buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "Example Owner",
  });
  const manifest = buildModulesManifest({
    personal_generation: "gen3",
    owner: "owner-github-username",
    module_slots: [{
      path: "workspace/personal-notes",
      required_roles: ["owner", "buddy"],
      default_access: "private",
    }],
  }, "example");
  expect(personal.buddy).toBeUndefined();
  expect(personal.repository.mount_strategy).toBe(NESTED_REPO_STRATEGY);
  expect(manifest.module_slots[0].required_roles).toEqual(["owner"]);
  expect(validatePersonalState(personal, manifest, {
    directoryName: "example_GEN3",
    ownerRemote: "git@github.com:example/example_GEN3.git",
    gbrainRemote: "https://github.com/example/example-gbrain.git",
  })).toEqual([]);
});

/** Blok `buddy` tak, jak ho po Lazurio decision 0210 deklaruje Personalspace s Buddym. */
function personalEnvironmentBuddy(overrides = {}) {
  return {
    slug: "example-buddy",
    gbrain_path: "gbrain",
    path: "buddy",
    repository: {
      github_repo: "example/example-buddy",
      visibility: "private",
      mount_strategy: NESTED_REPO_STRATEGY,
    },
    runtime: { deployment_target: BUDDY_DEPLOYMENT_TARGET },
    hermes: {
      software_repo: BUDDY_HERMES_SOFTWARE_REPO,
      profile_format: BUDDY_PROFILE_FORMAT,
      profile_path: "buddy",
    },
    ...overrides,
  };
}

function personalWithBuddy(buddy) {
  const personal = buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "Example Owner",
  });
  personal.buddy = buddy;
  const manifest = buildModulesManifest({
    personal_generation: "gen3",
    owner: "owner-github-username",
    module_slots: [],
  }, "example");
  return { personal, manifest };
}

test("validátor přijme Buddyho v Osobním Prostředí s Hermesem z forku (decision 0210)", () => {
  const { personal, manifest } = personalWithBuddy(personalEnvironmentBuddy());
  expect(BUDDY_DEPLOYMENT_TARGET).toBe("owner-personal-environment");
  expect(BUDDY_HERMES_SOFTWARE_REPO).toBe("Lazurio/hermes-agent");
  expect(validatePersonalState(personal, manifest)).toEqual([]);
});

test("validátor odmítne Buddyho na dedikované VPS i pole skončeného modelu (decision 0210)", () => {
  // Přesně ten blok, který platil před 0210: Buddy na vlastní VPS, runtime
  // z Resident distribuce a zákaz lokálního běhu.
  const { personal, manifest } = personalWithBuddy(personalEnvironmentBuddy({
    runtime: {
      github_repo: "HumanAndMachines/Lazurio",
      deployment_target: "owner-dedicated-personalspace-vps",
      local_execution: "forbidden",
    },
  }));
  const failures = validatePersonalState(personal, manifest);
  expect(failures).toHaveLength(3);
  expect(failures.some((failure) => failure.startsWith("buddy.runtime.deployment_target musí být owner-personal-environment"))).toBe(true);
  expect(failures.some((failure) => failure.startsWith("buddy.runtime.local_execution skončilo"))).toBe(true);
  expect(failures.some((failure) => failure.startsWith("buddy.runtime.github_repo skončilo"))).toBe(true);
});

test("Buddy bere Hermes z forku Lazurio/hermes-agent, ne přímo z upstreamu", () => {
  const { personal, manifest } = personalWithBuddy(personalEnvironmentBuddy({
    hermes: {
      software_repo: "NousResearch/hermes-agent",
      profile_format: BUDDY_PROFILE_FORMAT,
      profile_path: "buddy",
    },
  }));
  expect(validatePersonalState(personal, manifest)).toEqual([
    "buddy.hermes.software_repo musí být fork Lazurio/hermes-agent (Lazurio decision 0210)",
  ]);
});

test("neúplný nebo cizí Buddy binding je vada, ne tichý průchod", () => {
  const { personal, manifest } = personalWithBuddy({ slug: "example-buddy", gbrain_path: "gbrain" });
  const partial = validatePersonalState(personal, manifest);
  expect(partial).toContain("buddy.path musí být buddy");
  expect(partial).toContain("buddy.repository.github_repo musí být explicitní owner/repo");
  expect(partial.some((failure) => failure.startsWith("buddy.runtime.deployment_target"))).toBe(true);
  expect(partial.some((failure) => failure.startsWith("buddy.hermes.software_repo"))).toBe(true);
  expect(buddyStateIssues(personalEnvironmentBuddy({
    repository: { github_repo: "other/other-buddy", visibility: "private", mount_strategy: NESTED_REPO_STRATEGY },
  }), "example")).toEqual(["Buddy profile repo musí patřit vlastníkovi Personalspace"]);
  expect(buddyStateIssues("mattychus", "example")).toEqual(["buddy musí být objekt"]);
});

test("validace odmítne mount cizího Personalspace", () => {
  const personal = buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "Example Owner",
  });
  personal.shared_spaces = [{ owner: "other" }];
  const manifest = buildModulesManifest({
    personal_generation: "gen3",
    owner: "owner-github-username",
    module_slots: [],
  }, "example");
  const failures = validatePersonalState(personal, manifest);
  expect(failures.some((failure) => failure.includes("shared_spaces musí zůstat prázdné"))).toBe(true);
});

test("collaborator audit povolí jen ownera", () => {
  expect(unexpectedRepositoryCollaborators(
    ["Example", "former-colleague", "example", "external-ai"],
    "example",
  )).toEqual(["external-ai", "former-colleague"]);
});

test("access audit odmítne každou čekající repository invitation", () => {
  expect(pendingRepositoryInvitationLabels([
    "42\tformer-colleague",
    "7\texternal-ai",
    "42\tformer-colleague",
    "",
  ])).toEqual(["external-ai (#7)", "former-colleague (#42)"]);
  expect(pendingRepositoryInvitationLabels(["unexpected-api-shape"]))
    .toEqual(["nečitelná čekající pozvánka"]);
});

test("localhost Doctor přijme konfiguraci bez Buddyho", () => {
  const personal = buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "Example Owner",
  });
  const manifest = buildModulesManifest({
    personal_generation: "gen3",
    owner: "owner-github-username",
    module_slots: [],
  }, "example");
  expect(validatePersonalState(personal, manifest)).toEqual([]);
});

test("preflight odmítne neplatnou identitu dřív než apply", () => {
  expect(() => buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "   ",
  })).toThrow("Display name");
  expect(() => buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "Example Owner",
    ownerType: "service-account",
  })).toThrow("Owner type");
});

test("Doctor odmítne neúplný strojový root kontrakt", () => {
  const personal = buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "Example Owner",
  });
  const manifest = buildModulesManifest({
    personal_generation: "gen3",
    owner: "owner-github-username",
    module_slots: [],
  }, "example");
  personal.personal_generation = "gen2";
  personal.owner.type = "service-account";
  delete personal.gbrain.repository.github_repo;
  manifest.personal_generation = "gen2";
  manifest.module_slots = {};
  const failures = validatePersonalState(personal, manifest);
  expect(failures.some((failure) => failure.includes("personal_generation musí být gen3"))).toBe(true);
  expect(failures.some((failure) => failure.includes("owner.type"))).toBe(true);
  expect(failures.some((failure) => failure.includes("gbrain.repository.github_repo"))).toBe(true);
  expect(failures.some((failure) => failure.includes("modules.manifest.json personal_generation"))).toBe(true);
  expect(failures.some((failure) => failure.includes("module_slots musí být pole"))).toBe(true);
});

test("validace odmítne public deklaraci a fiktivní Buddy roli", () => {
  const personal = buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "Example Owner",
  });
  personal.repository.visibility = "public";
  const manifest = {
    personal_generation: "gen3",
    owner: "example",
    module_slots: [{ required_roles: ["owner", "buddy"] }],
  };
  const failures = validatePersonalState(personal, manifest);
  expect(failures.some((failure) => failure.includes("repository.visibility"))).toBe(true);
  expect(failures.some((failure) => failure.includes("roli buddy"))).toBe(true);
});

test("gitlink parser a ignore merger jsou deterministické", () => {
  expect(gitlinkPaths([
    "100644 abc 0\tREADME.md",
    "160000 def 0\tgbrain",
  ].join("\n"))).toEqual(["gbrain"]);
  expect(appendMissingLines("existing/\r\n", ["existing/", ".cache/"])).toBe("existing/\n.cache/\n");
});

test("privacy guard odmítne trackované credentials, runtime DB a high-confidence token", () => {
  const pathIssues = trackedPathPrivacyIssues([
    "notes/index.md",
    "Secrets/provider/token.txt",
    ".env.local",
    ".GBrain/data.sqlite",
  ], { label: "gbrain" });
  expect(pathIssues).toHaveLength(3);
  expect(trackedTextPrivacyIssues(
    "notes/index.md",
    `credential ${["gh", "p_", "a".repeat(30)].join("")}`,
    { label: "gbrain" },
  )).toHaveLength(1);
  const credentialSamples = [
    ["OpenAI API key", ["s", "k-proj-", "a".repeat(30)].join("")],
    ["Anthropic API key", ["s", "k-ant-", "a".repeat(30)].join("")],
    ["credential v URL", ["https://owner:", "password@example.test/path"].join("")],
    ["Bearer token", ["Bearer ", "a".repeat(30)].join("")],
  ];
  for (const [kind, sample] of credentialSamples) {
    expect(trackedTextPrivacyIssues(
      "history.txt",
      sample,
      { label: "history" },
    )).toContain(`history: history.txt obsahuje pattern ${kind}`);
  }
});

test("repo privacy guard čte Git index, ne pouze .gitignore", () => {
  const blob = "a".repeat(40);
  const fakeRun = (_command, args) => {
    if (args[0] === "ls-files") {
      return { status: 0, stdout: `100644 ${blob} 0\tsecrets/token.txt\u0000`, stderr: "" };
    }
    if (args[0] === "cat-file" && args[1] === "-s") {
      return { status: 0, stdout: "40", stderr: "" };
    }
    if (args[0] === "cat-file" && args[1] === "blob") {
      return {
        status: 0,
        stdout: ["gh", "p_", "a".repeat(30)].join(""),
        stderr: "",
      };
    }
    throw new Error(`neočekávaný Git příkaz ${args.join(" ")}`);
  };
  const issues = trackedRepoPrivacyIssues("/example", {
    runCommand: fakeRun,
    label: "Personalspace",
  });
  expect(issues.some((issue) => issue.includes("trackovaný secret path"))).toBe(true);
  expect(issues.some((issue) => issue.includes("GitHub token"))).toBe(true);
});

test("CLI parser drží apply a instalaci jako explicitní volby", () => {
  expect(parseBootstrapArgs([
    "--display-name",
    "Example Owner",
    "--apply",
    "--install-gbrain",
  ])).toMatchObject({
    displayName: "Example Owner",
    apply: true,
    installGbrain: true,
    ownerType: "human",
  });
});

test("materializovaná instance vždy deklaruje vlastního doctora (decision 0118)", () => {
  const personal = buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "Example Owner",
  });
  expect(personal.doctor).toEqual({
    schema_version: DOCTOR_DECLARATION_SCHEMA_VERSION,
    command: [...DOCTOR_COMMAND],
    timeout_ms: 120000,
    scope_type: DOCTOR_SCOPE_TYPE,
  });
  const manifest = buildModulesManifest({ module_slots: [] }, "example");
  expect(validatePersonalState(personal, manifest)).toEqual([]);
});

test("chybějící nebo pokažená deklarace doctora je vada, ne ticho", () => {
  expect(doctorDeclarationIssues({})).toEqual([
    "personal.gen3.json musí deklarovat blok doctor (decision 0118)",
  ]);
  expect(doctorDeclarationIssues({
    doctor: { schema_version: "jiná", command: [], scope_type: "organization", timeout_ms: 10 },
  })).toEqual([
    `doctor.schema_version musí být ${DOCTOR_DECLARATION_SCHEMA_VERSION}`,
    "doctor.command musí být neprázdné argv",
    `doctor.scope_type musí být ${DOCTOR_SCOPE_TYPE}`,
    "doctor.timeout_ms musí být celé číslo aspoň 1000",
  ]);
  const personal = buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "Example Owner",
  });
  delete personal.doctor;
  expect(validatePersonalState(personal, buildModulesManifest({ module_slots: [] }, "example")))
    .toContain("personal.gen3.json musí deklarovat blok doctor (decision 0118)");
});

test("module_port_pool osobního prostoru smí chybět, jinak leží ve vyhrazeném rozsahu", () => {
  expect(PERSONAL_MODULE_PORT_POOL).toEqual({ start: 23000, end: 23099 });
  // Personalspace z doby před vyhrazeným rozsahem: pool dostane se slotem
  // prvního modulu (lazurio module create personalspace/<slug>).
  expect(modulePortPoolIssues({ module_slots: [] })).toEqual([]);
  expect(modulePortPoolIssues({
    module_port_pool: { start: 23000, end: 23099 },
    module_slots: [],
  })).toEqual([]);
  expect(modulePortPoolIssues({ module_port_pool: { start: 23010, end: 23019 } })).toEqual([]);
  for (const pool of [
    { start: 24000, end: 24099 },
    { start: 22999, end: 23050 },
    { start: 23050, end: 23100 },
    { start: 23050, end: 23040 },
    { start: 23000 },
    { start: 23000, end: 23099, extra: 1 },
    { start: "23000", end: 23099 },
    null,
    [],
    "23000-23099",
  ]) {
    expect(modulePortPoolIssues({ module_port_pool: pool }), JSON.stringify(pool)).toHaveLength(1);
  }
});

test("bootstrap zachová pool šablony a materializace hlídá jeho rozsah", () => {
  const personal = buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "Example Owner",
  });
  const template = {
    personal_generation: "gen3",
    owner: "owner-github-username",
    module_port_pool: { start: 23000, end: 23099 },
    module_slots: [],
  };
  const manifest = buildModulesManifest(template, "example");
  expect(manifest.module_port_pool).toEqual({ start: 23000, end: 23099 });
  expect(validatePersonalState(personal, manifest)).toEqual([]);
  expect(validatePersonalState(personal, {
    ...manifest,
    module_port_pool: { start: 24900, end: 24999 },
  })).toEqual([
    "modules.manifest.json module_port_pool musí být {\"start\", \"end\"} uvnitř vyhrazeného rozsahu 23000-23099",
  ]);
});

test("slot osobního modulu tak, jak ho deklaruje lazurio module create, projde materializací", () => {
  const personal = buildPersonalConfig(personalTemplate, {
    login: "example",
    displayName: "Example Owner",
  });
  const manifest = buildModulesManifest({
    personal_generation: "gen3",
    owner: "owner-github-username",
    module_port_pool: { start: 23000, end: 23099 },
    module_slots: [{
      path: "workspace/notes",
      slug: "notes",
      space: "workspace",
      category: "application",
      default_access: "private",
      required_roles: ["owner"],
      source_of_truth: "git-native",
      status: "active",
      notes: "Notes: osobní Modul založený příkazem lazurio module create (stack vite-react).",
      git: { url: "git@github.com:example/notes.git", branch: "main" },
    }],
  }, "example");
  expect(manifest.module_slots[0].required_roles).toEqual(["owner"]);
  expect(validatePersonalState(personal, manifest)).toEqual([]);
});
