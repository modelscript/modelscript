// SPDX-License-Identifier: AGPL-3.0-or-later

import { ReqIfParser, type ReqIfRequirement, type ReqIfSpecification } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

interface ReqIfImportArgs {
  file: string;
  "to-sysml"?: string;
  "to-modelica"?: string;
  format: "table" | "json";
}

interface ReqIfExportArgs {
  file: string;
  output?: string;
  title?: string;
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

export const ReqIf: CommandModule = {
  command: "reqif <action>",
  describe: "Lossless OMG ReqIF 1.2 requirements interchange with DOORS, Polarion, and Teamcenter",
  builder: (yargs) => {
    return yargs
      .command(ReqIfImportCommand)
      .command(ReqIfExportCommand)
      .demandCommand(1, "Please specify an action (import or export)") as any;
  },
  handler: () => {},
};
