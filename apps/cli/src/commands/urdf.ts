// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeInverseDynamicsRnea,
  lintUrdfRobot,
  lowerUrdfToDae,
  parseUrdf,
  urdfToAdams,
  urdfToModelica,
  urdfToSimpack,
} from "@modelscript/urdf";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

import { normalizeDomainAction, resolveOutputPath } from "../util/cli-options.js";

const URDF_ACTIONS = ["inspect", "summary", "lint", "rnea", "to-modelica", "to-simpack", "to-adams", "to-dae"] as const;

export const UrdfCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "urdf <action> [files...]",
  describe: "Inspect, validate, solve kinematics, and project ROS URDF & SDFormat robot models (.urdf, .sdf, .xacro)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: inspect | summary | lint | rnea | to-modelica | to-simpack | to-adams | to-dae",
        choices: URDF_ACTIONS,
        demandOption: true,
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input robot description files (.urdf, .sdf, .xacro)",
      })
      .option("out", {
        alias: ["o", "output"],
        type: "string",
        describe: "Output file path",
      })
      .option("gravity", {
        type: "number",
        default: 9.80665,
        describe: "Gravitational acceleration [m/s^2]",
      });
  },
  handler: async (argv) => {
    const action = normalizeDomainAction(String(argv["action"] ?? "inspect"), URDF_ACTIONS);
    const files = (argv["files"] as string[]) ?? [];
    const out = resolveOutputPath(argv);

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
      const robot = parseUrdf(content);

      switch (action) {
        case "inspect":
        case "summary": {
          let totalMass = 0;
          for (const link of robot.links.values()) {
            if (link.inertial?.mass) totalMass += link.inertial.mass;
          }
          console.log(`=== URDF Robot Summary: ${robot.name} ===`);
          console.log(`  Links      : ${robot.links.size}`);
          console.log(`  Joints     : ${robot.joints.size}`);
          console.log(`  Total Mass : ${totalMass.toFixed(3)} kg`);
          break;
        }

        case "lint": {
          const diagnostics = lintUrdfRobot(robot);
          if (diagnostics.length === 0) {
            console.log(`[URDF Linter] ${file}: Clean. 0 diagnostics.`);
          } else {
            console.log(`[URDF Linter] ${file}: ${diagnostics.length} diagnostic(s) found:`);
            for (const d of diagnostics) {
              const loc = `${d.range.startLine}:${d.range.startColumn}`;
              console.log(`  [${loc}] [${d.code}] ${d.severity.toUpperCase()}: ${d.message}`);
            }
            if (diagnostics.some((d) => d.severity === "error")) {
              process.exitCode = 1;
            }
          }
          break;
        }

        case "rnea": {
          const q = new Map<string, number>();
          const qd = new Map<string, number>();
          const qdd = new Map<string, number>();
          for (const j of robot.joints.keys()) {
            q.set(j, 0.0);
            qd.set(j, 0.0);
            qdd.set(j, 0.0);
          }
          const gravity = (argv["gravity"] as number) ?? 9.80665;
          const rnea = computeInverseDynamicsRnea(robot, q, qd, qdd, gravity);
          console.log(`[URDF RNEA] Inverse Dynamics Gravity Torques (tau [N*m]):`);
          for (const [j, tau] of rnea.jointTorques) {
            console.log(`  Joint '${j}': ${tau.toFixed(4)} N*m`);
          }
          break;
        }

        case "to-modelica": {
          const mo = urdfToModelica(robot);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, mo, "utf-8");
            console.log(`[URDF] Modelica model written to ${out}`);
          } else {
            console.log(mo);
          }
          break;
        }

        case "to-simpack": {
          const simpack = urdfToSimpack(robot);
          const json = JSON.stringify(simpack, null, 2);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, json, "utf-8");
            console.log(`[URDF] SIMPACK model written to ${out}`);
          } else {
            console.log(json);
          }
          break;
        }

        case "to-adams": {
          const adams = urdfToAdams(robot);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            const { serializeAdams } = await import("@modelscript/adams");
            const adm = serializeAdams(adams);
            fs.writeFileSync(outPath, adm, "utf-8");
            console.log(`[URDF] MSC Adams dataset written to ${out}`);
          } else {
            console.log(
              `[URDF -> MSC Adams] Generated ${adams.parts.size} parts, ${adams.joints.size} joints, ${adams.markers.size} markers.`,
            );
          }
          break;
        }

        case "to-dae": {
          const dae = lowerUrdfToDae(robot);
          console.log(`[URDF -> DAE] Model: '${robot.name}' lowered to linear WebAssembly memory arena:`);
          console.log(`  Variables: ${dae.varCount}`);
          console.log(`  Equations: ${dae.eqCount}`);
          if (out) {
            fs.writeFileSync(
              path.resolve(process.cwd(), out),
              JSON.stringify({ model: robot.name, variables: dae.varCount, equations: dae.eqCount }, null, 2),
              "utf-8",
            );
          }
          break;
        }
      }
    }
  },
};
