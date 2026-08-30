import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { OWNER_PLACEHOLDER } from "./personalspace-lib.mjs";

const root = join(import.meta.dirname, "..");
let personal;
try {
  personal = JSON.parse(await readFile(join(root, "personal.gen3.json"), "utf8"));
} catch {
  console.error("Personalspace check FAIL: personal.gen3.json není validní JSON.");
  process.exit(1);
}

const script = personal.owner?.github_username === OWNER_PLACEHOLDER
  ? "check:template"
  : "check:static-instance";
const result = spawnSync(process.execPath, ["run", script], {
  cwd: root,
  shell: false,
  stdio: "inherit",
});
process.exit(Number.isInteger(result.status) ? result.status : 1);
