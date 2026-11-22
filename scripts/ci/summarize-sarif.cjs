// SPDX-License-Identifier: AGPL-3.0-or-later

const fs = require("node:fs");

function main() {
  const sarifPath = process.argv[2];
  if (!sarifPath || !fs.existsSync(sarifPath)) {
    console.warn(`[CodeQL] No SARIF file found at: ${sarifPath}`);
    return;
  }

  try {
    const raw = fs.readFileSync(sarifPath, "utf8");
    const sarif = JSON.parse(raw);
    const runs = sarif.runs || [];
    let totalAlerts = 0;

    for (const run of runs) {
      const results = run.results || [];
      totalAlerts += results.length;

      for (const res of results) {
        const ruleId = res.ruleId || "unknown";
        const level = (res.level || "warning").toUpperCase();
        const msg = res.message?.text || "";
        const loc = res.locations?.[0]?.physicalLocation;
        const file = loc?.artifactLocation?.uri || "unknown";
        const line = loc?.region?.startLine || 1;
        const col = loc?.region?.startColumn || 1;

        console.log(`\n  \x1b[33m[${level}]\x1b[0m \x1b[1m${ruleId}\x1b[0m`);
        console.log(`  Location: ${file}:${line}:${col}`);
        console.log(`  Message:  ${msg.split("\n")[0]}`);
      }
    }

    console.log("");
    if (totalAlerts === 0) {
      console.log("\x1b[32m✔ CodeQL analysis passed with 0 security alerts!\x1b[0m\n");
    } else {
      console.log(`\x1b[31m✖ Found ${totalAlerts} CodeQL alert(s). See ${sarifPath} for complete details.\x1b[0m\n`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`[CodeQL] Failed to parse SARIF output: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
