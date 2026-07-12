/**
 * fmusim Verification Script
 * Automates the validation of ModelScript-generated FMUs by simulating them
 * inside the official Modelica Association \`fmusim\` C-simulator.
 */
import { exec } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import util from "util";

const execAsync = util.promisify(exec);

const VALIDATION_DIR = path.resolve("validation/exported_fmus");
const REF_DIR = path.resolve("validation/reference_fmus");

// Select the correct binary based on the OS
const platform = os.platform();
const arch = os.arch();
let fmusimFolder = "";
if (platform === "linux" && arch === "x64") fmusimFolder = "fmusim-x86_64-linux";
else if (platform === "linux" && arch === "arm64") fmusimFolder = "fmusim-aarch64-linux";
else if (platform === "darwin" && arch === "x64") fmusimFolder = "fmusim-x86_64-darwin";
else if (platform === "darwin" && arch === "arm64") fmusimFolder = "fmusim-aarch64-darwin";
else if (platform === "win32" && arch === "x64") fmusimFolder = "fmusim-x86_64-windows";
else if (platform === "win32" && (arch === "ia32" || arch === "x86")) fmusimFolder = "fmusim-x86-windows";
else throw new Error(`Unsupported platform for fmusim: ${platform} ${arch}`);

const FMUSIM_CMD = path.join(REF_DIR, fmusimFolder, platform === "win32" ? "fmusim.exe" : "fmusim");

async function main() {
  console.log("Starting fmusim Cross-Verification...\n");

  try {
    await fs.access(FMUSIM_CMD);
  } catch {
    console.error(`[!] fmusim not found at ${FMUSIM_CMD}.`);
    console.error(`Please run 'npm run fetch:fmusim' first!`);
    process.exit(1);
  }

  const models = await fs.readdir(VALIDATION_DIR);

  for (const model of models) {
    const fmuPath = path.join(VALIDATION_DIR, model, `${model}.fmu`);

    try {
      await fs.access(fmuPath);
    } catch {
      continue; // No FMU generated for this directory yet
    }

    console.log(`========================================`);
    console.log(`Verifying FMU in fmusim: ${model}.fmu`);

    // Create a build directory to keep the output clean
    const buildDir = path.join(VALIDATION_DIR, model, "build_fmusim");
    await fs.mkdir(buildDir, { recursive: true });

    // Figure out start/stop times from the _ref.opt file
    let stopTime = 1.0;
    let stepSize = 0.01;
    try {
      const optPath = path.join(VALIDATION_DIR, model, `${model}_ref.opt`);
      const optText = await fs.readFile(optPath, "utf-8");
      for (const line of optText.split("\\n")) {
        if (line.startsWith("StopTime")) stopTime = parseFloat(line.split(",")[1]);
        if (line.startsWith("StepSize")) stepSize = parseFloat(line.split(",")[1]);
      }
    } catch (e) {
      // Ignore missing .opt, use defaults
    }

    try {
      // Run the official Modelica Association fmusim
      // Use CVODE solver for robustness, set stop time and output interval
      const args = [
        FMUSIM_CMD,
        `--output-file`,
        `fmusim_res.csv`,
        `--solver`,
        `cvode`,
        `--stop-time`,
        stopTime.toString(),
        `--output-interval`,
        stepSize.toString(),
        `../${model}.fmu`,
      ];

      const { stdout, stderr } = await execAsync(args.join(" "), {
        cwd: buildDir,
      });

      const out = stdout.trim();
      if (out.includes("error") || stderr) {
        console.warn(`  [!] fmusim simulation had warnings/errors for ${model}.`);
        if (stderr) console.error("fmusim Stderr:", stderr);
      } else {
        console.log(`  [✓] fmusim successfully simulated ${model}.fmu`);
      }
    } catch (err: any) {
      console.error(`  [!] fmusim failed to run for ${model}:`, err.message || err.stdout || err.stderr);
    }

    console.log("");
  }

  console.log("fmusim Cross-Verification Complete.");
}

main().catch((err) => {
  console.error("Fatal error during fmusim verification:", err);
  process.exit(1);
});
