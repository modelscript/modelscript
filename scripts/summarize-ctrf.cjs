// scripts/summarize-ctrf.cjs
// Aggregates all CTRF JSON reports across the monorepo and outputs a formatted summary table.
const fs = require("node:fs");
const path = require("node:path");

function findCtrfFiles(dir, maxDepth = 4, currentDepth = 0) {
  const results = [];
  if (currentDepth > maxDepth || !fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".nx" || entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findCtrfFiles(fullPath, maxDepth, currentDepth + 1));
    } else if (entry.isFile() && entry.name.endsWith(".json") && path.basename(dir) === "ctrf") {
      results.push(fullPath);
    }
  }
  return results;
}

const rootDir = path.resolve(__dirname, "..");
const files = findCtrfFiles(rootDir);

if (files.length === 0) {
  console.log("\n[CTRF] No CTRF test reports found.");
  process.exit(0);
}

let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;
let totalPending = 0;
let totalSkipped = 0;

console.log("\n================================================================================");
console.log("                      ModelScript CTRF Test Suite Summary                       ");
console.log("================================================================================");
console.log(
  "Package / Suite".padEnd(46) +
    "Tests".padStart(8) +
    "Passed".padStart(8) +
    "Failed".padStart(8) +
    "Skipped".padStart(9)
);
console.log("-".repeat(79));

for (const file of files) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    const data = raw.results || raw.report?.results;
    if (!data) continue;

    const summary = data.summary || {};
    const relDir = path.relative(rootDir, path.dirname(path.dirname(file)));
    const toolName = data.tool?.name;
    const displayName = relDir ? (toolName && toolName !== "node-test" && toolName !== "jest" ? toolName : `${relDir} (${toolName || "test"})`) : (toolName || "root");

    const tests = summary.tests || 0;
    const passed = summary.passed || 0;
    const failed = summary.failed || 0;
    const pending = summary.pending || 0;
    const skipped = (summary.skipped || 0) + pending;

    totalTests += tests;
    totalPassed += passed;
    totalFailed += failed;
    totalPending += pending;
    totalSkipped += skipped;

    const statusMark = failed > 0 ? "✗" : "✓";
    console.log(
      `${statusMark} ${displayName}`.padEnd(46) +
        String(tests).padStart(8) +
        String(passed).padStart(8) +
        String(failed).padStart(8) +
        String(skipped).padStart(9)
    );
  } catch {}
}

console.log("=".repeat(79));
console.log(
  "Total".padEnd(46) +
    String(totalTests).padStart(8) +
    String(totalPassed).padStart(8) +
    String(totalFailed).padStart(8) +
    String(totalSkipped).padStart(9)
);
console.log("================================================================================\n");

// If called with --check-failed, exit with code 1 if any failed
if (process.argv.includes("--check-failed") && totalFailed > 0) {
  process.exit(1);
}
