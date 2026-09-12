/**
 * Drone Chassis — Procedural CAD Model
 *
 * This file defines the 3D geometry of a quadcopter drone chassis using
 * the ModelScript procedural CAD DSL.  When compiled, it produces a
 * standard STEP file that can be used for FEA/CFD simulation, 3D
 * printing, or import into any CAD software.
 *
 * Usage:
 *   npx tsx drone.mcad.ts              # prints STEP to stdout
 *   npx tsx drone.mcad.ts drone.step   # writes to file
 */

import { assembly, box, compileAssemblyToStep, cylinder, part, translate } from "@modelscript/cad";
import * as fs from "fs";

// ── Parameters ───────────────────────────────────────────────────────────
// These could be driven by Modelica parameters via annotation(CAD(...))

const BODY_WIDTH = 10;
const BODY_HEIGHT = 3;
const BODY_DEPTH = 10;
const ARM_LENGTH = 7;
const ARM_WIDTH = 1.6;
const ARM_HEIGHT = 1;
const MOTOR_RADIUS = 1.5;
const MOTOR_HEIGHT = 2;
const MOTOR_OFFSET = 10; // distance from center to motor
const SKID_LENGTH = 10;
const SKID_HEIGHT = 0.4;
const STRUT_HEIGHT = 2.4;
const CAMERA_DEPTH = 3;

// ── Central Body ─────────────────────────────────────────────────────────

const centralBody = box({
  width: BODY_WIDTH,
  height: BODY_HEIGHT,
  depth: BODY_DEPTH,
  name: "CentralBody",
});

const topCover = translate(
  box({ width: BODY_WIDTH - 2, height: 0.6, depth: BODY_DEPTH - 2, name: "TopCover" }),
  [0, 2, 0],
);

const electronicsBay = translate(box({ width: 6, height: 1, depth: 6, name: "ElectronicsBay" }), [0, -2.2, 0]);

// ── Arms ─────────────────────────────────────────────────────────────────
// Front-right arm, then mirror to get the other three

const armFR = translate(box({ width: ARM_LENGTH, height: ARM_HEIGHT, depth: ARM_WIDTH, name: "Arm_FR" }), [6, 0, 6]);

const armFL = translate(box({ width: ARM_LENGTH, height: ARM_HEIGHT, depth: ARM_WIDTH, name: "Arm_FL" }), [-6, 0, 6]);

const armRR = translate(box({ width: ARM_LENGTH, height: ARM_HEIGHT, depth: ARM_WIDTH, name: "Arm_RR" }), [6, 0, -6]);

const armRL = translate(box({ width: ARM_LENGTH, height: ARM_HEIGHT, depth: ARM_WIDTH, name: "Arm_RL" }), [-6, 0, -6]);

// ── Motor Mounts ─────────────────────────────────────────────────────────

const motorFR = translate(cylinder({ radius: MOTOR_RADIUS, height: MOTOR_HEIGHT, name: "Motor_FR" }), [
  MOTOR_OFFSET,
  1,
  MOTOR_OFFSET,
]);

const motorFL = translate(cylinder({ radius: MOTOR_RADIUS, height: MOTOR_HEIGHT, name: "Motor_FL" }), [
  -MOTOR_OFFSET,
  1,
  MOTOR_OFFSET,
]);

const motorRR = translate(cylinder({ radius: MOTOR_RADIUS, height: MOTOR_HEIGHT, name: "Motor_RR" }), [
  MOTOR_OFFSET,
  1,
  -MOTOR_OFFSET,
]);

const motorRL = translate(cylinder({ radius: MOTOR_RADIUS, height: MOTOR_HEIGHT, name: "Motor_RL" }), [
  -MOTOR_OFFSET,
  1,
  -MOTOR_OFFSET,
]);

// ── Landing Skids ────────────────────────────────────────────────────────

const skidL = translate(
  box({ width: 0.6, height: SKID_HEIGHT, depth: SKID_LENGTH, name: "LandingSkid_L" }),
  [-4, -4, 0],
);

const skidR = translate(
  box({ width: 0.6, height: SKID_HEIGHT, depth: SKID_LENGTH, name: "LandingSkid_R" }),
  [4, -4, 0],
);

// Landing struts
const strutLF = translate(box({ width: 0.4, height: STRUT_HEIGHT, depth: 0.4, name: "Strut_LF" }), [-4, -2.8, 3.5]);
const strutLR = translate(box({ width: 0.4, height: STRUT_HEIGHT, depth: 0.4, name: "Strut_LR" }), [-4, -2.8, -3.5]);
const strutRF = translate(box({ width: 0.4, height: STRUT_HEIGHT, depth: 0.4, name: "Strut_RF" }), [4, -2.8, 3.5]);
const strutRR = translate(box({ width: 0.4, height: STRUT_HEIGHT, depth: 0.4, name: "Strut_RR" }), [4, -2.8, -3.5]);

// ── Camera Mount ─────────────────────────────────────────────────────────

const cameraMount = translate(box({ width: 2, height: 0.8, depth: CAMERA_DEPTH, name: "CameraMount" }), [0, -1, 6.5]);

const cameraHousing = translate(box({ width: 1.6, height: 1.6, depth: 1.2, name: "CameraHousing" }), [0, -1.8, 7.8]);

// ── Battery ──────────────────────────────────────────────────────────────

const battery = translate(box({ width: 5, height: 1.2, depth: 8, name: "Battery" }), [0, -3.2, 0]);

// ── Assembly ─────────────────────────────────────────────────────────────

const droneAssembly = assembly("DroneChassisV2", [
  // Frame
  part(centralBody, { material: "CarbonFiber", color: [0.15, 0.15, 0.18] }),
  part(topCover, { material: "CarbonFiber", color: [0.2, 0.2, 0.22] }),
  part(electronicsBay, { material: "ABS", color: [0.1, 0.1, 0.12] }),

  // Arms
  part(armFR, { material: "CarbonFiber", color: [0.2, 0.2, 0.25] }),
  part(armFL, { material: "CarbonFiber", color: [0.2, 0.2, 0.25] }),
  part(armRR, { material: "CarbonFiber", color: [0.2, 0.2, 0.25] }),
  part(armRL, { material: "CarbonFiber", color: [0.2, 0.2, 0.25] }),

  // Motors
  part(motorFR, { material: "Aluminum", color: [0.7, 0.72, 0.78] }),
  part(motorFL, { material: "Aluminum", color: [0.7, 0.72, 0.78] }),
  part(motorRR, { material: "Aluminum", color: [0.7, 0.72, 0.78] }),
  part(motorRL, { material: "Aluminum", color: [0.7, 0.72, 0.78] }),

  // Landing gear
  part(skidL, { material: "Aluminum", color: [0.5, 0.5, 0.55] }),
  part(skidR, { material: "Aluminum", color: [0.5, 0.5, 0.55] }),
  part(strutLF, { material: "Aluminum", color: [0.5, 0.5, 0.55] }),
  part(strutLR, { material: "Aluminum", color: [0.5, 0.5, 0.55] }),
  part(strutRF, { material: "Aluminum", color: [0.5, 0.5, 0.55] }),
  part(strutRR, { material: "Aluminum", color: [0.5, 0.5, 0.55] }),

  // Camera
  part(cameraMount, { material: "ABS", color: [0.3, 0.3, 0.35] }),
  part(cameraHousing, { material: "ABS", color: [0.1, 0.1, 0.12] }),

  // Battery
  part(battery, { material: "LiPo", color: [0.05, 0.2, 0.6] }),
]);

// ── Compile & Output ─────────────────────────────────────────────────────

const step = compileAssemblyToStep(droneAssembly);

const outputPath = process.argv[2];
if (outputPath) {
  fs.writeFileSync(outputPath, step);
  console.log(`✅ Compiled DroneChassisV2 → ${outputPath} (${step.length} bytes, ${droneAssembly.parts.length} parts)`);
} else {
  process.stdout.write(step);
}
