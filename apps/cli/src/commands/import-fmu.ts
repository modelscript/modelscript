// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CLI command to import an FMU archive and synthesize a Modelica wrapper model.
 *
 * If FMI 3.0 Terminals and Icons (FMI-LS-TI) metadata is present:
 * - Synthesizes an acausal physical Modelica `model` with multi-domain connectors
 *   (Fluid, Thermal, Electrical, Mechanical)
 * - Prioritizes Model Exchange (ME) over Co-Simulation (CS)
 *
 * If terminals are absent:
 * - Falls back to a standard causal Modelica `block`
 */

import {
  extractFileFromZip,
  generateFmuWrapperModelica,
  parseModelDescription,
  parseTerminalsAndIcons,
  type FmiTerminal,
} from "@modelscript/exchange/fmu";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export interface ImportFmuArgs {
  fmu: string;
  output?: string | undefined;
  package?: string | undefined;
  verbose?: boolean | undefined;
}

export async function runImportFmu(args: ImportFmuArgs): Promise<number> {
  const fmuPath = path.resolve(args.fmu);
  if (!fs.existsSync(fmuPath)) {
    console.error(`Error: FMU archive not found at '${fmuPath}'`);
    return 1;
  }

  const data = fs.readFileSync(fmuPath);

  // Extract modelDescription.xml
  const xmlContent = extractFileFromZip(data, "modelDescription.xml");
  if (!xmlContent) {
    console.error(`Error: Invalid FMU archive — modelDescription.xml not found`);
    return 1;
  }

  const desc = parseModelDescription(xmlContent);

  // Extract terminalsAndIcons.xml (FMI-LS-TI layered standard)
  let terminals: FmiTerminal[] | undefined;
  const terminalsXml =
    extractFileFromZip(data, "terminalsAndIcons/terminalsAndIcons.xml") ??
    extractFileFromZip(data, "terminalsAndIcons.xml") ??
    extractFileFromZip(data, "fmi3TerminalsAndIcons.xml");

  if (terminalsXml) {
    terminals = parseTerminalsAndIcons(terminalsXml);
  } else if (desc.terminals && desc.terminals.length > 0) {
    terminals = desc.terminals;
  }

  const fmuFilename = path.basename(fmuPath);
  const moSource = generateFmuWrapperModelica(desc, fmuFilename, args.package, terminals);

  // Determine output path
  const defaultOutName = `${desc.modelName || path.basename(fmuPath, ".fmu")}.mo`;
  const outputPath = args.output ? path.resolve(args.output) : path.resolve(path.dirname(fmuPath), defaultOutName);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, moSource, "utf-8");

  const isAcausal = terminals && terminals.length > 0;
  console.log(`Successfully generated Modelica wrapper: ${outputPath}`);
  console.log(`  Model: ${desc.modelName}`);
  console.log(`  FMI Version: ${desc.fmiVersion}`);
  console.log(`  Paradigm: ${isAcausal ? "Acausal Physical Model ('model')" : "Causal Signal Block ('block')"}`);
  console.log(`  Target Mode: ${desc.supportsModelExchange ? "Model Exchange (Preferred)" : "Co-Simulation"}`);

  if (isAcausal && terminals) {
    console.log(`  Physical Terminals (${terminals.length}):`);
    for (const term of terminals) {
      console.log(
        `    - ${term.name} [kind: ${term.terminalKind ?? "custom"}, members: ${term.memberVariables.length}]`,
      );
    }
  }

  const totalVars = desc.variables.length;
  console.log(`  Total FMU Variables: ${totalVars}`);

  return 0;
}

export const ImportFmu: CommandModule<{}, ImportFmuArgs> = {
  command: "import-fmu <fmu>",
  aliases: ["fmu-import"],
  describe: "Import an FMU archive and generate an acausal or causal Modelica wrapper",

  builder: ((yargs: any) => {
    return yargs
      .positional("fmu", {
        demandOption: true,
        description: "Path to .fmu archive",
        type: "string",
      })
      .option("output", {
        alias: "o",
        description: "Output path for the generated .mo file",
        type: "string",
      })
      .option("package", {
        alias: "p",
        description: "Enclosing package name (e.g. ImportedFMUs)",
        type: "string",
      })
      .option("verbose", {
        alias: "v",
        description: "Verbose output",
        type: "boolean",
        default: false,
      });
  }) as any,

  handler: async (args) => {
    const code = await runImportFmu(args);
    if (code !== 0) {
      process.exitCode = code;
    }
  },
};
