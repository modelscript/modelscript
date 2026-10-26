// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cfd — Standard Diagnostic Error Codes (C1001–C1050 / M7301–M7308).
 */

export const CfdErrorCode = {
  CFL_STABILITY_VIOLATION: {
    code: 7301,
    numericCode: 1001,
    stdCode: "C1001",
    rule: "cfl-stability-violation",
    severity: "warning" as const,
    message: (cfl: number) =>
      `Courant-Friedrichs-Lewy stability number '${cfl}' exceeds recommended maximum limit for explicit scheme.`,
  },
  UNRESOLVED_MESH_FILE: {
    code: 7302,
    numericCode: 1002,
    stdCode: "C1002",
    rule: "unresolved-mesh-file",
    severity: "error" as const,
    message: (mesh: string) => `Referenced grid mesh file '${mesh}' cannot be located or is invalid.`,
  },
  MISSING_INLET_BOUNDARY: {
    code: 7303,
    numericCode: 1003,
    stdCode: "C1003",
    rule: "missing-inlet-boundary",
    severity: "warning" as const,
    message: (name: string) => `CFD domain '${name}' lacks a declared inlet boundary condition or stagnation state.`,
  },
  MISSING_OUTLET_BOUNDARY: {
    code: 7304,
    numericCode: 1004,
    stdCode: "C1004",
    rule: "missing-outlet-boundary",
    severity: "warning" as const,
    message: (name: string) => `CFD domain '${name}' lacks a declared outlet boundary condition or pressure exit.`,
  },
  UNPHYSICAL_FREESTREAM_MACH: {
    code: 7305,
    numericCode: 1005,
    stdCode: "C1005",
    rule: "unphysical-freestream-mach",
    severity: "error" as const,
    message: (mach: number) => `Freestream Mach number '${mach}' is non-physical or outside valid range [0, 25].`,
  },
  UNPHYSICAL_REYNOLDS_NUMBER: {
    code: 7306,
    numericCode: 1006,
    stdCode: "C1006",
    rule: "unphysical-reynolds-number",
    severity: "error" as const,
    message: (re: number) => `Freestream Reynolds number '${re}' must be strictly positive.`,
  },
  NEGATIVE_SURFACE_AREA: {
    code: 7307,
    numericCode: 1007,
    stdCode: "C1007",
    rule: "negative-surface-area",
    severity: "error" as const,
    message: (area: number) => `Aerodynamic reference area '${area}' must be strictly positive.`,
  },
  TURBULENT_VISCOSITY_RATIO: {
    code: 7308,
    numericCode: 1008,
    stdCode: "C1008",
    rule: "turbulent-viscosity-ratio",
    severity: "warning" as const,
    message: (ratio: number) => `Turbulent eddy viscosity ratio '${ratio}' is non-physical.`,
  },
} as const;

export type CfdErrorCodeKey = keyof typeof CfdErrorCode;
