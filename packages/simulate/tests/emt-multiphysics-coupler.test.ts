// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  MultiphysicsPortCoupler,
  type ContinuumBoundaryCondition,
  type ContinuumPatchMetrics,
  type ICfdContinuumParticipant,
} from "../src/core/index.js";

console.log("=== Testing Phase 5: Multi-Physics Power-Continuum Coupling (EMT + FEA/CFD) ===");

// Mock 3D thermal/aero continuum participant implementing ICfdContinuumParticipant
class MockPowerContinuumParticipant implements ICfdContinuumParticipant {
  public readonly id = "mock_power_continuum";
  public readonly patchNames = ["igbt_heatsink_patch", "turbine_blade_patch"] as const;
  public lastBc: Map<string, ContinuumBoundaryCondition> = new Map();

  public initialize(): void {}

  public step() {
    return {
      aerodynamicForceN: [0, 12500, 0] as [number, number, number],
      maxVelocity: 45.0,
      pressureDropPa: 1200.0,
    };
  }

  public setBoundaryCondition(patchName: string, bc: ContinuumBoundaryCondition): void {
    this.lastBc.set(patchName, bc);
  }

  public getPatchMetrics(patchName: string): ContinuumPatchMetrics {
    const bc = this.lastBc.get(patchName);
    if (patchName === "igbt_heatsink_patch") {
      return {
        patchName,
        integratedForce: [0, 0, 0],
        meanPressure: 101325.0,
        surfaceTemperatureDegC: bc?.temperature,
        integratedHeatFlowWatts: (bc?.heatFlux ?? 0) * 0.02,
      };
    }
    return {
      patchName,
      integratedForce: [0, 12500.0, 0], // 12.5 kN tangential aerodynamic force
      meanPressure: 102500.0,
    };
  }

  public terminate(): void {}
}

{
  const coupler = new MultiphysicsPortCoupler();
  const continuum = new MockPowerContinuumParticipant();

  // 1. Register IGBT Electro-Thermal Die Port (1D EMT converter loss <-> 3D heatsink continuum)
  coupler.registerBinding({
    id: "bind_igbt_die",
    oneDPortName: "mmc_valve_a1",
    continuumTagOrPatch: "igbt_heatsink_patch",
    role: "electro_thermal_die_port",
    areaM2: 0.02, // 200 cm^2 module baseplate area
    nominalRonOhm: 1.5e-3,
    dieTemperatureCoeffPerK: 0.004,
    referenceTempDegC: 25.0,
    heatCapacityJPerK: 20.0,
    thermalResistanceKPerW: 0.04,
  });

  // 2. Register Wind/Hydro Generator EMT Shaft Port (1D EMT rotor omega <-> 3D CFD blade torque)
  coupler.registerBinding({
    id: "bind_turbine_shaft",
    oneDPortName: "pmsg_rotor",
    continuumTagOrPatch: "turbine_blade_patch",
    role: "electrical_emt_port",
    axis: [0, 1, 0],
    effectiveRadiusM: 42.0, // 42 m effective blade moment arm
  });

  // Step 50 macro-steps of 10 ms (0.5 s total) with 18 kW IGBT power dissipation
  const dt = 0.01;
  let lastFeedback = new Map<string, number>();
  for (let k = 0; k < 50; k++) {
    coupler.sync1DToContinuum(
      {
        "mmc_valve_a1.P_loss": 18000.0, // 18 kW switching + conduction loss
        "pmsg_rotor.omega": 1.8, // 1.8 rad/s rotor speed
      },
      continuum,
      dt,
    );
    lastFeedback = coupler.syncContinuumTo1D(continuum);
  }

  const tj = lastFeedback.get("mmc_valve_a1.T_junction_degC")!;
  const rOn = lastFeedback.get("mmc_valve_a1.R_on_ohm")!;
  const qFlux = lastFeedback.get("mmc_valve_a1.q_flux_W_m2")!;
  const tauMech = lastFeedback.get("pmsg_rotor.tau_mech")!;

  console.log(
    `   Coupled Electro-Thermal & Aero-Shaft: Tj=${tj.toFixed(2)} degC, R_on=${(rOn * 1e3).toFixed(4)} mOhm, q''=${(qFlux / 1e3).toFixed(1)} kW/m^2, tau_mech=${(tauMech / 1e3).toFixed(1)} kNm`,
  );

  assert.ok(tj > 25.0, "Die junction temperature must increase under 18 kW dissipation");
  assert.ok(rOn > 1.5e-3, "Temperature-dependent R_on(Tj) must increase with junction temperature");
  assert.strictEqual(qFlux, 18000.0 / 0.02, "Heat flux q'' must equal P_loss / A_die");
  assert.strictEqual(tauMech, 42.0 * 12500.0, "Mechanical shaft torque must equal R_eff * F_tangent");

  // Verify formal conservation of electro-thermal energy (< 1e-6 relative drift)
  const conservation = coupler.verifyConservation();
  console.log(
    `   Conservation check: isConservative=${conservation.isConservative}, energyImbalance=${conservation.metrics.electroThermalEnergyImbalanceJoules?.toExponential(4)} J, relDrift=${conservation.metrics.electroThermalRelativeDrift?.toExponential(4)}`,
  );
  assert.strictEqual(conservation.isConservative, true);
  assert.ok((conservation.metrics.electroThermalRelativeDrift ?? 1) < 1e-6);
}

console.log("=== All Phase 5 Multi-Physics Power-Continuum Coupling Tests Passed! ===");
