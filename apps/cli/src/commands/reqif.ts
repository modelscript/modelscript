// SPDX-License-Identifier: AGPL-3.0-or-later

import { ReqIfParser, type ReqIfRequirement, type ReqIfSpecification } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

interface ReqIfImportArgs {
  file: string;
  "to-sysml"?: string | undefined;
  "to-modelica"?: string | undefined;
  format: "table" | "json";
}

interface ReqIfExportArgs {
  file: string;
  output?: string | undefined;
  title?: string | undefined;
}

const ReqIfImportCommand: CommandModule<{}, ReqIfImportArgs> = {
  command: "import <file>",
  describe: "Import and inspect OMG ReqIF 1.2 requirements document with hierarchy and traceability relations",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        demandOption: true,
        description: "Path to .reqif or .xml file",
        type: "string",
      })
      .option("to-sysml", {
        description: "Generate SysML v2 requirement definition file",
        type: "string",
      })
      .option("to-modelica", {
        description: "Generate Modelica verification block file",
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
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }

    const xmlContent = fs.readFileSync(filePath, "utf-8");
    const spec = ReqIfParser.parse(xmlContent);

    if (args.format === "json") {
      console.log(JSON.stringify(spec, null, 2));
    } else {
      console.log(`\n\x1b[1mReqIF Document:\x1b[0m ${spec.title} (${spec.id})`);
      console.log(`Requirements found: ${spec.requirements.length}`);
      if (spec.relations && spec.relations.length > 0) {
        console.log(`Traceability relations found: ${spec.relations.length}`);
      }
      console.log("");

      const printReq = (req: ReqIfRequirement, indent = 0) => {
        const pad = "  ".repeat(indent);
        const asilBadge = req.asilLevel ? ` [\x1b[33m${req.asilLevel}\x1b[0m]` : "";
        const limitStr = req.limitValue !== undefined ? ` (limit: ${req.comparator || "<="} ${req.limitValue})` : "";
        console.log(`${pad}• \x1b[1m[${req.id}]\x1b[0m ${req.name}${asilBadge}${limitStr}`);
        if (req.text) {
          console.log(`${pad}  \x1b[90m${req.text.trim()}\x1b[0m`);
        }
        if (req.satisfiedBy && req.satisfiedBy.length > 0) {
          console.log(`${pad}  \x1b[32mSatisfied by:\x1b[0m ${req.satisfiedBy.join(", ")}`);
        }
        if (req.verifiedBy && req.verifiedBy.length > 0) {
          console.log(`${pad}  \x1b[34mVerified by:\x1b[0m ${req.verifiedBy.join(", ")}`);
        }

        if (req.children && req.children.length > 0) {
          for (const child of req.children) {
            printReq(child, indent + 1);
          }
        }
      };

      for (const req of spec.requirements) {
        printReq(req);
      }
    }

    if (args["to-sysml"]) {
      const sysmlPath = path.resolve(process.cwd(), args["to-sysml"]);
      const sysmlCode = ReqIfParser.toSysML2(spec);
      fs.writeFileSync(sysmlPath, sysmlCode, "utf-8");
      console.log(`\nExported SysML v2 requirements to ${sysmlPath}`);
    }

    if (args["to-modelica"]) {
      const moPath = path.resolve(process.cwd(), args["to-modelica"]);
      const moCode = ReqIfParser.toModelicaVerifier(spec);
      fs.writeFileSync(moPath, moCode, "utf-8");
      console.log(`Exported Modelica verification model to ${moPath}`);
    }
  },
};

const ReqIfExportCommand: CommandModule<{}, ReqIfExportArgs> = {
  command: "export <file>",
  describe: "Export SysML v2 requirements or model specs into OMG ReqIF 1.2 XML format",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        demandOption: true,
        description: "Path to SysML v2 (.sysml) or JSON model file",
        type: "string",
      })
      .option("output", {
        alias: "o",
        description: "Path to output .reqif file",
        type: "string",
      })
      .option("title", {
        alias: "t",
        description: "Document title for ReqIF specification",
        type: "string",
        default: "Exported Requirements",
      }) as any;
  },
  handler: async (args) => {
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    let spec: ReqIfSpecification;

    if (filePath.endsWith(".sysml") || filePath.endsWith(".sys2")) {
      spec = ReqIfParser.fromSysML2(content, args.title);
    } else {
      spec = JSON.parse(content);
    }

    const reqifXml = ReqIfParser.generate(spec);

    if (args.output) {
      const outPath = path.resolve(process.cwd(), args.output);
      fs.writeFileSync(outPath, reqifXml, "utf-8");
      console.log(`Saved ReqIF 1.2 XML to ${outPath}`);
    } else {
      console.log(reqifXml);
    }
  },
};

const ReqIfLintCommand: CommandModule<{}, { file: string }> = {
  command: "lint <file>",
  describe: "Lint OMG ReqIF document for missing attributes, dangling relations, and unbounded contracts",
  builder: (yargs) =>
    yargs.positional("file", {
      demandOption: true,
      description: "Path to .reqif file",
      type: "string",
    }) as any,
  handler: async (args) => {
    const { parseReqIf, lintReqIf } = await import("@modelscript/reqif");
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }
    const xml = fs.readFileSync(filePath, "utf-8");
    const doc = parseReqIf(xml);
    const diags = lintReqIf(doc);
    if (diags.length === 0) {
      console.log(
        `[PASS] ${args.file}: 0 issues found (${doc.specObjects.size} requirements, ${doc.specRelations.length} relations).`,
      );
    } else {
      console.log(`[DIAGNOSTICS] ${args.file}: ${diags.length} issue(s) found:`);
      for (const d of diags) {
        console.log(`  - [M${d.code}] ${d.severity.toUpperCase()}: ${d.message}`);
      }
    }
  },
};

const ReqIfVerifyCommand: CommandModule<{}, { file: string }> = {
  command: "verify <file>",
  describe: "Formally verify requirements decomposition completeness using Nelson-Oppen SMT entailment",
  builder: (yargs) =>
    yargs.positional("file", {
      demandOption: true,
      description: "Path to .reqif file",
      type: "string",
    }) as any,
  handler: async (args) => {
    const { parseReqIf, verifyReqIfEntailment } = await import("@modelscript/reqif");
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }
    const xml = fs.readFileSync(filePath, "utf-8");
    const doc = parseReqIf(xml);
    const report = verifyReqIfEntailment(doc);
    console.log(`--- Nelson-Oppen Requirements Entailment Report ---`);
    console.log(`Total Queries Evaluated: ${report.totalQueries}`);
    console.log(`Certified Entailments:   ${report.certifiedCount}`);
    console.log(`Decomposition Gaps:      ${report.gapCount}`);
    for (const r of report.results) {
      const badge = r.isEntailed ? "CERTIFIED" : "GAP";
      const diag = r.diagnosticMessage ? ` (${r.diagnosticMessage})` : "";
      console.log(`[${badge}] ${r.childReqIds.join(" ∧ ")} ⊨ ${r.parentReqId}${diag}`);
    }
  },
};

const ReqIfToSysmlCommand: CommandModule<{}, { file: string; out?: string }> = {
  command: "to-sysml <file>",
  describe: "Translate ReqIF requirements and satisfaction relations into SysML v2 definitions",
  builder: (yargs) =>
    yargs
      .positional("file", {
        demandOption: true,
        description: "Path to .reqif file",
        type: "string",
      })
      .option("out", {
        description: "Output .sysml file path",
        type: "string",
      }) as any,
  handler: async (args) => {
    const { parseReqIf, reqifToSysml2 } = await import("@modelscript/reqif");
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }
    const xml = fs.readFileSync(filePath, "utf-8");
    const doc = parseReqIf(xml);
    const sysml = reqifToSysml2(doc);
    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), sysml, "utf-8");
      console.log(`Saved SysML v2 requirements to ${args.out}`);
    } else {
      console.log(sysml);
    }
  },
};

const ReqIfToModelicaCommand: CommandModule<{}, { file: string; out?: string }> = {
  command: "to-modelica <file>",
  describe: "Translate ReqIF requirements contracts into a Modelica plant monitor verification block",
  builder: (yargs) =>
    yargs
      .positional("file", {
        demandOption: true,
        description: "Path to .reqif file",
        type: "string",
      })
      .option("out", {
        description: "Output .mo file path",
        type: "string",
      }) as any,
  handler: async (args) => {
    const { parseReqIf, reqifToModelicaVerifier } = await import("@modelscript/reqif");
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }
    const xml = fs.readFileSync(filePath, "utf-8");
    const doc = parseReqIf(xml);
    const mo = reqifToModelicaVerifier(doc);
    if (args.out) {
      fs.writeFileSync(path.resolve(process.cwd(), args.out), mo, "utf-8");
      console.log(`Saved Modelica verifier to ${args.out}`);
    } else {
      console.log(mo);
    }
  },
};

export const ReqIf: CommandModule = {
  command: "reqif <action>",
  describe: "Lossless OMG ReqIF 1.2 requirements interchange with DOORS, Polarion, and Teamcenter",
  builder: (yargs) => {
    return yargs
      .command(ReqIfImportCommand)
      .command(ReqIfExportCommand)
      .command(ReqIfLintCommand)
      .command(ReqIfVerifyCommand)
      .command(ReqIfToSysmlCommand)
      .command(ReqIfToModelicaCommand)
      .demandCommand(1, "Please specify an action (import, export, lint, verify, to-sysml, or to-modelica)") as any;
  },
  handler: () => {},
};
