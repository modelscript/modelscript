// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";

const reportPath = path.resolve(import.meta.dirname, "../ctrf/ctrf-testsuite-report.json");
const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
const failed = report.results.tests.filter((t: any) => t.status === "failed");

const arrayTests = failed.filter((t: any) => t.suite === "arrays" && t.message?.includes("Output mismatch:"));

console.log(`Found ${arrayTests.length} array tests with output mismatch.`);

for (const t of arrayTests.slice(0, 8)) {
  console.log(`\n==================================================`);
  console.log(`Test: ${t.name}`);
  const lines: string[] = t.message.split("\n");
  const expIdx = lines.findIndex((l) => l.includes("--- Expected ---"));
  const actIdx = lines.findIndex((l) => l.includes("--- Actual ---"));
  if (expIdx >= 0 && actIdx >= 0) {
    console.log("Expected snippet:");
    console.log(lines.slice(expIdx + 1, expIdx + 8).join("\n"));
    console.log("Actual snippet:");
    console.log(lines.slice(actIdx + 1, actIdx + 8).join("\n"));
  }
}
