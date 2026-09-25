// SPDX-License-Identifier: AGPL-3.0-or-later

import { getCfdDialect, type ParameterLookup } from "@modelscript/cfd";
import type { LbmGridConfig } from "./lbm-types.js";

export interface LoadCfgOptions {
  evaluator?: ParameterLookup | Record<string, number | string>;
  nx?: number;
  ny?: number;
  nz?: number;
  domainSizeMeters?: [number, number, number];
  dialect?: string;
}

/**
 * Loads a CFD configuration (.cfg) and maps it into an in-WASM WebGPU LbmGridConfig.
 */
export function loadCfgToLbm(cfgContent: string, options: LoadCfgOptions = {}): LbmGridConfig {
  const dialect = getCfdDialect(options.dialect || "su2");
  let text = cfgContent;
  if (text.includes("{{")) {
    text = dialect.materialize(text, { evaluator: options.evaluator });
  }

  const parsed = dialect.parse(text);

  const nx = options.nx ?? 64;
  const ny = options.ny ?? 32;
  const nz = options.nz ?? 32;

  const domainX = options.domainSizeMeters ? options.domainSizeMeters[0] : 0.5; // 0.5m default
  const dx = domainX / nx;

  const density = parsed.density ?? 1.225; // kg/m^3
  const inletVelocity = parsed.inletVelocity ?? [10.0, 0.0, 0.0];
  const speed = Math.sqrt(inletVelocity[0] ** 2 + inletVelocity[1] ** 2 + inletVelocity[2] ** 2) || 10.0;

  // Lattice speed of sound cs = 1 / sqrt(3) in lattice units
  // Keep lattice Mach number u_lb < 0.15 for incompressibility stability
  const targetLatticeSpeed = 0.08;
  const dt = (targetLatticeSpeed * dx) / speed;

  // Kinematic viscosity nu = mu / rho
  const mu = parsed.viscosity ?? 1.8e-5;
  const nu = mu / density;

  // Lattice kinematic viscosity nu_lb = nu * (dt / (dx * dx))
  const nu_lb = nu * (dt / (dx * dx));
  // BGK relaxation time tau = 3 * nu_lb + 0.5
  const tau = Math.max(0.505, Math.min(1.5, 3.0 * nu_lb + 0.5));

  const config: LbmGridConfig = {
    nx,
    ny,
    nz,
    dx,
    dt,
    tau,
    density,
    inletVelocity,
    turbulenceModel:
      parsed.mathProblem?.includes("RANS") || parsed.mathProblem?.includes("SST") ? "smagorinsky_les" : "laminar",
    curvedBoundary: true,
  };

  return config;
}
