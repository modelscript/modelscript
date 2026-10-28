// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";

interface SpiceSimulateArgs {
  file: string;
  analysis?: "op" | "tran" | "ac" | undefined;
  tstep?: number | undefined;
  tstop?: number | undefined;
  format: "table" | "json" | "csv";
  out?: string | undefined;
}

interface SpiceLintArgs {
  file: string;
  format: "pretty" | "json";
}

interface SpiceToModelicaArgs {
  file: string;
  out?: string | undefined;
}

interface SpiceToEcadArgs {
  file: string;
  out?: string | undefined;
}

export const SpiceSimulateCommand: CommandModule<{}, SpiceSimulateArgs> = {
  command: "simulate <file>",
  aliases: ["solve <file>", "sim <file>", "solve", "sim"],
  describe: "Simulate SPICE netlist with DC operating point (.OP), transient (.TRAN), or AC frequency response (.AC)",
  builder: (yargs) =>
    yargs
      .positional("file", {
        demandOption: true,
        description: "Path to SPICE netlist (.cir, .sp, .net, .lib)",
        type: "string",
      })
      .option("analysis", {
        alias: "a",
        description: "Analysis type (op, tran, ac). Defaults to directives defined in netlist",
        choices: ["op", "tran", "ac"],
        type: "string",
      })
      .option("tstep", {
        description: "Transient step size (seconds)",
        type: "number",
      })
      .option("tstop", {
        description: "Transient stop time (seconds)",
        type: "number",
      })
      .option("format", {
        alias: "f",
        description: "Output format",
        choices: ["table", "json", "csv"],
        default: "table",
      })
      .option("out", {
        alias: "o",
        description: "Write results to output file",
        type: "string",
      }) as unknown as Argv<SpiceSimulateArgs>,
  handler: async (args) => {
    const { parseSpice, solveOp, solveTran, solveAc } = await import("@modelscript/spice");

    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const circuit = parseSpice(content);

    // Determine analysis mode
    let mode = args.analysis;
    if (!mode) {
      if (
        circuit.directives.some((d) => d.kind === ".TRAN") ||
        (args.tstep !== undefined && args.tstop !== undefined)
      ) {
        mode = "tran";
      } else if (circuit.directives.some((d) => d.kind === ".AC")) {
        mode = "ac";
      } else {
        mode = "op";
      }
    }

    if (mode === "op") {
      const result = solveOp(circuit);
      if (!result.converged) {
        console.error("Error: DC Operating Point did not converge.");
        process.exit(1);
      }

      if (args.format === "json") {
        const payload = {
          converged: result.converged,
          iterations: result.iterations,
          nodeVoltages: Object.fromEntries(result.nodeVoltages),
          branchCurrents: Object.fromEntries(result.branchCurrents),
        };
        const jsonStr = JSON.stringify(payload, null, 2);
        if (args.out) {
          fs.writeFileSync(path.resolve(process.cwd(), args.out), jsonStr, "utf-8");
          console.log(`Saved OP results to ${args.out}`);
        } else {
          console.log(jsonStr);
        }
      } else {
        console.log(`\n\x1b[1mSPICE DC Operating Point (.OP):\x1b[0m ${circuit.title}`);
        console.log(`Iterations: ${result.iterations}\n`);
        console.log("\x1b[4mNode\x1b[0m          \x1b[4mVoltage (V)\x1b[0m");
        for (const [node, v] of result.nodeVoltages.entries()) {
          console.log(`${node.padEnd(14)} ${v >= 0 ? " " : ""}${v.toFixed(6)} V`);
        }
        if (result.branchCurrents.size > 0) {
          console.log("\n\x1b[4mSource\x1b[0m        \x1b[4mCurrent (A)\x1b[0m");
          for (const [src, i] of result.branchCurrents.entries()) {
            console.log(`${src.padEnd(14)} ${i >= 0 ? " " : ""}${i.toExponential(4)} A`);
          }
        }
      }
    } else if (mode === "tran") {
      const opts: NonNullable<Parameters<typeof solveTran>[1]> = {};
      if (args.tstep !== undefined) opts.tstep = args.tstep;
      if (args.tstop !== undefined) opts.tstop = args.tstop;

      const result = solveTran(circuit, opts);

      if (args.format === "json") {
        const payload = {
          time: result.time,
          nodeVoltages: Object.fromEntries(result.nodeVoltages),
          branchCurrents: Object.fromEntries(result.branchCurrents),
        };
        const jsonStr = JSON.stringify(payload, null, 2);
        if (args.out) {
          fs.writeFileSync(path.resolve(process.cwd(), args.out), jsonStr, "utf-8");
          console.log(`Saved transient results to ${args.out}`);
        } else {
          console.log(jsonStr);
        }
      } else if (args.format === "csv") {
        const nodes = Array.from(result.nodeVoltages.keys());
        const header = ["time", ...nodes.map((n) => `V(${n})`)].join(",");
        const rows = [header];
        for (let i = 0; i < result.time.length; i++) {
          const rowVals = [
            result.time[i]!.toExponential(5),
            ...nodes.map((n) => result.nodeVoltages.get(n)![i]!.toFixed(6)),
          ];
          rows.push(rowVals.join(","));
        }
        const csvStr = rows.join("\n");
        if (args.out) {
          fs.writeFileSync(path.resolve(process.cwd(), args.out), csvStr, "utf-8");
          console.log(`Saved CSV results to ${args.out}`);
        } else {
          console.log(csvStr);
        }
      } else {
        console.log(`\n\x1b[1mSPICE Transient Analysis (.TRAN):\x1b[0m ${circuit.title}`);
        console.log(`Time points simulated: ${result.time.length}`);
        const nodes = Array.from(result.nodeVoltages.keys());
        console.log(`Monitored nodes: ${nodes.join(", ")}`);
        if (result.time.length > 0) {
          const lastIdx = result.time.length - 1;
          console.log(`Final simulated time: ${result.time[lastIdx]!.toExponential(4)} s`);
          for (const n of nodes) {
            console.log(`  V(${n}) = ${result.nodeVoltages.get(n)![lastIdx]!.toFixed(6)} V`);
          }
        }
      }
    } else if (mode === "ac") {
      const result = solveAc(circuit);

      if (args.format === "json") {
        const voltagesObj: Record<string, unknown> = {};
        for (const [k, v] of result.nodeVoltages.entries()) {
          voltagesObj[k] = v;
        }
        const payload = {
          frequency: result.frequency,
          nodeVoltages: voltagesObj,
        };
        const jsonStr = JSON.stringify(payload, null, 2);
        if (args.out) {
          fs.writeFileSync(path.resolve(process.cwd(), args.out), jsonStr, "utf-8");
          console.log(`Saved AC results to ${args.out}`);
        } else {
          console.log(jsonStr);
        }
      } else {
        console.log(`\n\x1b[1mSPICE AC Frequency Sweep (.AC):\x1b[0m ${circuit.title}`);
        console.log(`Frequency points: ${result.frequency.length}`);
        const nodes = Array.from(result.nodeVoltages.keys());
        console.log(`Monitored nodes: ${nodes.join(", ")}`);
      }
    }
  },
};

export const SpiceLintCommand: CommandModule<{}, SpiceLintArgs> = {
  command: "lint <file>",
  aliases: ["check <file>", "validate <file>", "check", "validate"],
  describe: "Perform pre-flight structural and electrical rule checks on SPICE netlist",
  builder: (yargs) =>
    yargs
      .positional("file", {
        demandOption: true,
        description: "Path to SPICE netlist (.cir, .sp, .net, .lib)",
        type: "string",
      })
      .option("format", {
        alias: "f",
        description: "Output format",
        choices: ["pretty", "json"],
        default: "pretty",
      }) as unknown as Argv<SpiceLintArgs>,
  handler: async (args) => {
    const { parseSpice, lintSpiceCircuit } = await import("@modelscript/spice");

    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    let circuit;
    try {
      circuit = parseSpice(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\x1b[31mFatal SPICE Syntax Error:\x1b[0m ${msg}`);
      process.exit(1);
    }

    const diags = lintSpiceCircuit(circuit);

    if (args.format === "json") {
      console.log(JSON.stringify(diags, null, 2));
    } else {
      console.log(
        `\n\x1b[1mSPICE Pre-Flight Lint:\x1b[0m ${path.basename(filePath)} (${circuit.components.length} components)`,
      );
      if (diags.length === 0) {
        console.log("\x1b[32m✔ No structural or electrical violations found.\x1b[0m\n");
        return;
      }

      console.log(`Found ${diags.length} diagnostic issue(s):\n`);
      for (const d of diags) {
        const color = d.severity === "error" ? "\x1b[31m" : d.severity === "warning" ? "\x1b[33m" : "\x1b[34m";
        const loc = d.span ? `:${d.span.startLine}:${d.span.startCol}` : "";
        console.log(`  ${color}[M${d.code}]\x1b[0m ${filePath}${loc} - ${d.message}`);
        if (d.quickFix) {
          console.log(`    \x1b[90mQuick-fix available: ${d.quickFix.title}\x1b[0m`);
        }
      }
      console.log("");
    }

    const errorCount = diags.filter((d) => d.severity === "error").length;
    if (errorCount > 0) {
      process.exit(1);
    }
  },
};

export const SpiceToModelicaCommand: CommandModule<{}, SpiceToModelicaArgs> = {
  command: "to-modelica <file>",
  describe: "Translate SPICE netlist to idiomatic Modelica 3.x electrical components and connections",
  builder: (yargs) =>
    yargs
      .positional("file", {
        demandOption: true,
        description: "Path to SPICE netlist (.cir, .sp, .net, .lib)",
        type: "string",
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output .mo file path",
        type: "string",
      }) as unknown as Argv<SpiceToModelicaArgs>,
  handler: async (args) => {
    const { parseSpice, spiceToModelica } = await import("@modelscript/spice");

    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const circuit = parseSpice(content);
    const moCode = spiceToModelica(circuit);

    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), moCode, "utf-8");
      console.log(`Saved Modelica model to ${args.out}`);
    } else {
      console.log(moCode);
    }
  },
};

const SpiceToEcadCommand: CommandModule<{}, SpiceToEcadArgs> = {
  command: "to-ecad <file>",
  describe: "Project SPICE netlist to ECAD NetlistGraph for PCB routing and design rule checking",
  builder: (yargs) =>
    yargs
      .positional("file", {
        demandOption: true,
        description: "Path to SPICE netlist (.cir, .sp, .net, .lib)",
        type: "string",
      })
      .option("out", {
        alias: "o",
        description: "Output JSON file path",
        type: "string",
      }) as unknown as Argv<SpiceToEcadArgs>,
  handler: async (args) => {
    const { parseSpice, spiceToNetlistGraph } = await import("@modelscript/spice");

    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const circuit = parseSpice(content);
    const graph = spiceToNetlistGraph(circuit);

    const jsonStr = JSON.stringify(graph, null, 2);
    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), jsonStr, "utf-8");
      console.log(`Saved ECAD NetlistGraph to ${args.out}`);
    } else {
      console.log(jsonStr);
    }
  },
};

interface SpiceSyncArgs {
  file: string;
  fromModelica: string;
  strategy?: "target-wins" | "source-wins" | "physics-simplex";
  out?: string | undefined;
}

const SpiceSyncCommand: CommandModule<{}, SpiceSyncArgs> = {
  command: "sync <file>",
  describe: "Synchronize tuned parameters and topology from Modelica 3.x back into SPICE netlist",
  builder: (yargs) =>
    yargs
      .positional("file", {
        demandOption: true,
        description: "Path to SPICE netlist (.cir, .sp, .net, .lib)",
        type: "string",
      })
      .option("from-modelica", {
        demandOption: true,
        description: "Path to Modelica model file to synchronize from",
        type: "string",
      })
      .option("strategy", {
        description: "Conflict reconciliation strategy",
        choices: ["target-wins", "source-wins", "physics-simplex"],
        default: "target-wins",
        type: "string",
      })
      .option("out", {
        alias: "o",
        description: "Output file path (default: in-place)",
        type: "string",
      }) as unknown as Argv<SpiceSyncArgs>,
  handler: async (args) => {
    const { synchronizeModelicaToSpice } = await import("@modelscript/spice");
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }
    const moPath = path.resolve(process.cwd(), args.fromModelica);
    if (!fs.existsSync(moPath)) {
      console.error(`Error: Modelica file not found: ${args.fromModelica}`);
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const moContent = fs.readFileSync(moPath, "utf-8");
    const strategy = (args.strategy ?? "target-wins") as NonNullable<
      Parameters<typeof synchronizeModelicaToSpice>[2]
    >["strategy"];
    const result = synchronizeModelicaToSpice(content, moContent, { strategy });

    console.log(
      `[SPICE Sync] Reconciled ${result.changes.length} change(s) from '${args.fromModelica}' into '${args.file}':`,
    );
    for (const c of result.changes) {
      const prop = c.property ? `.${c.property}` : "";
      console.log(`  - [${c.target}] ${c.elementId}${prop}: ${c.sourceOldVal ?? ""} -> ${c.reconciledVal}`);
    }

    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), result.updatedText, "utf-8");
      console.log(`Saved synchronized netlist to ${args.out}`);
    } else {
      fs.writeFileSync(filePath, result.updatedText, "utf-8");
      console.log(`Updated in-place: ${args.file}`);
    }
  },
};

interface SpiceInspectArgs {
  file: string;
  format: "pretty" | "json";
  out?: string | undefined;
}

export const SpiceInspectCommand: CommandModule<{}, SpiceInspectArgs> = {
  command: "inspect <file>",
  aliases: ["summary <file>", "summary"],
  describe: "Inspect circuit topology, component breakdown by kind, nodes, models, subcircuits, and directives",
  builder: (yargs) =>
    yargs
      .positional("file", {
        demandOption: true,
        description: "Path to SPICE netlist (.cir, .sp, .net, .lib)",
        type: "string",
      })
      .option("format", {
        alias: "f",
        description: "Output format",
        choices: ["pretty", "json"],
        default: "pretty",
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Write summary to output JSON file",
        type: "string",
      }) as unknown as Argv<SpiceInspectArgs>,
  handler: async (args) => {
    const { parseSpice } = await import("@modelscript/spice");

    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const circuit = parseSpice(content);

    const kindCounts: Record<string, number> = {};
    for (const c of circuit.components) {
      kindCounts[c.kind] = (kindCounts[c.kind] ?? 0) + 1;
    }
    const nodes = new Set<string>();
    for (const c of circuit.components) {
      for (const n of c.nodes) nodes.add(n);
    }

    const payload = {
      title: circuit.title,
      componentsCount: circuit.components.length,
      componentsByKind: kindCounts,
      nodes: Array.from(nodes),
      nodeCount: nodes.size,
      models: Array.from(circuit.models.keys()),
      subcircuits: Array.from(circuit.subcircuits.keys()),
      directives: circuit.directives.map((d) => d.kind),
    };

    if (args.format === "json") {
      const jsonStr = JSON.stringify(payload, null, 2);
      if (args.out) {
        fs.writeFileSync(path.resolve(process.cwd(), args.out), jsonStr, "utf-8");
        console.log(`Saved SPICE netlist summary to ${args.out}`);
      } else {
        console.log(jsonStr);
      }
    } else {
      console.log(`\n\x1b[1mSPICE Netlist Summary:\x1b[0m ${circuit.title || path.basename(filePath)}`);
      const breakdown = Object.entries(kindCounts)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      console.log(`  Components:  ${circuit.components.length}${breakdown ? ` (${breakdown})` : ""}`);
      const nodeList = Array.from(nodes).slice(0, 10).join(", ");
      console.log(`  Nodes:       ${nodes.size}${nodeList ? ` (${nodeList}${nodes.size > 10 ? "..." : ""})` : ""}`);
      console.log(`  Models:      ${circuit.models.size}`);
      console.log(`  Subcircuits: ${circuit.subcircuits.size}`);
      const dirList = circuit.directives.map((d) => d.kind).join(", ");
      console.log(`  Directives:  ${circuit.directives.length}${dirList ? ` (${dirList})` : ""}\n`);
      if (args.out) {
        fs.writeFileSync(path.resolve(process.cwd(), args.out), JSON.stringify(payload, null, 2), "utf-8");
        console.log(`Saved SPICE netlist summary to ${args.out}`);
      }
    }
  },
};

interface SpiceToDaeArgs {
  file: string;
  format: "pretty" | "json";
  out?: string | undefined;
}

export const SpiceToDaeCommand: CommandModule<{}, SpiceToDaeArgs> = {
  command: "to-dae <file>",
  describe: "Lower SPICE netlist directly into zero-GC linear-memory DAE arena",
  builder: (yargs) =>
    yargs
      .positional("file", {
        demandOption: true,
        description: "Path to SPICE netlist (.cir, .sp, .net, .lib)",
        type: "string",
      })
      .option("format", {
        alias: "f",
        description: "Output format",
        choices: ["pretty", "json"],
        default: "pretty",
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output JSON file for DAE metadata",
        type: "string",
      }) as unknown as Argv<SpiceToDaeArgs>,
  handler: async (args) => {
    const { parseSpice, lowerSpiceToDae } = await import("@modelscript/spice");

    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const circuit = parseSpice(content);
    const arena = lowerSpiceToDae(circuit);

    const payload = {
      title: circuit.title,
      varCount: arena.getVarCount(),
      eqCount: arena.getEqCount(),
    };

    if (args.format === "json") {
      const jsonStr = JSON.stringify(payload, null, 2);
      if (args.out) {
        fs.writeFileSync(path.resolve(process.cwd(), args.out), jsonStr, "utf-8");
        console.log(`Saved DAE metadata to ${args.out}`);
      } else {
        console.log(jsonStr);
      }
    } else {
      console.log(`\n\x1b[1mLowered SPICE netlist into linear DAE arena:\x1b[0m ${circuit.title}`);
      console.log(`  Variables: ${payload.varCount}`);
      console.log(`  Equations: ${payload.eqCount}`);
      if (args.out) {
        fs.writeFileSync(path.resolve(process.cwd(), args.out), JSON.stringify(payload, null, 2), "utf-8");
        console.log(`Saved DAE metadata to ${args.out}`);
      }
    }
  },
};

interface SpiceDiagramArgs {
  file: string;
  format: "svg" | "json";
  out?: string | undefined;
}

export const SpiceDiagramCommand: CommandModule<{}, SpiceDiagramArgs> = {
  command: "diagram <file>",
  aliases: ["render <file>", "render"],
  describe: "Render SPICE circuit schematic diagram to standalone vector SVG or JSON graph",
  builder: (yargs) =>
    yargs
      .positional("file", {
        demandOption: true,
        description: "Path to SPICE netlist (.cir, .sp, .net, .lib)",
        type: "string",
      })
      .option("format", {
        alias: "f",
        description: "Output format (svg or json)",
        choices: ["svg", "json"],
        default: "svg",
      })
      .option("out", {
        alias: "o",
        description: "Output file path (e.g., schematic.svg or graph.json)",
        type: "string",
      }) as unknown as Argv<SpiceDiagramArgs>,
  handler: async (args) => {
    const { parseSpice, renderSpiceSvg, buildSpiceDiagram } = await import("@modelscript/spice");

    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const circuit = parseSpice(content);

    let outputStr: string;
    if (args.format === "json") {
      const graph = buildSpiceDiagram(circuit);
      outputStr = JSON.stringify(graph, null, 2);
    } else {
      outputStr = renderSpiceSvg(circuit);
    }

    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), outputStr, "utf-8");
      console.log(`Saved schematic diagram to ${args.out}`);
    } else {
      console.log(outputStr);
    }
  },
};

export const Spice: CommandModule = {
  command: "spice <action>",
  describe: "SPICE netlist (.cir, .sp, .net) analog & mixed-signal simulation and translation",
  builder: (yargs) => {
    return yargs
      .command(SpiceSimulateCommand)
      .command(SpiceLintCommand)
      .command(SpiceInspectCommand)
      .command(SpiceToModelicaCommand)
      .command(SpiceToEcadCommand)
      .command(SpiceToDaeCommand)
      .command(SpiceDiagramCommand)
      .command(SpiceSyncCommand)
      .demandCommand(
        1,
        "Please specify an action (simulate, lint, inspect, summary, to-modelica, to-ecad, to-dae, diagram, or sync)",
      );
  },
  handler: () => {},
};
