// SPDX-License-Identifier: AGPL-3.0-or-later

import { LandgemErrorCode } from "../errors.js";
import type { LandgemModel } from "../types.js";

export interface LandgemDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
}

export function lintLandgem(model: LandgemModel): LandgemDiagnostic[] {
  const diags: LandgemDiagnostic[] = [];

  for (const site of model.sites) {
    if (site.closeYear < site.openYear) {
      diags.push({
        code: LandgemErrorCode.INVALID_YEAR_RANGE.code,
        rule: LandgemErrorCode.INVALID_YEAR_RANGE.rule,
        severity: LandgemErrorCode.INVALID_YEAR_RANGE.severity,
        message: LandgemErrorCode.INVALID_YEAR_RANGE.message(site.name, site.openYear, site.closeYear),
        line: site.line ?? 1,
      });
    }

    if (site.params.k <= 0.0) {
      diags.push({
        code: LandgemErrorCode.INVALID_KINETIC_PARAMETER.code,
        rule: LandgemErrorCode.INVALID_KINETIC_PARAMETER.rule,
        severity: LandgemErrorCode.INVALID_KINETIC_PARAMETER.severity,
        message: LandgemErrorCode.INVALID_KINETIC_PARAMETER.message("k", site.params.k),
        line: site.line ?? 1,
      });
    }

    if (site.params.l0 <= 0.0) {
      diags.push({
        code: LandgemErrorCode.INVALID_KINETIC_PARAMETER.code,
        rule: LandgemErrorCode.INVALID_KINETIC_PARAMETER.rule,
        severity: LandgemErrorCode.INVALID_KINETIC_PARAMETER.severity,
        message: LandgemErrorCode.INVALID_KINETIC_PARAMETER.message("L0", site.params.l0),
        line: site.line ?? 1,
      });
    }

    if (site.cohorts.length === 0) {
      diags.push({
        code: LandgemErrorCode.MISSING_WASTE_DATA.code,
        rule: LandgemErrorCode.MISSING_WASTE_DATA.rule,
        severity: LandgemErrorCode.MISSING_WASTE_DATA.severity,
        message: LandgemErrorCode.MISSING_WASTE_DATA.message(site.name),
        line: site.line ?? 1,
      });
    }

    for (const c of site.cohorts) {
      if (c.massMg < 0) {
        diags.push({
          code: LandgemErrorCode.NEGATIVE_WASTE_MASS.code,
          rule: LandgemErrorCode.NEGATIVE_WASTE_MASS.rule,
          severity: LandgemErrorCode.NEGATIVE_WASTE_MASS.severity,
          message: LandgemErrorCode.NEGATIVE_WASTE_MASS.message(c.year, c.massMg),
          line: c.line ?? 1,
        });
      }
    }
  }

  for (const d of model.digesters) {
    if (d.ph < 6.0 || d.ph > 8.5) {
      diags.push({
        code: LandgemErrorCode.DIGESTER_PH_INHIBITION.code,
        rule: LandgemErrorCode.DIGESTER_PH_INHIBITION.rule,
        severity: LandgemErrorCode.DIGESTER_PH_INHIBITION.severity,
        message: LandgemErrorCode.DIGESTER_PH_INHIBITION.message(d.name, d.ph),
        line: d.line ?? 1,
      });
    }
  }

  return diags;
}
