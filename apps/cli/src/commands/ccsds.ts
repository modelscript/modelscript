// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ccsdsToModelica,
  ccsdsToSysml,
  keplerianToCartesian,
  lintCcsds,
  lowerCcsdsToDae,
  parseCcsds,
  propagateOrbit,
} from "@modelscript/ccsds";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const CcsdsCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "ccsds <action> [files...]",
  describe:
    "Inspect, validate, propagate, lower to DAE, and project CCSDS and XTCE spacecraft data (.oem, .opm, .omm, .xtce)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: inspect | lint | propagate | to-modelica | to-sysml | to-dae",
        choices: ["inspect", "lint", "propagate", "to-modelica", "to-sysml", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input CCSDS / XTCE files (.oem, .opm, .omm, .xtce)",
      })
      .option("out", {
        type: "string",
        describe: "Output file path for generated Modelica or SysML v2 code",
      })
      .option("duration", {
        type: "number",
        default: 5400,
        describe: "Propagation duration in seconds (~90 min default)",
      })
      .option("step", {
        type: "number",
        default: 30,
        describe: "Propagation time step in seconds",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
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
      const doc = parseCcsds(content, file);

      switch (action) {
        case "inspect": {
          if (doc.format === "XTCE") {
            console.log(`\n=== OMG XTCE Space System: ${doc.name} ===`);
            console.log(`Telemetry Parameters: ${doc.parameters.length}`);
            for (const p of doc.parameters) {
              console.log(
                `  - '${p.name}': ${p.paramType} (${p.bitLength} bits)${p.units ? " [" + p.units + "]" : ""}`,
              );
            }
            console.log(`Sequence Containers: ${doc.containers.length}`);
            for (const c of doc.containers) {
              console.log(`  - Container '${c.name}' (${c.entries.length} entries)`);
            }
            console.log(`Telecommands: ${doc.commands.length}`);
            for (const cmd of doc.commands) {
              console.log(`  - Command '${cmd.name}' (${cmd.arguments.length} args)`);
            }
          } else {
            console.log(`\n=== CCSDS ${doc.format} Spacecraft: ${doc.metadata.objectName} ===`);
            console.log(`Ref Frame: ${doc.metadata.refFrame}, Time System: ${doc.metadata.timeSystem}`);
            if (doc.format === "OEM") {
              console.log(`Ephemeris Points: ${doc.points.length}`);
              if (doc.points.length > 0) {
                const p0 = doc.points[0]!;
                console.log(
                  `  - Start Epoch: ${p0.epoch}, pos=[${p0.x.toFixed(2)}, ${p0.y.toFixed(2)}, ${p0.z.toFixed(2)}] km`,
                );
              }
            } else if (doc.format === "OPM") {
              console.log(`State Vector at Epoch ${doc.stateVector.epoch}:`);
              console.log(
                `  pos = [${doc.stateVector.x.toFixed(2)}, ${doc.stateVector.y.toFixed(2)}, ${doc.stateVector.z.toFixed(2)}] km`,
              );
              console.log(
                `  vel = [${doc.stateVector.vx.toFixed(3)}, ${doc.stateVector.vy.toFixed(3)}, ${doc.stateVector.vz.toFixed(3)}] km/s`,
              );
              if (doc.keplerian) {
                console.log(`Keplerian Orbit Elements:`);
                console.log(
                  `  a = ${doc.keplerian.semiMajorAxisKm.toFixed(2)} km, e = ${doc.keplerian.eccentricity.toFixed(4)}, inc = ${doc.keplerian.inclinationDeg.toFixed(2)} deg`,
                );
              }
            } else if (doc.format === "OMM") {
              console.log(`Mean Keplerian Elements:`);
              console.log(
                `  a = ${doc.meanElements.semiMajorAxisKm.toFixed(2)} km, e = ${doc.meanElements.eccentricity.toFixed(4)}, inc = ${doc.meanElements.inclinationDeg.toFixed(2)} deg`,
              );
            }
            if ("spacecraft" in doc && doc.spacecraft) {
              console.log(
                `Spacecraft Parameters: mass=${doc.spacecraft.massKg ?? "auto"} kg, dragArea=${doc.spacecraft.dragAreaM2 ?? "auto"} m2`,
              );
            }
          }
          break;
        }

        case "lint": {
          const diags = lintCcsds(doc);
          if (diags.length === 0) {
            console.log(`[PASS] ${file}: 0 diagnostics reported.`);
          } else {
            console.log(`Found ${diags.length} diagnostic(s) in ${file}:`);
            for (const d of diags) {
              const loc = `${file}:${d.range.startLine}:${d.range.startColumn}`;
              console.log(`  [${d.code}] [${d.severity.toUpperCase()}] ${loc} - ${d.message}`);
            }
          }
          break;
        }

        case "propagate": {
          let initPos: [number, number, number] = [7000, 0, 0];
          let initVel: [number, number, number] = [0, 7.546, 0];

          if (doc.format === "OPM") {
            if (doc.stateVector.x !== 0 || doc.stateVector.y !== 0) {
              initPos = [doc.stateVector.x, doc.stateVector.y, doc.stateVector.z];
              initVel = [doc.stateVector.vx, doc.stateVector.vy, doc.stateVector.vz];
            } else if (doc.keplerian) {
              const sv = keplerianToCartesian(doc.keplerian);
              initPos = [sv.x, sv.y, sv.z];
              initVel = [sv.vx, sv.vy, sv.vz];
            }
          } else if (doc.format === "OMM") {
            const sv = keplerianToCartesian(doc.meanElements);
            initPos = [sv.x, sv.y, sv.z];
            initVel = [sv.vx, sv.vy, sv.vz];
          } else if (doc.format === "OEM" && doc.points.length > 0) {
            const p0 = doc.points[0]!;
            initPos = [p0.x, p0.y, p0.z];
            initVel = [p0.vx, p0.vy, p0.vz];
          }

          const dur = (argv["duration"] as number) ?? 5400;
          const dt = (argv["step"] as number) ?? 30;

          const traj = propagateOrbit(
            { x: initPos[0], y: initPos[1], z: initPos[2], vx: initVel[0], vy: initVel[1], vz: initVel[2] },
            "spacecraft" in doc ? doc.spacecraft : undefined,
            { durationSeconds: dur, stepSeconds: dt, includeJ2: true },
          );

          console.log(`\n=== Cowell Orbit Propagation (${traj.length} steps, ${dur}s duration) ===`);
          const t0 = traj[0]!;
          const tEnd = traj[traj.length - 1]!;
          console.log(
            `  Initial Altitude: ${t0.altitudeKm.toFixed(2)} km, Lat: ${t0.latitudeDeg.toFixed(2)}°, Lon: ${t0.longitudeDeg.toFixed(2)}°`,
          );
          console.log(
            `  Final Altitude:   ${tEnd.altitudeKm.toFixed(2)} km, Lat: ${tEnd.latitudeDeg.toFixed(2)}°, Lon: ${tEnd.longitudeDeg.toFixed(2)}°`,
          );
          break;
        }

        case "to-modelica": {
          const modelica = ccsdsToModelica(doc);
          if (outFile) {
            fs.writeFileSync(path.resolve(process.cwd(), outFile), modelica, "utf-8");
            console.log(`Saved Modelica astrodynamics model to ${outFile}`);
          } else {
            console.log(modelica);
          }
          break;
        }

        case "to-sysml": {
          const sysml = ccsdsToSysml(doc);
          if (outFile) {
            fs.writeFileSync(path.resolve(process.cwd(), outFile), sysml, "utf-8");
            console.log(`Saved SysML v2 model to ${outFile}`);
          } else {
            console.log(sysml);
          }
          break;
        }

        case "to-dae": {
          const arena = lowerCcsdsToDae(doc);
          console.log(`Lowered CCSDS spacecraft orbit into linear DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          break;
        }

        default:
          console.error(`Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
