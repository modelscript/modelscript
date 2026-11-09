// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Radio Access Network & Microwave Subcommand.
 *
 * Provides headless CLI operations for microwave link budgets and antenna radiation patterns:
 * - `msx ran microwave --freq <GHz> --dist <km>`
 * - `msx ran antenna <file.adf|file.pat>`
 * - `msx ran fresnel --freq <GHz> --dist <km> --tx-height <m> --rx-height <m>`
 */

import {
  computeFsplDb,
  evaluateFresnelClearance,
  parseNsmaAdf,
  parsePlanetPat,
  solveMicrowaveLinkBudget,
  type MicrowaveLink,
} from "@modelscript/ran";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const RanCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "ran <action> [files...]",
  describe:
    "Solve line-of-sight microwave link budgets, parse NSMA/Planet antenna patterns, and compute Fresnel clearance",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (microwave, budget, antenna, fresnel)",
        type: "string",
        choices: ["microwave", "budget", "antenna", "fresnel"],
        demandOption: true,
      })
      .positional("files", {
        description: "Antenna pattern files (.adf, .pat) or configuration files",
        type: "string",
        array: true,
      })
      .option("freq", {
        alias: "f",
        description: "Carrier frequency in GHz (e.g. 6.0, 11.0, 18.0)",
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
          txSiteName: "Site-Alpha",
          rxSiteName: "Site-Bravo",
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
        console.log(
          `Five-Nines Verdict:    ${budget.availabilityPercent >= 99.999 ? "✓ MEETS 99.999% SLA (Five-Nines)" : "FAIL (Under 99.999%)"}`,
        );
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
        console.log(
          `Adequate Clearance:      ${result.minClearanceRatio >= 0.6 ? "✓ ADEQUATE (>= 60% F1)" : "⚠ INADEQUATE"}`,
        );
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
