import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import {
  CLAUDE_SKILLS_MATERIALIZATION,
  inspectAgentSkillsEntrypoint,
  repairAgentSkillsEntrypoint,
} from "./agent-skills-entrypoint.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function git(cwd, args) {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
}

const SAMPLE_SKILL = "# Sample\n";

async function fixture(name, { createMirror = true, gitignoreMirror = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), `organization-template-${name}-`));
  tempRoots.push(root);
  await mkdir(join(root, ".agents", "skills", "sample"), { recursive: true });
  await writeFile(join(root, ".agents", "skills", "sample", "SKILL.md"), SAMPLE_SKILL);
  await writeFile(
    join(root, ".agents", "skills", "manifest.json"),
    JSON.stringify({
      schema_version: "companiesascode.organization_skills.v1",
      policy: { claude_compatibility: "tracked-derived-mirror" },
      skills: [{ slug: "sample", path: ".agents/skills/sample/SKILL.md" }],
    }),
  );
  if (gitignoreMirror) {
    await writeFile(join(root, ".gitignore"), ".claude/skills\n");
  }
  git(root, ["init"]);
  git(root, ["add", ".agents/skills"]);
  if (createMirror) {
    await mkdir(join(root, ".claude", "skills", "sample"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "sample", "SKILL.md"), SAMPLE_SKILL);
    git(root, ["add", ".claude/skills"]);
  }
  return { root };
}

describe("agent skills tracked mirror", () => {
  test("přijme byte-for-byte mirror aktivních skillů", async () => {
    const { root } = await fixture("ready");
    const state = await inspectAgentSkillsEntrypoint(root);

    expect(state.status).toBe("ok");
    expect(state.code).toBe("mirror_ready");
    expect(state.materialization).toBe(CLAUDE_SKILLS_MATERIALIZATION);
  });

  test("nespustí caller-controlled Git z PATH", async () => {
    const { root } = await fixture("poison-path");
    const fakeBin = join(root, "fake-bin");
    const marker = join(root, "fake-git-ran");
    const originalPath = process.env.PATH;

    try {
      await mkdir(fakeBin);
      const fakeGit = join(fakeBin, process.platform === "win32" ? "git.cmd" : "git");
      const fakeGitContents = process.platform === "win32"
        ? `@echo off\r\n>>"${marker}" echo fake git executed\r\nif "%~1"=="rev-parse" echo ${root}\r\nexit /b 0\r\n`
        : `#!/bin/sh\nprintf 'fake git executed\\n' >> ${JSON.stringify(marker)}\nif [ "$1" = "rev-parse" ]; then\n  printf '%s\\n' ${JSON.stringify(root)}\nfi\nexit 0\n`;
      await writeFile(fakeGit, fakeGitContents);
      await chmod(fakeGit, 0o755);

      process.env.PATH = `${fakeBin}${delimiter}${originalPath ?? ""}`;
      const state = await inspectAgentSkillsEntrypoint(root);

      expect(state.status).toBe("ok");
      expect(await Bun.file(marker).exists()).toBe(false);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  test("nespustí caller global Git config hook", async () => {
    const { root } = await fixture("global-config");
    const maliciousHome = join(root, "malicious-home");
    const marker = join(root, "global-config-hook-ran");
    const originalHome = process.env.HOME;
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalHomeDrive = process.env.HOMEDRIVE;
    const originalHomePath = process.env.HOMEPATH;

    try {
      await writeFile(join(root, "tracked.txt"), "tracked\n");
      git(root, ["add", "tracked.txt"]);
      await mkdir(maliciousHome, { recursive: true });
      const helper = join(
        maliciousHome,
        process.platform === "win32" ? "fsmonitor.cmd" : "fsmonitor.sh",
      );
      const helperContents = process.platform === "win32"
        ? `@echo off\r\n>>"${marker}" echo global config executed\r\nexit /b 0\r\n`
        : `#!/bin/sh\nprintf 'global config executed\\n' >> ${JSON.stringify(marker)}\nexit 0\n`;
      await writeFile(helper, helperContents);
      await chmod(helper, 0o755);
      await writeFile(
        join(maliciousHome, ".gitconfig"),
        `[core]\n\tfsmonitor = ${helper.replaceAll("\\", "\\\\")}\n`,
      );

      process.env.HOME = maliciousHome;
      process.env.XDG_CONFIG_HOME = join(maliciousHome, ".config");
      process.env.USERPROFILE = maliciousHome;
      process.env.HOMEDRIVE = "";
      process.env.HOMEPATH = maliciousHome;

      const state = await inspectAgentSkillsEntrypoint(root);

      expect(state.status).toBe("ok");
      expect(await Bun.file(marker).exists()).toBe(false);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      if (originalHomeDrive === undefined) delete process.env.HOMEDRIVE;
      else process.env.HOMEDRIVE = originalHomeDrive;
      if (originalHomePath === undefined) delete process.env.HOMEPATH;
      else process.env.HOMEPATH = originalHomePath;
    }
  });

  test("chybějící mirror označí a Repair ho vytvoří", async () => {
    const { root } = await fixture("missing", { createMirror: false });
    const before = await inspectAgentSkillsEntrypoint(root);

    expect(before.status).toBe("repair_needed");
    expect(before.code).toBe("mirror_missing");

    const after = await repairAgentSkillsEntrypoint(root);
    expect(after.status).toBe("ok");
    expect(
      await readFile(join(root, ".claude", "skills", "sample", "SKILL.md"), "utf8"),
    ).toBe(SAMPLE_SKILL);
  });

  test("drift kanonického skillu označí a Repair srovná bytes", async () => {
    const { root } = await fixture("drift");
    await writeFile(
      join(root, ".agents", "skills", "sample", "SKILL.md"),
      "# Sample v2\n",
    );

    const before = await inspectAgentSkillsEntrypoint(root);
    expect(before.status).toBe("repair_needed");
    expect(before.code).toBe("mirror_drift");
    expect(before.problems.join("\n")).toContain("byte-for-byte");

    const after = await repairAgentSkillsEntrypoint(root);
    expect(after.status).toBe("ok");
    expect(
      await readFile(join(root, ".claude", "skills", "sample", "SKILL.md"), "utf8"),
    ).toBe("# Sample v2\n");
  });

  test("neaktivní skill v mirroru Repair bezpečně odstraní", async () => {
    const { root } = await fixture("stale-skill");
    await mkdir(join(root, ".claude", "skills", "retired"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "retired", "SKILL.md"), "# Old\n");

    const before = await inspectAgentSkillsEntrypoint(root);
    expect(before.status).toBe("repair_needed");
    expect(before.code).toBe("mirror_drift");

    const after = await repairAgentSkillsEntrypoint(root);
    expect(after.status).toBe("ok");
    expect(
      await Bun.file(join(root, ".claude", "skills", "retired", "SKILL.md")).exists(),
    ).toBe(false);
  });

  test("neznámý obsah v mirroru Repair nesmaže", async () => {
    const { root } = await fixture("unknown-content");
    await mkdir(join(root, ".claude", "skills", "notes"), { recursive: true });
    const marker = join(root, ".claude", "skills", "notes", "local.md");
    await writeFile(marker, "local\n");

    const state = await repairAgentSkillsEntrypoint(root);
    expect(state.status).toBe("blocked");
    expect(state.code).toBe("mirror_unknown_content");
    expect(await Bun.file(marker).text()).toBe("local\n");
  });

  test("legacy symlink Repair nahradí skutečným mirrorem", async () => {
    const { root } = await fixture("legacy-link", { createMirror: false });
    await mkdir(join(root, ".claude"), { recursive: true });
    await symlink(
      process.platform === "win32"
        ? join(root, ".agents", "skills")
        : "../.agents/skills",
      join(root, ".claude", "skills"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const before = await inspectAgentSkillsEntrypoint(root);
    expect(before.status).toBe("repair_needed");
    expect(before.code).toBe("mirror_legacy_link");

    const after = await repairAgentSkillsEntrypoint(root);
    expect(after.status).toBe("ok");
    expect(
      await readFile(join(root, ".agents", "skills", "sample", "SKILL.md"), "utf8"),
    ).toBe(SAMPLE_SKILL);
    expect(
      await readFile(join(root, ".claude", "skills", "sample", "SKILL.md"), "utf8"),
    ).toBe(SAMPLE_SKILL);
  });

  test("legacy Windows placeholder Repair nahradí mirrorem", async () => {
    const { root } = await fixture("placeholder", { createMirror: false });
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "skills"), "../.agents/skills\n");

    const before = await inspectAgentSkillsEntrypoint(root);
    expect(before.status).toBe("repair_needed");
    expect(before.code).toBe("mirror_legacy_placeholder");

    const after = await repairAgentSkillsEntrypoint(root);
    expect(after.status).toBe("ok");
  });

  test("gitignored mirror je porušení kontraktu", async () => {
    const { root } = await fixture("ignored", {
      createMirror: false,
      gitignoreMirror: true,
    });

    const state = await inspectAgentSkillsEntrypoint(root);
    expect(state.status).toBe("blocked");
    expect(state.code).toBe("entrypoint_contract_invalid");
    expect(state.problems.join("\n")).toContain("nesmí být v .gitignore");
  });

  test("cizí tracked obsah pod mirrorem je porušení kontraktu", async () => {
    const { root } = await fixture("foreign-tracked");
    await writeFile(join(root, ".claude", "skills", "README.md"), "foreign\n");
    git(root, ["add", ".claude/skills/README.md"]);

    const state = await inspectAgentSkillsEntrypoint(root);
    expect(state.status).toBe("blocked");
    expect(state.problems.join("\n")).toContain("nepatří do odvozeného mirroru");
  });

  test("odmítne symlinkovaný kanonický katalog", async () => {
    const { root } = await fixture("canonical-link", { createMirror: false });
    const canonical = join(root, ".agents", "skills");
    const physical = join(root, ".agents", "skills-physical");
    await Bun.$`mv ${canonical} ${physical}`.quiet();
    await symlink(physical, canonical, "junction");

    const state = await inspectAgentSkillsEntrypoint(root);
    expect(state.status).toBe("blocked");
    expect(state.code).toBe("canonical_not_directory");
  });

  test("Repair po prohození dříve bezpečného parentu nezapíše mimo root", async () => {
    const { root } = await fixture("parent-swap", { createMirror: false });
    const outside = await mkdtemp(join(tmpdir(), "organization-template-skills-outside-"));
    tempRoots.push(outside);

    const before = await inspectAgentSkillsEntrypoint(root);
    expect(before.status).toBe("repair_needed");
    await rm(join(root, ".claude"), { recursive: true, force: true });
    await symlink(outside, join(root, ".claude"), "junction");

    const state = await repairAgentSkillsEntrypoint(root);
    expect(state.status).toBe("blocked");
    expect(state.code).toBe("entrypoint_contract_invalid");
    expect(await Bun.file(join(outside, "skills")).exists()).toBe(false);
  });
});

test("extra soubor v aktivním skill adresáři: repair failuje zavřeně a soubor přežije", async () => {
  const { root } = await fixture("active-extra");
  await writeFile(join(root, ".claude", "skills", "sample", "notes.md"), "lokální poznámky\n");

  const state = await repairAgentSkillsEntrypoint(root);
  expect(state.status).toBe("blocked");
  expect(state.code).toBe("mirror_unknown_content");
  const survived = await readFile(join(root, ".claude", "skills", "sample", "notes.md"), "utf8");
  expect(survived).toBe("lokální poznámky\n");

  await rm(join(root, ".claude", "skills", "sample", "notes.md"));
  const after = await repairAgentSkillsEntrypoint(root);
  expect(after.status).toBe("ok");
});

test("stray soubor přímo v mirroru: repair failuje zavřeně a soubor přežije", async () => {
  const { root } = await fixture("stray-file");
  await writeFile(join(root, ".claude", "skills", "README.txt"), "stray\n");

  const state = await repairAgentSkillsEntrypoint(root);
  expect(state.status).toBe("blocked");
  expect(state.code).toBe("mirror_unknown_content");
  const survived = await readFile(join(root, ".claude", "skills", "README.txt"), "utf8");
  expect(survived).toBe("stray\n");
});

test("slug s traversal cestou v manifestu je blocked manifest_invalid", async () => {
  const { root } = await fixture("traversal");
  await writeFile(
    join(root, ".agents", "skills", "manifest.json"),
    JSON.stringify({
      schema_version: "companiesascode.organization_skills.v1",
      policy: { claude_compatibility: "tracked-derived-mirror" },
      skills: [{ slug: "../../evil", path: ".agents/skills/../../evil/SKILL.md" }],
    }),
  );

  const state = await inspectAgentSkillsEntrypoint(root);
  expect(state.status).toBe("blocked");
  expect(state.code).toBe("manifest_invalid");
});

test("symlink v kanonickém katalogu: repair failuje zavřeně a nic nekopíruje", async () => {
  const { root } = await fixture("canonical-symlink", { createMirror: false });
  const outside = await mkdtemp(join(tmpdir(), "canonical-outside-"));
  tempRoots.push(outside);
  await writeFile(join(outside, "secret.md"), "tajný obsah\n");
  await rm(join(root, ".agents", "skills", "sample", "SKILL.md"));
  await symlink(join(outside, "secret.md"), join(root, ".agents", "skills", "sample", "SKILL.md"));

  const state = await repairAgentSkillsEntrypoint(root);
  expect(state.status).toBe("blocked");
  expect(state.code).toBe("canonical_unsafe_content");
});

test("mirror mimo Git index je repair_needed a repair ho stage-uje", async () => {
  const { root } = await fixture("untracked");
  git(root, ["rm", "--cached", "--quiet", ".claude/skills/sample/SKILL.md"]);

  const before = await inspectAgentSkillsEntrypoint(root);
  expect(before.status).toBe("repair_needed");
  expect(before.code).toBe("mirror_untracked");

  const after = await repairAgentSkillsEntrypoint(root);
  expect(after.status).toBe("ok");
});

test("gitignored OS junk (.DS_Store) v mirroru není drift ani blocker", async () => {
  const { root } = await fixture("os-junk");
  await writeFile(join(root, ".claude", "skills", ".DS_Store"), "junk");
  await writeFile(join(root, ".claude", "skills", "sample", ".DS_Store"), "junk");

  const state = await inspectAgentSkillsEntrypoint(root);
  expect(state.status).toBe("ok");
  expect(state.code).toBe("mirror_ready");

  const repair = await repairAgentSkillsEntrypoint(root);
  expect(repair.status).toBe("ok");
  const survived = await readFile(join(root, ".claude", "skills", ".DS_Store"), "utf8");
  expect(survived).toBe("junk");
});

test("symlink kanonického SKILL.md hlásí doctor zavřeně, ne mirror_ready", async () => {
  const { root } = await fixture("canonical-symlink-doctor", { createMirror: false });
  const outside = await mkdtemp(join(tmpdir(), "canonical-doctor-outside-"));
  tempRoots.push(outside);
  await writeFile(join(outside, "secret.md"), SAMPLE_SKILL);
  await rm(join(root, ".agents", "skills", "sample", "SKILL.md"));
  await symlink(join(outside, "secret.md"), join(root, ".agents", "skills", "sample", "SKILL.md"));
  // Mirror nese shodné bajty — dřív to doctor prohlásil za mirror_ready.
  await mkdir(join(root, ".claude", "skills", "sample"), { recursive: true });
  await writeFile(join(root, ".claude", "skills", "sample", "SKILL.md"), SAMPLE_SKILL);
  git(root, ["add", ".claude/skills"]);

  const state = await inspectAgentSkillsEntrypoint(root);
  expect(state.status).toBe("blocked");
  expect(state.problems.join(" ")).toContain("žádné symlinky");
});
