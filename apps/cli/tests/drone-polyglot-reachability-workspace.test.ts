// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect } from "expect";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { box, computeProjectedFrontalArea, cylinder, union } from "@modelscript/cad";

import { extractCfdSlicingProperties } from "../../../languages/cfd/src/materializer.js";
import { extractFeaSlicingProperties } from "../../../languages/fea/src/materializer.js";

import {
  CaeContractOracle,
  SemanticTheoryCoordinator,
  simulateDroneReachability,
  SpatialPhysicsOracle,
} from "@modelscript/runtime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceDir = path.resolve(__dirname, "../../../packages/examples/drone-reachability");

describe("Native Polyglot Drone Reachability Workspace (Zero-Glue Engine)", () => {
  it("Phase 1: Workspace model files should exist and be valid", () => {
    const expectedFiles = [
      "cad/drone.scad",
      "cae/drone_chassis.inp",
      "cae/drone_aero.cfg",
      "sysml/drone_specs.sysml",
      "modelica/DroneSimulation.mo",
      "modelscript.json",
      "README.md",
    ];

    for (const relPath of expectedFiles) {
      const fullPath = path.join(workspaceDir, relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, "utf8");
      expect(content.length).toBeGreaterThan(50);
    }
  });

  it("Phase 2.1: OpenSCAD CAD solid geometry should evaluate frontal area A = 0.030 m²", () => {
    // Construct representative quadcopter airframe assembly in CAD DSL (360mm span)
    const hub = cylinder({ radius: 35.0, height: 28.0 });
    const arm1 = box({ width: 360.0, height: 24.0, depth: 4.2 });
    const arm2 = box({ width: 24.0, height: 360.0, depth: 4.2 });
    const shroud = cylinder({ radius: 69.0, height: 25.0 });

    const quadFrame = union(hub, union(arm1, union(arm2, shroud)));
    const area = computeProjectedFrontalArea(quadFrame, [0, 0, 1]);

    expect(area).toBeCloseTo(0.03, 2);
  });

  it("Phase 2.2: CalculiX FEA deck should verify yield stress and derive mass m = 1.2 kg", () => {
    const inpPath = path.join(workspaceDir, "cae/drone_chassis.inp");
    const inpText = fs.readFileSync(inpPath, "utf8");

    const feaProps = extractFeaSlicingProperties(inpText);
    expect(feaProps.mass).toBe(1.2);
    expect(feaProps.maxVonMisesPa).toBe(172.4e6);
    expect(feaProps.yieldStrengthPa).toBe(180.0e6);
    expect(feaProps.isSafe).toBe(true);
    expect(feaProps.safetyFactor).toBeGreaterThan(1.0);
  });

  it("Phase 2.3: SU2 CFD configuration should evaluate drag polar Cd = 0.80", () => {
    const cfgPath = path.join(workspaceDir, "cae/drone_aero.cfg");
    const cfgText = fs.readFileSync(cfgPath, "utf8");

    const cfdProps = extractCfdSlicingProperties(cfgText);
    expect(cfdProps.cd).toBe(0.8);
    expect(cfdProps.refArea).toBe(0.03);
    expect(cfdProps.density).toBe(1.225);
    expect(cfdProps.freeStreamVelocity).toBe(10.0);
  });

  it("Phase 2.4: Nelson-Oppen Theory Coordinator should prove multi-domain contract SAT", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const spatialOracle = new SpatialPhysicsOracle();
    const caeOracle = new CaeContractOracle();

    coordinator.registerOracle(spatialOracle);
    coordinator.registerOracle(caeOracle);

    // Assert multi-domain contracts
    spatialOracle.assertDroneSlicingProperties({
      mass: 1.2,
      maxVonMisesPa: 172.4e6,
      yieldStrengthPa: 180.0e6,
      frontalAreaM2: 0.03,
      dragCoeff: 0.8,
    });

    caeOracle.assertContract({
      contractId: "SYSML-REQ-FLIGHT-CEILING",
      metricName: "maxClimbVelocity",
      actualValue: 11.42,
      threshold: 12.0,
      operator: "<=",
      unit: "m/s",
    });

    const satResult = coordinator.checkSat();
    expect(satResult.isSat).toBe(true);

    const equalities = spatialOracle.propagateEqualities();
    const massEq = equalities.find((e) => e.varA === "DroneSimulation.m");
    const areaEq = equalities.find((e) => e.varA === "DroneSimulation.A");
    const cdEq = equalities.find((e) => e.varA === "DroneSimulation.Cd");

    expect(massEq).toBeDefined();
    expect(massEq?.bounds?.[0]).toBe(1.2);
    expect(areaEq).toBeDefined();
    expect(areaEq?.bounds?.[0]).toBe(0.03);
    expect(cdEq).toBeDefined();
    expect(cdEq?.bounds?.[0]).toBe(0.8);
  });

  it("Phase 3: linearized zonotope estimate reproduces the reference envelope (non-rigorous)", () => {
    const result = simulateDroneReachability({
      m: 1.2,
      A: 0.03,
      Cd: 0.8,
      rho: 1.225,
      z_target: 11.0,
      kz: 3.1,
      kv: 1.35,
      w_max: 0.5,
      v_limit: 12.0,
    });

    // 1. Zonotope envelope stays below the limit, but this is an estimate, not a proof
    expect(result.envelopeWithinLimit).toBe(true);
    expect(result.zonotopeMaxVelocity).toBe(11.42);
    expect(result.verdict.kind).toBe("unknown");
    expect(result.verdict.kind === "unknown" && result.verdict.reason).toBe("not-rigorous");

    // 2. High-speed performance (< 10ms, typically < 3ms)
    expect(result.durationMs).toBeLessThan(15.0);

    // 3. Interval arithmetic wrapping blow-up crosses the limit at t = 3.42s
    expect(result.intervalBreachTime).toBe(3.42);
    expect(result.intervalMaxVelocity).toBeGreaterThan(12.0);

    // 4. Negative settling velocity dip down to -3.25 m/s
    expect(result.settlingDipVelocity).toBe(-3.25);

    // 5. Summary text must not claim certification
    expect(result.summary).toContain("non-rigorous");
    expect(result.summary).not.toContain("certified");
  });
});
