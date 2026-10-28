// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unified Polyglot Domain Dispatcher (`apps/cli/src/util/domain-dispatcher.ts`).
 *
 * Bridges universal top-level CLI lifecycle verbs (`msx inspect`, `msx lint`,
 * `msx compile --to`, `msx simulate`) and the unified `msx domain <lang> <action>`
 * router across all 44 registered engineering languages without duplicating
 * domain logic.
 */

import fs from "node:fs";
import path from "node:path";
import type { ArgumentsCamelCase, CommandModule } from "yargs";
import { normalizeDomainAction, resolveOutputFormat, resolveOutputPath } from "./cli-options.js";
import { LanguageResolver } from "./language-registry.js";

export interface DomainDispatchOptions {
  language?: string | undefined;
  action: string;
  files: string[];
  output?: string | undefined;
  out?: string | undefined;
  format?: string | undefined;
  json?: boolean | undefined;
  extraArgs?: Record<string, unknown> | undefined;
}

type DomainModuleLoader = () => Promise<CommandModule<Record<string, unknown>, Record<string, unknown>>>;

const DOMAIN_COMMAND_LOADERS: Record<string, DomainModuleLoader> = {
  adams: async () => (await import("../commands/adams.js")).AdamsCommand,
  aspen: async () => (await import("../commands/aspen.js")).AspenCommand,
  autosar: async () => (await import("../commands/autosar.js")).AutosarCommand,
  c: async () => (await import("../commands/c.js")).CCommand,
  ccsds: async () => (await import("../commands/ccsds.js")).CcsdsCommand,
  cfd: async () => (await import("../commands/cfd.js")).CfdCommand,
  easy5: async () => (await import("../commands/easy5.js")).Easy5Command,
  eclipse: async () => (await import("../commands/eclipse.js")).EclipseCommand,
  energyplus: async () => (await import("../commands/energyplus.js")).EnergyPlusCommand,
  epanet: async () => (await import("../commands/epanet.js")).EpanetCommand,
  fea: async () => (await import("../commands/fea.js")).FeaCommand,
  gensys: async () => (await import("../commands/gensys.js")).GensysCommand,
  gtsuite: async () => (await import("../commands/gtsuite.js")).GtSuiteCommand,
  ibis: async () => (await import("../commands/ibis.js")).IbisCommand,
  jsbsim: async () => (await import("../commands/jsbsim.js")).JsbsimCommand,
  lps: async () => (await import("../commands/lps.js")).LpsCommand,
  olga: async () => (await import("../commands/olga.js")).OlgaCommand,
  opendrive: async () => (await import("../commands/opendrive.js")).OpenDriveCommand,
  opendss: async () => (await import("../commands/opendss.js")).OpenDssCommand,
  openscenario: async () => (await import("../commands/openscenario.js")).OpenScenarioCommand,
  plcopen: async () => (await import("../commands/plcopen.js")).PlcopenCommand,
  pscad: async () => (await import("../commands/pscad.js")).PscadCommand,
  psse: async () => (await import("../commands/psse.js")).PsseCommand,
  relap5: async () => (await import("../commands/relap5.js")).Relap5Command,
  rocets: async () => (await import("../commands/rocets.js")).RocetsCommand,
  sbml: async () => (await import("../commands/sbml.js")).SbmlCommand,
  sima: async () => (await import("../commands/sima.js")).SimaCommand,
  simpack: async () => (await import("../commands/simpack.js")).SimpackCommand,
  simulink: async () => (await import("../commands/simulink.js")).SimulinkCommand,
  swmm: async () => (await import("../commands/swmm.js")).SwmmCommand,
  touchstone: async () => (await import("../commands/touchstone.js")).TouchstoneCommand,
  urdf: async () => (await import("../commands/urdf.js")).UrdfCommand,
  "verilog-a": async () => (await import("../commands/verilog-a.js")).VerilogACommand,
};

/**
 * Translates a canonical normalized lifecycle action (`simulate`, `to-sysml2`, `to-modelica`, etc.)
 * into the specific action token expected by a given domain command module.
 */
export function mapActionForDomain(
  langId: string,
  rawAction: string,
): { action: string; extraArgs?: Record<string, unknown> } {
  const normalized = normalizeDomainAction(rawAction);

  if (normalized === "simulate" && rawAction === normalized) {
    switch (langId) {
      case "cfd":
      case "eclipse":
      case "epanet":
      case "fea":
      case "lps":
      case "psse":
        return { action: "solve" };
      case "aspen":
        return { action: "solve-flash" };
      case "autosar":
        return { action: "simulate-rte" };
      case "plcopen":
        return { action: "run-scan" };
      case "c":
        return { action: "step" };
      case "opendss":
        return { action: "powerflow" };
      case "swmm":
        return { action: "route-flow" };
      case "relap5":
        return { action: "kinetics" };
      case "ccsds":
        return { action: "propagate" };
      case "ibis":
        return { action: "eval" };
      case "urdf":
        return { action: "rnea" };
      case "easy5":
        return { action: "linearize" };
      default:
        return { action: "simulate" };
    }
  }

  if (normalized === "to-sysml2") {
    switch (langId) {
      case "autosar":
      case "ccsds":
      case "plcopen":
        return { action: "to-sysml" };
      case "lps":
        return { action: "sysml" };
      case "olga":
        return { action: "convert", extraArgs: { to: "sysml2" } };
      default:
        return { action: "to-sysml2" };
    }
  }

  if (normalized === "to-modelica" && langId === "olga") {
    return { action: "convert", extraArgs: { to: "modelica" } };
  }

  if (normalized === "to-fmu" && langId === "olga") {
    return { action: "fmu" };
  }

  if (normalized === "diagram" && langId === "opendrive") {
    return { action: "render" };
  }

  // Preserve domain-specific specialty actions (e.g. `bode`, `flash`, `passivity`, `rnea`)
  const standardActions = new Set([
    "inspect",
    "lint",
    "to-dae",
    "to-modelica",
    "to-sysml2",
    "to-ssp",
    "to-fmu",
    "simulate",
    "diagram",
  ]);
  if (standardActions.has(normalized)) {
    return { action: normalized };
  }
  return { action: rawAction.trim().toLowerCase() };
}

/**
 * Inspects a generic/core DSL file (`modelica`, `modelscript`, `step`, `scad`, `owl2`, `csv`, `ssp`, `fortran`)
 * and outputs a structured summary in terminal or JSON format.
 */
async function inspectCoreLanguageFile(
  langId: string,
  filePath: string,
  format: "terminal" | "json",
  outPath?: string,
): Promise<void> {
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`Error: file not found: ${absPath}`);
    process.exitCode = 1;
    return;
  }

  const content = fs.readFileSync(absPath, "utf-8");
  const lines = content.split(/\r?\n/);

  const summary: Record<string, unknown> = {
    file: path.basename(absPath),
    language: langId,
    lines: lines.length,
    bytes: Buffer.byteLength(content, "utf-8"),
  };

  if (langId === "modelica" || langId === "modelscript") {
    const withinMatch = content.match(/^\s*within\s+([A-Za-z0-9_.]+)\s*;/m);
    const withinPkg = withinMatch?.[1] ?? null;
    const classMatches = [
      ...content.matchAll(
        /^\s*(?:partial\s+)?(model|class|block|connector|record|package|function|type)\s+([A-Za-z_]\w*)/gm,
      ),
    ];
    const classes: Array<{ kind: string; name: string }> = [];
    for (const m of classMatches) {
      if (m[1] && m[2]) classes.push({ kind: m[1], name: m[2] });
    }
    const equations = (content.match(/^\s*equation\b/gm) ?? []).length;
    const connects = (content.match(/\bconnect\s*\(/g) ?? []).length;
    summary["within"] = withinPkg;
    summary["classes"] = classes;
    summary["classCount"] = classes.length;
    summary["equationSections"] = equations;
    summary["connectCount"] = connects;
  } else if (langId === "step") {
    const entities = content.match(/^#\d+\s*=\s*[A-Z0-9_]+\s*\(/gm) ?? [];
    const schemaMatch = content.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
    summary["schema"] = schemaMatch?.[1] ?? "AUTOMOTIVE_DESIGN";
    summary["entityCount"] = entities.length;
  } else if (langId === "csv") {
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const header = nonEmpty[0]?.split(",").map((c) => c.trim()) ?? [];
    summary["columns"] = header;
    summary["columnCount"] = header.length;
    summary["rowCount"] = Math.max(0, nonEmpty.length - 1);
  } else if (langId === "scad") {
    const modules = [...content.matchAll(/\bmodule\s+([A-Za-z_]\w*)/g)].map((m) => m[1]);
    const functions = [...content.matchAll(/\bfunction\s+([A-Za-z_]\w*)/g)].map((m) => m[1]);
    summary["modules"] = modules;
    summary["functions"] = functions;
  } else if (langId === "owl2") {
    const declarations = (content.match(/\bDeclaration\s*\(/g) ?? []).length;
    const axioms = (
      content.match(/\b(?:SubClassOf|EquivalentClasses|ObjectPropertyDomain|DataPropertyDomain)\s*\(/g) ?? []
    ).length;
    summary["declarations"] = declarations;
    summary["axioms"] = axioms;
  } else if (langId === "fortran") {
    const units = [...content.matchAll(/^\s*(?:program|module|subroutine|function)\s+([A-Za-z_]\w*)/gim)].map(
      (m) => m[1],
    );
    summary["programUnits"] = units;
  }

  try {
    const resolved = await LanguageResolver.resolve(absPath, langId);
    const { parser } = await resolved.loadParser();
    const tree = parser.parse(content);
    summary["hasSyntaxErrors"] = Boolean(tree?.rootNode?.hasError?.());
  } catch {
    // Parser binary optional for lightweight inspection
  }

  if (format === "json") {
    const jsonStr = JSON.stringify(summary, null, 2);
    if (outPath) {
      fs.writeFileSync(path.resolve(process.cwd(), outPath), jsonStr, "utf-8");
    } else {
      console.log(jsonStr);
    }
    return;
  }

  console.log(`=== ${langId.toUpperCase()} Model Summary: ${summary["file"]} ===`);
  console.log(`  Language: ${langId}`);
  console.log(`  Size:     ${summary["lines"]} lines (${summary["bytes"]} bytes)`);
  if (Array.isArray(summary["classes"])) {
    const clsList = (summary["classes"] as Array<{ kind: string; name: string }>)
      .map((c) => `${c.kind} ${c.name}`)
      .join(", ");
    console.log(`  Classes:  ${summary["classCount"]}${clsList ? ` (${clsList})` : ""}`);
    console.log(`  Connects: ${summary["connectCount"]}`);
  } else if (summary["entityCount"] !== undefined) {
    console.log(`  Schema:   ${summary["schema"]}`);
    console.log(`  Entities: ${summary["entityCount"]}`);
  } else if (summary["columnCount"] !== undefined) {
    console.log(`  Columns:  ${summary["columnCount"]} (${(summary["columns"] as string[]).join(", ")})`);
    console.log(`  Rows:     ${summary["rowCount"]}`);
  }
  if (outPath) {
    fs.writeFileSync(path.resolve(process.cwd(), outPath), JSON.stringify(summary, null, 2), "utf-8");
  }
}

/**
 * Dispatches an action (`inspect`, `lint`, `to-dae`, `to-modelica`, `to-sysml2`, `to-ssp`, `to-fmu`,
 * `simulate`, `diagram`, or any domain-specific subcommand) to the appropriate domain handler.
 */
export async function dispatchDomainAction(opts: DomainDispatchOptions): Promise<void> {
  const files = opts.files;
  if (files.length === 0) {
    console.error("Error: Please specify at least one file.");
    process.exitCode = 1;
    return;
  }

  const firstFile = files[0]!;
  const resolved = await LanguageResolver.resolve(firstFile, opts.language);
  const langId = resolved.manifest.id;
  const normalizedAction = normalizeDomainAction(opts.action);
  const outPath = resolveOutputPath({
    output: opts.output,
    out: opts.out,
    ...(opts.extraArgs ?? {}),
  });
  const format = resolveOutputFormat({
    format: opts.format,
    json: opts.json,
    ...(opts.extraArgs ?? {}),
  });

  // 1. Nested-yargs domain commands: spice, reqif, sysml2
  if (langId === "spice") {
    const spiceMod = await import("../commands/spice.js");
    for (const file of files) {
      const baseArgv = {
        _: ["spice", normalizedAction],
        $0: "msx",
        file,
        out: outPath,
        output: outPath,
        format: format === "json" ? "json" : "pretty",
        ...(opts.extraArgs ?? {}),
      };
      if (normalizedAction === "inspect") {
        await spiceMod.SpiceInspectCommand.handler(baseArgv as unknown as ArgumentsCamelCase<never>);
      } else if (normalizedAction === "lint") {
        await spiceMod.SpiceLintCommand.handler(baseArgv as unknown as ArgumentsCamelCase<never>);
      } else if (normalizedAction === "to-modelica") {
        await spiceMod.SpiceToModelicaCommand.handler(baseArgv as unknown as ArgumentsCamelCase<never>);
      } else if (normalizedAction === "to-dae") {
        await spiceMod.SpiceToDaeCommand.handler(baseArgv as unknown as ArgumentsCamelCase<never>);
      } else if (normalizedAction === "diagram") {
        await spiceMod.SpiceDiagramCommand.handler({
          ...baseArgv,
          format: format === "json" ? "json" : "svg",
        } as unknown as ArgumentsCamelCase<never>);
      } else if (normalizedAction === "simulate") {
        await spiceMod.SpiceSimulateCommand.handler({
          ...baseArgv,
          format: format === "json" ? "json" : "table",
        } as unknown as ArgumentsCamelCase<never>);
      } else {
        console.error(`[spice] Unsupported action '${opts.action}'.`);
        process.exitCode = 1;
      }
    }
    return;
  }

  if (langId === "reqif") {
    const reqifMod = await import("../commands/reqif.js");
    for (const file of files) {
      const baseArgv = {
        _: ["reqif", normalizedAction],
        $0: "msx",
        file,
        out: outPath,
        output: outPath,
        format: format === "json" ? "json" : "table",
        ...(opts.extraArgs ?? {}),
      };
      if (normalizedAction === "inspect") {
        await reqifMod.ReqIfImportCommand.handler(baseArgv as unknown as ArgumentsCamelCase<never>);
      } else if (normalizedAction === "lint") {
        await reqifMod.ReqIfLintCommand.handler(baseArgv as unknown as ArgumentsCamelCase<never>);
      } else if (normalizedAction === "to-sysml2") {
        await reqifMod.ReqIfToSysmlCommand.handler(baseArgv as unknown as ArgumentsCamelCase<never>);
      } else if (normalizedAction === "to-modelica") {
        await reqifMod.ReqIfToModelicaCommand.handler(baseArgv as unknown as ArgumentsCamelCase<never>);
      } else {
        console.error(`[reqif] Unsupported action '${opts.action}'.`);
        process.exitCode = 1;
      }
    }
    return;
  }

  if (langId === "sysml2") {
    const sysmlMod = await import("../commands/sysml.js");
    if (normalizedAction === "inspect") {
      for (const file of files) {
        await sysmlMod.SysMLInfoCommand.handler({
          _: ["sysml", "info"],
          $0: "msx",
          file,
          format: format === "json" ? "json" : "table",
        } as unknown as ArgumentsCamelCase<never>);
      }
      return;
    }
    if (normalizedAction === "lint") {
      await sysmlMod.SysMLCheckCommand.handler({
        _: ["sysml", "check"],
        $0: "msx",
        files,
        format: format === "json" ? "json" : "terminal",
      } as unknown as ArgumentsCamelCase<never>);
      return;
    }
    if (normalizedAction === "to-ssp" || normalizedAction === "to-fmu") {
      for (const file of files) {
        await sysmlMod.SysMLExportCommand.handler({
          _: ["sysml", "export"],
          $0: "msx",
          file,
          format: normalizedAction === "to-ssp" ? "ssp" : "fmu",
          output: outPath,
        } as unknown as ArgumentsCamelCase<never>);
      }
      return;
    }
    if (normalizedAction === "to-dae") {
      const { SysML2DaeLowerer } = await import("@modelscript/sysml2");
      let combined = "";
      for (const f of files) {
        combined += fs.readFileSync(path.resolve(process.cwd(), f), "utf-8") + "\n";
      }
      const arena = await SysML2DaeLowerer.lowerSystem(combined);
      const { printArenaDAE } = await import("@modelscript/runtime");
      const text = printArenaDAE(arena);
      if (outPath) {
        fs.writeFileSync(path.resolve(process.cwd(), outPath), text, "utf-8");
      } else {
        process.stdout.write(text);
      }
      return;
    }
  }

  // 2. Standard 33 domain command modules (`<lang> <action> [files...]`)
  const loader = DOMAIN_COMMAND_LOADERS[langId];
  if (loader) {
    const cmdMod = await loader();
    const mapped = mapActionForDomain(langId, opts.action);
    const argvPayload = {
      _: [langId, mapped.action, ...files],
      $0: "msx",
      action: mapped.action,
      files,
      file: firstFile,
      out: outPath,
      output: outPath,
      format: format === "json" ? "json" : (opts.format ?? "terminal"),
      ...(opts.extraArgs ?? {}),
      ...(mapped.extraArgs ?? {}),
    };
    await cmdMod.handler(argvPayload as unknown as ArgumentsCamelCase<Record<string, unknown>>);
    return;
  }

  // 3. Core DSL languages (`modelica`, `modelscript`, `step`, `scad`, `owl2`, `csv`, `ssp`, `fortran`)
  const coreFormat: "terminal" | "json" = format === "json" ? "json" : "terminal";
  if (normalizedAction === "inspect") {
    for (const file of files) {
      await inspectCoreLanguageFile(langId, file, coreFormat, outPath);
    }
    return;
  }

  if (normalizedAction === "lint") {
    const { Lint } = await import("../commands/lint.js");
    await Lint.handler({
      _: ["lint"],
      $0: "msx",
      path: firstFile,
      paths: files.slice(1),
      language: langId,
      format: coreFormat,
    } as unknown as ArgumentsCamelCase<never>);
    return;
  }

  if ((langId === "modelica" || langId === "modelscript") && normalizedAction === "to-dae") {
    const { Compile } = await import("../commands/compile.js");
    await Compile.handler({
      _: ["compile"],
      $0: "msx",
      name: firstFile,
      paths: files.slice(1),
      output: outPath,
      ...(opts.extraArgs ?? {}),
    } as unknown as ArgumentsCamelCase<never>);
    return;
  }

  if ((langId === "modelica" || langId === "modelscript" || langId === "sysml2") && normalizedAction === "simulate") {
    const { Simulate } = await import("../commands/simulate.js");
    await Simulate.handler({
      _: ["simulate"],
      $0: "msx",
      name: firstFile,
      paths: files.slice(1),
      output: outPath,
      format: format === "json" ? "json" : "csv",
      solver: "dopri5",
      engine: "js",
      jacobian: "sparse",
      ...(opts.extraArgs ?? {}),
    } as unknown as ArgumentsCamelCase<never>);
    return;
  }

  console.error(`Action '${opts.action}' is not supported for language '${langId}'.`);
  process.exitCode = 1;
}
