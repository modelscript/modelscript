#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { compileAssemblyScript, compileLanguage } from "../src/api.js";

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
  const languageDef = Object.values(module).find((val) => val && val.name && val.syntax);

  if (!languageDef) {
    console.error("Error: Could not find a valid language export in the entry file.");
    process.exit(1);
  }

  const result = compileLanguage(languageDef);

  const absoluteOutDir = path.resolve(process.cwd(), outDir);
  if (!fs.existsSync(absoluteOutDir)) {
    fs.mkdirSync(absoluteOutDir, { recursive: true });
  }

  const outputPath = path.join(absoluteOutDir, "parser.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  // Generate AssemblyScript parser
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(__dirname, "../src/templates/parser.as.template");
  const templateStr = fs.readFileSync(templatePath, "utf-8");

  const asCode = compileAssemblyScript(languageDef, templateStr);
  const asOutputPath = path.join(absoluteOutDir, "parser.ts");
  fs.writeFileSync(asOutputPath, asCode);

  console.log(`=== ${result.name} Parser Generated ===`);
  console.log(`Generated ${result.statesCount} GLR states`);
  console.log(`JSON written to: ${outputPath}`);
  console.log(`AssemblyScript written to: ${asOutputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
