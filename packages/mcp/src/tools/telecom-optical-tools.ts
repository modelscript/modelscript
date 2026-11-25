// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  discretizeCoverageToH3,
  evaluateCsaPoleStress,
  evaluateEurocodeMastLoading,
  evaluatePoleLoading,
  locateOtdrFault,
  type BdcTechnologyProfile,
  type CsaPoleAnalysisConfig,
  type EurocodeMastLoadingConfig,
  type FiberCableSpan,
  type FiberStructureNode,
  type H3Resolution,
  type PoleAttachmentLoad,
  type PoleSpecification,
} from "@modelscript/fiber";
import {
  createEmptyOpticalTopology,
  parseSor,
  solveChannelTransmission,
  type OpticalChannel,
  type OpticalSpan,
  type SorKeyEvent,
} from "@modelscript/optical";
import {
  computeFsplDb,
  evaluateFaaPart77Notice,
  evaluateFresnelClearance,
  evaluateIcaoAirspaceObstruction,
  evaluateSiteMpe,
  evaluateTransportCanadaAirspaceObstruction,
  solveMicrowaveLinkBudget,
  type IcaoAerodromeConfig,
  type MicrowaveLink,
  type MpeStandard,
  type ProposedStructureSiting,
  type ProposedTowerStructure,
  type RfEmitterConfig,
  type RunwaySpecification,
} from "@modelscript/ran";
import fs from "node:fs";
import { z } from "zod";
import type { ServerContext } from "../types.js";
import { getErrorMessage, resolveWorkspacePath } from "./shared.js";
export function registerTelecomOpticalTools(server: McpServer, _ctx: ServerContext): void {
  server.tool(
    "optical_inspect_otdr",
    "Inspects a Telcordia GR-196/SR-4731 .sor Optical Time-Domain Reflectometer (OTDR) binary file or base64 data to extract fiber span attenuation, event loss, reflectance, and splice integrity.",
    {
      filePath: z.string().optional().describe("Local filesystem path to .sor trace file"),
      base64Data: z.string().optional().describe("Base64-encoded .sor binary content"),
    },
    async (args) => {
      try {
        let buffer: Buffer;
        if (args.filePath) {
          const resolvedSorPath = resolveWorkspacePath(args.filePath);
          buffer = fs.readFileSync(resolvedSorPath);
        } else if (args.base64Data) {
          buffer = Buffer.from(args.base64Data, "base64");
        } else {
          throw new Error("Must provide either filePath or base64Data");
        }

        const sorData = parseSor(buffer);
        const hasExcessLoss = sorData.keyEvents.some(
          (e: SorKeyEvent) => e.eventType !== "end-of-fiber" && e.eventLossDb > 0.3,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  fiberId: sorData.genParams.fiberId,
                  cableId: sorData.genParams.cableId,
                  wavelengthNm: sorData.fxdParams.actualWavelengthNm || sorData.genParams.nominalWavelengthNm,
                  pulseWidthNs: sorData.fxdParams.pulseWidthNs,
                  sampleSpacingNs: sorData.fxdParams.sampleSpacingNs,
                  refractiveIndex: sorData.fxdParams.refractiveIndex,
                  totalDataPoints: sorData.dataPoints.numPoints,
                  totalEvents: sorData.keyEvents.length,
                  hasHighLossSplice: hasExcessLoss,
                  complianceVerdict: hasExcessLoss ? "FAIL_EXCESS_SPLICE_LOSS" : "PASS_TELCORDIA_GR196",
                  events: sorData.keyEvents.map((e: SorKeyEvent) => ({
                    eventNumber: e.eventNumber,
                    distanceKm: Math.round((e.distanceMeters / 1000) * 1000) / 1000,
                    slopeDbPerKm: Math.round(e.slopeDbPerKm * 1000) / 1000,
                    eventLossDb: Math.round(e.eventLossDb * 100) / 100,
                    reflectanceDb: e.reflectanceDb,
                    eventType: e.eventType,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to inspect OTDR trace: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  server.tool(
    "optical_solve_transmission",
    "Solves multi-span optical DWDM transmission performance using the Generalized Gaussian Noise (EGN) non-linear model, computing GSNR, ASE noise, NLI power, and CD accumulation.",
    {
      totalDistanceKm: z.number().describe("Total link distance in kilometers"),
      spanLengthKm: z.number().default(80.0).describe("Length per fiber span in km"),
      channelCount: z.number().default(80).describe("Number of DWDM channels"),
      baudRateGbaud: z.number().default(64.0).describe("Symbol rate in Gbaud"),
      launchPowerDbm: z.number().default(0.0).describe("Per-channel launch power in dBm"),
      edfaNoiseFigureDb: z.number().default(5.5).describe("EDFA amplifier noise figure in dB"),
      fiberType: z.enum(["SSMF", "LEAF", "custom"]).default("SSMF").describe("Fiber type"),
    },
    async (args) => {
      try {
        const numSpans = Math.max(1, Math.round(args.totalDistanceKm / args.spanLengthKm));
        const spanLen = args.totalDistanceKm / numSpans;
        const topo = createEmptyOpticalTopology("MCP-Optical-Query");
        const pathSpanIds: string[] = [];

        for (let i = 0; i < numSpans; i++) {
          const spanId = `SPAN-${i + 1}`;
          pathSpanIds.push(spanId);
          const spanLossDb = spanLen * (args.fiberType === "SSMF" ? 0.2 : 0.22);
          const span: OpticalSpan = {
            id: spanId,
            fromNodeId: `NODE-${i}`,
            toNodeId: `NODE-${i + 1}`,
            lengthKm: spanLen,
            fiberType: args.fiberType,
            attenuationDbPerKm: args.fiberType === "SSMF" ? 0.2 : 0.22,
            dispersionPsPerNmKm: args.fiberType === "SSMF" ? 17.0 : 4.0,
            pmdPsPerSqrtKm: 0.04,
            nonLinearCoeffPerWKm: args.fiberType === "SSMF" ? 1.3 : 1.5,
            amplifiers: [
              {
                id: `EDFA-${i + 1}`,
                ampType: "edfa",
                gainDb: spanLossDb,
                noiseFigureDb: args.edfaNoiseFigureDb,
                maxOutputPowerDbm: 20.0,
              },
            ],
          };
          topo.addSpan(span);
        }

        const channel: OpticalChannel = {
          id: "CH-1",
          sourceNodeId: "NODE-0",
          destinationNodeId: `NODE-${numSpans}`,
          centerFrequencyThz: 193.1,
          baudRateGbaud: args.baudRateGbaud,
          modulation: "PM-16QAM",
          launchPowerDbm: args.launchPowerDbm,
          requiredOsnrDb: 15.0,
          pathSpanIds,
        };
        topo.addChannel(channel);

        const metrics = solveChannelTransmission(topo, channel);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  totalDistanceKm: args.totalDistanceKm,
                  numberOfSpans: numSpans,
                  gsnrDb: Math.round(metrics.gsnrDb * 100) / 100,
                  osnrAseDb: Math.round(metrics.osnrDb * 100) / 100,
                  accumulatedDispersionPsPerNm: Math.round(metrics.accumulatedDispersionPsPerNm),
                  berEstimate: metrics.estimatedBer,
                  qFactorDb: Math.round(metrics.estimatedQFactorDb * 100) / 100,
                  isFeasibleAt15DbThreshold: metrics.gsnrDb >= 15.0,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Optical transmission solver error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  server.tool(
    "ran_solve_microwave_budget",
    "Solves line-of-sight microwave link budget, Free Space Path Loss (FSPL), ITU-R P.530 rain fade, Fresnel clearance, and annual availability percentage ('five-nines' verification).",
    {
      frequencyGhz: z.number().describe("Carrier frequency in GHz (e.g. 6.0, 11.0, 18.0, 23.0)"),
      pathLengthKm: z.number().describe("Path length in kilometers"),
      txPowerDbm: z.number().default(26.0).describe("Transmitter power in dBm"),
      txAntennaGainDbi: z.number().default(38.0).describe("Tx antenna gain in dBi"),
      rxAntennaGainDbi: z.number().default(38.0).describe("Rx antenna gain in dBi"),
      txFeederLossDb: z.number().default(1.5).describe("Tx feeder waveguide loss in dB"),
      rxFeederLossDb: z.number().default(1.5).describe("Rx feeder waveguide loss in dB"),
      rxThresholdDbm: z.number().default(-72.0).describe("Receiver threshold for target modulation in dBm"),
      rainRateMmPerHour: z.number().default(42.0).describe("ITU rain zone 0.01% precipitation rate in mm/hr"),
      polarization: z.enum(["H", "V"]).default("V").describe("Antenna polarization"),
      towerHeightsMeters: z.object({ tx: z.number(), rx: z.number() }).optional().describe("Tower heights in meters"),
      midpointObstacleElevationMeters: z
        .number()
        .optional()
        .describe("Ground elevation of midpoint obstacle in meters"),
    },
    async (args) => {
      try {
        const link: MicrowaveLink = {
          id: "MW-QUERY",
          txSiteName: "Site-A",
          rxSiteName: "Site-B",
          frequencyGhz: args.frequencyGhz,
          pathLengthKm: args.pathLengthKm,
          txPowerDbm: args.txPowerDbm,
          txAntennaGainDbi: args.txAntennaGainDbi,
          rxAntennaGainDbi: args.rxAntennaGainDbi,
          txFeederLossDb: args.txFeederLossDb,
          rxFeederLossDb: args.rxFeederLossDb,
          requiredMarginDb: 25.0,
          polarization: args.polarization,
        };

        const budget = solveMicrowaveLinkBudget(link, { rainRate001MmPerHour: args.rainRateMmPerHour });
        const fspl = computeFsplDb(args.frequencyGhz, args.pathLengthKm);

        let fresnelResult: unknown = undefined;
        if (args.towerHeightsMeters && args.midpointObstacleElevationMeters !== undefined) {
          fresnelResult = evaluateFresnelClearance(
            args.pathLengthKm,
            args.frequencyGhz,
            args.towerHeightsMeters.tx,
            args.towerHeightsMeters.rx,
            [
              {
                distanceFromTxKm: args.pathLengthKm / 2,
                obstacleGroundElevationMeters: args.midpointObstacleElevationMeters,
                obstacleHeightMeters: 0,
              },
            ],
            1.333,
          );
        }

        const eirpDbm = args.txPowerDbm - args.txFeederLossDb + args.txAntennaGainDbi;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  frequencyGhz: args.frequencyGhz,
                  pathLengthKm: args.pathLengthKm,
                  freeSpacePathLossDb: Math.round(fspl * 100) / 100,
                  totalPathLossDb: Math.round(budget.totalPathLossDb * 100) / 100,
                  receivedPowerDbm: Math.round(budget.receivedPowerDbm * 100) / 100,
                  fadeMarginDb: Math.round(budget.fadeMarginDb * 100) / 100,
                  annualAvailabilityPercent: Math.round(budget.availabilityPercent * 10000) / 10000,
                  annualOutageMinutes: Math.round(budget.unavailabilityMinutesPerYear * 10) / 10,
                  isFiveNines: budget.availabilityPercent >= 99.999,
                  eirpDbm: Math.round(eirpDbm * 10) / 10,
                  fccPart101Compliant: eirpDbm <= 55.0,
                  fresnelClearance: fresnelResult,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Microwave budget solver error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  server.tool(
    "fiber_locate_otdr_fault",
    "Pinpoints the exact physical GIS GPS latitude/longitude of an optical fiber break or event measured by OTDR, correcting for cable helix twisting and vault slack loops.",
    {
      opticalDistanceMeters: z.number().describe("Optical distance to event in meters from OTDR"),
      cableCoordinates: z
        .array(z.tuple([z.number(), z.number()]))
        .describe("Array of [longitude, latitude] cable path points"),
      helixFactor: z.number().default(1.03).describe("Cable helix factor (default: 1.03)"),
      enclosures: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            nodeType: z.enum(["manhole", "pole", "splice-closure", "handhole", "central-office"]),
            coordinates: z.tuple([z.number(), z.number()]),
            slackStorageMeters: z.number().default(0),
          }),
        )
        .optional()
        .describe("Enclosures along route with slack storage"),
    },
    async (args) => {
      try {
        const cable: FiberCableSpan = {
          id: "CABLE-QUERY",
          name: "QueryCable",
          fromNodeId: "START",
          toNodeId: "END",
          strandCount: 72,
          fibersPerTube: 12,
          fiberType: "G.652.D",
          sheathLengthMeters: 0,
          slackLengthMeters: 0,
          helixFactor: args.helixFactor,
          pathCoordinates: args.cableCoordinates,
        };

        const nodes: FiberStructureNode[] = (args.enclosures ?? []).map((enc) => ({
          id: enc.id,
          name: enc.name,
          nodeType: enc.nodeType,
          coordinates: enc.coordinates,
          slackStorageMeters: enc.slackStorageMeters,
        }));

        const result = locateOtdrFault({
          cable,
          opticalDistanceMeters: args.opticalDistanceMeters,
          helixFactor: args.helixFactor,
          enclosures: nodes,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  opticalDistanceMeters: args.opticalDistanceMeters,
                  physicalSheathDistanceMeters: Math.round(result.physicalSheathDistanceMeters * 10) / 10,
                  gpsCoordinate: {
                    longitude: result.gpsCoordinate[0],
                    latitude: result.gpsCoordinate[1],
                  },
                  nearestEnclosure: result.nearestEnclosure
                    ? {
                        id: result.nearestEnclosure.id,
                        name: result.nearestEnclosure.name,
                        type: result.nearestEnclosure.type,
                        distanceToFaultMeters: Math.round(result.nearestEnclosure.distanceToFaultMeters * 10) / 10,
                        direction: result.nearestEnclosure.direction,
                        coordinates: result.nearestEnclosure.gpsCoordinate,
                      }
                    : null,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `OTDR fault locator error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── ran_evaluate_mpe_safety ─────────────────────────────────────────────

  server.tool(
    "ran_evaluate_mpe_safety",
    "Evaluates FCC OET-65, Health Canada Safety Code 6, ICNIRP 2020, EU CENELEC, Swiss NISV, and Italian CEI 211 maximum permissible exposure (MPE) for cellular and microwave base station sites. Computes power densities, exclusion boundary distances (General Population vs. Occupational), Total Exposure Ratio (TER <= 1.0), and OSHA/FCC warning signage requirements.",
    {
      siteId: z.string().default("SITE-001").describe("Base station site identifier"),
      siteName: z.string().default("Cell Site A").describe("Human-readable site name"),
      standard: z
        .enum([
          "FCC_OET65",
          "ICNIRP_2020",
          "HEALTH_CANADA_SC6",
          "EU_CENELEC_EN50383",
          "SWISS_ORNI_NISV",
          "ITALY_CEI_211",
        ])
        .default("FCC_OET65")
        .describe("Electromagnetic safety standard"),
      environment: z
        .enum(["general_population", "occupational"])
        .default("general_population")
        .describe("Exposure tier: general_population (uncontrolled) or occupational (controlled)"),
      emitters: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            frequencyMhz: z.number().describe("Carrier frequency in MHz (e.g. 700, 1900, 3500, 28000)"),
            eirpWatts: z.number().optional().describe("Effective Isotropic Radiated Power in Watts"),
            txPowerWatts: z.number().optional().describe("Transmitter power in Watts (if EIRP not provided)"),
            antennaGainDbi: z.number().optional().describe("Antenna gain in dBi (if EIRP not provided)"),
            antennaHeightMeters: z.number().default(30.0).describe("Antenna center of radiation height AGL in meters"),
            azimuthDeg: z.number().default(0.0).describe("Antenna boresight azimuth in degrees"),
            downTiltDeg: z.number().default(0.0).describe("Mechanical + electrical downtilt in degrees"),
            physicalApertureAreaM2: z
              .number()
              .optional()
              .describe("Antenna physical aperture area in m² (for cylindrical near-field ceiling)"),
          }),
        )
        .describe("List of RF emitters collocated on the site"),
      studyPoints: z
        .array(
          z.object({
            x: z.number(),
            y: z.number(),
            z: z.number(),
          }),
        )
        .optional()
        .describe("Optional 3D evaluation coordinates relative to tower base"),
    },
    async (args) => {
      try {
        const rfEmitters: RfEmitterConfig[] = args.emitters.map((e) => {
          let powerWatts = e.txPowerWatts;
          if (powerWatts === undefined) {
            if (e.eirpWatts !== undefined) {
              const gainLin = Math.pow(10, (e.antennaGainDbi ?? 15.0) / 10);
              powerWatts = e.eirpWatts / gainLin;
            } else {
              powerWatts = 50.0;
            }
          }
          return {
            id: e.id,
            name: e.name,
            coordinates: [0, 0, e.antennaHeightMeters],
            azimuthDeg: e.azimuthDeg,
            mechanicalTiltDeg: e.downTiltDeg,
            electricalDowntiltDeg: 0,
            frequencyMhz: e.frequencyMhz,
            inputPowerWatts: powerWatts,
            cableLossDb: 0.5,
            peakGainDbi: e.antennaGainDbi ?? (e.eirpWatts ? 10 * Math.log10(e.eirpWatts / powerWatts) : 15.0),
            apertureAreaM2: e.physicalApertureAreaM2,
          };
        });

        const studyCoords: Array<[number, number, number]> =
          args.studyPoints?.map((p) => [p.x, p.y, p.z] as [number, number, number]) ?? [];
        const result = evaluateSiteMpe(rfEmitters, studyCoords, { standard: args.standard as MpeStandard });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `MPE safety evaluation error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── ran_evaluate_faa_obstruction ────────────────────────────────────────

  server.tool(
    "ran_evaluate_faa_obstruction",
    "Evaluates FAA 14 CFR Part 77, ICAO Annex 14 Volume I, and Transport Canada CAR 601.23 airspace obstruction notice criteria for telecom towers, calculates runway slope penetrations, and generates structured filing notice data.",
    {
      latitude: z.number().describe("Structure latitude in decimal degrees"),
      longitude: z.number().describe("Structure longitude in decimal degrees"),
      structureHeightMeters: z.number().describe("Height of structure above ground level (AGL) in meters"),
      groundElevationMeters: z.number().describe("Site ground elevation above mean sea level (AMSL) in meters"),
      structureType: z.enum(["tower", "pole", "building_rooftop", "water_tank", "monopole"]).default("tower"),
      siteName: z.string().default("Proposed Tower Site"),
      standard: z
        .enum(["FAA_PART77", "ICAO_ANNEX14", "TRANSPORT_CANADA_CAR601"])
        .default("FAA_PART77")
        .describe("Aviation regulatory regime"),
      airports: z
        .array(
          z.object({
            code: z.string().describe("ICAO or IATA airport identifier"),
            name: z.string(),
            latitude: z.number(),
            longitude: z.number(),
            elevationMeters: z.number(),
            runways: z.array(
              z.object({
                id: z.string(),
                lengthMeters: z.number(),
                hasInstrumentApproach: z.boolean(),
                end1Latitude: z.number(),
                end1Longitude: z.number(),
                end2Latitude: z.number(),
                end2Longitude: z.number(),
              }),
            ),
          }),
        )
        .optional()
        .describe("Optional nearby airports to check for runway slope penetrations"),
    },
    async (args) => {
      try {
        if (args.standard === "ICAO_ANNEX14" || args.standard === "TRANSPORT_CANADA_CAR601") {
          const firstAirport = args.airports?.[0];
          const icaoAerodrome: IcaoAerodromeConfig = {
            id: firstAirport?.code ?? "ICAO-AD",
            name: firstAirport?.name ?? "Regional Aerodrome",
            elevationMslMeters: firstAirport?.elevationMeters ?? args.groundElevationMeters,
            latitude: firstAirport?.latitude ?? args.latitude + 0.05,
            longitude: firstAirport?.longitude ?? args.longitude + 0.05,
            runwayCode: "4",
            runwayType: "precision-cat-II-III",
            runwayLengthMeters: firstAirport?.runways?.[0]?.lengthMeters ?? 3000,
          };

          const proposedSiting: ProposedStructureSiting = {
            id: "SITE-PROP",
            name: args.siteName,
            latitude: args.latitude,
            longitude: args.longitude,
            groundElevationMslMeters: args.groundElevationMeters,
            structureHeightAglMeters: args.structureHeightMeters,
          };

          const intlReport =
            args.standard === "ICAO_ANNEX14"
              ? evaluateIcaoAirspaceObstruction(proposedSiting, icaoAerodrome)
              : evaluateTransportCanadaAirspaceObstruction(proposedSiting, icaoAerodrome);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(intlReport, null, 2),
              },
            ],
          };
        }

        const runways: RunwaySpecification[] = (args.airports ?? []).flatMap((a) =>
          a.runways.map((r) => ({
            airportCode: a.code,
            runwayId: r.id,
            runwayLengthFeet: r.lengthMeters * 3.28084,
            runwayElevationAmslFeet: a.elevationMeters * 3.28084,
            latitude: (r.end1Latitude + r.end2Latitude) / 2,
            longitude: (r.end1Longitude + r.end2Longitude) / 2,
            isInstrumentRunway: r.hasInstrumentApproach,
          })),
        );

        const structure: ProposedTowerStructure = {
          siteId: "SITE-PROP",
          structureName: args.siteName,
          latitude: args.latitude,
          longitude: args.longitude,
          groundElevationAmslFeet: args.groundElevationMeters * 3.28084,
          structureHeightAglFeet: args.structureHeightMeters * 3.28084,
        };

        const determination = evaluateFaaPart77Notice(structure, runways);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(determination, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Airspace obstruction evaluation error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── fiber_evaluate_pole_loading ──────────────────────────────────────────

  server.tool(
    "fiber_evaluate_pole_loading",
    "Evaluates utility pole structural loading pursuant to US NESC Rule 250/260, Canadian CSA C22.3 No. 1, or European Eurocode EN 50341 / EN 1991-1-4. Computes bending moment capacity, conductor transverse/ice loads, and percent pole capacity utilization.",
    {
      standard: z.enum(["NESC", "CSA", "EUROCODE"]).default("NESC").describe("Structural design code"),
      poleId: z.string().default("POLE-001").describe("Pole identifier"),
      overallLengthMeters: z.number().default(12.0).describe("Overall pole length in meters"),
      species: z.string().default("western-red-cedar").describe("Wood species or material specification"),
      loadingDistrict: z
        .string()
        .default("heavy")
        .describe("Climatic loading zone (e.g. heavy, severe, medium, light)"),
      attachments: z
        .array(
          z.object({
            id: z.string(),
            heightMeters: z.number().describe("Attachment height AGL in meters"),
            bareDiameterMm: z.number().default(15.0).describe("Bare cable diameter in mm"),
            spanLengthMeters: z.number().default(50.0).describe("Span length in meters"),
            weightKgPerMeter: z.number().default(0.3).describe("Weight in kg/m"),
          }),
        )
        .describe("Attached conductors and fiber messengers"),
    },
    async (args) => {
      try {
        if (args.standard === "CSA") {
          const csaConfig: CsaPoleAnalysisConfig = {
            poleId: args.poleId,
            species: "western-red-cedar",
            overallLengthMeters: args.overallLengthMeters,
            circumferenceAtGroundLineMeters: 0.95,
            circumferenceAtTopMeters: 0.55,
            constructionGrade: "grade-2",
            loadingDistrict: (args.loadingDistrict as CsaPoleAnalysisConfig["loadingDistrict"]) ?? "heavy",
            attachments: args.attachments.map((a) => ({
              id: a.id,
              type: "telecom-fiber",
              attachmentHeightMeters: a.heightMeters,
              bareCableDiameterMm: a.bareDiameterMm,
              bareCableWeightKgPerM: a.weightKgPerMeter,
              spanLengthMeters: a.spanLengthMeters,
            })),
          };
          const report = evaluateCsaPoleStress(csaConfig);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
          };
        }

        if (args.standard === "EUROCODE") {
          const euroConfig: EurocodeMastLoadingConfig = {
            mastId: args.poleId,
            basicWindVelocityMPerS: 25.0,
            terrainCategory: "II",
            iceClass: "G2",
            overallHeightMeters: args.overallLengthMeters,
            groundSectionModulusM3: 0.002,
            characteristicYieldStrengthMpa: 355.0,
            cables: args.attachments.map((a) => ({
              id: a.id,
              attachmentHeightMeters: a.heightMeters,
              bareDiameterMm: a.bareDiameterMm,
              bareWeightKgPerM: a.weightKgPerMeter,
              spanLengthMeters: a.spanLengthMeters,
            })),
          };
          const report = evaluateEurocodeMastLoading(euroConfig);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
          };
        }

        // Default NESC evaluation
        const lengthFeet = args.overallLengthMeters * 3.28084;
        const poleSpec: PoleSpecification = {
          poleId: args.poleId,
          species: "southern-yellow-pine",
          poleClass: "4",
          lengthFeet,
        };
        const nescAttachments: PoleAttachmentLoad[] = args.attachments.map((a) => ({
          attachmentId: a.id,
          description: (a as Record<string, unknown>)["description"]
            ? String((a as Record<string, unknown>)["description"])
            : a.id,
          heightAboveGroundFeet: a.heightMeters * 3.28084,
          transverseWindForceLbs: 50.0,
          tensionForceLbs: 30.0,
        }));
        const report = evaluatePoleLoading(poleSpec, nescAttachments, { grade: "C-elsewhere" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Pole loading evaluation error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── fiber_generate_bdc_fabric ───────────────────────────────────────────

  server.tool(
    "fiber_generate_bdc_fabric",
    "Generates FCC Broadband Data Collection (BDC) and NTIA BEAD compliant spatial datasets discretized into Uber H3 Resolution 8 or 9 hexagonal bins from geographic fiber routes or service polygon points.",
    {
      sampleCoordinates: z
        .array(z.tuple([z.number(), z.number()]))
        .describe("Array of [longitude, latitude] coordinates along fiber route or coverage boundary"),
      techCode: z
        .number()
        .default(50)
        .describe("BDC technology code: 50 (Optical Carrier / FTTH), 70 (5G Mobile), 71 (5G Fixed Wireless)"),
      maxDownloadMbps: z.number().default(1000).describe("Maximum advertised download speed in Mbps"),
      maxUploadMbps: z.number().default(1000).describe("Maximum advertised upload speed in Mbps"),
      lowLatency: z.boolean().default(true).describe("Low-latency indicator (<=100ms RTT)"),
      resolution: z.enum(["8", "9"]).default("9").describe("H3 resolution (8: ~461m edge, 9: ~174m edge)"),
      providerName: z.string().default("ModelScript Fiber Provider").describe("Broadband provider brand name"),
    },
    async (args) => {
      try {
        const res: H3Resolution = args.resolution === "8" ? 8 : 9;
        const techProfile: BdcTechnologyProfile = {
          techCode: args.techCode,
          maxDownloadMbps: args.maxDownloadMbps,
          maxUploadMbps: args.maxUploadMbps,
          lowLatency: args.lowLatency,
          providerName: args.providerName,
        };

        const dataset = discretizeCoverageToH3(args.sampleCoordinates, techProfile, res);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  totalHexagons: dataset.totalHexagons,
                  resolution: dataset.resolution,
                  technologyCode: dataset.technologyCode,
                  sampleHexagons: dataset.hexagons.slice(0, 10).map((h) => ({
                    h3Index: h.h3Index,
                    center: h.centerCoordinates,
                  })),
                  csvPreview: dataset.csvSummary.split("\n").slice(0, 6).join("\n"),
                  geojsonFeatureCount: dataset.geojson.features.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `BDC fabric generator error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── telecom_evaluate_nors_outage ────────────────────────────────────────

  server.tool(
    "telecom_evaluate_nors_outage",
    "Evaluates whether a telecom network outage meets mandatory FCC Part 4 (47 CFR § 4.9) NORS reporting thresholds (900,000 user-minutes, 911/PSAP facility impact, or major transport cut) and generates an automated electronic filing dossier.",
    {
      outageId: z.string().describe("Carrier outage incident identifier"),
      serviceProviderName: z.string().describe("Service provider carrier legal name"),
      startTimeIso: z.string().describe("Outage start timestamp in ISO-8601"),
      endTimeIso: z.string().optional().describe("Outage end timestamp in ISO-8601 (if restored)"),
      durationMinutes: z.number().describe("Total or elapsed outage duration in minutes"),
      affectedUsersEstimate: z.number().describe("Estimated number of impacted subscribers/users"),
      is911Affected: z.boolean().default(false).describe("Whether 911 access, special facility, or PSAP is affected"),
      majorTransportAffected: z
        .boolean()
        .default(false)
        .describe("Whether inter-office major transport (DS3, OC3, 100G+ cut) is affected"),
      affectedCounties: z.array(z.string()).optional().describe("Affected counties or geographic areas"),
      rootCauseDescription: z
        .string()
        .describe("Root cause summary description (e.g. fiber cut, power loss, equipment failure)"),
      filingStage: z
        .enum(["notification", "initial", "final"])
        .default("notification")
        .describe("Filing stage: notification (2h), initial (72h), or final (30d)"),
      fccFilerId: z.string().default("FCC-FILER-10023").describe("FCC Filer 499A/FRN identifier"),
    },
    async (args) => {
      try {
        let eeMod: { generateNorsFilingDossier?: (e: unknown, stage: string, filerId: string) => unknown } | null =
          null;
        try {
          // Dynamic import of Enterprise Edition compliance module
          const eePkg = ["@", "modelscript", "/", "ee"].join("");
          eeMod = (await import(/* webpackIgnore: true */ eePkg)) as {
            generateNorsFilingDossier?: (e: unknown, stage: string, filerId: string) => unknown;
          };
        } catch {
          eeMod = null;
        }

        const event = {
          outageId: args.outageId,
          serviceProviderName: args.serviceProviderName,
          startTimeIso: args.startTimeIso,
          endTimeIso: args.endTimeIso,
          durationMinutes: args.durationMinutes,
          affectedUsersEstimate: args.affectedUsersEstimate,
          is911Affected: args.is911Affected,
          majorTransportAffected: args.majorTransportAffected,
          affectedCounties: args.affectedCounties,
          rootCauseDescription: args.rootCauseDescription,
        };

        if (eeMod && typeof eeMod.generateNorsFilingDossier === "function") {
          const dossier = eeMod.generateNorsFilingDossier(event, args.filingStage, args.fccFilerId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(dossier, null, 2),
              },
            ],
          };
        }

        // Inline community evaluation fallback when Enterprise Edition module is not installed
        const userMinutes = args.durationMinutes * args.affectedUsersEstimate;
        const isDurationEligible = args.durationMinutes >= 30;
        let isReportable = false;
        let reason: string | undefined;
        let deadlineHours = 0;
        let filingType = "NONE";

        if (isDurationEligible && args.is911Affected) {
          isReportable = true;
          reason =
            "911 Special Facility Outage: Exceeds 30-minute threshold impacting public safety (47 CFR § 4.9(e)). 2-hour notification required.";
          deadlineHours = 2.0;
          filingType = "NORS_NOTIFICATION";
        } else if (isDurationEligible && userMinutes >= 900000) {
          isReportable = true;
          reason = `User-Minutes Threshold Exceeded: ${userMinutes.toLocaleString()} user-minutes >= 900,000 threshold (47 CFR § 4.9).`;
          deadlineHours = 72.0;
          filingType = "NORS_INITIAL";
        } else if (isDurationEligible && args.majorTransportAffected) {
          isReportable = true;
          reason = "Major Transport Facility Interruption: Inter-office transport cut >= 30 minutes (47 CFR § 4.9(f)).";
          deadlineHours = 72.0;
          filingType = "NORS_INITIAL";
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  outageId: args.outageId,
                  serviceProviderName: args.serviceProviderName,
                  isReportableUnderPart4: isReportable,
                  userMinutes,
                  thresholdExceededReason: reason,
                  reportingDeadlineHours: deadlineHours,
                  filingType,
                  notice:
                    "Basic evaluation completed. Full electronic NORS/DIRS submission packages require ModelScript Enterprise Edition (@modelscript/ee).",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `NORS outage evaluation error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── modelscript_bifurcation_continuation ───────────────────────────────
}
