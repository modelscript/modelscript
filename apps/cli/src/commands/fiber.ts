// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Fiber Outside Plant, GIS & Structural Subcommand.
 *
 * Provides headless CLI operations for outside plant optical fiber networks:
 * - `msx fiber locate <route.geojson> --distance <meters> [--helix 1.03]`
 * - `msx fiber trace <network.json> --cable <id> --strand <n>`
 * - `msx fiber srlg <network.json>`
 * - `msx fiber color <strandNumber>`
 * - `msx fiber bdc <route.geojson> [--tech 50] [--down 1000] [--up 1000] [--res 9] [--out bdc.geojson]`
 * - `msx fiber pole-loading [--pole-class 4] [--species southern-yellow-pine] [--length 40] [--grade C-elsewhere]`
 * - `msx fiber make-ready [--prop-height 21]`
 */

import {
  auditPoleMakeReady,
  discretizeCoverageToH3,
  evaluateCsaPoleStress,
  evaluateEurocodeMastLoading,
  evaluatePoleLoading,
  findNetworkSrlgSpofs,
  locateOtdrFault,
  parseFiberGis,
  resolveStrandColor,
  type BdcTechnologyProfile,
  type CsaPoleAnalysisConfig,
  type EurocodeMastLoadingConfig,
  type FiberCableSpan,
  type FiberStructureNode,
  type H3Resolution,
  type NescConstructionGrade,
  type PoleAttachmentLoad,
  type PoleAttachmentPosition,
  type PoleClass,
  type PoleSpecification,
  type SrlgNetwork,
  type SrlgPath,
  type SrlgSegment,
  type WoodSpecies,
} from "@modelscript/fiber";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

/**
 * Traverses GeoJSON / geometry structures and extracts all coordinate pairs [longitude, latitude].
 */
function extractCoordinatesFromGeoJson(data: unknown): Array<[number, number]> {
  const points: Array<[number, number]> = [];

  function collectFromGeometry(geom: unknown): void {
    if (!geom || typeof geom !== "object") return;
    const g = geom as { type?: string; coordinates?: unknown; geometries?: unknown[] };
    if (!g.type || !g.coordinates) return;

    switch (g.type) {
      case "Point":
        if (Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
          points.push([Number(g.coordinates[0]), Number(g.coordinates[1])]);
        }
        break;
      case "MultiPoint":
      case "LineString":
        if (Array.isArray(g.coordinates)) {
          for (const coord of g.coordinates) {
            if (Array.isArray(coord) && coord.length >= 2) {
              points.push([Number(coord[0]), Number(coord[1])]);
            }
          }
        }
        break;
      case "MultiLineString":
      case "Polygon":
        if (Array.isArray(g.coordinates)) {
          for (const ring of g.coordinates) {
            if (Array.isArray(ring)) {
              for (const coord of ring) {
                if (Array.isArray(coord) && coord.length >= 2) {
                  points.push([Number(coord[0]), Number(coord[1])]);
                }
              }
            }
          }
        }
        break;
      case "MultiPolygon":
        if (Array.isArray(g.coordinates)) {
          for (const poly of g.coordinates) {
            if (Array.isArray(poly)) {
              for (const ring of poly) {
                if (Array.isArray(ring)) {
                  for (const coord of ring) {
                    if (Array.isArray(coord) && coord.length >= 2) {
                      points.push([Number(coord[0]), Number(coord[1])]);
                    }
                  }
                }
              }
            }
          }
        }
        break;
      case "GeometryCollection":
        if (Array.isArray(g.geometries)) {
          for (const sub of g.geometries) {
            collectFromGeometry(sub);
          }
        }
        break;
    }
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      if (Array.isArray(item) && item.length >= 2) {
        points.push([Number(item[0]), Number(item[1])]);
      } else if (item && typeof item === "object") {
        const obj = item as { geometry?: unknown };
        collectFromGeometry(obj.geometry ?? item);
      }
    }
  } else if (data && typeof data === "object") {
    const root = data as { type?: string; features?: unknown[]; geometry?: unknown };
    if (root.type === "FeatureCollection" && Array.isArray(root.features)) {
      for (const feat of root.features) {
        if (feat && typeof feat === "object") {
          collectFromGeometry((feat as { geometry?: unknown }).geometry);
        }
      }
    } else if (root.type === "Feature") {
      collectFromGeometry(root.geometry);
    } else if (root.type) {
      collectFromGeometry(root);
    }
  }

  return points;
}

export const FiberCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "fiber <action> [files...]",
  describe:
    "Locate OTDR faults along GIS cable paths, trace strand continuity, audit SRLG diversity, prepare FCC BDC fabric, and perform NESC pole loading FEA",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (locate, otdr-fault, trace, srlg, color, bdc, pole-loading, make-ready)",
        type: "string",
        choices: ["locate", "otdr-fault", "trace", "srlg", "color", "bdc", "pole-loading", "make-ready"],
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
      })
      .option("tech", {
        description: "BDC Technology Code (50=FTTH, 70=5G-NR Mobile, 71=5G Fixed Wireless)",
        type: "number",
        default: 50,
      })
      .option("down", {
        description: "Maximum advertised download speed in Mbps",
        type: "number",
        default: 1000,
      })
      .option("up", {
        description: "Maximum advertised upload speed in Mbps",
        type: "number",
        default: 1000,
      })
      .option("low-latency", {
        description: "Low-latency service indicator (RTT <= 100ms)",
        type: "boolean",
        default: true,
      })
      .option("res", {
        description: "H3 spatial resolution (8 or 9)",
        type: "number",
        default: 9,
      })
      .option("provider", {
        description: "Broadband service provider brand name",
        type: "string",
        default: "ModelScript Fiber Provider",
      })
      .option("out", {
        alias: "o",
        description: "Output file path to save BDC filing (GeoJSON or CSV)",
        type: "string",
      })
      .option("format", {
        description: "Output format for BDC filing (geojson, csv, json)",
        type: "string",
        choices: ["geojson", "csv", "json"],
      })
      .option("pole-class", {
        description: "ANSI O5.1 wood pole class (1-6)",
        type: "string",
        default: "4",
        choices: ["1", "2", "3", "4", "5", "6"],
      })
      .option("species", {
        description: "Wood pole species",
        type: "string",
        default: "southern-yellow-pine",
        choices: ["southern-yellow-pine", "douglas-fir", "western-red-cedar", "lodgepole-pine"],
      })
      .option("length", {
        description: "Total pole length in feet (e.g. 35, 40, 45)",
        type: "number",
        default: 40.0,
      })
      .option("grade", {
        description: "NESC construction grade (B, C-crossing, C-elsewhere)",
        type: "string",
        default: "C-elsewhere",
        choices: ["B", "C-crossing", "C-elsewhere"],
      })
      .option("district", {
        description: "NESC Rule 250 environmental loading district",
        type: "string",
        default: "heavy",
        choices: ["heavy", "medium", "light", "extreme-wind"],
      })
      .option("prop-height", {
        description: "Proposed fiber attachment height above ground in feet",
        type: "number",
        default: 21.0,
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

      case "bdc": {
        if (files.length === 0) {
          console.error("[fiber] Please specify a GeoJSON route/boundary file or coordinates JSON.");
          process.exit(1);
        }

        const absPath = path.resolve(process.cwd(), files[0]!);
        if (!fs.existsSync(absPath)) {
          console.error(`[fiber] File not found: ${absPath}`);
          process.exit(1);
        }

        const raw = fs.readFileSync(absPath, "utf-8");
        let samplePoints: Array<[number, number]> = [];

        try {
          const parsedJson = JSON.parse(raw);
          samplePoints = extractCoordinatesFromGeoJson(parsedJson);
        } catch {
          try {
            const network = parseFiberGis(raw);
            for (const cable of network.cables.values()) {
              samplePoints.push(...cable.pathCoordinates);
            }
            for (const node of network.nodes.values()) {
              samplePoints.push(node.coordinates);
            }
          } catch {
            console.error("[fiber] Failed to parse input file as GeoJSON or Fiber GIS.");
            process.exit(1);
          }
        }

        if (samplePoints.length === 0) {
          console.error("[fiber] No valid coordinates found in input file for H3 discretization.");
          process.exit(1);
        }

        const techCode = Number(argv["tech"] ?? 50);
        const downMbps = Number(argv["down"] ?? 1000);
        const upMbps = Number(argv["up"] ?? 1000);
        const lowLatency = Boolean(argv["low-latency"] ?? true);
        const rawRes = Number(argv["res"] ?? 9);
        const resolution: H3Resolution = rawRes === 8 ? 8 : 9;
        const providerName = String(argv["provider"] ?? "ModelScript Fiber Provider");

        const techProfile: BdcTechnologyProfile = {
          techCode,
          maxDownloadMbps: downMbps,
          maxUploadMbps: upMbps,
          lowLatency,
          providerName,
        };

        const dataset = discretizeCoverageToH3(samplePoints, techProfile, resolution);

        const techDescription =
          techCode === 50
            ? "Optical Carrier / FTTH"
            : techCode === 70
              ? "5G-NR Mobile Broadband"
              : techCode === 71
                ? "Licensed Fixed Wireless"
                : `Tech Code ${techCode}`;

        console.log(`\n=== FCC Broadband Data Collection (BDC) Spatial Fabric ===`);
        console.log(`Technology:       ${techCode} (${techDescription})`);
        console.log(`H3 Resolution:    Res ${dataset.resolution} (~${dataset.resolution === 9 ? "174m edge" : "461m edge"})`);
        console.log(`Max Advertised:   ${downMbps} Mbps Down / ${upMbps} Mbps Up`);
        console.log(`Low Latency:      ${lowLatency ? "Yes (<=100ms RTT)" : "No"}`);
        console.log(`Provider:         ${providerName}`);
        console.log(`Total Points:     ${samplePoints.length}`);
        console.log(`Total Hexagons:   ${dataset.totalHexagons}`);
        console.log(
          `Sample H3 IDs:    ${dataset.hexagons.slice(0, 5).map((h) => h.h3Index).join(", ")}${dataset.totalHexagons > 5 ? "..." : ""}`,
        );

        const outPath = argv["out"] as string | undefined;
        if (outPath) {
          const resolvedOut = path.resolve(process.cwd(), outPath);
          const format = (argv["format"] as string | undefined) ?? (outPath.endsWith(".csv") ? "csv" : "geojson");

          if (format === "csv") {
            fs.writeFileSync(resolvedOut, dataset.csvSummary, "utf-8");
          } else {
            fs.writeFileSync(resolvedOut, JSON.stringify(dataset.geojson, null, 2), "utf-8");
          }
          console.log(`\n✓ Exported FCC BDC submission dataset to: ${resolvedOut}`);
        }
        return;
      }

      case "pole-loading": {
        const std = String(argv["standard"] ?? "nesc").toLowerCase();

        if (std.includes("csa") || std.includes("canada")) {
          const lengthM = Number(argv["length-m"] ?? (Number(argv["length"] ?? 40.0) * 0.3048));
          const csaConfig: CsaPoleAnalysisConfig = {
            poleId: "POLE-DIST-01",
            species: "western-red-cedar",
            overallLengthMeters: lengthM,
            circumferenceAtGroundLineMeters: 0.95,
            circumferenceAtTopMeters: 0.55,
            constructionGrade: "grade-2",
            loadingDistrict: (argv["district"] as any) ?? "heavy",
            attachments: [
              {
                id: "FIBER-PROP",
                type: "telecom-fiber",
                attachmentHeightMeters: lengthM * 0.65,
                bareCableDiameterMm: 15.0,
                bareCableWeightKgPerM: 0.3,
                spanLengthMeters: 50.0,
              },
            ],
          };
          const report = evaluateCsaPoleStress(csaConfig);
          console.log(`\n================================================================`);
          console.log(`CSA C22.3 NO. 1 & CSA 015 OVERHEAD POLE STRESS ANALYSIS`);
          console.log(`================================================================`);
          console.log(`Pole Identification:        ${report.poleId}`);
          console.log(`Loading District:           ${report.district.toUpperCase()}`);
          console.log(`Construction Grade:         ${report.constructionGrade} (phi = ${report.resistanceFactorPhi})`);
          console.log(`Length / Setting Depth:     ${lengthM.toFixed(1)} m (${report.settingDepthMeters} m buried, ${report.aboveGroundHeightMeters} m AGL)`);
          console.log(`Section Modulus (Z):        ${report.groundLineSectionModulusM3.toFixed(6)} m³`);
          console.log(`Resisting Moment Capacity:  ${report.resistingMomentCapacityNm.toLocaleString()} N·m`);
          console.log(`Total Ground-Line Moment:   ${report.totalGroundLineMomentNm.toLocaleString()} N·m`);
          console.log(`Pole Capacity Utilization:  ${report.poleCapacityUtilizationPercent.toFixed(1)} %`);
          console.log(`Compliance Verdict:         ${report.isCompliant ? "✓ PASS (Meets CSA C22.3 No. 1)" : "⚠ FAIL (Overloaded)"}`);
          console.log(`================================================================\n`);
          return;
        }

        if (std.includes("euro") || std.includes("en50341") || std.includes("cenelec")) {
          const heightM = Number(argv["length-m"] ?? (Number(argv["length"] ?? 40.0) * 0.3048));
          const euroConfig: EurocodeMastLoadingConfig = {
            mastId: "POLE-DIST-01",
            basicWindVelocityMPerS: 25.0,
            terrainCategory: "II",
            iceClass: "G2",
            overallHeightMeters: heightM,
            groundSectionModulusM3: 0.002,
            characteristicYieldStrengthMpa: 355.0,
            cables: [
              {
                id: "FIBER-PROP",
                attachmentHeightMeters: heightM * 0.65,
                bareDiameterMm: 15.0,
                bareWeightKgPerM: 0.3,
                spanLengthMeters: 50.0,
              },
            ],
          };
          const report = evaluateEurocodeMastLoading(euroConfig);
          console.log(`\n================================================================`);
          console.log(`EUROCODE EN 1991-1-4 & EN 50341 STRUCTURAL MAST ANALYSIS`);
          console.log(`================================================================`);
          console.log(`Mast Identification:        ${report.mastId}`);
          console.log(`Terrain Category / Ice:     Category ${report.terrainCategory} / Class ${report.iceClass}`);
          console.log(`Peak Wind Pressure at Top:  ${report.peakVelocityPressureAtTopPa.toFixed(1)} Pa`);
          console.log(`Design Bending Moment (Ed): ${report.designBendingMomentEdNm.toLocaleString()} N·m`);
          console.log(`Design Resistance (Rd):     ${report.designResistanceMomentRdNm.toLocaleString()} N·m`);
          console.log(`ULS Utilization Ratio:      ${report.utilizationRatioPercent.toFixed(1)} %`);
          console.log(`Compliance Verdict:         ${report.isCompliant ? "✓ PASS (Meets Eurocode 3 ULS)" : "⚠ FAIL (ULS Resistance Exceeded)"}`);
          console.log(`================================================================\n`);
          return;
        }

        const pClass = String(argv["pole-class"] ?? "4") as PoleClass;
        const species = String(argv["species"] ?? "southern-yellow-pine") as WoodSpecies;
        const lengthFeet = Number(argv["length"] ?? 40.0);
        const grade = String(argv["grade"] ?? "C-elsewhere") as NescConstructionGrade;

        const pole: PoleSpecification = {
          poleId: "POLE-DIST-01",
          species,
          poleClass: pClass,
          lengthFeet,
        };

        const attachments: PoleAttachmentLoad[] = [
          {
            attachmentId: "PRI-1",
            description: "13.2 kV 3-Phase Primary",
            heightAboveGroundFeet: lengthFeet - 7.0, // e.g. 33 ft on 40 ft pole
            transverseWindForceLbs: 95.0,
            tensionForceLbs: 110.0,
          },
          {
            attachmentId: "SEC-1",
            description: "120/240V Secondary Neutral",
            heightAboveGroundFeet: lengthFeet - 12.0, // e.g. 28 ft
            transverseWindForceLbs: 65.0,
            tensionForceLbs: 45.0,
          },
          {
            attachmentId: "TELCO",
            description: "Incumbent Telco Copper",
            heightAboveGroundFeet: lengthFeet - 18.0, // e.g. 22 ft
            transverseWindForceLbs: 35.0,
            tensionForceLbs: 20.0,
          },
          {
            attachmentId: "FIBER-PROP",
            description: "Proposed 48-Fiber Aerial Messenger",
            heightAboveGroundFeet: Number(argv["prop-height"] ?? 21.0),
            transverseWindForceLbs: 25.0,
            tensionForceLbs: 15.0,
          },
        ];

        const result = evaluatePoleLoading(pole, attachments, { grade });

        console.log(`\n================================================================`);
        console.log(`NESC RULE 250/260 & ANSI O5.1 POLE LOADING ANALYSIS`);
        console.log(`================================================================`);
        console.log(`Pole Identification:        ${result.poleId}`);
        console.log(`Species / Class:            ${result.species} (${result.poleClass})`);
        console.log(
          `Length / Setting Depth:     ${result.lengthFeet} ft (${result.settingDepthFeet} ft buried, ${result.heightAboveGroundFeet} ft AGL)`,
        );
        console.log(
          `Ground-Line Circumference:  ${result.groundLineCircumferenceInches}" (Diameter: ${result.groundLineDiameterInches}")`,
        );
        console.log(`Section Modulus (Z):        ${result.sectionModulusCubicInches} in³`);
        console.log(`Resisting Moment Capacity:  ${result.nominalBendingCapacityFtLbs.toLocaleString()} ft-lbs`);
        console.log(`----------------------------------------------------------------`);
        console.log(`NESC Construction Grade:    Grade ${result.constructionGrade}`);
        console.log(`Pole Wind Moment (Factored):${result.poleWindMomentFtLbs.toLocaleString()} ft-lbs`);
        console.log(`Conductor Factored Moments: ${result.attachmentsFactoredMomentFtLbs.toLocaleString()} ft-lbs`);
        console.log(`Total Factored Moment:      ${result.totalFactoredMomentFtLbs.toLocaleString()} ft-lbs`);
        console.log(`Pole Capacity Utilization:  ${result.percentPoleLoading.toFixed(1)} %`);
        console.log(
          `Compliance Verdict:         ${result.isCompliant ? "✓ PASS (Meets NESC Rule 260)" : "⚠ FAIL (Overloaded - Guying Required)"}`,
        );
        console.log(`================================================================\n`);
        return;
      }

      case "make-ready": {
        const propHeight = Number(argv["prop-height"] ?? 21.0);
        const existing: PoleAttachmentPosition[] = [
          {
            id: "PRI-1",
            ownerName: "Utility Electric",
            utilityType: "electric-primary",
            heightAboveGroundFeet: 33.0,
          },
          {
            id: "SEC-1",
            ownerName: "Utility Electric",
            utilityType: "electric-secondary",
            heightAboveGroundFeet: 28.0,
          },
          {
            id: "XFMR-DRIP",
            ownerName: "Utility Electric",
            utilityType: "electric-equipment",
            heightAboveGroundFeet: 26.5,
          },
          {
            id: "TELCO-1",
            ownerName: "Verizon",
            utilityType: "telco-incumbent",
            heightAboveGroundFeet: 22.0,
          },
        ];

        const proposed: PoleAttachmentPosition = {
          id: "FIBER-PROP",
          ownerName: "ModelScript Fiber",
          utilityType: "third-party-fiber",
          heightAboveGroundFeet: propHeight,
          midSpanSagFeet: 2.0,
        };

        const audit = auditPoleMakeReady("POLE-DIST-01", existing, proposed, { crossing: "roadway" });
        console.log(`\n${audit.jointUseExhibitText}`);
        return;
      }

      default:
        console.error(`[fiber] Unknown action: ${action}`);
        process.exit(1);
    }
  },
};
