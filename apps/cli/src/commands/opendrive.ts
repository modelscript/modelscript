// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  lintOpenDrive,
  lowerOpenDriveToDae,
  opendriveToGensys,
  parseOpenDrive,
  renderOpenDriveSvg,
  sampleRoadTrack,
} from "@modelscript/opendrive";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OpenDriveCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "opendrive <action> [files...]",
  describe: "Inspect, validate, sample trajectories, render, and project ASAM OpenDRIVE road networks (.xodr, .xml)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: inspect | lint | track | to-gensys | to-dae | render",
        choices: ["inspect", "lint", "track", "to-gensys", "to-dae", "render"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input OpenDRIVE roadway files (.xodr, .xml)",
      })
      .option("out", {
        alias: ["o", "output"],
        type: "string",
        describe: "Output file path for generated track or SVG diagram",
      })
      .option("step", {
        type: "number",
        default: 1.0,
        describe: "Discretization sampling step along road reference line in meters",
      })
      .option("theme", {
        type: "string",
        choices: ["dark", "light"],
        default: "dark",
        describe: "Visual theme for vector SVG rendering (dark | light)",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const step = (argv["step"] as number) ?? 1.0;
    const theme = (argv["theme"] as "dark" | "light") ?? "dark";
    const outFile = argv["out"] as string | undefined;

    if (files.length === 0) {
      console.error("Error: No input files provided.");
      process.exit(1);
    }

    for (const file of files) {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found: ${file}`);
        process.exit(1);
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      const doc = parseOpenDrive(content, file);

      switch (action) {
        case "inspect": {
          console.log(`\n=== ASAM OpenDRIVE Road Network: ${doc.header.name ?? path.basename(file)} ===`);
          console.log(`Schema Version: ${doc.header.revMajor}.${doc.header.revMinor}`);
          console.log(`Roads: ${doc.roads.length}`);
          console.log(`Junctions: ${doc.junctions.length}`);

          let totalLen = 0;
          for (const r of doc.roads) {
            totalLen += r.length;
            console.log(
              `  - Road '${r.id}' (${r.name ?? "unnamed"}): length=${r.length.toFixed(1)}m, segments=${r.planView.length}, lanes=${r.lanes.laneSections.length}, signals=${r.signals.length}`,
            );
          }
          console.log(`Total Roadway Length: ${totalLen.toFixed(1)} m\n`);
          break;
        }

        case "lint": {
          const diags = lintOpenDrive(doc);
          if (diags.length === 0) {
            console.log(`✓ ${file}: 0 diagnostics reported. Road network is geometrically valid.`);
          } else {
            console.log(`Found ${diags.length} diagnostic(s) in ${file}:`);
            for (const d of diags) {
              const loc = `${file}:${d.range.startLine}:${d.range.startColumn}`;
              console.log(`  [${d.code}] [${d.severity.toUpperCase()}] ${loc} - ${d.message}`);
            }
          }
          break;
        }

        case "track": {
          const allTracks = doc.roads.map((r) => ({
            roadId: r.id,
            name: r.name,
            points: sampleRoadTrack(r, step),
          }));

          const json = JSON.stringify(allTracks, null, 2);
          if (outFile) {
            fs.writeFileSync(outFile, json, "utf-8");
            console.log(`Saved 3D track trajectories to ${outFile}`);
          } else {
            console.log(json);
          }
          break;
        }

        case "to-gensys": {
          const gensys = opendriveToGensys(doc, step);
          if (outFile) {
            fs.writeFileSync(outFile, gensys, "utf-8");
            console.log(`Saved GENSYS track deck to ${outFile}`);
          } else {
            console.log(gensys);
          }
          break;
        }

        case "to-dae": {
          const arena = lowerOpenDriveToDae(doc);
          console.log(`Lowered OpenDRIVE road network into linear DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          break;
        }

        case "render": {
          const svg = renderOpenDriveSvg(doc, { sampleStep: step, theme });
          if (outFile) {
            fs.writeFileSync(outFile, svg, "utf-8");
            console.log(`Saved OpenDRIVE SVG road schematic to ${outFile}`);
          } else {
            console.log(svg);
          }
          break;
        }

        default:
          console.error(`Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
