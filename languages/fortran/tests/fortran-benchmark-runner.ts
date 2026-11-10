// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fortran Industrial Benchmark Runner:
 * 6-DOF Orbital Dynamics & Propulsion System with DAE Arena Lowering & Formal Verification.
 */

import { DAEBuilder } from "@modelscript/runtime";
import { lowerFortranToDae, type FortranDaeLoweringResult } from "../src/dae/lowering.js";
import { simulateFortranRoutine } from "../src/codegen/step-compiler.js";
import { verifyFortranSource, type FormalVerificationReport } from "../src/formal/verifier.js";

export interface FortranBenchmarkResult {
  name: string;
  variableCount: number;
  equationCount: number;
  stateCount: number;
  inputCount: number;
  outputCount: number;
  isCertifiedSafe: boolean;
  provenSafeCount: number;
  definiteBugCount: number;
  simulationSteps: number;
  finalEnergy: number;
  daeLoweringTimeMs: number;
  simulationTimeMs: number;
  formalVerificationTimeMs: number;
  totalTimeMs: number;
}

export const ORBITAL_PROPULSION_FORTRAN_SRC = `subroutine orbital_flight_dynamics(p_c, a_t, c_f, mass_dry, mass_fuel)
  implicit none
  real(8), intent(in)  :: p_c, a_t, c_f, mass_dry, mass_fuel
  real(8), intent(out) :: thrust, mass_total, alt_out, speed_out, energy_out
  real(8), parameter   :: mu_earth = 3.986004418e14
  real(8), parameter   :: r_earth = 6.371e6
  real(8), parameter   :: rho_0 = 1.225
  real(8), parameter   :: scale_height = 8500.0
  real(8), parameter   :: c_drag = 0.47
  real(8), parameter   :: area_ref = 12.5
  real(8) :: r_norm, v_norm, alt_val, rho_val, f_drag, a_grav, a_thrust
  integer :: k

  ! Total vehicle mass & thrust calculation
  mass_total = mass_dry + mass_fuel
  thrust = p_c * a_t * c_f

  ! 6 Orbital state derivatives: SD(1:3) = velocity, SD(4:6) = accelerations
  ! S(1:3) = position [x, y, z], S(4:6) = velocity [vx, vy, vz]
  SD(1) = S(4)
  SD(2) = S(5)
  SD(3) = S(6)

  ! Bounded orbital radius & velocity magnitude (ensures strictly positive divisors)
  r_norm = sqrt(4.0e13 + S(1)**2 + S(2)**2 + S(3)**2)
  v_norm = sqrt(100.0 + S(4)**2 + S(5)**2 + S(6)**2)
  alt_val = r_norm - r_earth

  ! Atmospheric density model and aerodynamic drag
  rho_val = rho_0 * exp(-alt_val / scale_height)
  f_drag = 0.5 * rho_val * (v_norm**2) * c_drag * area_ref

  ! Equations of motion
  a_grav = -mu_earth / (r_norm**2)
  a_thrust = thrust / mass_total

  SD(4) = a_grav * (S(1) / r_norm) + (a_thrust - f_drag / mass_total) * (S(4) / v_norm)
  SD(5) = a_grav * (S(2) / r_norm) + (a_thrust - f_drag / mass_total) * (S(5) / v_norm)
  SD(6) = a_grav * (S(3) / r_norm) + (a_thrust - f_drag / mass_total) * (S(6) / v_norm)

  alt_out = alt_val
  speed_out = v_norm
  energy_out = 0.5 * (v_norm**2) - mu_earth / r_norm
end subroutine orbital_flight_dynamics
`;

export async function runFortranBenchmark(): Promise<FortranBenchmarkResult> {
  const t0 = performance.now();

  // 1. DAE Arena Lowering
  const tDae0 = performance.now();
  const builder = new DAEBuilder();
  const daeResult: FortranDaeLoweringResult = lowerFortranToDae(
    builder,
    ORBITAL_PROPULSION_FORTRAN_SRC.split("\n"),
    "orbital_dynamics",
  );
  const daeLoweringTimeMs = performance.now() - tDae0;

  // 2. Formal Safety Verification
  const tFormal0 = performance.now();
  const formalReport: FormalVerificationReport = verifyFortranSource(ORBITAL_PROPULSION_FORTRAN_SRC);
  const formalVerificationTimeMs = performance.now() - tFormal0;

  // 3. Multi-Step Simulation
  const tSim0 = performance.now();
  const simResult = await simulateFortranRoutine(ORBITAL_PROPULSION_FORTRAN_SRC, {
    startTime: 0.0,
    stopTime: 1.0,
    dt: 0.1,
    inputs: {
      p_c: 5.0e6,
      a_t: 0.1,
      c_f: 1.6,
      mass_dry: 5000.0,
      mass_fuel: 25000.0,
    },
  });
  const simulationTimeMs = performance.now() - tSim0;
  const totalTimeMs = performance.now() - t0;

  const totalVars =
    daeResult.stateVarIndices.length +
    daeResult.inputVarIndices.length +
    daeResult.outputVarIndices.length +
    daeResult.parameterVarIndices.length;

  return {
    name: "Fortran 6-DOF Orbital Dynamics & Propulsion System",
    variableCount: totalVars,
    equationCount: daeResult.equationCount,
    stateCount: daeResult.stateVarIndices.length,
    inputCount: daeResult.inputVarIndices.length,
    outputCount: daeResult.outputVarIndices.length,
    isCertifiedSafe: formalReport.isCertifiedSafe,
    provenSafeCount: formalReport.provenSafeCount,
    definiteBugCount: formalReport.definiteBugCount,
    simulationSteps: simResult.t.length,
    finalEnergy: simResult.finalLocals["energy_out"] ?? 0,
    daeLoweringTimeMs,
    simulationTimeMs,
    formalVerificationTimeMs,
    totalTimeMs,
  };
}
