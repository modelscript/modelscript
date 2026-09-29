// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MultiDomainContractBridge, type AssumeGuaranteeContract } from "../src/index.js";

describe("Multi-Domain Assume-Guarantee Contract Bridge (SysML ↔ Modelica ↔ CAD/FEA)", () => {
  it("should synthesize contracts from FEA boundary conditions and Modelica ports", () => {
    // 1. Synthesize FEA structural contract for a motor mounting bracket
    // Yield stress = 250 MPa, safety factor = 1.5 => max allowable stress = 166.67 MPa
    const feaContract = MultiDomainContractBridge.fromFeaBoundary({
      componentName: "MotorBracket",
      appliedForceVar: "bracket.appliedForce",
      maxAllowableForce: 1500, // N
      yieldStressPa: 250e6,
      safetyFactor: 1.5,
      maxDeflectionMm: 0.5,
      stressVar: "bracket.vonMisesStress",
      deflectionVar: "bracket.deflection",
    });

    assert.strictEqual(feaContract.name, "FEA_MotorBracket_Contract");
    assert(feaContract.assumptions.includes("bracket.appliedForce <= 1500"));
    assert(feaContract.guarantees.some((g) => g.includes("bracket.vonMisesStress <=")));
    assert(feaContract.guarantees.includes("bracket.deflection <= 0.5"));

    // 2. Synthesize Modelica continuous behavioral contract for the powertrain
    const modelicaContract = MultiDomainContractBridge.fromModelicaPort({
      subsystemName: "Powertrain",
      portName: "flange_mount",
      variableName: "force",
      peakLoadMagnitude: 1200, // N (simulated peak transient load < 1500 N allowable)
      operatingTempRange: [-20, 50],
      sourceGuarantees: ["powertrain.speed <= 100"],
    });

    assert.strictEqual(modelicaContract.name, "Modelica_Powertrain_flange_mount_Contract");
    assert(modelicaContract.assumptions.includes("Powertrain.ambientTemp >= -20"));
    assert(modelicaContract.assumptions.includes("Powertrain.ambientTemp <= 50"));
    assert(modelicaContract.guarantees.includes("Powertrain.flange_mount.force <= 1200"));
    assert(modelicaContract.guarantees.includes("powertrain.speed <= 100"));
  });

  it("should certify valid multi-domain digital thread contract composition", () => {
    // Top-level SysML System Requirement
    const sysmlRequirement: AssumeGuaranteeContract = {
      name: "VehicleSafetyRequirement",
      assumptions: ["ambientTemp >= -20", "ambientTemp <= 50"],
      guarantees: ["vehicleSpeed <= 100", "chassisStress <= 200e6"],
    };

    // Subsystem 1: Modelica Closed-Loop Powertrain
    const powertrainContract: AssumeGuaranteeContract = {
      name: "Modelica_Powertrain_Contract",
      assumptions: ["ambientTemp >= -20", "ambientTemp <= 50"],
      guarantees: [
        "vehicleSpeed <= 100",
        "mountForce <= 1200", // Transmitted force
      ],
    };

    // Subsystem 2: CAD / FEA Chassis & Bracket
    const chassisFeaContract: AssumeGuaranteeContract = {
      name: "FEA_Chassis_Contract",
      assumptions: ["mountForce <= 1500"], // Can safely take up to 1500 N
      guarantees: ["chassisStress <= 180e6"], // 180 MPa <= 200 MPa required
    };

    const result = MultiDomainContractBridge.verifyMultiDomainComposition(sysmlRequirement, [
      powertrainContract,
      chassisFeaContract,
    ]);

    assert.strictEqual(result.isCertifiedSafe, true);
    assert.strictEqual(result.domainViolations.length, 0);
    assert(result.summary.includes("CERTIFIED SAFE"));
  });

  it("should detect cross-domain structural compatibility violation when dynamic load exceeds FEA limit", () => {
    // SysML requirement
    const sysmlRequirement: AssumeGuaranteeContract = {
      name: "VehicleSafetyRequirement",
      assumptions: ["ambientTemp >= 0"],
      guarantees: ["chassisStress <= 200e6"],
    };

    // Aggressive Modelica powertrain emits peak load up to 1800 N
    const aggressivePowertrain: AssumeGuaranteeContract = {
      name: "Modelica_AggressiveMotor_Contract",
      assumptions: ["ambientTemp >= 0"],
      guarantees: ["mountForce <= 1800"], // Exceeds FEA bracket capability!
    };

    // CAD / FEA bracket only designed for 1400 N
    const lightweightBracket: AssumeGuaranteeContract = {
      name: "FEA_Bracket_Contract",
      assumptions: ["mountForce <= 1400"],
      guarantees: ["chassisStress <= 150e6"],
    };

    const result = MultiDomainContractBridge.verifyMultiDomainComposition(sysmlRequirement, [
      aggressivePowertrain,
      lightweightBracket,
    ]);

    assert.strictEqual(result.isCertifiedSafe, false);
    assert.strictEqual(result.domainViolations.length >= 1, true);

    const cadViolation = result.domainViolations.find((v) => v.domain === "cad_fea");
    assert(cadViolation !== undefined, "Must identify CAD/FEA domain violation");
    assert(cadViolation.component.includes("FEA_Bracket_Contract"));
    assert(cadViolation.description.includes("mountForce <= 1400"));
    assert(result.summary.includes("FALSIFIED"));
  });
});
