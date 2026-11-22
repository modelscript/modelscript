// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";

interface AtoLintArgs {
  file: string;
  format: "pretty" | "json";
}

interface AtoNetlistArgs {
  file: string;
  entry?: string | undefined;
  out?: string | undefined;
}

function readRequiredAto(rawPath: string): { filePath: string; content: string } {
  const filePath = path.resolve(process.cwd(), rawPath);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: file not found: ${filePath}`);
    process.exit(1);
  }
  return { filePath, content: fs.readFileSync(filePath, "utf-8") };
}

export const AtopileLintCommand: CommandModule<{}, AtoLintArgs> = {
  command: "lint <file>",
  describe: "Lint an atopile (.ato) design and verify worst-case tolerance assertions",
  builder: (yargs) =>
    yargs
      .positional("file", { demandOption: true, description: "Path to .ato file", type: "string" })
      .option("format", {
        alias: "f",
        choices: ["pretty", "json"],
        default: "pretty",
        type: "string",
      }) as unknown as Argv<AtoLintArgs>,
  handler: async (args) => {
    const { parseAtopile, lintAtopile } = await import("@modelscript/atopile");
    const { content } = readRequiredAto(args.file);
    const diags = lintAtopile(parseAtopile(content));

    if (args.format === "json") {
      console.log(JSON.stringify({ diagnostics: diags }, null, 2));
    } else if (diags.length === 0) {
      console.log("✓ No atopile issues found");
    } else {
      for (const d of diags) {
        console.log(`[${d.severity.toUpperCase()}] [${d.code}] ${d.message}`);
      }
    }
    if (diags.some((d) => d.severity === "error")) {
      process.exitCode = 1;
    }
  },
};

export const AtopileNetlistCommand: CommandModule<{}, AtoNetlistArgs> = {
  command: "netlist <file>",
  describe: "Elaborate an atopile (.ato) module into a canonical NetlistGraph + BOM JSON",
  builder: (yargs) =>
    yargs
      .positional("file", { demandOption: true, description: "Path to .ato file", type: "string" })
      .option("entry", { alias: "e", description: "Entry module name", type: "string" })
      .option("out", {
        alias: "o",
        description: "Output JSON path",
        type: "string",
      }) as unknown as Argv<AtoNetlistArgs>,
  handler: async (args) => {
    const { parseAtopile, elaborateAtopile } = await import("@modelscript/atopile");
    const { content } = readRequiredAto(args.file);
    const res = elaborateAtopile(parseAtopile(content), args.entry);
    const json = JSON.stringify({ entryModule: res.entryModule, netlist: res.netlist, bom: res.bom }, null, 2);

    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), json, "utf-8");
      console.log(`Wrote netlist to ${args.out}`);
    } else {
      console.log(json);
    }
  },
};

export const AtopileToIpc2581Command: CommandModule<{}, AtoNetlistArgs> = {
  command: "to-ipc2581 <file>",
  describe: "Elaborate an atopile (.ato) module and export IPC-2581C XML",
  builder: (yargs) =>
    yargs
      .positional("file", { demandOption: true, description: "Path to .ato file", type: "string" })
      .option("entry", { alias: "e", description: "Entry module name", type: "string" })
      .option("out", {
        alias: "o",
        description: "Output IPC-2581 XML path",
        type: "string",
      }) as unknown as Argv<AtoNetlistArgs>,
  handler: async (args) => {
    const { parseAtopile, elaborateAtopile } = await import("@modelscript/atopile");
    const { compileToIPC2581 } = await import("@modelscript/cad/ecad");
    const { content } = readRequiredAto(args.file);
    const res = elaborateAtopile(parseAtopile(content), args.entry);
    const xml = compileToIPC2581(
      { traces: [], pads: [], vias: [], outline: null, netlist: res.netlist, bom: res.bom },
      { assemblyName: res.entryModule || "ATOPILE_DESIGN" },
    );
    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), xml, "utf-8");
      console.log(`Exported IPC-2581C XML to ${args.out}`);
    } else {
      console.log(xml);
    }
  },
};

interface AtoUqArgs {
  file: string;
  entry?: string | undefined;
  samples: number;
  seed: number;
  format: "table" | "json";
}

export const AtopileUqCommand: CommandModule<{}, AtoUqArgs> = {
  command: "uq <file>",
  describe: "Run worst-case corner & Monte Carlo tolerance UQ over atopile (+/- %) physical parameters",
  builder: (yargs) =>
    yargs
      .positional("file", { demandOption: true, description: "Path to .ato file", type: "string" })
      .option("entry", { alias: "e", description: "Entry module name", type: "string" })
      .option("samples", { default: 500, description: "Monte Carlo sample count", type: "number" })
      .option("seed", { default: 42, description: "Deterministic PRNG seed", type: "number" })
      .option("format", {
        alias: "f",
        choices: ["table", "json"],
        default: "table",
        type: "string",
      }) as unknown as Argv<AtoUqArgs>,
  handler: async (args) => {
    const { parseAtopile, runAtopileToleranceUQ } = await import("@modelscript/atopile");
    const { content } = readRequiredAto(args.file);
    const opts: { entryModule?: string; samples: number; seed: number } = {
      samples: args.samples,
      seed: args.seed,
    };
    if (args.entry) opts.entryModule = args.entry;
    const report = runAtopileToleranceUQ(parseAtopile(content), opts);

    if (args.format === "json") {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log("Metric | Nominal | Worst-Case Min | Worst-Case Max | MC Mean | MC StdDev | Unit");
    for (const m of report.metrics) {
      console.log(
        `${m.name} | ${m.nominal.toFixed(4)} | ${m.worstCaseMin.toFixed(4)} | ${m.worstCaseMax.toFixed(4)} | ${m.mcMean.toFixed(4)} | ${m.mcStdDev.toFixed(4)} | ${m.unit}`,
      );
    }
  },
};

export const Atopile: CommandModule = {
  command: "atopile <action>",
  describe: "atopile (.ato) code-first hardware linting, tolerance UQ, netlist elaboration, and IPC-2581 export",
  builder: (yargs) =>
    yargs
      .command(AtopileLintCommand)
      .command(AtopileNetlistCommand)
      .command(AtopileToIpc2581Command)
      .command(AtopileUqCommand)
      .demandCommand(1, "Please specify an action (lint, netlist, to-ipc2581, or uq)"),
  handler: () => {},
};
