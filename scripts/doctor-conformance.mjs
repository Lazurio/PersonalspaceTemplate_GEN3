// Konformní test společného surfacu doctorů (decision 0118).
//
// Tímhle musí projít KAŽDÝ doctor — root v kořeni Conglomerate, doctor Organizace
// i personalspace doctor běžící samostatně na Buddy VPS. Bez něj je surface jen
// próza: každý producent by si „v3 report" vyložil po svém a root by se to dozvěděl
// až v okamžiku, kdy na tom závisí brána.
//
// CLI:
//   bun scripts/doctor-conformance.mjs -- <command> [args...]
// Spustí zadaný doctor v aktuálním adresáři a vypíše nálezy; exit 1 = neprošel.

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DOCTOR_EXIT_CODES,
  DOCTOR_REPORT_SCHEMA_VERSION_V3,
  NOT_APPLICABLE_REASONS,
  buildSummary,
  countChecks,
  exitCodeForSummaryStatus,
  flattenChecks,
  loadDoctorReportSchema,
  summarizeStatus,
  validateDoctorReport,
} from "./doctor-surface-lib.mjs";

/**
 * Konformita SAMOTNÉHO reportu. Použitelná i tam, kde se doctor volá v procesu
 * (core doctor v `bun run check`), ne jen jako podproces.
 */
export function checkReportConformance(report, { schema, label = "doctor" } = {}) {
  const failures = validateDoctorReport(report, { schema, label });

  if (report?.schema_version !== DOCTOR_REPORT_SCHEMA_VERSION_V3) {
    failures.push(
      `${label}: schema_version musí být ${DOCTOR_REPORT_SCHEMA_VERSION_V3}, nalezeno ${report?.schema_version}`,
    );
    return failures;
  }

  const checks = Array.isArray(report.checks) ? report.checks : [];
  checks.forEach((check, index) => {
    const at = `${label}.checks[${index}] (${check?.id ?? "bez id"})`;
    if (check?.status === "blocked") {
      // Blocked bez remedy je nepozorování, o kterém nikdo neví, co s ním.
      if (!check.blocked_reason?.trim()) failures.push(`${at}: blocked bez 'blocked_reason'`);
      if (!check.remedy?.trim()) failures.push(`${at}: blocked bez 'remedy'`);
    }
    if (check?.status === "not_applicable") {
      if (!NOT_APPLICABLE_REASONS.includes(check.not_applicable_reason)) {
        failures.push(
          `${at}: not_applicable_reason musí být jeden z [${NOT_APPLICABLE_REASONS.join(", ")}], nalezeno ${JSON.stringify(check.not_applicable_reason)}`,
        );
      }
      if (!check.owner?.trim()) failures.push(`${at}: not_applicable bez 'owner'`);
    }
    if (check?.status === "skip") {
      failures.push(`${at}: 'skip' je legacy stav; v3 používá not_applicable nebo blocked`);
    }
  });

  const expectedSummary = buildSummary(flattenChecks(report));
  for (const key of Object.keys(expectedSummary)) {
    if (report.summary?.[key] !== expectedSummary[key]) {
      failures.push(
        `${label}: summary.${key}=${report.summary?.[key]}, odvozeno ${expectedSummary[key]}`,
      );
    }
  }

  return failures;
}

/**
 * Konformita doctora jako PROCESU: argv + cwd dovnitř, v3 report na stdout,
 * exit kód podle odvozeného souhrnu.
 */
export function checkDoctorProcessConformance({
  command,
  cwd = process.cwd(),
  schema,
  label = command?.join(" ") ?? "doctor",
  timeoutMs = 180_000,
  spawn = spawnSync,
} = {}) {
  const failures = [];
  if (!Array.isArray(command) || command.length === 0) {
    failures.push(`${label}: konformní test potřebuje 'command' (argv doctora)`);
    return { failures, report: null };
  }

  const result = spawn(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result?.error) {
    failures.push(`${label}: doctor nešel spustit: ${result.error.message}`);
    return { failures, report: null };
  }

  const stdout = String(result?.stdout ?? "").trim();
  if (stdout === "") {
    // Prázdný stdout je legitimní JEN se signálním kódem 3 — a i tak to není
    // konformní doctor, jen doctor, který se přiznal.
    failures.push(
      result?.status === DOCTOR_EXIT_CODES.no_report
        ? `${label}: doctor report nevytvořil (exit 3) — přiznaně, ale konformitu to nesplňuje`
        : `${label}: doctor nic nevypsal na stdout a přitom neskončil kódem 3 (nalezeno ${result?.status})`,
    );
    return { failures, report: null };
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    failures.push(`${label}: stdout není JSON: ${error.message}`);
    return { failures, report: null };
  }

  failures.push(...checkReportConformance(report, { schema, label }));

  const expectedExit = exitCodeForSummaryStatus(summarizeStatus(flattenChecks(report)));
  if (result?.status !== expectedExit) {
    const counts = countChecks(flattenChecks(report));
    failures.push(
      `${label}: exit kód ${result?.status} neodpovídá reportu (očekáváno ${expectedExit}; `
      + `fail=${counts.fail}, blocked=${counts.blocked}, warn=${counts.warn})`,
    );
  }

  return { failures, report };
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const separator = process.argv.indexOf("--");
  const command = separator === -1 ? process.argv.slice(2) : process.argv.slice(separator + 1);
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const schema = loadDoctorReportSchema(repoRoot);
  const { failures } = checkDoctorProcessConformance({ command, schema, cwd: process.cwd() });
  if (failures.length > 0) {
    console.error("Konformní test doctora selhal:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Doctor je konformní se surfacem ${DOCTOR_REPORT_SCHEMA_VERSION_V3}: ${command.join(" ")}`);
}
