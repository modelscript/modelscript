// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Idempotently wires zero-I/O `registerBuiltIn*LibrarySync()` auto-registration
 * into each of the 30 cleanroom-stdlib language plugins (`src/language.ts`).
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

const ENTRIES = [
  ["adams", "registerBuiltInAdamsLibrarySync"],
  ["ampl", "registerBuiltInAmplLibrarySync"],
  ["aspen", "registerBuiltInAspenLibrarySync"],
  ["atp", "registerBuiltInAtpLibrarySync"],
  ["cyme", "registerBuiltInCymeLibrarySync"],
  ["easy5", "registerBuiltInEasy5LibrarySync"],
  ["eclipse", "registerBuiltInEclipseLibrarySync"],
  ["fea", "registerBuiltInFeaLibrarySync"],
  ["gensys", "registerBuiltInGensysLibrarySync"],
  ["gproms", "registerBuiltInGpromsLibrarySync"],
  ["gtsuite", "registerBuiltInGtSuiteLibrarySync"],
  ["lps", "registerBuiltInLpsLibrarySync"],
  ["magicdraw", "registerBuiltInMagicDrawLibrarySync"],
  ["mlxtran", "registerBuiltInMlxtranLibrarySync"],
  ["nmtran", "registerBuiltInNmtranLibrarySync"],
  ["olga", "registerBuiltInOlgaLibrarySync"],
  ["oneliner", "registerBuiltInOneLinerLibrarySync"],
  ["plscadd", "registerBuiltInPlsCaddLibrarySync"],
  ["powerfactory", "registerBuiltInPowerFactoryLibrarySync"],
  ["powerworld", "registerBuiltInPowerWorldLibrarySync"],
  ["pslf", "registerBuiltInPslfLibrarySync"],
  ["relap5", "registerBuiltInRelap5LibrarySync"],
  ["rocets", "registerBuiltInRocetsLibrarySync"],
  ["rtds", "registerBuiltInRtdsLibrarySync"],
  ["sel", "registerBuiltInSelLibrarySync"],
  ["sima", "registerBuiltInSimaLibrarySync"],
  ["simpack", "registerBuiltInSimpackLibrarySync"],
  ["simulink", "registerBuiltInSimulinkLibrarySync"],
  ["spice", "registerBuiltInSpiceLibrarySync"],
  ["tough", "registerBuiltInToughLibrarySync"],
];

let updated = 0;
for (const [lang, fnName] of ENTRIES) {
  const filePath = path.join(ROOT, "languages", lang, "src", "language.ts");
  if (!fs.existsSync(filePath)) {
    console.error(`[missing] ${filePath}`);
    continue;
  }
  const src = fs.readFileSync(filePath, "utf-8");
  if (src.includes(fnName)) continue;

  const importLine = `import { ${fnName} } from "./catalog/library-package-adapter.js";`;
  const callBlock = `\n// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).\n${fnName}();\n`;

  const lines = src.split("\n");
  let lastImportEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\b/.test(lines[i])) {
      let j = i;
      while (
        j < lines.length &&
        !lines[j].includes(";") &&
        !lines[j].includes('from "') &&
        !lines[j].includes("from '")
      ) {
        j++;
      }
      lastImportEnd = j;
    }
  }
  if (lastImportEnd >= 0) {
    lines.splice(lastImportEnd + 1, 0, importLine);
  } else {
    lines.unshift(importLine);
  }
  const nextSrc = lines.join("\n").trimEnd() + "\n" + callBlock;
  fs.writeFileSync(filePath, nextSrc, "utf-8");
  updated++;
}
console.log(`Auto-registration wired into ${updated} language.ts files.`);
