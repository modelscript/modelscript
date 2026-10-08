// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runLanguageParserBuild } from "../../scripts/build-language-parser.js";

runLanguageParserBuild({
  langName: "sysml2",
  dir: import.meta.dirname,
  languageModule: "./src/language.js",
  languageExportName: "sysml2Language",
  extraAscFlags: ["--disableWarning", "235"],
});

// KerML stdlib pre-compiled snapshot check
const kermlPath = path.join(import.meta.dirname, "stdlib", "KerML.sysml");
const snapshotTs = path.join(import.meta.dirname, "src-gen", "kerml-snapshot.ts");
const outWasm = path.join(import.meta.dirname, "dist", "parser.wasm");
const forceRebuild = process.argv.includes("--force");

function isSnapshotUpToDate() {
  if (forceRebuild) return false;
  if (!fs.existsSync(snapshotTs)) return false;
  const snapStat = fs.statSync(snapshotTs);
  if (snapStat.size === 0) return false;
  const snapTime = snapStat.mtimeMs;

  if (fs.existsSync(kermlPath) && fs.statSync(kermlPath).mtimeMs > snapTime) return false;
  if (fs.existsSync(outWasm) && fs.statSync(outWasm).mtimeMs > snapTime) return false;
  return true;
}

if (isSnapshotUpToDate()) {
  console.log("[sysml2] KerML snapshot is up to date, skipping snapshot generation.");
} else {
  console.log("[sysml2] Generating KerML stdlib pre-compiled snapshot...");
  execFileSync("npx", ["tsx", "scripts/generate-kerml-snapshot.ts"], { stdio: "inherit", cwd: import.meta.dirname });
}
