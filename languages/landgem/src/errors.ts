// SPDX-License-Identifier: AGPL-3.0-or-later

export const LandgemErrorCode = {
  PARSE_ERROR: {
    code: 1001,
    rule: "landgem-parse-error",
    severity: "error" as const,
    message: (err: string) => `Syntax or structure error in LandGEM / Biogas deck: ${err}.`,
  },
  MISSING_WASTE_DATA: {
    code: 2001,
    rule: "landgem-missing-waste-data",
    severity: "error" as const,
    message: (site: string) =>
      `Landfill site '${site}' has no historical or projected waste acceptance cohorts.`,
  },
  INVALID_KINETIC_PARAMETER: {
    code: 3001,
    rule: "landgem-invalid-kinetic-parameter",
    severity: "error" as const,
    message: (param: string, val: number) =>
      `Kinetic parameter ${param} = ${val} is invalid. Value must be strictly positive (${param} > 0).`,
  },
  DIGESTER_PH_INHIBITION: {
    code: 3002,
    rule: "landgem-digester-ph-inhibition",
    severity: "error" as const,
    message: (digester: string, ph: number) =>
      `Digester '${digester}' operating pH (${ph}) causes severe methanogenic inhibition. Optimum pH is 6.8 - 7.6.`,
  },
  INVALID_YEAR_RANGE: {
    code: 4001,
    rule: "landgem-invalid-year-range",
    severity: "error" as const,
    message: (site: string, open: number, close: number) =>
      `Landfill site '${site}' closing year (${close}) must be greater than or equal to opening year (${open}).`,
  },
  NEGATIVE_WASTE_MASS: {
    code: 4002,
    rule: "landgem-negative-waste-mass",
    severity: "error" as const,
    message: (year: number, mass: number) =>
      `Waste acceptance in year ${year} has negative mass (${mass} Mg). Waste mass must be non-negative.`,
  },
};
