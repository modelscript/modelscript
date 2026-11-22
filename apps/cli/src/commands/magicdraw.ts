// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CLI Command: `msx magicdraw <action> <file>`
 *
 * Actions:
 *   - inspect    : Summarize packages, blocks, requirements, state machines, and diagrams
 *   - lint       : Run semantic & structural checks (M9921–M9934)
 *   - to-sysml   : Project SysML 1.x model to OMG SysML v2 (.sysml)
 *   - to-reqif   : Export SysML 1.x requirements to OMG ReqIF 1.2 (.reqif)
 *   - to-modelica: Project blocks & parametric constraints to Modelica (.mo)
 *   - render     : Render BDD / IBD / REQ / PAR / STM diagram as SVG
 */

import fs from "node:fs";
import path from "node:path";
import type { ArgumentsCamelCase, CommandModule } from "yargs";

interface MagicDrawCliArgs {
  action: "inspect" | "lint" | "to-sysml" | "to-reqif" | "to-modelica" | "render" | "diff" | "migrate";
  file: string;
  compare?: string | undefined;
  out?: string | undefined;
  diagramId?: string | undefined;
  diagramKind?: "BDD" | "IBD" | "REQ" | "PAR" | "STM" | "ACT" | "SEQ" | "PKG" | undefined;
  json?: boolean | undefined;
}

export const MagicDrawCommand: CommandModule<object, MagicDrawCliArgs> = {
  command: "magicdraw <action> <file>",
  describe:
    "MagicDraw / Cameo (.mdzip, .mdxml, .xmi) inspection, linting, diffing, diagramming, and SysML v2/ReqIF/Modelica migration",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["inspect", "lint", "to-sysml", "to-reqif", "to-modelica", "render", "diff", "migrate"] as const,
        demandOption: true,
        describe: "Operation to perform on the MagicDraw archive or XMI file",
      })
      .positional("file", {
        type: "string",
        demandOption: true,
        describe: "Path to .mdzip, .mdxml, or .xmi file",
      })
      .option("compare", {
        alias: "c",
        type: "string",
        describe: "Target .mdzip/.mdxml file to compare against (for the diff action)",
      })
      .option("out", {
        alias: "o",
        type: "string",
        describe: "Optional output file or directory path",
      })
      .option("diagramId", {
        type: "string",
        describe: "Specific diagram xmi:id for the render action",
      })
      .option("diagramKind", {
        type: "string",
        choices: ["BDD", "IBD", "REQ", "PAR", "STM", "ACT", "SEQ", "PKG"] as const,
        describe: "Diagram kind for the render action",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Emit structured JSON output",
      }),
  handler: async (argv: ArgumentsCamelCase<MagicDrawCliArgs>) => {
    const absPath = path.resolve(process.cwd(), argv.file);
    const rawBytes = new Uint8Array(fs.readFileSync(absPath));
    const {
      diffMagicDrawDocuments,
      formatMagicDrawDiffMarkdown,
      lintMagicDrawDocument,
      magicDrawToModelica,
      magicDrawToReqif,
      magicDrawToSysml2,
      migrateMagicDrawToSysml2Workspace,
      parseMagicDraw,
      renderMagicDrawDiagramSvg,
    } = await import("@modelscript/magicdraw");

    const doc = parseMagicDraw(rawBytes);

    const emitOutput = (content: string) => {
      if (argv.out) {
        fs.writeFileSync(path.resolve(process.cwd(), argv.out), content, "utf-8");
        console.log(`Wrote ${argv.out}`);
      } else {
        console.log(content);
      }
    };

    switch (argv.action) {
      case "inspect": {
        const summary = {
          projectName: doc.metadata.projectName,
          format: doc.metadata.format,
          status: doc.metadata.status,
          magicDrawVersion: doc.metadata.magicDrawVersion,
          packages: doc.packages.size,
          classifiers: doc.classifiers.size,
          requirements: Array.from(doc.classifiers.values()).filter((c) => c.kind === "Requirement").length,
          stateMachines: doc.stateMachines.size,
          activities: doc.activities.size,
          interactions: doc.interactions.size,
          relationships: doc.relationships.length,
          diagrams: doc.diagrams.map((d) => ({ id: d.id, name: d.name, kind: d.kind })),
        };
        emitOutput(JSON.stringify(summary, null, 2));
        break;
      }
      case "lint": {
        const diags = lintMagicDrawDocument(doc);
        if (argv.json) {
          emitOutput(JSON.stringify(diags, null, 2));
        } else if (diags.length === 0) {
          console.log("No MagicDraw diagnostics found.");
        } else {
          for (const d of diags) {
            console.log(`[${d.code}] ${d.severity.toUpperCase()}: ${d.message}`);
          }
        }
        break;
      }
      case "diff": {
        if (!argv.compare) {
          throw new Error("The 'diff' action requires --compare <targetFile>.");
        }
        const targetBytes = new Uint8Array(fs.readFileSync(path.resolve(process.cwd(), argv.compare)));
        const diff = diffMagicDrawDocuments(doc, targetBytes);
        emitOutput(argv.json ? JSON.stringify(diff, null, 2) : formatMagicDrawDiffMarkdown(diff));
        break;
      }
      case "migrate": {
        const workspace = migrateMagicDrawToSysml2Workspace(doc);
        if (argv.out) {
          const outDir = path.resolve(process.cwd(), argv.out);
          fs.mkdirSync(outDir, { recursive: true });
          for (const f of workspace.files) {
            fs.writeFileSync(path.join(outDir, f.fileName), f.content, "utf-8");
          }
          fs.writeFileSync(
            path.join(outDir, "migration-report.json"),
            JSON.stringify(workspace.report, null, 2),
            "utf-8",
          );
          console.log(`Migrated ${workspace.files.length} SysML v2 files to ${argv.out}`);
        } else {
          console.log(
            JSON.stringify({ report: workspace.report, files: workspace.files.map((f) => f.fileName) }, null, 2),
          );
        }
        break;
      }
      case "to-sysml": {
        emitOutput(magicDrawToSysml2(doc));
        break;
      }
      case "to-reqif": {
        emitOutput(magicDrawToReqif(doc));
        break;
      }
      case "to-modelica": {
        emitOutput(magicDrawToModelica(doc));
        break;
      }
      case "render": {
        emitOutput(renderMagicDrawDiagramSvg(doc, { diagramId: argv.diagramId, diagramKind: argv.diagramKind }));
        break;
      }
    }
  },
};

export default MagicDrawCommand;
