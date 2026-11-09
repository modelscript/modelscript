// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Fiber Outside Plant & GIS Subcommand.
 *
 * Provides headless CLI operations for outside plant optical fiber networks:
 * - `msx fiber locate <route.geojson> --distance <meters> [--helix 1.03]`
 * - `msx fiber trace <network.json> --cable <id> --strand <n>`
 * - `msx fiber srlg <network.json>`
 * - `msx fiber color <strandNumber>`
 */

import {
  findNetworkSrlgSpofs,
  locateOtdrFault,
  parseFiberGis,
  resolveStrandColor,
  type FiberCableSpan,
  type FiberStructureNode,
  type SrlgNetwork,
  type SrlgPath,
  type SrlgSegment,
} from "@modelscript/fiber";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const FiberCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "fiber <action> [files...]",
  describe: "Locate OTDR faults along GIS cable paths, trace strand continuity, and audit SRLG diversity",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (locate, otdr-fault, trace, srlg, color)",
        type: "string",
        choices: ["locate", "otdr-fault", "trace", "srlg", "color"],
        demandOption: true,
      })
      .positional("files", {
        description: "Fiber GIS route (GeoJSON) or network model files",
        type: "string",
        array: true,
      })
      .option("distance", {
        alias: "d",
        description: "Optical distance to event in meters from OTDR launch",
        type: "number",
      })
      .option("helix", {
        description: "Cable helix factor (optical length / sheath length)",
        type: "number",
        default: 1.03,
      })
      .option("cable", {
        alias: "c",
        description: "Starting cable ID for strand trace",
        type: "string",
      })
      .option("strand", {
        alias: "s",
        description: "Strand number (1-based)",
        type: "number",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];

    switch (action) {
      case "color": {
        const strandNumber = Number(argv["strand"] ?? files[0] ?? 1);
        if (Number.isNaN(strandNumber) || strandNumber < 1) {
          console.error("[fiber] Please provide a valid 1-based strand number (e.g. msx fiber color --strand 14).");
          process.exit(1);
        }

        const assign = resolveStrandColor(strandNumber);
        console.log(`\n=== ANSI/TIA-598-D Color Code Assignment ===`);
        console.log(`Strand Index:  #${assign.strandNumber}`);
        console.log(`Tube Number:   #${assign.tubeNumber} (${assign.tubeColor.name})`);
        console.log(`Strand Color:  ${assign.fiberColor.name}`);
        console.log(`Hex Swatch:    Tube: ${assign.tubeColor.hex} | Fiber: ${assign.fiberColor.hex}`);
        if (assign.fiberHasStripe || assign.tubeHasStripe) {
          console.log(`Tracer Stripe: Black dashed tracer stripe (strands 13-24)`);
        }
        return;
      }

      case "locate":
      case "otdr-fault": {
        const distanceMeters = Number(argv["distance"]);
        if (!distanceMeters || distanceMeters <= 0) {
          console.error("[fiber] Please specify optical distance in meters via --distance <meters>.");
          process.exit(1);
        }

        if (files.length === 0) {
          console.error("[fiber] No GeoJSON or fiber network file specified.");
          process.exit(1);
        }

        const absPath = path.resolve(process.cwd(), files[0]!);
        if (!fs.existsSync(absPath)) {
          console.error(`[fiber] File not found: ${absPath}`);
          process.exit(1);
        }

        const raw = fs.readFileSync(absPath, "utf-8");
        const parsed = parseFiberGis(raw);
        const helixFactor = Number(argv["helix"] ?? 1.03);

        const firstCable = Array.from(parsed.cables.values())[0] as FiberCableSpan | undefined;
        if (!firstCable) {
          console.error("[fiber] No cable spans found in provided network file.");
          process.exit(1);
        }

        const enclosures = Array.from(parsed.nodes.values()) as FiberStructureNode[];
        const result = locateOtdrFault({
          cable: firstCable,
          opticalDistanceMeters: distanceMeters,
          helixFactor,
          enclosures,
        });

        console.log(`\n=== OTDR-to-GIS Precision Fault Localization ===`);
        console.log(`Optical Distance (OTDR):    ${distanceMeters.toFixed(1)} m`);
        console.log(`Helix Factor Correction:    ${helixFactor}`);
        console.log(`Physical Sheath Distance:   ${result.physicalSheathDistanceMeters.toFixed(1)} m`);
        console.log(
          `GPS Coordinate (Lon, Lat):  [${result.gpsCoordinate[0].toFixed(6)}, ${result.gpsCoordinate[1].toFixed(6)}]`,
        );
        if (result.nearestEnclosure) {
          console.log(`Nearest Splice Enclosure:   ${result.nearestEnclosure.name} (${result.nearestEnclosure.type})`);
          console.log(
            `Enclosure Distance:         ${result.nearestEnclosure.distanceToFaultMeters.toFixed(1)} m ${result.nearestEnclosure.direction}`,
          );
          console.log(
            `Enclosure GPS:              [${result.nearestEnclosure.gpsCoordinate[0].toFixed(6)}, ${result.nearestEnclosure.gpsCoordinate[1].toFixed(6)}]`,
          );
        }
        return;
      }

      case "trace": {
        if (files.length === 0) {
          console.error("[fiber] No fiber network file specified.");
          process.exit(1);
        }

        const absPath = path.resolve(process.cwd(), files[0]!);
        const raw = fs.readFileSync(absPath, "utf-8");
        const network = parseFiberGis(raw);

        const cableId = String(argv["cable"] ?? Array.from(network.cables.keys())[0] ?? "");
        const strandIdx = Number(argv["strand"] ?? 1);

        const hops = network.traceStrand(cableId, strandIdx);
        const totalOpticalLen = hops.reduce((sum, h) => sum + h.lengthMeters, 0);
        console.log(`\n=== Optical Strand Continuity Trace ===`);
        console.log(`Start Cable:      ${cableId} (Strand #${strandIdx})`);
        console.log(`Span Hops:        ${hops.length}`);
        console.log(`Total Length:     ${totalOpticalLen.toFixed(1)} m`);
        console.log(`----------------------------------------------------------------`);
        for (const [idx, hop] of hops.entries()) {
          console.log(
            `  Hop ${idx + 1}: Cable ${hop.cableId} -> Strand #${hop.strandNumber} (${hop.lengthMeters.toFixed(1)} m, Loss: ${hop.lossDb.toFixed(2)} dB)`,
          );
        }
        return;
      }

      case "srlg": {
        if (files.length === 0) {
          console.error("[fiber] No fiber network file specified.");
          process.exit(1);
        }

        const absPath = path.resolve(process.cwd(), files[0]!);
        const raw = fs.readFileSync(absPath, "utf-8");
        const network = parseFiberGis(raw);

        const segments: SrlgSegment[] = [];
        const pathsList: SrlgPath[] = [];

        for (const [cableId, cable] of network.cables.entries()) {
          const srlgIds = cable.conduitId ? [cable.conduitId] : [`CONDUIT-${cableId}`];
          const segId = `SEG-${cableId}`;
          segments.push({
            segmentId: segId,
            fromNodeId: cable.fromNodeId,
            toNodeId: cable.toNodeId,
            cableId,
            lengthMeters: cable.sheathLengthMeters,
            srlgIds,
          });

          pathsList.push({
            pathId: `PATH-${cableId}`,
            segmentIds: [segId],
            totalLengthMeters: cable.sheathLengthMeters,
            srlgIds: new Set(srlgIds),
          });
        }

        const srlgNet: SrlgNetwork = {
          nodes: Array.from(network.nodes.values()).map((n) => ({ id: n.id, name: n.name })),
          segments,
        };

        const spofs = findNetworkSrlgSpofs(pathsList, srlgNet);
        console.log(`\n=== Shared Risk Link Group (SRLG) Diversity Audit ===`);
        console.log(`Total Cables Analyzed: ${network.cables.size}`);
        console.log(`Single Points of Failure (SPOFs): ${spofs.length}`);
        if (spofs.length > 0) {
          console.log(`\n⚠ Detected Critical SPOFs:`);
          for (const spof of spofs) {
            console.log(
              `  - Risk Group '${spof.srlgId}' (${spof.riskType}) shared by paths: ${spof.affectingPaths.join(", ")}`,
            );
          }
        } else {
          console.log(`✓ All analyzed paths verified route-disjoint. Zero SPOFs detected.`);
        }
        return;
      }

      default:
        console.error(`[fiber] Unknown action: ${action}`);
        process.exit(1);
    }
  },
};
