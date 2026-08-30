// Personalspace doctor — vlastní nezávislý doctor tohohle mountu (decision 0118).
//
// Invokační kontrakt společného surfacu: doctor je PROCES. Dostane argv a pracovní
// adresář, s `--json` vrací v3 report na stdout a končí exit kódem
//   0 = ok|warn · 1 = fail · 2 = incomplete (aspoň jeden blocked) · 3 = report nevznikl.
//
// Běží samostatně. Na Buddy VPS nad ním žádný Lazurio root není a nikdy
// nebude; kontroly kořene se proto hlásí jako not_applicable / owned_by_root, ne
// jako vada instalace, která se nikdy nestala.

import { DOCTOR_EXIT_CODES, exitCodeForSummaryStatus } from "./doctor-surface-lib.mjs";
import { renderHumanReport, runPersonalspaceDoctor } from "./doctor-personalspace-lib.mjs";

const asJson = process.argv.slice(2).includes("--json");
let report;
try {
  report = await runPersonalspaceDoctor({ cwd: process.cwd() });
} catch (error) {
  // Exit 3 = report vůbec nevznikl. Rodič to musí odlišit od „dítě řeklo ne".
  console.error(`Personalspace Doctor: report nevznikl (${error.message}).`);
  process.exitCode = DOCTOR_EXIT_CODES.no_report;
}

if (report) {
  if (asJson) {
    // V JSON režimu patří na stdout výhradně report. Cokoli dalšího by z něj
    // u rodiče udělalo `unparseable`.
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderHumanReport(report));
  }
  // process.exitCode místo process.exit(): useknutý stdout by rodič klasifikoval
  // jako `unparseable`, tedy jako jinou vadu, než jaká se opravdu stala.
  process.exitCode = exitCodeForSummaryStatus(report.summary.status);
}
