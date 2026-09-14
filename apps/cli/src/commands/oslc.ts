// SPDX-License-Identifier: AGPL-3.0-or-later

import { OslcGateway, ReqIfParser } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

interface OslcExportArgs {
  input?: string;
  domain: "rm" | "qm" | "am" | "all";
  format: "turtle" | "jsonld";
  output?: string;
}

interface OslcServeArgs {
  input?: string;
  port: number;
  host: string;
}

const OslcExportCommand: CommandModule<{}, OslcExportArgs> = {
  command: "export",
  describe: "Export requirements, test results, or architecture models as OSLC Linked Data (Turtle or JSON-LD)",
  builder: (yargs) => {
    return yargs
      .option("input", {
        alias: "i",
        description: "Path to input file (e.g. .reqif, .json)",
        type: "string",
      })
      .option("domain", {
        alias: "d",
        description: "OSLC domain to export: rm (Requirements), qm (Quality/Tests), am (Architecture), or all",
        choices: ["rm", "qm", "am", "all"],
        default: "all",
      })
      .option("format", {
        alias: "f",
        description: "RDF serialization format: turtle or jsonld",
        choices: ["turtle", "jsonld"],
        default: "turtle",
      })
      .option("output", {
        alias: "o",
        description: "Output file path (prints to stdout if not specified)",
        type: "string",
      }) as any;
  },
  handler: async (args) => {
    const gateway = new OslcGateway("https://modelscript.org/oslc");

    if (args.input) {
      const inputPath = path.resolve(process.cwd(), args.input);
      if (!fs.existsSync(inputPath)) {
        console.error(`Error: input file not found: ${inputPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(inputPath, "utf-8");
      if (inputPath.endsWith(".reqif") || inputPath.endsWith(".xml") || content.includes("<REQ-IF")) {
        const spec = ReqIfParser.parse(content);
        gateway.importReqIf(spec);
      } else if (inputPath.endsWith(".json")) {
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.status && (item.status === "Passed" || item.status === "Failed")) {
              gateway.registerTestResult(item);
            } else {
              gateway.registerRequirement(item);
            }
          }
        }
      }
    }

    const output =
      args.format === "turtle"
        ? gateway.exportTurtle(args.domain)
        : JSON.stringify(gateway.exportJsonLd(args.domain), null, 2);

    if (args.output) {
      const outPath = path.resolve(process.cwd(), args.output);
      fs.writeFileSync(outPath, output, "utf-8");
      console.log(`Exported OSLC ${args.domain.toUpperCase()} to ${outPath}`);
    } else {
      console.log(output);
    }
  },
};

const OslcServeCommand: CommandModule<{}, OslcServeArgs> = {
  command: "serve",
  describe: "Start an embedded OSLC Core 3.0 Linked Data HTTP REST server",
  builder: (yargs) => {
    return yargs
      .option("input", {
        alias: "i",
        description: "Optional initial requirements or thread file to populate",
        type: "string",
      })
      .option("port", {
        alias: "p",
        description: "Port to bind HTTP server",
        type: "number",
        default: 8080,
      })
      .option("host", {
        alias: "H",
        description: "Host interface to listen on",
        type: "string",
        default: "localhost",
      }) as any;
  },
  handler: async (args) => {
    const gateway = new OslcGateway(`http://${args.host}:${args.port}`);

    if (args.input) {
      const inputPath = path.resolve(process.cwd(), args.input);
      if (fs.existsSync(inputPath)) {
        const content = fs.readFileSync(inputPath, "utf-8");
        if (inputPath.endsWith(".reqif") || content.includes("<REQ-IF")) {
          const spec = ReqIfParser.parse(content);
          gateway.importReqIf(spec);
          console.log(`Loaded ${gateway.getAllRequirements().length} requirements from ${args.input}`);
        }
      }
    }

    const port = await gateway.startServer(args.port, args.host);
    console.log(`\x1b[32m[OSLC Gateway]\x1b[0m Listening on http://${args.host}:${port}`);
    console.log(`Service Provider Catalog: http://${args.host}:${port}/oslc/catalog`);
    console.log(`  OSLC-RM (Requirements): http://${args.host}:${port}/oslc/rm/requirements`);
    console.log(`  OSLC-QM (Quality/Tests): http://${args.host}:${port}/oslc/qm/results`);
    console.log(`  OSLC-AM (Architecture):  http://${args.host}:${port}/oslc/am/elements`);
    console.log("Press Ctrl+C to stop server.");

    await new Promise(() => {}); // Keep alive until interrupted
  },
};

export const Oslc: CommandModule = {
  command: "oslc <action>",
  describe: "OSLC Core 3.0 enterprise coexistence gateway for Teamcenter, Windchill, and DOORS",
  builder: (yargs) => {
    return yargs
      .command(OslcExportCommand)
      .command(OslcServeCommand)
      .demandCommand(1, "Please specify an action (export or serve)") as any;
  },
  handler: () => {},
};
