#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { buildParser } from "../dist/api.js";

async function main() {
  const args = process.argv.slice(2);
  const entryPath = args[0] || "src/index.ts";
  const outDir = args[1] || "build/src-gen";

  const absoluteEntry = path.resolve(process.cwd(), entryPath);
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

  const result = buildParser(languageDef);

  const absoluteOutDir = path.resolve(process.cwd(), outDir);
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
