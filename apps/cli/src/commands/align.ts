// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BrownfieldAlignmentEngine,
  DigitalThreadHypergraph,
  ReqIfParser,
  ThreadDomain,
  type AlignmentElement,
} from "@modelscript/runtime";
import { extractStepAssembly } from "@modelscript/step/assembly";
import type { StepPart } from "@modelscript/step/physical-data";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

interface AlignArgs {
  source: string;
  target: string;
  "min-confidence": number;
  threshold: number;
  apply: boolean;
  hypergraph?: string;
  json: boolean;
}

export const Align: CommandModule<{}, AlignArgs> = {
  command: "align <source> <target>",
  describe: "Fuzzy align and correlate brownfield engineering assets (STEP CAD, Modelica, SysML v2, ReqIF)",
  builder: (yargs) => {
    return yargs
      .positional("source", {
        demandOption: true,
        description: "Path to source model (e.g. .step, .mo, .sysml, .reqif, .json)",
        type: "string",
      })
      .positional("target", {
        demandOption: true,
        description: "Path to target model (e.g. .mo, .sysml, .step, .reqif, .json)",
        type: "string",
      })
      .option("min-confidence", {
        description: "Minimum confidence score to display candidates (0.0 - 1.0)",
        type: "number",
        default: 0.6,
      })
      .option("threshold", {
        description: "Confidence threshold to auto-seed into Digital Thread Hypergraph",
        type: "number",
        default: 0.85,
      })
      .option("apply", {
        description: "Auto-seed matching pairs into Digital Thread Hypergraph",
        type: "boolean",
        default: false,
      })
      .option("hypergraph", {
        description: "Path to existing hypergraph state JSON to update",
        type: "string",
      })
      .option("json", {
        description: "Output raw JSON candidates",
        type: "boolean",
        default: false,
      }) as any;
  },
  handler: async (args) => {
    const srcPath = path.resolve(process.cwd(), args.source);
    const tgtPath = path.resolve(process.cwd(), args.target);

    if (!fs.existsSync(srcPath)) {
      console.error(`Error: source file not found: ${srcPath}`);
      process.exit(1);
    }
    if (!fs.existsSync(tgtPath)) {
      console.error(`Error: target file not found: ${tgtPath}`);
      process.exit(1);
    }

    const extractElements = (filePath: string): AlignmentElement[] => {
      const content = fs.readFileSync(filePath, "utf-8");
      const ext = path.extname(filePath).toLowerCase();

      if (ext === ".step" || ext === ".stp") {
        const model = extractStepAssembly(content);
        return Array.from(model.parts.values()).map((p: StepPart, idx: number) => {
          const mp = model.massProperties.get(p.id);
          return {
            id: p.name || `part_${idx}`,
            name: p.name,
            domain: ThreadDomain.CAD,
            type: "CADPart",
            properties: {
              mass: mp?.mass,
              centerOfGravity: mp?.centerOfMass,
              hasInertia: Boolean(mp?.inertiaTensor),
              tolerances: model.tolerances?.length || 0,
            },
          };
        });
      }

      if (ext === ".mo") {
        // Modelica: extract component declarations and models
        const elements: AlignmentElement[] = [];
        const compRegex = /(?:Modelica\.[\w.]+|[\w.]+)\s+([a-zA-Z_]\w*)\s*(?:\([^)]*\))?\s*(?:=.*?)?;/g;
        let m: RegExpExecArray | null;
        let idCounter = 1;
        while ((m = compRegex.exec(content)) !== null) {
          const compName = m[1];
          if (
            compName &&
            !["equation", "algorithm", "initial", "annotation", "protected", "public", "end"].includes(compName)
          ) {
            elements.push({
              id: idCounter++,
              name: compName,
              domain: ThreadDomain.Modelica,
              type: "ModelicaComponent",
            });
          }
        }
        // Also extract model name
        const modelMatch = content.match(/model\s+([a-zA-Z_]\w*)/i);
        if (modelMatch && modelMatch[1]) {
          elements.push({
            id: 0,
            name: modelMatch[1],
            domain: ThreadDomain.Modelica,
            type: "ModelicaModel",
          });
        }
        return elements;
      }

      if (ext === ".sysml" || ext === ".sys2") {
        // SysML v2: extract part defs / part usages
        const elements: AlignmentElement[] = [];
        const partRegex = /(?:part|action|port|attribute)\s+(?:def\s+)?([a-zA-Z_]\w*)/g;
        let m: RegExpExecArray | null;
        let idCounter = 1;
        while ((m = partRegex.exec(content)) !== null) {
          if (m[1]) {
            elements.push({
              id: idCounter++,
              name: m[1],
              domain: ThreadDomain.SysML2,
              type: "SysMLPart",
            });
          }
        }
        return elements;
      }

      if (ext === ".reqif" || ext === ".xml" || content.includes("<REQ-IF")) {
        const spec = ReqIfParser.parse(content);
        return spec.requirements.map((r) => ({
          id: r.id,
          name: r.name || r.id,
          domain: ThreadDomain.Requirements,
          type: "Requirement",
          properties: r.attributes,
        }));
      }

      if (ext === ".json") {
        return JSON.parse(content);
      }

      console.warn(`Unrecognized file format for ${filePath}, treating as generic tokens`);
      return [];
    };

    const sourceElements = extractElements(srcPath);
    const targetElements = extractElements(tgtPath);

    const engine = new BrownfieldAlignmentEngine();
    const candidates = engine.alignModels(sourceElements, targetElements, {
      minConfidence: args["min-confidence"],
      topKPerSource: 3,
    });

    if (args.json) {
      console.log(JSON.stringify(candidates, null, 2));
    } else {
      console.log(
        `\n\x1b[1mBrownfield Alignment:\x1b[0m ${path.basename(srcPath)} (${sourceElements.length} elements) ⟷ ${path.basename(tgtPath)} (${targetElements.length} elements)`,
      );
      console.log(engine.formatCandidatesTable(candidates));
    }

    if (args.apply) {
      const hypergraph = new DigitalThreadHypergraph();
      const seedResult = engine.applySeeds(candidates, hypergraph, {
        minConfidence: args.threshold,
      });

      console.log(
        `\n\x1b[32m[Auto-Seed]\x1b[0m Applied ${seedResult.seededCount} correspondences into ${seedResult.threadsCreated} hypergraph threads (threshold >= ${args.threshold})`,
      );
      if (args.hypergraph) {
        const hPath = path.resolve(process.cwd(), args.hypergraph);
        // Save hypergraph records
        const records = [];
        for (let i = 0; i < hypergraph.getThreadCount(); i++) {
          const rec = hypergraph.getRecord(i);
          if (rec) records.push(rec);
        }
        fs.writeFileSync(hPath, JSON.stringify(records, null, 2), "utf-8");
        console.log(`Updated hypergraph state saved to ${hPath}`);
      }
    }
  },
};
