/**
 * OMC Verification Script
 * Automates the validation of ModelScript-generated FMUs by importing
 * and simulating them inside OpenModelica (OMC).
 */
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import util from "util";

const execAsync = util.promisify(exec);

const VALIDATION_DIR = path.resolve("validation/exported_fmus");

async function main() {
  console.log("Starting OMC Cross-Verification...\n");

  const models = await fs.readdir(VALIDATION_DIR);

  for (const model of models) {
    const fmuPath = path.join(VALIDATION_DIR, model, `${model}.fmu`);

    try {
      await fs.access(fmuPath);
    } catch {
      continue; // No FMU generated for this directory yet
    }

    console.log(`========================================`);
    console.log(`Verifying FMU in OMC: ${model}.fmu`);

    const buildDir = path.join(VALIDATION_DIR, model, "build");
    await fs.mkdir(buildDir, { recursive: true });

    // We write a temporary .mos script to instruct OMC to import and simulate the FMU
    const mosContent = `
// Note: In OMC, importFMU extracts the FMU and generates a wrapper model
setCommandLineOptions("--allowNonStandardModelica=reinitInAlgorithms");
mo_file := importFMU("../${model}.fmu");
getErrorString();

loadFile(mo_file);
getErrorString();

simulate(${model}_me_FMU);
getErrorString();
`;

    const mosPath = path.join(buildDir, "verify.mos");
    await fs.writeFile(mosPath, mosContent);

    try {
      // Run OpenModelica Compiler (omc)
      const { stdout, stderr } = await execAsync(`omc "verify.mos"`, {
        cwd: buildDir,
      });

      const out = stdout.trim();
      if (out.includes("Failed") || out.includes("Error") || stderr) {
        console.warn(`  [!] OMC simulation completed with warnings/errors for ${model}.`);
        console.log("OMC Output:", out);
        if (stderr) console.error("OMC Stderr:", stderr);
      } else {
        console.log(`  [✓] OMC successfully imported and simulated ${model}.fmu`);
      }
    } catch (err: any) {
      console.error(`  [!] OMC failed to run for ${model}:`, err.message || err.stdout || err.stderr);
    }

    // Clean up temporary script
    // await fs.unlink(mosPath);
    console.log("");
  }

  console.log("OMC Cross-Verification Complete.");
}

main().catch((err) => {
  console.error("Fatal error during OMC verification:", err);
  process.exit(1);
});
