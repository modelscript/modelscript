// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";

interface KiCadLintArgs {
  file: string;
  format: "pretty" | "json";
}

interface KiCadParasiticsArgs {
  file: string;
  tempRise: number;
  format: "table" | "json";
}

interface KiCadConsistencyArgs {
  schematic: string;
  pcb: string;
  format: "pretty" | "json";
}

interface KiCadConvertArgs {
  file: string;
  out?: string | undefined;
}

interface KiCadDrcArgs {
  file: string;
  format: "pretty" | "json";
}

function readRequiredFile(rawPath: string): { filePath: string; content: string } {
  const filePath = path.resolve(process.cwd(), rawPath);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: file not found: ${filePath}`);
    process.exit(1);
  }
  return { filePath, content: fs.readFileSync(filePath, "utf-8") };
}

export const KiCadLintCommand: CommandModule<{}, KiCadLintArgs> = {
  command: "lint <file>",
  describe: "Run ECAD / ERC lints on a KiCad .kicad_pcb or .kicad_sch file",
  builder: (yargs) =>
    yargs
      .positional("file", { demandOption: true, description: "Path to .kicad_pcb or .kicad_sch", type: "string" })
      .option("format", {
        alias: "f",
        choices: ["pretty", "json"],
        default: "pretty",
        type: "string",
      }) as unknown as Argv<KiCadLintArgs>,
  handler: async (args) => {
    const { parseKiCadDocument, lintKiCadBoard, lintKiCadSchematic } = await import("@modelscript/kicad");
    const { content } = readRequiredFile(args.file);
    const doc = parseKiCadDocument(content);
    const diags =
      doc.kind === "kicad_pcb"
        ? lintKiCadBoard(doc)
        : doc.kind === "kicad_sch"
          ? lintKiCadSchematic(doc)
          : doc.diagnostics;

    if (args.format === "json") {
      console.log(JSON.stringify({ kind: doc.kind, diagnostics: diags }, null, 2));
    } else if (diags.length === 0) {
      console.log(`✓ No issues found (${doc.kind})`);
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

export const KiCadParasiticsCommand: CommandModule<{}, KiCadParasiticsArgs> = {
  command: "parasitics <file>",
  describe: "Extract trace RLGC parasitics, microstrip/stripline Z0, and IPC-2221 ampacity from .kicad_pcb",
  builder: (yargs) =>
    yargs
      .positional("file", { demandOption: true, description: "Path to .kicad_pcb", type: "string" })
      .option("temp-rise", {
        default: 10,
        description: "Allowed temperature rise (deg C) for IPC-2221",
        type: "number",
      })
      .option("format", {
        alias: "f",
        choices: ["table", "json"],
        default: "table",
        type: "string",
      }) as unknown as Argv<KiCadParasiticsArgs>,
  handler: async (args) => {
    const { parseKiCadBoard, extractBoardParasitics } = await import("@modelscript/kicad");
    const { content } = readRequiredFile(args.file);
    const board = parseKiCadBoard(content);
    const report = extractBoardParasitics(board, { tempRiseC: args.tempRise });

    if (args.format === "json") {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log("Net | Segs | Length (mm) | R (ohm) | L (nH) | C (pF) | Z0 (ohm) | Imax (A)");
    for (const summary of Object.values(report.nets)) {
      console.log(
        `${summary.net} | ${summary.segmentCount} | ${summary.totalLengthMm.toFixed(2)} | ${summary.totalResistanceOhm.toFixed(4)} | ${summary.totalInductanceNH.toFixed(2)} | ${summary.totalCapacitancePF.toFixed(2)} | ${summary.minImpedanceOhm.toFixed(1)}-${summary.maxImpedanceOhm.toFixed(1)} | ${summary.minMaxCurrentA.toFixed(2)}`,
      );
    }
  },
};

export const KiCadConsistencyCommand: CommandModule<{}, KiCadConsistencyArgs> = {
  command: "consistency <schematic> <pcb>",
  describe: "Verify schematic (.kicad_sch) ↔ PCB (.kicad_pcb) component, value, footprint, and net consistency",
  builder: (yargs) =>
    yargs
      .positional("schematic", { demandOption: true, description: "Path to .kicad_sch", type: "string" })
      .positional("pcb", { demandOption: true, description: "Path to .kicad_pcb", type: "string" })
      .option("format", {
        alias: "f",
        choices: ["pretty", "json"],
        default: "pretty",
        type: "string",
      }) as unknown as Argv<KiCadConsistencyArgs>,
  handler: async (args) => {
    const { parseKiCadSchematic, parseKiCadBoard, verifySchematicPcbConsistency } = await import("@modelscript/kicad");
    const sch = parseKiCadSchematic(readRequiredFile(args.schematic).content);
    const board = parseKiCadBoard(readRequiredFile(args.pcb).content);
    const diags = verifySchematicPcbConsistency(sch, board);

    if (args.format === "json") {
      console.log(JSON.stringify({ diagnostics: diags }, null, 2));
    } else if (diags.length === 0) {
      console.log("✓ Schematic and PCB are consistent");
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

export const KiCadToIpc2581Command: CommandModule<{}, KiCadConvertArgs> = {
  command: "to-ipc2581 <file>",
  describe: "Export a KiCad .kicad_pcb board to IPC-2581C XML",
  builder: (yargs) =>
    yargs.positional("file", { demandOption: true, description: "Path to .kicad_pcb", type: "string" }).option("out", {
      alias: "o",
      description: "Output IPC-2581 XML path",
      type: "string",
    }) as unknown as Argv<KiCadConvertArgs>,
  handler: async (args) => {
    const { parseKiCadBoard, kicadBoardToPcbLayout } = await import("@modelscript/kicad");
    const { compileToIPC2581 } = await import("@modelscript/cad/ecad");
    const { filePath, content } = readRequiredFile(args.file);
    const layout = kicadBoardToPcbLayout(parseKiCadBoard(content));
    const xml = compileToIPC2581(layout, { assemblyName: path.basename(filePath, path.extname(filePath)) });

    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), xml, "utf-8");
      console.log(`Exported IPC-2581C XML to ${args.out}`);
    } else {
      console.log(xml);
    }
  },
};

export const KiCadFromIpc2581Command: CommandModule<{}, KiCadConvertArgs> = {
  command: "from-ipc2581 <file>",
  describe: "Convert an IPC-2581B/C XML board (Altium, Cadence, Siemens, KiCad) to KiCad 8 .kicad_pcb",
  builder: (yargs) =>
    yargs
      .positional("file", { demandOption: true, description: "Path to IPC-2581 .xml/.cvg file", type: "string" })
      .option("out", {
        alias: "o",
        description: "Output .kicad_pcb path",
        type: "string",
      }) as unknown as Argv<KiCadConvertArgs>,
  handler: async (args) => {
    const { exportToKiCadPcb } = await import("@modelscript/kicad");
    const { parseIPC2581 } = await import("@modelscript/cad/ecad");
    const { content } = readRequiredFile(args.file);
    const parsed = parseIPC2581(content);
    const pcbText = exportToKiCadPcb(parsed.layout);

    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), pcbText, "utf-8");
      console.log(`Exported KiCad 8 board to ${args.out}`);
    } else {
      console.log(pcbText);
    }
  },
};

export const KiCadDrcCommand: CommandModule<{}, KiCadDrcArgs> = {
  command: "drc <file>",
  describe: "Run ModelScript PCB Design Rule Checks (DRC) on a .kicad_pcb or IPC-2581 XML board",
  builder: (yargs) =>
    yargs
      .positional("file", {
        demandOption: true,
        description: "Path to .kicad_pcb or IPC-2581 .xml/.cvg",
        type: "string",
      })
      .option("format", {
        alias: "f",
        choices: ["pretty", "json"],
        default: "pretty",
        type: "string",
      }) as unknown as Argv<KiCadDrcArgs>,
  handler: async (args) => {
    const { parseKiCadBoard, kicadBoardToPcbLayout } = await import("@modelscript/kicad");
    const { DEFAULT_DESIGN_RULES, parseIPC2581, runDRC } = await import("@modelscript/cad/ecad");
    const { content } = readRequiredFile(args.file);
    const isXml = content.trimStart().startsWith("<");
    const layout = isXml ? parseIPC2581(content).layout : kicadBoardToPcbLayout(parseKiCadBoard(content));

    const drc = runDRC({
      traces: layout.traces.map((t) => ({
        points: [
          { x: t.start[0], y: t.start[1] },
          { x: t.end[0], y: t.end[1] },
        ],
        width: t.width,
        layer: t.layer,
        netId: t.net,
        selected: false,
      })),
      pads: layout.pads.map((p, idx) => ({
        center: { x: p.center[0], y: p.center[1] },
        width: p.width,
        height: p.height,
        shape: p.shape,
        layer: p.layer,
        netId: p.net,
        component: p.component,
        pinName: `${p.component}.${idx + 1}`,
        selected: false,
      })),
      vias: layout.vias.map((v) => ({
        center: { x: v.center[0], y: v.center[1] },
        outerRadius: v.drill / 2 + v.annularRing,
        drillRadius: v.drill / 2,
        netId: v.net,
        selected: false,
      })),
      boardOutline: (layout.outline?.vertices ?? []).map(([x, y]) => ({ x, y })),
      rules: DEFAULT_DESIGN_RULES,
      expectedNets: new Map(layout.netlist.nets.map((n) => [n.id, n.pins.map((p) => p.name)])),
    });

    if (args.format === "json") {
      console.log(JSON.stringify(drc, null, 2));
    } else if (drc.violations.length === 0) {
      console.log(`✓ DRC passed (${drc.totalChecks} checks)`);
    } else {
      for (const v of drc.violations) {
        console.log(`[${v.severity.toUpperCase()}] [${v.rule}] ${v.message}`);
      }
    }
    if (drc.violations.some((v) => v.severity === "error")) {
      process.exitCode = 1;
    }
  },
};

export const KiCadToIdxCommand: CommandModule<{}, KiCadConvertArgs> = {
  command: "to-idx <file>",
  describe: "Export a KiCad .kicad_pcb board to ProSTEP iViP IDX v4.0 ECAD-MCAD XML",
  builder: (yargs) =>
    yargs.positional("file", { demandOption: true, description: "Path to .kicad_pcb", type: "string" }).option("out", {
      alias: "o",
      description: "Output IDX .idx/.xml path",
      type: "string",
    }) as unknown as Argv<KiCadConvertArgs>,
  handler: async (args) => {
    const { parseKiCadBoard, kicadBoardToPcbLayout } = await import("@modelscript/kicad");
    const { exportToIdx } = await import("@modelscript/cad/ecad");
    const { filePath, content } = readRequiredFile(args.file);
    const layout = kicadBoardToPcbLayout(parseKiCadBoard(content));
    const xml = exportToIdx(layout, { designName: path.basename(filePath, path.extname(filePath)) });

    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), xml, "utf-8");
      console.log(`Exported IDX v4.0 XML to ${args.out}`);
    } else {
      console.log(xml);
    }
  },
};

export const KiCadToSpecctraCommand: CommandModule<{}, KiCadConvertArgs> = {
  command: "to-specctra <file>",
  describe: "Export a KiCad .kicad_pcb board to Specctra .dsn autorouter format",
  builder: (yargs) =>
    yargs.positional("file", { demandOption: true, description: "Path to .kicad_pcb", type: "string" }).option("out", {
      alias: "o",
      description: "Output Specctra .dsn path",
      type: "string",
    }) as unknown as Argv<KiCadConvertArgs>,
  handler: async (args) => {
    const { parseKiCadBoard, kicadBoardToPcbLayout } = await import("@modelscript/kicad");
    const { exportToSpecctraDsn } = await import("@modelscript/cad/ecad");
    const { filePath, content } = readRequiredFile(args.file);
    const layout = kicadBoardToPcbLayout(parseKiCadBoard(content));
    const dsn = exportToSpecctraDsn(layout, { designName: path.basename(filePath, path.extname(filePath)) });

    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), dsn, "utf-8");
      console.log(`Exported Specctra DSN to ${args.out}`);
    } else {
      console.log(dsn);
    }
  },
};

export const KiCadToSpiceCommand: CommandModule<{}, KiCadConvertArgs> = {
  command: "to-spice <file>",
  describe: "Export a KiCad .kicad_sch schematic to a SPICE .cir netlist",
  builder: (yargs) =>
    yargs.positional("file", { demandOption: true, description: "Path to .kicad_sch", type: "string" }).option("out", {
      alias: "o",
      description: "Output SPICE .cir path",
      type: "string",
    }) as unknown as Argv<KiCadConvertArgs>,
  handler: async (args) => {
    const { parseKiCadSchematic, exportKiCadSchematicToSpice } = await import("@modelscript/kicad");
    const { filePath, content } = readRequiredFile(args.file);
    const cir = exportKiCadSchematicToSpice(parseKiCadSchematic(content), path.basename(filePath));

    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), cir, "utf-8");
      console.log(`Exported SPICE netlist to ${args.out}`);
    } else {
      console.log(cir);
    }
  },
};

export const KiCad: CommandModule = {
  command: "kicad <action>",
  describe:
    "KiCad ECAD (.kicad_pcb, .kicad_sch) linting, ERC, DRC, RLGC parasitics, consistency, and IPC-2581/IDX/Specctra/SPICE translation",
  builder: (yargs) =>
    yargs
      .command(KiCadLintCommand)
      .command(KiCadParasiticsCommand)
      .command(KiCadConsistencyCommand)
      .command(KiCadDrcCommand)
      .command(KiCadToIpc2581Command)
      .command(KiCadFromIpc2581Command)
      .command(KiCadToIdxCommand)
      .command(KiCadToSpecctraCommand)
      .command(KiCadToSpiceCommand)
      .demandCommand(
        1,
        "Please specify an action (lint, parasitics, consistency, drc, to-ipc2581, from-ipc2581, to-idx, to-specctra, or to-spice)",
      ),
  handler: () => {},
};
