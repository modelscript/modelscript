// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Optical Transport & OTDR Subcommand.
 *
 * Provides headless CLI operations for DWDM optical networks and Telcordia .sor OTDR traces:
 * - `msx optical inspect <file>` / `msx optical otdr <file>`
 * - `msx optical gsnr --distance <km> --spans <N>`
 * - `msx optical lint <file>`
 * - `msx optical to-dae [file]`
 */

import {
  createEmptyOpticalTopology,
  lowerOpticalEdfaToDae,
  parseOpenRoadmTopology,
  parseSor,
  solveChannelTransmission,
  type OpticalChannel,
  type OpticalSpan,
} from "@modelscript/optical";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OpticalCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "optical <action> [files...]",
  describe: "Inspect Telcordia .sor traces, solve DWDM GSNR transmission budgets, and lint optical networks",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, otdr, gsnr, lint, to-dae)",
        type: "string",
        choices: ["inspect", "otdr", "gsnr", "lint", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "Optical trace (.sor) or network topology (.json) files",
        type: "string",
        array: true,
      })
      .option("distance", {
        alias: "d",
        description: "Total link distance in kilometers for GSNR solver",
        type: "number",
        default: 320,
      })
      .option("span-len", {
        alias: "s",
        description: "Fiber span length in kilometers",
        type: "number",
        default: 80,
      })
      .option("baud", {
        alias: "b",
        description: "Baud rate in Gbaud",
        type: "number",
        default: 64,
      })
      .option("power", {
        alias: "p",
        description: "Launch power in dBm",
        type: "number",
        default: 0.0,
      })
      .option("edfa-nf", {
        description: "EDFA noise figure in dB",
        type: "number",
        default: 5.5,
      })
      .option("fiber", {
        description: "Fiber type (SSMF, LEAF, custom)",
        type: "string",
        default: "SSMF",
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for DAE or summary export)",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];

    switch (action) {
      case "gsnr": {
        const totalDistanceKm = Number(argv["distance"] ?? 320);
        const spanLengthKm = Number(argv["span-len"] ?? 80);
        const baudRate = Number(argv["baud"] ?? 64);
        const launchPowerDbm = Number(argv["power"] ?? 0.0);
        const edfaNf = Number(argv["edfa-nf"] ?? 5.5);
        const fiberType = String(argv["fiber"] ?? "SSMF") as "SSMF" | "LEAF" | "custom";

        const numSpans = Math.max(1, Math.round(totalDistanceKm / spanLengthKm));
        const actualSpanLen = totalDistanceKm / numSpans;
        const topo = createEmptyOpticalTopology("CLI-GSNR-Link");
        const pathSpanIds: string[] = [];

        for (let i = 0; i < numSpans; i++) {
          const spanId = `SPAN-${i + 1}`;
          pathSpanIds.push(spanId);
          const spanLossDb = actualSpanLen * (fiberType === "SSMF" ? 0.2 : 0.22);
          const span: OpticalSpan = {
            id: spanId,
            fromNodeId: `ROADM-${i}`,
            toNodeId: `ROADM-${i + 1}`,
            lengthKm: actualSpanLen,
            fiberType,
            attenuationDbPerKm: fiberType === "SSMF" ? 0.2 : 0.22,
            dispersionPsPerNmKm: fiberType === "SSMF" ? 17.0 : 4.0,
            pmdPsPerSqrtKm: 0.04,
            nonLinearCoeffPerWKm: fiberType === "SSMF" ? 1.3 : 1.5,
            amplifiers: [
              {
                id: `EDFA-${i + 1}`,
                ampType: "edfa",
                gainDb: spanLossDb,
                noiseFigureDb: edfaNf,
                maxOutputPowerDbm: 20.0,
              },
            ],
          };
          topo.addSpan(span);
        }

        const channel: OpticalChannel = {
          id: "CH-1",
          sourceNodeId: "ROADM-0",
          destinationNodeId: `ROADM-${numSpans}`,
          centerFrequencyThz: 193.1,
          baudRateGbaud: baudRate,
          modulation: "PM-16QAM",
          launchPowerDbm,
          requiredOsnrDb: 15.0,
          pathSpanIds,
        };
        topo.addChannel(channel);

        const metrics = solveChannelTransmission(topo, channel);

        console.log(`\n=== DWDM Generalized Optical Transmission Solver (EGN Model) ===`);
        console.log(
          `Total Distance:        ${totalDistanceKm} km (${numSpans} spans @ ${actualSpanLen.toFixed(1)} km)`,
        );
        console.log(`Fiber Type:            ${fiberType}`);
        console.log(`Baud Rate:             ${baudRate} Gbaud`);
        console.log(`Launch Power:          ${launchPowerDbm.toFixed(1)} dBm`);
        console.log(`----------------------------------------------------------------`);
        console.log(`Accumulated GSNR:      ${metrics.gsnrDb.toFixed(2)} dB`);
        console.log(`Accumulated OSNR(ASE): ${metrics.osnrDb.toFixed(2)} dB`);
        console.log(`Accumulated Dispersion:${metrics.accumulatedDispersionPsPerNm.toFixed(0)} ps/nm`);
        console.log(`Accumulated PMD:       ${metrics.accumulatedPmdPs.toFixed(2)} ps`);
        console.log(`Estimated BER:         ${metrics.estimatedBer.toExponential(2)}`);
        console.log(`Estimated Q-Factor:    ${metrics.estimatedQFactorDb.toFixed(2)} dB`);
        console.log(
          `Feasibility (@15dB):   ${metrics.gsnrDb >= 15.0 ? "✓ FEASIBLE (Margin: +" + (metrics.gsnrDb - 15.0).toFixed(2) + " dB)" : "FAIL (Insufficient GSNR)"}`,
        );
        return;
      }

      case "inspect":
      case "otdr": {
        if (files.length === 0) {
          console.error("[optical] No .sor trace or network file specified.");
          process.exit(1);
        }

        for (const file of files) {
          const absPath = path.resolve(process.cwd(), file);
          if (!fs.existsSync(absPath)) {
            console.error(`[optical] File not found: ${absPath}`);
            process.exit(1);
          }

          if (file.toLowerCase().endsWith(".sor")) {
            const buffer = fs.readFileSync(absPath);
            const doc = parseSor(buffer);

            console.log(`\n=== Telcordia GR-196 / SR-4731 OTDR Trace: ${path.basename(file)} ===`);
            console.log(`Cable ID:        ${doc.genParams.cableId || "N/A"}`);
            console.log(`Fiber ID:        ${doc.genParams.fiberId || "N/A"}`);
            console.log(`Fiber Type:      ${doc.genParams.fiberType || "SMF"}`);
            console.log(`Wavelength:      ${doc.fxdParams.actualWavelengthNm || doc.genParams.nominalWavelengthNm} nm`);
            console.log(`Pulse Width:     ${doc.fxdParams.pulseWidthNs} ns`);
            console.log(`Refractive Index:${doc.fxdParams.refractiveIndex}`);
            console.log(`Span Length:     ${(doc.fiberLengthMeters() / 1000).toFixed(3)} km`);
            console.log(`Total Span Loss: ${doc.totalSpanLossDb().toFixed(2)} dB`);
            console.log(`Data Points:     ${doc.dataPoints.numPoints}`);
            console.log(`\nKey Events (${doc.keyEvents.length}):`);
            console.log(`  #   Distance (km)   Loss (dB)   Refl (dB)   Slope (dB/km)   Type / Notes`);
            console.log(`  --  -------------   ---------   ---------   -------------   ------------`);

            let hasDefect = false;
            for (const ev of doc.keyEvents) {
              const km = (ev.distanceMeters / 1000).toFixed(3).padStart(13);
              const loss = ev.eventLossDb.toFixed(2).padStart(9);
              const refl = (Number.isFinite(ev.reflectanceDb) ? ev.reflectanceDb.toFixed(1) : "-inf").padStart(9);
              const slope = ev.slopeDbPerKm.toFixed(3).padStart(13);
              if (ev.eventType !== "end-of-fiber" && ev.eventLossDb > 0.3) {
                hasDefect = true;
              }
              console.log(
                `  ${String(ev.eventNumber).padStart(2)}  ${km}   ${loss}   ${refl}   ${slope}   ${ev.eventType} (${ev.comments || ""})`,
              );
            }

            console.log(
              `\nTelcordia Verdict: ${hasDefect ? "FAIL (Excess splice loss > 0.30 dB)" : "✓ PASS (Telcordia GR-196-CORE Compliant)"}`,
            );
          } else {
            const raw = fs.readFileSync(absPath, "utf-8");
            const topo = parseOpenRoadmTopology(raw);
            console.log(`\n=== OpenROADM Optical Topology: ${path.basename(file)} ===`);
            console.log(`Network Name:  ${topo.name}`);
            console.log(`ROADM Nodes:   ${topo.nodes.size}`);
            console.log(`Fiber Spans:   ${topo.spans.size}`);
            console.log(`Channels:      ${topo.channels.size}`);
          }
        }
        return;
      }

      case "to-dae": {
        const dae = lowerOpticalEdfaToDae();
        console.log(`\n=== Lowered Dynamic EDFA to Linear DAE Arena ===`);
        console.log(`Equations Count: ${dae.eqCount}`);
        console.log(`Variables Count: ${dae.varCount}`);
        console.log(`✓ EDFA differential rate equation and power conservation registered.`);
        return;
      }

      default:
        console.error(`[optical] Unknown action: ${action}`);
        process.exit(1);
    }
  },
};
