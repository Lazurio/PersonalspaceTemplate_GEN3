import { spawnSync } from "child_process";

const embeddedUrlCredentialPattern = new RegExp(
  [":", "/", "/", "([^:/\\s]+)", ":", "([^@\\s]+)", "@"].join(""),
  "g",
);

export function runCommand(command, args = [], {
  cwd = process.cwd(),
  allowFailure = false,
  inherit = false,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    shell: false,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  const status = Number.isInteger(result.status) ? result.status : 1;
  const output = {
    status,
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
    error: result.error ?? null,
  };
  if (status !== 0 && !allowFailure) {
    const detail = redactDiagnostic(output.stderr || output.error?.message || "bez detailu");
    throw new Error(`${command} selhal (exit ${status}): ${detail}`);
  }
  return output;
}

export function runJson(command, args, options = {}) {
  const result = runCommand(command, args, options);
  try {
    return { ...result, json: JSON.parse(result.stdout) };
  } catch {
    throw new Error(`${command} nevrátil validní JSON.`);
  }
}

export function redactDiagnostic(value) {
  return String(value)
    .replace(embeddedUrlCredentialPattern, [":", "/", "/", "***", ":", "***", "@"].join(""))
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, "gh*_***")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{16,}\b/g, "github_pat_***")
    .replace(/\bBearer\s+\S+/gi, "Bearer ***")
    .slice(-1200);
}
