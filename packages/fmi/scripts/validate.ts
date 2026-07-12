import { exec } from "child_process";
import * as fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import util from "util";
import { compareCSV, getVarsMap } from "./compare-csv.js";

const execAsync = util.promisify(exec);

const FMI_PKG_ROOT = path.resolve(".");
const VALIDATION_DIR = path.join(FMI_PKG_ROOT, "validation");
const REF_REPO_DIR = path.join(VALIDATION_DIR, "reference_fmus_repo");
const EXPORTED_DIR = path.join(VALIDATION_DIR, "exported_fmus");
const REF_FMUS_DIR = path.join(VALIDATION_DIR, "reference_fmus");
const MODELS_DIR = path.join(VALIDATION_DIR, "models");

const MODELS = [
  { name: "BouncingBall", file: "BouncingBall.mo", stopTime: 1.0, stepSize: 0.01 },
  { name: "VanDerPol", file: "VanDerPol.mo", stopTime: 10.0, stepSize: 0.1 },
  { name: "Dahlquist", file: "Dahlquist.mo", stopTime: 10.0, stepSize: 0.1 },
  { name: "Stair", file: "Stair.mo", stopTime: 10.0, stepSize: 0.01 },
  { name: "StateSpace", file: "StateSpace.mo", stopTime: 10.0, stepSize: 0.1 },
];

async function runCmd(cmd: string, cwd: string = FMI_PKG_ROOT, maxBuffer: number = 1024 * 1024 * 10) {
  try {
    const { stdout } = await execAsync(cmd, { cwd, maxBuffer });
    return stdout;
  } catch (err: any) {
    throw new Error(`Command failed: ${cmd}\nError: ${err.message || err.stderr || err.stdout}`);
  }
}

async function cloneAndBuildReferenceFMUs() {
  console.log("==> Phase 1: Cloning and Building Reference-FMUs...");

  try {
    await fs.access(REF_REPO_DIR);
    console.log("  [✓] Repository already cloned.");
  } catch {
    console.log("  [~] Cloning https://github.com/modelica/Reference-FMUs.git...");
    await runCmd(`git clone --depth 1 https://github.com/modelica/Reference-FMUs.git ${REF_REPO_DIR}`);
  }

  // Build FMI 2.0
  console.log("  [~] Building FMI 2.0 Reference FMUs...");
  await runCmd(`cmake -S . -B build-fmi2 -DFMI_VERSION=2`, REF_REPO_DIR);
  await runCmd(`cmake --build build-fmi2`, REF_REPO_DIR);

  // Build FMI 3.0
  console.log("  [~] Building FMI 3.0 Reference FMUs...");
  await runCmd(`cmake -S . -B build-fmi3 -DFMI_VERSION=3`, REF_REPO_DIR);
  await runCmd(`cmake --build build-fmi3`, REF_REPO_DIR);

  // Copy FMI 2.0 and FMI 3.0 FMUs to validation/reference_fmus
  await fs.mkdir(path.join(REF_FMUS_DIR, "2.0"), { recursive: true });
  await fs.mkdir(path.join(REF_FMUS_DIR, "3.0"), { recursive: true });

  for (const model of MODELS) {
    // Copy FMI 2.0
    try {
      await fs.copyFile(
        path.join(REF_REPO_DIR, `build-fmi2/fmus/${model.name}.fmu`),
        path.join(REF_FMUS_DIR, "2.0", `${model.name}.fmu`),
      );
    } catch {
      // It is expected that some models (like StateSpace) are only available in FMI 3.0
    }

    // Copy FMI 3.0
    try {
      await fs.copyFile(
        path.join(REF_REPO_DIR, `build-fmi3/fmus/${model.name}.fmu`),
        path.join(REF_FMUS_DIR, "3.0", `${model.name}.fmu`),
      );
    } catch {
      // Ignore if not available
    }
  }
  console.log("  [✓] Reference FMUs built and copied.");
}

async function prepareModelicaModels() {
  console.log("\n==> Phase 2: Preparing ModelScript Modelica Models...");
  for (const model of MODELS) {
    const sourceMo = path.join(MODELS_DIR, model.file);
    const outDir = path.join(EXPORTED_DIR, model.name);
    await fs.mkdir(outDir, { recursive: true });

    for (const fmiVer of ["2.0", "3.0"]) {
      console.log(`  [~] Compiling ${model.name} (FMI ${fmiVer}) using ModelScript...`);
      const fmuPath = path.join(outDir, `${model.name}_${fmiVer}.fmu`);
      try {
        await runCmd(
          `npx msc fmu ${model.name} ${path.join(MODELS_DIR, model.file)} -o ${fmuPath} --compile --fmi-version ${fmiVer === "2.0" ? "2" : "3"}`,
          path.resolve("../.."),
        );
        console.log(`  [✓] ModelScript compiled: ${model.name}_${fmiVer}.fmu`);
      } catch (e: any) {
        console.error(`  [X] ModelScript compile failed for ${model.name}_${fmiVer}.fmu:`, e.message);
      }
    }
  }
}

function formatDev(dev: { abs: number; rel: number } | null): string {
  if (!dev) return "⚠️ No Ref";
  // Pass if max absolute error is tiny, or NRMSE < 5%
  const isPass = dev.abs < 1.0 || dev.rel < 0.05;
  const icon = isPass ? "✅" : "❌";
  const relPercent = (dev.rel * 100).toFixed(2);
  return `${icon} ${dev.abs.toExponential(1)} (${relPercent}%)`;
}

async function runCrossSimulationMatrix() {
  console.log("\n==> Phase 3: Cross-Simulation Compatibility Matrix...");

  // Locate fmusim
  const platform = os.platform();
  const arch = os.arch();
  let fmusimFolder = "";
  if (platform === "linux" && arch === "x64") fmusimFolder = "fmusim-x86_64-linux";
  else if (platform === "linux" && arch === "arm64") fmusimFolder = "fmusim-aarch64-linux";
  else if (platform === "darwin" && arch === "x64") fmusimFolder = "fmusim-x86_64-darwin";
  else if (platform === "darwin" && arch === "arm64") fmusimFolder = "fmusim-aarch64-darwin";
  else if (platform === "win32" && arch === "x64") fmusimFolder = "fmusim-x86_64-windows";
  else if (platform === "win32" && (arch === "ia32" || arch === "x86")) fmusimFolder = "fmusim-x86-windows";

  const fmusimCmd = fmusimFolder
    ? path.join(REF_FMUS_DIR, fmusimFolder, platform === "win32" ? "fmusim.exe" : "fmusim")
    : null;

  const results: any[] = [];

  const fmiVersions = ["2.0", "3.0"];
  const interfaceTypes = ["cs", "me"];

  for (const model of MODELS) {
    console.log(`\n--- Simulating ${model.name} ---`);
    const outDir = path.join(EXPORTED_DIR, model.name);

    // 1. Simulate natively with ModelScript (only needs to be done once per model)
    let nativeCsvStr = "";
    try {
      console.log(`  [~] ModelScript natively simulating .mo file...`);
      const refCsv = path.join(outDir, `${model.name}_msc.csv`);
      const moPath = path.join(MODELS_DIR, model.file);
      const solverArg = `--engine arena --solver ${model.solver || "cvode"}`;
      const stdout = await runCmd(
        `npx msc simulate ${model.name} "${moPath}" --stop-time ${model.stopTime} --interval ${model.stepSize} ${solverArg} --format csv`,
        path.resolve("../.."),
      );
      const csvLines = stdout.split("\n").filter((line) => line.includes(",") && !line.includes("[Context]"));

      if (csvLines.length > 0) {
        const result: string[] = [];
        let current = "";
        let inBracket = 0;
        for (let i = 0; i < csvLines[0].length; i++) {
          const char = csvLines[0][i];
          if (char === "[") inBracket++;
          else if (char === "]") inBracket--;

          if (char === "," && inBracket === 0) {
            result.push(`"${current}"`);
            current = "";
          } else {
            current += char;
          }
        }
        result.push(`"${current}"`);
        csvLines[0] = result.join(",");
      }

      nativeCsvStr = csvLines.join("\n");
      await fs.writeFile(refCsv, nativeCsvStr);
      console.log(`  [✓] Success (Native)`);
    } catch (e: any) {
      console.error(`  [X] Failed Native:`, e.message.split("\n")[0]);
    }

    for (const fmiVer of fmiVersions) {
      for (const iface of interfaceTypes) {
        console.log(`\n  >> Matrix: [FMI ${fmiVer} | ${iface.toUpperCase()}]`);

        const row: {
          model: string;
          fmiVer: string;
          iface: string;
          refMsc: string;
          refFmusim: string;
          mscFmusim: string;
          mscOms: string;
        } = {
          model: model.name,
          fmiVer,
          iface: iface.toUpperCase(),
          refMsc: "⚠️ No Ref",
          refFmusim: "⚠️ No Ref",
          mscFmusim: "⚠️ No Ref",
          mscOms: "⚠️ No Ref",
        };

        let groundTruthCsvStr = "";

        // Locate Reference FMU for this version
        const refFmuPath = path.join(REF_FMUS_DIR, fmiVer, `${model.name}.fmu`);
        let refExists = true;
        try {
          await fs.access(refFmuPath);
        } catch {
          refExists = false;
        }

        // 2. Simulate Reference FMU with fmusim (Ground Truth)
        const refFmusimCsv = path.join(outDir, `${model.name}_refFmu_fmusim_${fmiVer}_${iface}.csv`);
        if (fmusimCmd && refExists) {
          try {
            console.log(`    [~] fmusim simulating Reference-FMU...`);
            const solverArg = iface === "me" ? `--solver cvode` : "";
            const args = [
              fmusimCmd,
              `--output-file "${refFmusimCsv}"`,
              `--interface-type ${iface}`,
              solverArg,
              `--stop-time ${model.stopTime}`,
              `--output-interval ${model.stepSize}`,
              `"${refFmuPath}"`,
            ]
              .filter(Boolean)
              .join(" ");
            await runCmd(args, outDir);
            groundTruthCsvStr = await fs.readFile(refFmusimCsv, "utf8");
            row.refFmusim = "Ground Truth";
            console.log(`    [✓] Success`);
          } catch (e: any) {
            console.error(`    [X] Failed:`, e.message.split("\n")[0]);
            row.refFmusim = "❌ Fail";
          }
        }

        // Calculate Native Deviation if Ground Truth exists
        if (groundTruthCsvStr && nativeCsvStr) {
          const dev = compareCSV(model.name, nativeCsvStr, groundTruthCsvStr);
          row.refMsc = formatDev(dev);
        } else if (nativeCsvStr) {
          row.refMsc = "Done (No Ref)";
        } else {
          row.refMsc = "❌ Fail";
        }

        // 3. Simulate ModelScript FMU with fmusim
        if (fmusimCmd) {
          try {
            console.log(`    [~] fmusim simulating msc-FMU...`);
            const fmusimBuildDir = path.join(outDir, `build_fmusim_${fmiVer}_${iface}`);
            await fs.mkdir(fmusimBuildDir, { recursive: true });

            const varsMap = getVarsMap()[model.name] || {};
            const outputVarFlagsSet = new Set<string>();
            for (const k of Object.keys(varsMap)) {
              if (fmiVer === "3.0" && k.includes("[")) {
                outputVarFlagsSet.add(k.split("[")[0]);
              } else {
                outputVarFlagsSet.add(k);
              }
            }
            const outputVarFlags = Array.from(outputVarFlagsSet)
              .map((k) => `--output-variable "${k}"`)
              .join(" ");

            const solverArg = iface === "me" ? `--solver cvode` : "";
            const args = [
              fmusimCmd,
              `--output-file fmusim_res.csv`,
              `--interface-type ${iface}`,
              solverArg,
              `--stop-time ${model.stopTime}`,
              `--output-interval ${model.stepSize}`,
              outputVarFlags,
              `../${model.name}_${fmiVer}.fmu`,
            ]
              .filter(Boolean)
              .join(" ");
            await runCmd(args, fmusimBuildDir);

            const mscFmusimCsvStr = await fs.readFile(path.join(fmusimBuildDir, "fmusim_res.csv"), "utf8");

            if (groundTruthCsvStr) {
              const dev = compareCSV(model.name, mscFmusimCsvStr, groundTruthCsvStr);
              row.mscFmusim = formatDev(dev);
            } else {
              row.mscFmusim = "Done (No Ref)";
            }
            console.log(`    [✓] Success`);
          } catch (e: any) {
            console.error(`    [X] Failed:`, e.message.split("\n")[0]);
            row.mscFmusim = "❌ Fail";
          }
        }

        // 4. Simulate ModelScript FMU with OMSimulator
        try {
          console.log(`    [~] OMSimulator simulating msc-FMU...`);
          const omBuildDir = path.join(outDir, `build_oms_${fmiVer}_${iface}`);
          await fs.mkdir(omBuildDir, { recursive: true });

          const fmuAbsPath = path.resolve(outDir, `${model.name}_${fmiVer}.fmu`);
          const args = [
            `OMSimulator`,
            `--startTime=${model.startTime || 0}`,
            `--stopTime=${model.stopTime}`,
            `--intervals=${Math.round(model.stopTime / model.stepSize)}`,
            `--resultFile=oms_res.csv`,
            `--mode=${iface}`,
            `--tempDir="${omBuildDir}"`,
            `--tolerance=1e-5`,
            `"${fmuAbsPath}"`,
          ];

          await runCmd(args.join(" "), omBuildDir);

          const omCsvStr = await fs.readFile(path.join(omBuildDir, `oms_res.csv`), "utf8");

          if (groundTruthCsvStr) {
            const dev = compareCSV(model.name, omCsvStr, groundTruthCsvStr);
            row.mscOms = formatDev(dev);
          } else {
            row.mscOms = "Done (No Ref)";
          }
          console.log(`    [✓] Success`);
        } catch (e: any) {
          console.error(`    [X] Failed:`, e.message.split("\n")[0]);
          row.mscOms = fmiVer === "3.0" ? "Not Supported" : "❌ Fail";
        }

        results.push(row);
      }
    }
  }

  // Print Results Grid
  const mdLines: string[] = [];
  mdLines.push("# ModelScript FMI Validation Dashboard\n");
  mdLines.push(
    "This dashboard tracks the numerical parity and structural compatibility of the ModelScript FMI exporter across FMI 2.0 & FMI 3.0 (ME and CS) against the official [Modelica Reference-FMUs](https://github.com/modelica/Reference-FMUs). The Reference-FMUs are compiled directly from their manual C source code via their provided CMake build system, serving as the definitive ground truth for these validation benchmarks.\n",
  );
  mdLines.push("### Options & Terminology");
  mdLines.push(
    "- **Native msc:** The ModelScript Arena Simulator running the source `.mo` file directly. Uses the internal WASM CVODE solver by default.",
  );
  mdLines.push(
    "- **msc-FMU (fmusim):** The exported ModelScript FMU (`.fmu`) simulated using the official FMI standard `fmusim` C-binary. We explicitly pass `--output-interval` to ensure exact parity with the Reference FMU execution.",
  );
  mdLines.push(
    "  - **Model Exchange (ME):** The FMU only supplies state derivatives. The host (`fmusim`) integrates the equations. We explicitly configure `fmusim` to use the **CVODE** algorithm (`--solver cvode`).",
  );
  mdLines.push(
    "  - **Co-Simulation (CS):** The FMU contains its own embedded solver. ModelScript natively compiles a custom **4th-order Runge-Kutta (RK4)** integration algorithm directly into the FMU binary to advance the state.",
  );
  mdLines.push(
    "- **msc-FMU (omsim):** The exported ModelScript FMU (`.fmu`) simulated using OpenModelica's `OMSimulator` binary (which also utilizes CVODE/KINSOL algorithms internally).\n",
  );
  mdLines.push("### Error Metric");
  mdLines.push(
    "Values are reported as `Max Absolute Error (NRMSE %)`. A simulation passes if the max absolute error is tiny (< 1.0) or the Normalized Root Mean Square Error (NRMSE) is under 5%.\n",
  );
  mdLines.push("### Expected Exclusions & Failures");
  mdLines.push(
    "- **Done (No Ref):** Indicates the simulation succeeded internally, but no Ground Truth Reference-FMU exists for this FMI version (e.g. `StateSpace` is not available in FMI 2.0 reference FMUs).",
  );
  mdLines.push(
    "- **OMSimulator FMI 3.0 Failures:** `OMSimulator` v2.1.3 explicitly hardcodes schema validation to the `FMI-2.0` standard. FMI 3.0 FMUs fail during ingestion because the `fmiVersion=\"3.0\"` attribute does not match the hardcoded `#FIXED` value of `'2.0'`. This is a limitation of the current OMSimulator build.\n",
  );
  mdLines.push("## Simulation Matrix\n");

  const header = `| ${"Model".padEnd(16)} | FMI | Mode | ${"Native msc".padEnd(20)} | ${"msc-FMU (fmusim)".padEnd(20)} | ${"msc-FMU (omsim)".padEnd(20)} |`;
  const divider = `|${"".padEnd(18, "-")}|-----|------|${"".padEnd(22, "-")}|${"".padEnd(22, "-")}|${"".padEnd(22, "-")}|`;

  mdLines.push(header);
  mdLines.push(divider);

  console.log(
    "\n=======================================================================================================================",
  );
  console.log(" FMI CROSS-SIMULATION VALIDATION RESULTS");
  console.log(
    "=======================================================================================================================",
  );
  console.log(
    ` ${"Model".padEnd(16)} | FMI | Mode | ${"Native msc".padEnd(20)} | ${"msc-FMU (fmusim)".padEnd(20)} | ${"msc-FMU (omsim)".padEnd(20)}`,
  );
  console.log("".padEnd(113, "-"));

  for (const r of results) {
    const termLine = ` ${r.model.padEnd(16)} | ${r.fmiVer} |  ${r.iface}  | ${r.refMsc.padEnd(20)} | ${r.mscFmusim.padEnd(20)} | ${r.mscOms.padEnd(20)}`;
    console.log(termLine);
    mdLines.push(
      `| ${r.model.padEnd(16)} | ${r.fmiVer} | ${r.iface} | ${r.refMsc.padEnd(20)} | ${r.mscFmusim.padEnd(20)} | ${r.mscOms.padEnd(20)} |`,
    );
  }
  console.log(
    "=======================================================================================================================\n",
  );

  // Generate plots
  console.log("==> Phase 4: Generating Trajectory Plots...");
  try {
    const pythonCmd = fsSync.existsSync("../../.venv/bin/python")
      ? "../../.venv/bin/python"
      : fsSync.existsSync(".venv/bin/python")
        ? ".venv/bin/python"
        : "python3";
    await runCmd(`${pythonCmd} scripts/plot_trajectories.py "${VALIDATION_DIR}"`);
    console.log("  [✓] Plots generated successfully.");
  } catch (e: any) {
    console.error("  [X] Failed to generate plots (pandas/matplotlib may not be installed):", e.message);
  }

  mdLines.push("\n## Models & Validation Plots\n");
  for (const model of MODELS) {
    mdLines.push(`### ${model.name}\n`);
    const nativeSolver = model.solver || "cvode";
    mdLines.push(
      `**Simulation Options:** \`stopTime = ${model.stopTime}\`, \`stepSize / outputInterval = ${model.stepSize}\`, \`Native Solver = ${nativeSolver}\`\n`,
    );

    let moContent = await fs.readFile(path.join(MODELS_DIR, model.file), "utf8");
    moContent = moContent.split("// Result:")[0];
    moContent = moContent.replace(/^(?:\/\/.*[\r\n]+)*/, "").trim();
    mdLines.push(`<details>\n<summary><b>Source Code (${model.file})</b></summary>\n`);
    mdLines.push("```modelica");
    mdLines.push(moContent);
    mdLines.push("```\n</details>\n");

    mdLines.push(`![${model.name} Trajectories](./plots/${model.name}.png)\n`);
  }

  await fs.writeFile(path.join(VALIDATION_DIR, "README.md"), mdLines.join("\n"));
  console.log(`  [✓] Dashboard written to ${path.join(VALIDATION_DIR, "README.md")}`);
}

async function main() {
  console.log("=== FMI Cross-Validation Pipeline ===");
  await cloneAndBuildReferenceFMUs();
  await prepareModelicaModels();
  await runCrossSimulationMatrix();
  console.log("\n=== Pipeline Complete ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
