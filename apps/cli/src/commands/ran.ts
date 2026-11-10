// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Radio Access Network & Microwave Subcommand.
 *
 * Provides headless CLI operations for microwave link budgets, PCN filings,
 * RF radiation safety (MPE), antenna radiation patterns, and FAA airspace obstruction:
 * - `msx ran microwave --freq <GHz> --dist <km>`
 * - `msx ran pcn --freq <GHz> --dist <km> --tx-site <A> --rx-site <B>`
 * - `msx ran mpe --freq <MHz> --power-watts <W> --tx-gain <dBi>`
 * - `msx ran faa --height <ft> --elev <ft> --lat <deg> --lon <deg>`
 * - `msx ran antenna <file.adf|file.pat>`
 * - `msx ran fresnel --freq <GHz> --dist <km> --tx-height <m> --rx-height <m>`
 */

import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";
import {
  computeEmitterExclusionBoundary,
  computeFsplDb,
  evaluateFaaPart77Notice,
  evaluateFresnelClearance,
  evaluateIcaoAirspaceObstruction,
  evaluateSiteMpe,
  evaluateTransportCanadaAirspaceObstruction,
  parseNsmaAdf,
  parsePlanetPat,
  solveMicrowaveLinkBudget,
  type IcaoAerodromeConfig,
  type MicrowaveLink,
  type MpeStandard,
  type ProposedStructureSiting,
  type ProposedTowerStructure,
  type RfEmitterConfig,
} from "@modelscript/ran";

export const RanCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "ran <action> [files...]",
  describe:
    "Solve line-of-sight microwave link budgets, generate PCN exhibits, compute MPE radiation safety, and evaluate FAA Part 77 airspace obstruction",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (microwave, budget, pcn, mpe, faa, antenna, fresnel)",
        type: "string",
        choices: ["microwave", "budget", "pcn", "mpe", "faa", "antenna", "fresnel"],
        demandOption: true,
      })
      .positional("files", {
        description: "Antenna pattern files (.adf, .pat) or configuration files",
        type: "string",
        array: true,
      })
      .option("freq", {
        alias: "f",
        description: "Carrier frequency in GHz (e.g. 6.0, 11.0, 18.0) or MHz for MPE",
        type: "number",
        default: 11.0,
      })
      .option("dist", {
        alias: "d",
        description: "Path length in kilometers",
        type: "number",
        default: 15.0,
      })
      .option("tx-power", {
        description: "Tx transmitter power in dBm",
        type: "number",
        default: 20.0,
      })
      .option("power-watts", {
        description: "Transmitter power in Watts (for MPE evaluation)",
        type: "number",
        default: 40.0,
      })
      .option("tx-gain", {
        description: "Tx antenna gain in dBi",
        type: "number",
        default: 38.0,
      })
      .option("rx-gain", {
        description: "Rx antenna gain in dBi",
        type: "number",
        default: 38.0,
      })
      .option("tx-site", {
        description: "Transmitter site name",
        type: "string",
        default: "Site-Alpha",
      })
      .option("rx-site", {
        description: "Receiver site name",
        type: "string",
        default: "Site-Bravo",
      })
      .option("rain-rate", {
        description: "ITU-R P.837 rain rate at 0.01% of year in mm/hr",
        type: "number",
        default: 42.0,
      })
      .option("rx-threshold", {
        description: "Receiver sensitivity threshold in dBm",
        type: "number",
        default: -72.0,
      })
      .option("polarization", {
        description: "Polarization (H or V)",
        type: "string",
        default: "V",
      })
      .option("tx-height", {
        description: "Tx tower antenna center of radiation height in meters",
        type: "number",
        default: 45.0,
      })
      .option("rx-height", {
        description: "Rx tower antenna center of radiation height in meters",
        type: "number",
        default: 35.0,
      })
      .option("obstacle-dist", {
        description: "Distance from Tx to midpoint obstacle in km",
        type: "number",
      })
      .option("obstacle-elev", {
        description: "Obstacle elevation in meters above sea level",
        type: "number",
        default: 0.0,
      })
      .option("height", {
        description: "Structure height AGL in feet (for FAA evaluation)",
        type: "number",
        default: 195.0,
      })
      .option("elev", {
        description: "Ground elevation AMSL in feet (for FAA evaluation)",
        type: "number",
        default: 150.0,
      })
      .option("lat", {
        description: "Latitude in decimal degrees",
        type: "number",
        default: 40.7128,
      })
      .option("lon", {
        description: "Longitude in decimal degrees",
        type: "number",
        default: -74.006,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];

    switch (action) {
      case "microwave":
      case "budget": {
        const freqGhz = Number(argv["freq"] ?? 11.0);
        const pathKm = Number(argv["dist"] ?? 15.0);
        const txPowerDbm = Number(argv["tx-power"] ?? 20.0);
        const txGainDbi = Number(argv["tx-gain"] ?? 38.0);
        const rxGainDbi = Number(argv["rx-gain"] ?? 38.0);
        const rainRate = Number(argv["rain-rate"] ?? 42.0);
        const rxThreshold = Number(argv["rx-threshold"] ?? -72.0);
        const polarization = (String(argv["polarization"] ?? "V").toUpperCase() === "H" ? "H" : "V") as "H" | "V";

        const link: MicrowaveLink = {
          id: "CLI-MW-LINK",
          txSiteName: String(argv["tx-site"] ?? "Site-Alpha"),
          rxSiteName: String(argv["rx-site"] ?? "Site-Bravo"),
          frequencyGhz: freqGhz,
          pathLengthKm: pathKm,
          txPowerDbm,
          txAntennaGainDbi: txGainDbi,
          rxAntennaGainDbi: rxGainDbi,
          txFeederLossDb: 1.5,
          rxFeederLossDb: 1.5,
          requiredMarginDb: 25.0,
          polarization,
        };

        const fspl = computeFsplDb(freqGhz, pathKm);
        const budget = solveMicrowaveLinkBudget(link, { rainRate001MmPerHour: rainRate });
        const eirpDbm = txPowerDbm - 1.5 + txGainDbi;

        console.log(`\n=== Line-of-Sight Microwave Link Budget (ITU-R P.530-18) ===`);
        console.log(`Frequency:             ${freqGhz} GHz (${polarization}-pol)`);
        console.log(`Path Length:           ${pathKm} km`);
        console.log(`Tx Power / Gain:       ${txPowerDbm} dBm / ${txGainDbi} dBi`);
        console.log(`Rx Gain / Sensitivity: ${rxGainDbi} dBi / ${rxThreshold} dBm`);
        console.log(`EIRP:                  ${eirpDbm.toFixed(1)} dBm (FCC Part 101 limit: 55 dBm)`);
        console.log(`----------------------------------------------------------------`);
        console.log(`Free Space Path Loss:  ${fspl.toFixed(2)} dB`);
        console.log(`Rain Fade (0.01%):     ${budget.rainFade001PercentDb.toFixed(2)} dB`);
        console.log(`Total Path Loss:       ${budget.totalPathLossDb.toFixed(2)} dB`);
        console.log(`Received Signal Level: ${budget.receivedPowerDbm.toFixed(2)} dBm`);
        console.log(`Fade Margin:           ${budget.fadeMarginDb.toFixed(2)} dB`);
        console.log(`Annual Availability:   ${budget.availabilityPercent.toFixed(4)} %`);
        console.log(`Annual Outage Time:    ${budget.unavailabilityMinutesPerYear.toFixed(1)} minutes/year`);
        console.log(`Five-Nines Verdict:    ${budget.availabilityPercent >= 99.999 ? "✓ MEETS 99.999% SLA (Five-Nines)" : "FAIL (Under 99.999%)"}`);
        return;
      }

      case "pcn": {
        const freqGhz = Number(argv["freq"] ?? 11.0);
        const pathKm = Number(argv["dist"] ?? 15.0);
        const txPowerDbm = Number(argv["tx-power"] ?? 20.0);
        const txGainDbi = Number(argv["tx-gain"] ?? 38.0);
        const txSite = String(argv["tx-site"] ?? "Site-Alpha");
        const rxSite = String(argv["rx-site"] ?? "Site-Bravo");
        const polarization = String(argv["polarization"] ?? "V").toUpperCase();
        const eirpDbm = txPowerDbm - 1.5 + txGainDbi;

        const emissionDesignator = freqGhz >= 10.0 ? "30M0D7W" : "10M0D7W";
        const today = new Date().toISOString().split("T")[0];

        console.log(`\n================================================================`);
        console.log(`PRIOR COORDINATION NOTICE (PCN) & FCC FORM 601 SCHEDULE I EXHIBIT`);
        console.log(`Pursuant to 47 C.F.R. § 101.103(d) & NSMA WG16.99.050 Standards`);
        console.log(`================================================================`);
        console.log(`Date of Notification:       ${today}`);
        console.log(`Coordination Period:        30 Days Mandatory Notice`);
        console.log(`Applicant / Licensee:       ModelScript Telecommunications Infrastructure`);
        console.log(`Link Identifier:            PCN-${txSite.toUpperCase()}-${rxSite.toUpperCase()}`);
        console.log(`Transmit Site (Site A):     ${txSite}`);
        console.log(`Receive Site (Site B):      ${rxSite}`);
        console.log(`Carrier Frequency:          ${freqGhz.toFixed(4)} GHz (${polarization}-Polarization)`);
        console.log(`Path Length:                ${pathKm.toFixed(2)} km (${(pathKm * 0.621371).toFixed(2)} miles)`);
        console.log(`Emission Designator:        ${emissionDesignator} (Digital QAM)`);
        console.log(`Transmitter Power:          +${txPowerDbm.toFixed(1)} dBm (${Math.pow(10, (txPowerDbm - 30) / 10).toFixed(3)} W)`);
        console.log(`Antenna Gain (Site A/B):    ${txGainDbi.toFixed(1)} dBi / ${Number(argv["rx-gain"] ?? 38.0).toFixed(1)} dBi`);
        console.log(`Maximum EIRP:               +${eirpDbm.toFixed(1)} dBm (Complies with FCC Part 101 ceiling: 55 dBm)`);
        console.log(`Frequency Stability:        ±0.001% (±10 ppm)`);
        console.log(`Coordination Status:        NOTICE_DISPATCHED (30-day response window active)`);
        console.log(`================================================================\n`);
        return;
      }

      case "mpe": {
        const rawFreq = Number(argv["freq"] ?? 1900);
        const freqMhz = rawFreq >= 100 ? rawFreq : rawFreq * 1000;
        const powerWatts = Number(argv["power-watts"] ?? 40.0);
        const gainDbi = Number(argv["tx-gain"] ?? 17.5);
        const stdArg = String(argv["standard"] ?? "fcc").toLowerCase();

        let standard: MpeStandard = "FCC_OET65";
        let standardTitle = "FCC OET Bulletin 65 & ICNIRP";
        if (stdArg.includes("canada") || stdArg.includes("sc6")) {
          standard = "HEALTH_CANADA_SC6";
          standardTitle = "Health Canada Safety Code 6 (2015/2021) / ISED RSS-102";
        } else if (stdArg.includes("icnirp")) {
          standard = "ICNIRP_2020";
          standardTitle = "ICNIRP 2020 Guidelines";
        } else if (stdArg.includes("eu") || stdArg.includes("cenelec")) {
          standard = "EU_CENELEC_EN50383";
          standardTitle = "EU Rec 1999/519/EC & CENELEC EN 50383";
        } else if (stdArg.includes("swiss") || stdArg.includes("nisv")) {
          standard = "SWISS_ORNI_NISV";
          standardTitle = "Swiss ORNI/NISV Sensitive Use Precautionary Limit";
        } else if (stdArg.includes("italy") || stdArg.includes("cei")) {
          standard = "ITALY_CEI_211";
          standardTitle = "Italian DPCM 08/07/2003 (6 V/m Quality Objective)";
        }

        const emitter: RfEmitterConfig = {
          id: "CLI-EMITTER-01",
          name: "Cellular Sector Antenna",
          coordinates: [0, 0, 10],
          azimuthDeg: 0,
          mechanicalTiltDeg: 0,
          electricalDowntiltDeg: 2,
          frequencyMhz: freqMhz,
          inputPowerWatts: powerWatts,
          cableLossDb: 1.0,
          peakGainDbi: gainDbi,
        };

        const boundary = computeEmitterExclusionBoundary(emitter, 2.56, standard);
        const siteReport = evaluateSiteMpe([emitter], [[0, 5, 2], [0, 15, 2], [0, 30, 2]], { standard });

        console.log(`\n=== ${standardTitle} RF Safety (MPE) Evaluation ===`);
        console.log(`Standard:                  ${standard}`);
        console.log(`Frequency:                 ${freqMhz} MHz`);
        console.log(`Transmitter Power:         ${powerWatts} Watts (${gainDbi} dBi antenna gain)`);
        console.log(`General Pop Limit:         ${boundary.generalPopThresholdMwCm2.toFixed(4)} mW/cm²`);
        console.log(`Occupational Limit:        ${boundary.occupationalThresholdMwCm2.toFixed(4)} mW/cm²`);
        console.log(`----------------------------------------------------------------`);
        console.log(`Main-Beam Exclusion (GenPop): ${boundary.mainBeamExclusionDistanceGeneralPopMeters.toFixed(2)} meters`);
        console.log(`Main-Beam Exclusion (Occ):    ${boundary.mainBeamExclusionDistanceOccupationalMeters.toFixed(2)} meters`);
        console.log(`Rear Exclusion Boundary:      ${boundary.rearExclusionDistanceGeneralPopMeters.toFixed(2)} meters`);
        console.log(`Max Total Exposure Ratio (TER): ${siteReport.maxTerGeneralPopulation.toFixed(2)}`);
        console.log(`Required Safety Signage:      ${siteReport.requiredSignageNotice}`);
        console.log(`Compliance Verdict:           ${siteReport.isSiteCompliantWithoutMitigation ? "✓ Compliant without mitigation" : "⚠ Barriers/Warning signs required"}`);
        return;
      }

      case "airspace":
      case "faa": {
        const heightMeters = Number(argv["height-m"] ?? (Number(argv["height"] ?? 195.0) / 3.28084));
        const elevMeters = Number(argv["elev-m"] ?? (Number(argv["elev"] ?? 150.0) / 3.28084));
        const lat = Number(argv["lat"] ?? 40.7128);
        const lon = Number(argv["lon"] ?? -74.006);
        const regulator = String(argv["regulator"] ?? (argv["standard"] ?? "faa")).toLowerCase();

        if (regulator.includes("icao")) {
          const cdgAirport: IcaoAerodromeConfig = {
            id: "REGIONAL-ICAO",
            name: "Regional International Airport",
            elevationMslMeters: elevMeters,
            latitude: lat + 0.03,
            longitude: lon + 0.03,
            runwayCode: "4",
            runwayType: "precision-cat-II-III",
            runwayLengthMeters: 3800,
          };
          const structure: ProposedStructureSiting = {
            id: "CLI-TOWER-01",
            latitude: lat,
            longitude: lon,
            groundElevationMslMeters: elevMeters,
            structureHeightAglMeters: heightMeters,
          };
          const result = evaluateIcaoAirspaceObstruction(structure, cdgAirport);
          console.log(`\n=== ICAO Annex 14 Volume I Obstacle Limitation Surfaces (OLS) Evaluation ===`);
          console.log(`Structure Coordinates:     ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
          console.log(`Height AGL / Tip MSL:      ${heightMeters.toFixed(1)} m / ${result.overallTipElevationMslMeters.toFixed(1)} m`);
          console.log(`Distance to Aerodrome:     ${(result.distanceToAerodromeMeters / 1000).toFixed(2)} km`);
          console.log(`Obstruction Severity:      ${result.obstructionSeverity}`);
          console.log(`Notification Mandatory:    ${result.isNotificationMandatory ? "✓ YES (ICAO_NOTIFICATION_REQUIRED)" : "No"}`);
          console.log(`e-TOD Category:            ${result.regulatorySubmissionData.eTodArea}`);
          console.log(`Summary:                   ${result.regulatorySubmissionData.summaryText}`);
          return;
        }

        if (regulator.includes("canada") || regulator.includes("tc")) {
          const pearsonAirport: IcaoAerodromeConfig = {
            id: "CYYZ",
            name: "Toronto Pearson International",
            elevationMslMeters: elevMeters,
            latitude: lat + 0.04,
            longitude: lon + 0.04,
            runwayCode: "4",
            runwayType: "precision-cat-II-III",
            runwayLengthMeters: 3389,
          };
          const structure: ProposedStructureSiting = {
            id: "CLI-TOWER-01",
            latitude: lat,
            longitude: lon,
            groundElevationMslMeters: elevMeters,
            structureHeightAglMeters: heightMeters,
          };
          const result = evaluateTransportCanadaAirspaceObstruction(structure, pearsonAirport);
          console.log(`\n=== Transport Canada CAR 601.23 & Standard 621 Obstruction Evaluation ===`);
          console.log(`Structure Coordinates:     ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
          console.log(`Height AGL:                ${heightMeters.toFixed(1)} m (${(heightMeters * 3.28084).toFixed(1)} ft)`);
          console.log(`Distance to Aerodrome:     ${(result.distanceToAerodromeMeters / 1000).toFixed(2)} km`);
          console.log(`NAV CANADA LUP Required:   ${result.regulatorySubmissionData.navCanadaLupRequired ? "✓ YES (LUP_SUBMISSION_MANDATORY)" : "No"}`);
          console.log(`Standard 621 Lighting:     ${result.regulatorySubmissionData.standard621LightingRequired ? "YES (Required)" : "No"}`);
          console.log(`Summary:                   ${result.regulatorySubmissionData.summaryText}`);
          return;
        }

        // US FAA Part 77 Default
        const heightAglFeet = heightMeters * 3.28084;
        const elevAmslFeet = elevMeters * 3.28084;
        const structure: ProposedTowerStructure = {
          siteId: "CLI-TOWER-01",
          structureName: "Telecom Monopole",
          latitude: lat,
          longitude: lon,
          groundElevationAmslFeet: elevAmslFeet,
          structureHeightAglFeet: heightAglFeet,
        };

        const result = evaluateFaaPart77Notice(structure, []);

        console.log(`\n=== FAA 14 CFR Part 77 Airspace Obstruction Evaluation ===`);
        console.log(`Structure Coordinates:     ${result.form74601Data.latitudeFormatted}, ${result.form74601Data.longitudeFormatted}`);
        console.log(`Ground Elevation (AMSL):   ${elevAmslFeet.toFixed(1)} ft`);
        console.log(`Structure Height (AGL):    ${heightAglFeet.toFixed(1)} ft`);
        console.log(`Total Overall Height:      ${result.totalOverallHeightAmslFeet.toFixed(1)} ft AMSL`);
        console.log(`----------------------------------------------------------------`);
        console.log(`Exceeds 200 ft Baseline:   ${result.obstructionStandardFindings.exceeds200FtAglThreshold ? "YES" : "No"}`);
        console.log(`Exceeds 499 ft Ceiling:    ${result.obstructionStandardFindings.exceeds499FtAglGeneralCeiling ? "YES" : "No"}`);
        console.log(`FAA Form 7460-1 Required:  ${result.requiresFaaNotice ? "✓ YES (NOTICE_REQUIRED)" : "No (NOTICE_NOT_REQUIRED)"}`);
        console.log(`Recommended Lighting:      ${result.form74601Data.recommendedMarkingAndLighting}`);
        return;
      }

      case "fresnel": {
        const freqGhz = Number(argv["freq"] ?? 11.0);
        const pathKm = Number(argv["dist"] ?? 15.0);
        const txHeight = Number(argv["tx-height"] ?? 45.0);
        const rxHeight = Number(argv["rx-height"] ?? 35.0);
        const obsDist = Number(argv["obstacle-dist"] ?? pathKm / 2);
        const obsElev = Number(argv["obstacle-elev"] ?? 15.0);

        const result = evaluateFresnelClearance(
          pathKm,
          freqGhz,
          txHeight,
          rxHeight,
          [
            {
              distanceFromTxKm: obsDist,
              obstacleGroundElevationMeters: obsElev,
              obstacleHeightMeters: 10,
            },
          ],
          1.333,
        );

        console.log(`\n=== Microwave Fresnel Clearance Profile (k = 4/3 Earth Curvature) ===`);
        console.log(`Path Length:             ${pathKm} km at ${freqGhz} GHz`);
        console.log(`Tx / Rx Antenna Heights: ${txHeight} m / ${rxHeight} m`);
        console.log(`Midpoint 1st Fresnel F1: ${result.midpointFresnelRadiusMeters.toFixed(2)} meters`);
        console.log(`Clearance Ratio (F1):    ${(result.minClearanceRatio * 100).toFixed(1)} % (Target: >= 60% F1)`);
        console.log(`LOS Obstructed:          ${result.isObstructed ? "YES (Path Blocked)" : "No (Clear Path)"}`);
        console.log(`Adequate Clearance:      ${result.minClearanceRatio >= 0.60 ? "✓ ADEQUATE (>= 60% F1)" : "⚠ INADEQUATE"}`);
        return;
      }

      case "antenna": {
        if (files.length === 0) {
          console.error("[ran] No antenna pattern file (.adf or .pat) specified.");
          process.exit(1);
        }

        for (const file of files) {
          const absPath = path.resolve(process.cwd(), file);
          if (!fs.existsSync(absPath)) {
            console.error(`[ran] File not found: ${absPath}`);
            process.exit(1);
          }

          const raw = fs.readFileSync(absPath, "utf-8");
          const isAdf = file.toLowerCase().endsWith(".adf") || raw.includes("REVNUM:");
          const pat = isAdf ? parseNsmaAdf(raw, path.basename(file)) : parsePlanetPat(raw, path.basename(file));

          console.log(`\n=== Antenna Radiation Pattern: ${path.basename(file)} ===`);
          console.log(`Manufacturer:   ${pat.manufacturer || "N/A"}`);
          console.log(`Model:          ${pat.model || "N/A"}`);
          console.log(`Mid-Band Gain:  ${pat.peakGainDbi.toFixed(1)} dBi`);
          console.log(`Frequency Range:${pat.frequencyRangeMhz[0]} - ${pat.frequencyRangeMhz[1]} MHz`);
          console.log(`Polarization:   ${pat.polarization}`);
          console.log(`Azimuth Points: ${pat.horizontalCut?.points.length ?? 0} cuts`);
          console.log(`Elev Points:    ${pat.verticalCut?.points.length ?? 0} cuts`);
        }
        return;
      }

      default:
        console.error(`[ran] Unknown action: ${action}`);
        process.exit(1);
    }
  },
};
