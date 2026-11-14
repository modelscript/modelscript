#!/usr/bin/env tsx
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { buildParser, validateLanguageQueries } from "../dist/index.js";

function parseArgs(argv) {
  const flags = new Set();
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }
  return {
    entryPath: positional[0] || "src/index.ts",
    outDir: positional[1] || "build/src-gen",
    inspect: flags.has("--inspect"),
    conflictsOnly: flags.has("--conflicts"),
    json: flags.has("--json"),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const absoluteEntry = path.resolve(process.cwd(), opts.entryPath);
  if (!fs.existsSync(absoluteEntry)) {
    console.error(`Error: Entry file not found at ${absoluteEntry}`);
    process.exit(1);
  }

  // Import the language definition
  const module = await import(pathToFileURL(absoluteEntry).href);

  // Find the language export
  const languageDef = Object.values(module).find((val) => val && val.name && val.rules);

  if (!languageDef) {
    console.error("Error: Could not find a valid language export in the entry file.");
    process.exit(1);
  }

  const result = buildParser(languageDef, { sourcePath: absoluteEntry });
  const queryDiagnostics = validateLanguageQueries(languageDef);
  const grammarDiagnostics = result.grammarDiagnostics || [];
  const conflicts = result.conflicts || [];

  if (opts.inspect || opts.conflictsOnly) {
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            parserInfo: {
              name: result.parserInfo.name,
              startSymbol: result.parserInfo.startSymbol,
              statesCount: result.parserInfo.statesCount,
              nonTerminalsCount: result.parserInfo.nonTerminals.length,
              terminalsCount: result.parserInfo.terminals.length,
            },
            grammarDiagnostics,
            queryDiagnostics,
            conflicts,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`=== ${result.parserInfo.name} Grammar Inspection ===`);
      console.log(`Start symbol : ${result.parserInfo.startSymbol}`);
      console.log(`GLR states   : ${result.parserInfo.statesCount}`);
      console.log(`Non-terminals: ${result.parserInfo.nonTerminals.length}`);
      console.log(`Terminals    : ${result.parserInfo.terminals.length}`);
      console.log(`Grammar diags: ${grammarDiagnostics.length}`);
      for (const d of grammarDiagnostics) {
        console.log(`  [${d.severity.toUpperCase()}] (${d.code}) ${d.message}`);
      }
      console.log(`Query AS diags: ${queryDiagnostics.length}`);
      for (const d of queryDiagnostics) {
        console.log(`  [${d.code}] ${d.target || "query"}:${d.line}:${d.column} - ${d.message}`);
      }
      console.log(`Conflicts    : ${conflicts.length}`);
      for (const c of conflicts) {
        console.log(
          `  [${c.type}] rules=${c.rules.join(", ")}${c.symbolSequence ? ` | seq: ${c.symbolSequence}` : ""}`,
        );
        if (opts.conflictsOnly && c.output) {
          console.log(c.output);
        }
      }
    }
    return;
  }

  const absoluteOutDir = path.resolve(process.cwd(), opts.outDir);
  if (!fs.existsSync(absoluteOutDir)) {
    fs.mkdirSync(absoluteOutDir, { recursive: true });
  }

  const outputPath = path.join(absoluteOutDir, "parser.json");
  fs.writeFileSync(outputPath, JSON.stringify(result.parserInfo, null, 2));

  // Generate AssemblyScript files
  for (const file of result.assemblyScriptFiles) {
    fs.writeFileSync(path.join(absoluteOutDir, file.filename), file.content);
  }

  console.log(`=== ${result.parserInfo.name} Parser Generated ===`);
  console.log(`Generated ${result.parserInfo.statesCount} GLR states`);
  console.log(`JSON written to: ${outputPath}`);
  console.log(`AssemblyScript files written to: ${absoluteOutDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
