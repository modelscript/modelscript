// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  SysML2ContainerExporter,
  SysML2EnterpriseSyncGateway,
  SysML2ModelInterchange,
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
  getSysML2ErrorCodeDef,
  getSysmlParser,
  loadEmbeddedKerMLStdlib,
} from "@modelscript/sysml2";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

function byteToLineCol(text: string, byteOffset: number): { line: number; col: number } {
  const slice = text.slice(0, Math.max(0, byteOffset));
  const lines = slice.split("\n");
  const line = lines.length;
  const col = (lines[lines.length - 1]?.length ?? 0) + 1;
  return { line, col };
}

interface SysMLExportArgs {
  file: string;
  format: "sysmlx" | "ssp" | "fmu";
  output?: string | undefined;
  description?: string | undefined;
  "include-stdlib"?: boolean | undefined;
}

const SysMLExportCommand: CommandModule<{}, SysMLExportArgs> = {
  command: "export <file>",
  describe: "Export SysML v2 models to OMG standard interchange (.sysmlx), SSP containers, or FMI 3.0 FMUs",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        demandOption: true,
        description: "Path to .sysml source file",
        type: "string",
      })
      .option("format", {
        alias: "f",
        description: "Export format (sysmlx = OMG JSON-LD, ssp = SSP package, fmu = Monolithic FMU)",
        choices: ["sysmlx", "ssp", "fmu"],
        default: "sysmlx",
      })
      .option("output", {
        alias: "o",
        description: "Target output filepath",
        type: "string",
      })
      .option("description", {
        alias: "d",
        description: "System or interchange description metadata",
        type: "string",
      })
      .option("include-stdlib", {
        description: "Include KerML standard library symbols in export",
        type: "boolean",
        default: false,
      }) as any;
  },
  handler: async (args) => {
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`\x1b[31mError:\x1b[0m file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const baseName = path.basename(filePath, path.extname(filePath));

    if (args.format === "sysmlx") {
      const outPath = args.output
        ? path.resolve(process.cwd(), args.output)
        : path.resolve(path.dirname(filePath), `${baseName}.sysmlx`);

      console.log(`\x1b[1m[SysML v2]\x1b[0m Exporting ${args.file} to OMG Model Interchange (.sysmlx)...`);
      const exportOpts: Parameters<typeof SysML2ModelInterchange.exportToSysmlx>[1] = {
        sourceUri: `file://${filePath}`,
      };
      if (args.description) exportOpts.description = args.description;
      if (args["include-stdlib"] !== undefined) exportOpts.includeStandardLibrary = args["include-stdlib"];

      const doc = await SysML2ModelInterchange.exportToSysmlx(content, exportOpts);

      fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf-8");
      const elementCount = doc["@graph"].length;
      console.log(`\x1b[32m✔ Successfully exported\x1b[0m ${elementCount} graph elements to ${outPath}`);
    } else if (args.format === "ssp") {
      const outPath = args.output
        ? path.resolve(process.cwd(), args.output)
        : path.resolve(path.dirname(filePath), `${baseName}.ssp`);

      console.log(`\x1b[1m[SysML v2]\x1b[0m Packaging multi-physics architecture into SSP container...`);
      const sspResult = await SysML2ContainerExporter.exportToSsp(content, {
        description: args.description || `SysML v2 Model: ${baseName}`,
        version: "1.0",
      });

      fs.writeFileSync(outPath, sspResult.archive);
      console.log(
        `\x1b[32m✔ Successfully packaged\x1b[0m ${sspResult.fmuCount} subsystem FMUs into ${outPath} (${(sspResult.archive.length / 1024).toFixed(1)} KB)`,
      );
    } else if (args.format === "fmu") {
      const outPath = args.output
        ? path.resolve(process.cwd(), args.output)
        : path.resolve(path.dirname(filePath), `${baseName}.fmu`);

      console.log(`\x1b[1m[SysML v2]\x1b[0m Generating monolithic FMI 3.0 FMU with layered terminals...`);
      const fmuResult = await SysML2ContainerExporter.exportToFmi3(content, {
        description: args.description || `SysML v2 Monolithic Model: ${baseName}`,
      });

      fs.writeFileSync(outPath, fmuResult.archive);
      console.log(
        `\x1b[32m✔ Successfully generated\x1b[0m FMI 3.0 FMU at ${outPath} (${(fmuResult.archive.length / 1024).toFixed(1)} KB)`,
      );
    }
  },
};

interface SysMLImportArgs {
  file: string;
  output?: string | undefined;
  indent?: number | undefined;
}

const SysMLImportCommand: CommandModule<{}, SysMLImportArgs> = {
  command: "import <file>",
  describe: "Import OMG SysML v2 Model Interchange (.sysmlx) JSON-LD into textual SysML v2",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        demandOption: true,
        description: "Path to .sysmlx or JSON-LD file",
        type: "string",
      })
      .option("output", {
        alias: "o",
        description: "Target output .sysml file path (default prints to stdout if not specified)",
        type: "string",
      })
      .option("indent", {
        description: "Indentation depth in spaces",
        type: "number",
        default: 2,
      }) as any;
  },
  handler: async (args) => {
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`\x1b[31mError:\x1b[0m file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    try {
      JSON.parse(content);
    } catch (err: any) {
      console.error(`\x1b[31mError:\x1b[0m Failed to parse '${args.file}' as valid JSON-LD: ${err.message}`);
      process.exit(1);
    }

    console.log(`\x1b[1m[SysML v2]\x1b[0m Importing OMG Interchange document ${args.file}...`);
    const sysmlText = SysML2ModelInterchange.importFromSysmlx(content, {
      indent: args.indent !== undefined ? Math.max(1, Math.floor(args.indent / 2)) : 1,
    });

    if (args.output) {
      const outPath = path.resolve(process.cwd(), args.output);
      fs.writeFileSync(outPath, sysmlText, "utf-8");
      console.log(`\x1b[32m✔ Reconstructed clean SysML v2 text saved to\x1b[0m ${outPath}`);
    } else {
      console.log("\n" + sysmlText);
    }
  },
};

interface SysMLCheckArgs {
  files: string[];
  format: "terminal" | "json";
  strict?: boolean | undefined;
}

const SysMLCheckCommand: CommandModule<{}, SysMLCheckArgs> = {
  command: ["check <files..>", "lint <files..>"],
  describe: "Run frontend static type checking and compiler diagnostics linter on SysML v2 models",
  builder: (yargs) => {
    return yargs
      .positional("files", {
        array: true,
        demandOption: true,
        description: "One or more .sysml files to validate",
        type: "string",
      })
      .option("format", {
        description: "Output format",
        choices: ["terminal", "json"],
        default: "terminal",
      })
      .option("strict", {
        description: "Treat warnings as errors",
        type: "boolean",
        default: false,
      }) as any;
  },
  handler: async (args) => {
    const parser = await getSysmlParser();
    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws, parser);

    const diagnostics: any[] = [];
    const sourceTexts = new Map<string, string>();
    const astMap = new Map<string, any>();

    const seenDiagKeys = new Set<string>();
    const pushUniqueDiagnostic = (diag: any) => {
      const key = `${diag.file}:${diag.line}:${diag.code}:${diag.message}`;
      if (seenDiagKeys.has(key)) return;
      seenDiagKeys.add(key);
      diagnostics.push(diag);
    };

    for (const f of args.files) {
      const filePath = path.resolve(process.cwd(), f);
      if (!fs.existsSync(filePath)) {
        pushUniqueDiagnostic({
          file: f,
          line: 1,
          col: 1,
          code: "S1001",
          severity: "error",
          message: `File not found: ${filePath}`,
        });
        continue;
      }

      const text = fs.readFileSync(filePath, "utf-8");
      const uri = `file://${filePath}`;
      const relPath = path.relative(process.cwd(), filePath) || f;
      sourceTexts.set(uri, text);

      const tree = parser.parse(text);
      const ast = tree ? (tree.rootNode as any) : null;
      if (ast) {
        astMap.set(uri, ast);
        const facade = (tree as any)?.facade ?? ast?.tree?.facade;
        if (facade && typeof facade.getDiagnostics === "function") {
          const rootPtr = ast.id ?? ast.ptr ?? 0;
          if (rootPtr) {
            if (typeof facade.loadSource === "function") facade.loadSource(text);
            for (const cd of facade.getDiagnostics(rootPtr, 0, 0, text)) {
              const codeNum = typeof cd.code === "number" ? cd.code : 1001;
              const def = getSysML2ErrorCodeDef(codeNum);
              const pos = byteToLineCol(text, cd.startOffset ?? 0);
              pushUniqueDiagnostic({
                file: relPath,
                line: pos.line,
                col: pos.col,
                code: `S${codeNum}`,
                rule: def?.rule || "syntax",
                severity: cd.severity === 1 ? "error" : cd.severity === 2 ? "warning" : def?.severity || "error",
                message: cd.message || def?.message("Syntax error") || "Syntax error",
              });
            }
          }
        } else if (ast.hasError && ast.hasError()) {
          pushUniqueDiagnostic({
            file: relPath,
            line: 1,
            col: 1,
            code: "S1001",
            rule: "parse-error",
            severity: "error",
            message: "Syntax error detected by native WASM GLR parser",
          });
        }
      }
      ws.register(uri, () => ast, text);
    }

    const unified = await ws.toUnifiedAsync();
    const cstProvider = {
      getText: (startOffset: number, endOffset: number, entry?: any) => {
        if (!entry || !entry.resourceId) return null;
        const text = sourceTexts.get(entry.resourceId);
        return text ? text.slice(startOffset, endOffset) : null;
      },
      getNode: (startOffset: number, endOffset: number, entry?: any) => {
        if (!entry || !entry.resourceId) return null;
        const ast = astMap.get(entry.resourceId);
        if (!ast || typeof ast.descendantForIndex !== "function") return null;
        return ast.descendantForIndex(startOffset, Math.max(startOffset, endOffset - 1));
      },
    };
    const qe = createSysML2QueryEngine(unified, cstProvider as any);

    // Run semantic & formal verification linter queries
    for (const [uri, text] of sourceTexts.entries()) {
      const relPath = path.relative(process.cwd(), uri.replace(/^file:\/\//, "")) || uri.replace(/^file:\/\//, "");
      const entryLints = qe.runAllLints(uri);
      for (const l of entryLints) {
        if (!l) continue;
        const pos = byteToLineCol(text, l.startOffset ?? 0);
        pushUniqueDiagnostic({
          file: relPath,
          line: pos.line,
          col: pos.col,
          code: l.code ? `S${l.code}` : "S4000",
          rule: l.lintName || "semantic",
          severity: l.severity || "warning",
          message: l.message,
        });
      }
    }

    if (args.format === "json") {
      console.log(JSON.stringify(diagnostics, null, 2));
    } else {
      console.log(`\n\x1b[1mSysML v2 Static Diagnostic Report:\x1b[0m`);
      if (diagnostics.length === 0) {
        console.log(
          `\x1b[32m✔ All ${args.files.length} file(s) passed static checks with 0 errors and 0 warnings.\x1b[0m\n`,
        );
        return;
      }

      for (const d of diagnostics) {
        const color = d.severity === "error" ? "\x1b[31m" : d.severity === "warning" ? "\x1b[33m" : "\x1b[36m";
        const badge = `${color}[${d.code}]\x1b[0m`;
        console.log(`  ${d.file}:${d.line}:${d.col} - ${badge} ${d.message}`);
      }

      const errors = diagnostics.filter((d) => d.severity === "error").length;
      const warnings = diagnostics.filter((d) => d.severity === "warning").length;
      console.log(`\nFound ${errors} error(s) and ${warnings} warning(s).\n`);

      if (errors > 0 || (args.strict && warnings > 0)) {
        process.exit(1);
      }
    }
  },
};

interface SysMLInfoArgs {
  file: string;
  format: "table" | "json";
}

const SysMLInfoCommand: CommandModule<{}, SysMLInfoArgs> = {
  command: "info <file>",
  describe: "Inspect model architecture, symbol counts, and structural metrics of a SysML v2 file",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        demandOption: true,
        description: "Path to .sysml or .sysmlx file",
        type: "string",
      })
      .option("format", {
        description: "Output display format",
        choices: ["table", "json"],
        default: "table",
      }) as any;
  },
  handler: async (args) => {
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`\x1b[31mError:\x1b[0m file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const parser = await getSysmlParser();
    const ws = createSysML2WorkspaceIndex();
    const uri = `file://${filePath}`;

    ws.register(uri, () => {
      const tree = parser.parse(content);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    const entries = db.allEntries().filter((e) => e.resourceId === uri);
    const packages = entries.filter((e) => e.ruleName === "Package");
    const partDefs = entries.filter((e) => e.ruleName === "PartDefinition");
    const portDefs = entries.filter((e) => e.ruleName === "PortDefinition");
    const partUsages = entries.filter((e) => e.ruleName === "PartUsage");
    const portUsages = entries.filter((e) => e.ruleName === "PortUsage");
    const reqDefs = entries.filter((e) => e.ruleName === "RequirementDefinition");
    const reqUsages = entries.filter((e) => e.ruleName === "RequirementUsage");
    const connections = entries.filter(
      (e) => e.ruleName === "ConnectionUsage" || e.ruleName === "BindingConnectorAsUsage",
    );
    const constraints = entries.filter(
      (e) => e.ruleName === "ConstraintUsage" || e.ruleName === "AssertConstraintUsage",
    );

    const infoData = {
      file: args.file,
      totalSymbols: entries.length,
      packages: packages.map((p) => p.name || "<anonymous>"),
      definitions: {
        parts: partDefs.length,
        ports: portDefs.length,
        requirements: reqDefs.length,
      },
      usages: {
        parts: partUsages.length,
        ports: portUsages.length,
        requirements: reqUsages.length,
        connections: connections.length,
        constraints: constraints.length,
      },
    };

    if (args.format === "json") {
      console.log(JSON.stringify(infoData, null, 2));
    } else {
      console.log(`\n\x1b[1mSysML v2 Model Inspection:\x1b[0m ${args.file}`);
      console.log(`--------------------------------------------------`);
      console.log(`Packages:      ${packages.map((p) => p.name).join(", ") || "None"}`);
      console.log(`Total Symbols: ${entries.length}`);
      console.log(`\x1b[1mDefinitions:\x1b[0m`);
      console.log(`  Part Definitions:        ${partDefs.length}`);
      console.log(`  Port Definitions:        ${portDefs.length}`);
      console.log(`  Requirement Definitions: ${reqDefs.length}`);
      console.log(`\x1b[1mUsages & Architecture:\x1b[0m`);
      console.log(`  Part Usages:             ${partUsages.length}`);
      console.log(`  Port Usages:             ${portUsages.length}`);
      console.log(`  Connections:             ${connections.length}`);
      console.log(`  Constraints:             ${constraints.length}`);
      console.log(`  Requirement Usages:      ${reqUsages.length}\n`);
    }
  },
};

interface SysMLSyncPullArgs {
  target: "twc" | "mms";
  url: string;
  resource?: string | undefined;
  org?: string | undefined;
  branch?: string | undefined;
  token?: string | undefined;
  output?: string | undefined;
}

const SysMLSyncPullCommand: CommandModule<{}, SysMLSyncPullArgs> = {
  command: "pull",
  describe: "Pull model elements from Cameo Teamwork Cloud (TWC) or OpenMBEE MMS and generate .sysml",
  builder: (yargs) => {
    return yargs
      .option("target", {
        alias: "t",
        demandOption: true,
        choices: ["twc", "mms"],
        description: "Target enterprise repository system",
      })
      .option("url", {
        demandOption: true,
        type: "string",
        description: "Base URL of TWC or MMS instance",
      })
      .option("resource", {
        alias: "r",
        type: "string",
        description: "TWC Resource ID or MMS Project ID",
      })
      .option("org", {
        type: "string",
        description: "OpenMBEE MMS Organization ID",
      })
      .option("branch", {
        alias: "b",
        type: "string",
        default: "master",
        description: "Branch or ref name",
      })
      .option("token", {
        type: "string",
        description: "Bearer authentication token",
      })
      .option("output", {
        alias: "o",
        type: "string",
        description: "Target output .sysml file path",
      }) as any;
  },
  handler: async (args) => {
    console.log(`\x1b[1m[SysML v2 Sync]\x1b[0m Pulling from ${args.target.toUpperCase()} at ${args.url}...`);
    let result;
    if (args.target === "twc") {
      if (!args.resource) {
        console.error(`\x1b[31mError:\x1b[0m --resource <resourceId> is required for Teamwork Cloud`);
        process.exit(1);
      }
      result = await SysML2EnterpriseSyncGateway.pullFromTwc({
        baseUrl: args.url,
        resourceId: args.resource,
        branch: args.branch,
        authToken: args.token,
      });
    } else {
      if (!args.org || !args.resource) {
        console.error(`\x1b[31mError:\x1b[0m --org <orgId> and --resource <projectId> are required for OpenMBEE MMS`);
        process.exit(1);
      }
      result = await SysML2EnterpriseSyncGateway.pullFromMms({
        baseUrl: args.url,
        orgId: args.org,
        projectId: args.resource,
        refId: args.branch,
        authToken: args.token,
      });
    }

    if (args.output) {
      const outPath = path.resolve(process.cwd(), args.output);
      fs.writeFileSync(outPath, result.sysmlSource, "utf-8");
      console.log(
        `\x1b[32m✔ Successfully pulled\x1b[0m ${result.elementCount} elements at revision '${result.remoteRevision}' to ${outPath}`,
      );
    } else {
      console.log(`\n// Revision: ${result.remoteRevision} (${result.elementCount} elements)\n`);
      console.log(result.sysmlSource);
    }
  },
};

interface SysMLSyncPushArgs {
  file: string;
  target: "twc" | "mms";
  url: string;
  resource?: string | undefined;
  org?: string | undefined;
  branch?: string | undefined;
  token?: string | undefined;
  message: string;
  force?: boolean | undefined;
}

const SysMLSyncPushCommand: CommandModule<{}, SysMLSyncPushArgs> = {
  command: "push <file>",
  describe: "Push local SysML v2 source changes upstream to Cameo Teamwork Cloud or OpenMBEE MMS",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        demandOption: true,
        type: "string",
        description: "Path to .sysml file to push",
      })
      .option("target", {
        alias: "t",
        demandOption: true,
        choices: ["twc", "mms"],
        description: "Target enterprise repository system",
      })
      .option("url", {
        demandOption: true,
        type: "string",
        description: "Base URL of TWC or MMS instance",
      })
      .option("resource", {
        alias: "r",
        type: "string",
        description: "TWC Resource ID or MMS Project ID",
      })
      .option("org", {
        type: "string",
        description: "OpenMBEE MMS Organization ID",
      })
      .option("branch", {
        alias: "b",
        type: "string",
        default: "master",
        description: "Branch or ref name",
      })
      .option("token", {
        type: "string",
        description: "Bearer authentication token",
      })
      .option("message", {
        alias: "m",
        demandOption: true,
        type: "string",
        description: "Commit message describing the revision",
      })
      .option("force", {
        type: "boolean",
        default: false,
        description: "Force push and overwrite conflicting upstream revisions",
      }) as any;
  },
  handler: async (args) => {
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`\x1b[31mError:\x1b[0m file not found: ${filePath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, "utf-8");

    console.log(`\x1b[1m[SysML v2 Sync]\x1b[0m Pushing ${args.file} to ${args.target.toUpperCase()}...`);
    let result;
    try {
      if (args.target === "twc") {
        if (!args.resource) {
          console.error(`\x1b[31mError:\x1b[0m --resource <resourceId> is required for Teamwork Cloud`);
          process.exit(1);
        }
        result = await SysML2EnterpriseSyncGateway.pushToTwc(
          {
            baseUrl: args.url,
            resourceId: args.resource,
            branch: args.branch,
            authToken: args.token,
          },
          content,
          {
            commitMessage: args.message,
            force: args.force,
          },
        );
      } else {
        if (!args.org || !args.resource) {
          console.error(`\x1b[31mError:\x1b[0m --org <orgId> and --resource <projectId> are required for OpenMBEE MMS`);
          process.exit(1);
        }
        result = await SysML2EnterpriseSyncGateway.pushToMms(
          {
            baseUrl: args.url,
            orgId: args.org,
            projectId: args.resource,
            refId: args.branch,
            authToken: args.token,
          },
          content,
          {
            commitMessage: args.message,
            force: args.force,
          },
        );
      }

      console.log(
        `\x1b[32m✔ Successfully committed revision\x1b[0m '${result.newRevision}' (${result.elementsCommitted} elements: +${result.diffSummary.added} ~${result.diffSummary.modified} -${result.diffSummary.deleted})`,
      );
    } catch (err: any) {
      console.error(`\x1b[31mCommit Error:\x1b[0m ${err.message}`);
      process.exit(1);
    }
  },
};

const SysMLSyncCommand: CommandModule = {
  command: "sync <action>",
  describe: "Synchronize SysML v2 models with Cameo Teamwork Cloud (TWC) or OpenMBEE MMS enterprise servers",
  builder: (yargs) => {
    return yargs
      .command(SysMLSyncPullCommand)
      .command(SysMLSyncPushCommand)
      .demandCommand(1, "Please specify a sync action (pull or push)") as any;
  },
  handler: () => {},
};

export const SysML: CommandModule = {
  command: "sysml <action>",
  describe: "OMG SysML v2 engineering toolkit: standard interchange (.sysmlx), validation, and container export",
  builder: (yargs) => {
    return yargs
      .command(SysMLExportCommand)
      .command(SysMLImportCommand)
      .command(SysMLCheckCommand)
      .command(SysMLInfoCommand)
      .command(SysMLSyncCommand)
      .demandCommand(1, "Please specify an action (export, import, check, info, or sync)") as any;
  },
  handler: () => {},
};
