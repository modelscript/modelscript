// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic and structural lint rules for USAF Stability and Control Digital DATCOM (`DAT1001`–`DAT5006`).
 */

import { DatcomErrorCode, type DatcomDiagnostic } from "../errors.js";
import { solveDatcomCase } from "../solver/aero-solver.js";
import { KNOWN_NAMELIST_GROUPS, type DatcomCase, type DatcomDeck, type PlanformParams } from "../types.js";

export { DatcomErrorCode, type DatcomDiagnostic };

const KNOWN_GROUPS_SET = new Set<string>(KNOWN_NAMELIST_GROUPS);

function isValidNacaDesignation(series: number, designation: string): boolean {
  const d = designation.trim().toUpperCase();
  if (series === 4) return /^\d{4}$/.test(d);
  if (series === 5) return /^\d{5}$/.test(d);
  if (series === 6) return /^6\d[A-Z]?\d{3}$/.test(d);
  return false;
}

function checkPlanform(group: string, plnf: PlanformParams, line: number | undefined, diags: DatcomDiagnostic[]): void {
  if ((plnf.SSPN !== undefined && plnf.SSPN <= 0) || (plnf.CHRDR !== undefined && plnf.CHRDR <= 0)) {
    diags.push({
      id: DatcomErrorCode.INVALID_SPAN_GEOMETRY.id,
      code: DatcomErrorCode.INVALID_SPAN_GEOMETRY.code,
      rule: DatcomErrorCode.INVALID_SPAN_GEOMETRY.rule,
      severity: DatcomErrorCode.INVALID_SPAN_GEOMETRY.severity,
      message: DatcomErrorCode.INVALID_SPAN_GEOMETRY.message(group),
      line,
      group,
    });
  }
  if (plnf.CHRDR !== undefined && plnf.CHRDR > 0 && plnf.CHRDTP !== undefined) {
    const taper = plnf.CHRDTP / plnf.CHRDR;
    if (taper < 0 || taper > 1.5) {
      diags.push({
        id: DatcomErrorCode.INVALID_TAPER_RATIO.id,
        code: DatcomErrorCode.INVALID_TAPER_RATIO.code,
        rule: DatcomErrorCode.INVALID_TAPER_RATIO.rule,
        severity: DatcomErrorCode.INVALID_TAPER_RATIO.severity,
        message: DatcomErrorCode.INVALID_TAPER_RATIO.message(group, taper),
        line,
        group,
      });
    }
  }
  if (plnf.SAVSI !== undefined && (plnf.SAVSI <= -60 || plnf.SAVSI >= 80)) {
    diags.push({
      id: DatcomErrorCode.INVALID_SWEEP_ANGLE.id,
      code: DatcomErrorCode.INVALID_SWEEP_ANGLE.code,
      rule: DatcomErrorCode.INVALID_SWEEP_ANGLE.rule,
      severity: DatcomErrorCode.INVALID_SWEEP_ANGLE.severity,
      message: DatcomErrorCode.INVALID_SWEEP_ANGLE.message(group, plnf.SAVSI),
      line,
      group,
    });
  }
}

/**
 * Lints a single Digital DATCOM case and returns all diagnostics.
 */
export function lintDatcomCase(c: DatcomCase): DatcomDiagnostic[] {
  const diags: DatcomDiagnostic[] = [];

  // 1. Parser errors (DAT1001, DAT1002)
  for (const err of c.parseErrors) {
    const isUnterm = err.code === DatcomErrorCode.UNTERMINATED_NAMELIST.id;
    const spec = isUnterm ? DatcomErrorCode.UNTERMINATED_NAMELIST : DatcomErrorCode.SYNTAX_ERROR;
    diags.push({
      id: spec.id,
      code: spec.code,
      rule: spec.rule,
      severity: spec.severity,
      message: err.message,
      line: err.line,
      column: err.column,
    });
  }

  // 2. Unknown NAMELIST groups (DAT2001)
  const groupLineMap = new Map<string, number>();
  for (const nl of c.namelists) {
    if (!groupLineMap.has(nl.group)) groupLineMap.set(nl.group, nl.line);
    if (!KNOWN_GROUPS_SET.has(nl.group)) {
      diags.push({
        id: DatcomErrorCode.UNKNOWN_NAMELIST_GROUP.id,
        code: DatcomErrorCode.UNKNOWN_NAMELIST_GROUP.code,
        rule: DatcomErrorCode.UNKNOWN_NAMELIST_GROUP.rule,
        severity: DatcomErrorCode.UNKNOWN_NAMELIST_GROUP.severity,
        message: DatcomErrorCode.UNKNOWN_NAMELIST_GROUP.message(nl.group),
        line: nl.line,
        group: nl.group,
      });
    }
  }

  // 3. Invalid NACA designations (DAT2002)
  for (const naca of c.nacaCards) {
    if (!isValidNacaDesignation(naca.series, naca.designation)) {
      diags.push({
        id: DatcomErrorCode.INVALID_NACA_DESIGNATION.id,
        code: DatcomErrorCode.INVALID_NACA_DESIGNATION.code,
        rule: DatcomErrorCode.INVALID_NACA_DESIGNATION.rule,
        severity: DatcomErrorCode.INVALID_NACA_DESIGNATION.severity,
        message: DatcomErrorCode.INVALID_NACA_DESIGNATION.message(naca.raw),
        line: naca.line,
      });
    }
  }

  // 4. Required $FLTCON and $WGPLNF (DAT3001, DAT3002)
  if (!c.fltcon) {
    diags.push({
      id: DatcomErrorCode.MISSING_FLTCON.id,
      code: DatcomErrorCode.MISSING_FLTCON.code,
      rule: DatcomErrorCode.MISSING_FLTCON.rule,
      severity: DatcomErrorCode.MISSING_FLTCON.severity,
      message: DatcomErrorCode.MISSING_FLTCON.message(c.caseId),
      line: 1,
      group: "FLTCON",
    });
  }
  if (!c.wgplnf) {
    diags.push({
      id: DatcomErrorCode.MISSING_WGPLNF.id,
      code: DatcomErrorCode.MISSING_WGPLNF.code,
      rule: DatcomErrorCode.MISSING_WGPLNF.rule,
      severity: DatcomErrorCode.MISSING_WGPLNF.severity,
      message: DatcomErrorCode.MISSING_WGPLNF.message(c.caseId),
      line: 1,
      group: "WGPLNF",
    });
  }

  // 5. $FLTCON array length consistency (DAT3003), transonic info (DAT5003), missing WT (DAT5004)
  if (c.fltcon) {
    const fltLine = groupLineMap.get("FLTCON");
    if (c.fltcon.NMACH !== undefined && c.fltcon.MACH !== undefined) {
      const expected = Math.round(c.fltcon.NMACH);
      if (expected !== c.fltcon.MACH.length) {
        diags.push({
          id: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.id,
          code: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.code,
          rule: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.rule,
          severity: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.severity,
          message: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.message("NMACH", expected, "MACH", c.fltcon.MACH.length),
          line: fltLine,
          group: "FLTCON",
        });
      }
    }
    if (c.fltcon.NALPHA !== undefined && c.fltcon.ALSCHD !== undefined) {
      const expected = Math.round(c.fltcon.NALPHA);
      if (expected !== c.fltcon.ALSCHD.length) {
        diags.push({
          id: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.id,
          code: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.code,
          rule: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.rule,
          severity: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.severity,
          message: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.message(
            "NALPHA",
            expected,
            "ALSCHD",
            c.fltcon.ALSCHD.length,
          ),
          line: fltLine,
          group: "FLTCON",
        });
      }
    }
    if (c.fltcon.NALT !== undefined && c.fltcon.ALT !== undefined) {
      const expected = Math.round(c.fltcon.NALT);
      if (expected !== c.fltcon.ALT.length) {
        diags.push({
          id: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.id,
          code: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.code,
          rule: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.rule,
          severity: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.severity,
          message: DatcomErrorCode.MISMATCHED_ARRAY_LENGTH.message("NALT", expected, "ALT", c.fltcon.ALT.length),
          line: fltLine,
          group: "FLTCON",
        });
      }
    }
    if (c.fltcon.MACH) {
      for (const m of c.fltcon.MACH) {
        if (m >= 0.8 && m <= 1.2) {
          diags.push({
            id: DatcomErrorCode.TRANSONIC_REGIME_INFO.id,
            code: DatcomErrorCode.TRANSONIC_REGIME_INFO.code,
            rule: DatcomErrorCode.TRANSONIC_REGIME_INFO.rule,
            severity: DatcomErrorCode.TRANSONIC_REGIME_INFO.severity,
            message: DatcomErrorCode.TRANSONIC_REGIME_INFO.message(m),
            line: fltLine,
            group: "FLTCON",
          });
        }
      }
    }
    if (c.damp && (c.fltcon.WT === undefined || c.fltcon.WT <= 0)) {
      diags.push({
        id: DatcomErrorCode.MISSING_AIRCRAFT_WEIGHT.id,
        code: DatcomErrorCode.MISSING_AIRCRAFT_WEIGHT.code,
        rule: DatcomErrorCode.MISSING_AIRCRAFT_WEIGHT.rule,
        severity: DatcomErrorCode.MISSING_AIRCRAFT_WEIGHT.severity,
        message: DatcomErrorCode.MISSING_AIRCRAFT_WEIGHT.message(c.caseId),
        line: fltLine,
        group: "FLTCON",
      });
    }
  }

  // 6. $OPTINS reference geometry (DAT4001, DAT4002, DAT4003)
  if (c.optins) {
    const optLine = groupLineMap.get("OPTINS");
    if (c.optins.SREF !== undefined && c.optins.SREF <= 0) {
      diags.push({
        id: DatcomErrorCode.NON_POSITIVE_SREF.id,
        code: DatcomErrorCode.NON_POSITIVE_SREF.code,
        rule: DatcomErrorCode.NON_POSITIVE_SREF.rule,
        severity: DatcomErrorCode.NON_POSITIVE_SREF.severity,
        message: DatcomErrorCode.NON_POSITIVE_SREF.message(c.optins.SREF),
        line: optLine,
        group: "OPTINS",
      });
    }
    if (c.optins.CBARR !== undefined && c.optins.CBARR <= 0) {
      diags.push({
        id: DatcomErrorCode.NON_POSITIVE_CBARR.id,
        code: DatcomErrorCode.NON_POSITIVE_CBARR.code,
        rule: DatcomErrorCode.NON_POSITIVE_CBARR.rule,
        severity: DatcomErrorCode.NON_POSITIVE_CBARR.severity,
        message: DatcomErrorCode.NON_POSITIVE_CBARR.message(c.optins.CBARR),
        line: optLine,
        group: "OPTINS",
      });
    }
    if (c.optins.BLREF !== undefined && c.optins.BLREF <= 0) {
      diags.push({
        id: DatcomErrorCode.NON_POSITIVE_BLREF.id,
        code: DatcomErrorCode.NON_POSITIVE_BLREF.code,
        rule: DatcomErrorCode.NON_POSITIVE_BLREF.rule,
        severity: DatcomErrorCode.NON_POSITIVE_BLREF.severity,
        message: DatcomErrorCode.NON_POSITIVE_BLREF.message(c.optins.BLREF),
        line: optLine,
        group: "OPTINS",
      });
    }
  }

  // 7. Planform taper ratio, sweep angle, span checks (DAT4004, DAT4005, DAT5005)
  if (c.wgplnf) checkPlanform("WGPLNF", c.wgplnf, groupLineMap.get("WGPLNF"), diags);
  if (c.htplnf) checkPlanform("HTPLNF", c.htplnf, groupLineMap.get("HTPLNF"), diags);
  if (c.vtplnf) checkPlanform("VTPLNF", c.vtplnf, groupLineMap.get("VTPLNF"), diags);
  if (c.vfplnf) checkPlanform("VFPLNF", c.vfplnf, groupLineMap.get("VFPLNF"), diags);

  // 8. Flap chord vs wing chord check (DAT5006)
  if (c.symflp && c.wgplnf && c.wgplnf.CHRDR !== undefined && c.wgplnf.CHRDR > 0) {
    const flapLine = groupLineMap.get("SYMFLP");
    if (c.symflp.CHRDFI !== undefined && c.symflp.CHRDFI > c.wgplnf.CHRDR) {
      diags.push({
        id: DatcomErrorCode.FLAP_CHORD_EXCEEDS_WING.id,
        code: DatcomErrorCode.FLAP_CHORD_EXCEEDS_WING.code,
        rule: DatcomErrorCode.FLAP_CHORD_EXCEEDS_WING.rule,
        severity: DatcomErrorCode.FLAP_CHORD_EXCEEDS_WING.severity,
        message: DatcomErrorCode.FLAP_CHORD_EXCEEDS_WING.message(c.symflp.CHRDFI, c.wgplnf.CHRDR),
        line: flapLine,
        group: "SYMFLP",
      });
    }
  }

  // 9. Static longitudinal stability check: CG vs Neutral Point (DAT5001, DAT5002)
  if (c.fltcon && c.wgplnf && c.synths?.XCG !== undefined) {
    const solved = solveDatcomCase(c);
    const synLine = groupLineMap.get("SYNTHS");
    const smPct = solved.staticMargin * 100;
    if (solved.cgX > solved.neutralPointX) {
      diags.push({
        id: DatcomErrorCode.STATIC_INSTABILITY_CG_AFT.id,
        code: DatcomErrorCode.STATIC_INSTABILITY_CG_AFT.code,
        rule: DatcomErrorCode.STATIC_INSTABILITY_CG_AFT.rule,
        severity: DatcomErrorCode.STATIC_INSTABILITY_CG_AFT.severity,
        message: DatcomErrorCode.STATIC_INSTABILITY_CG_AFT.message(solved.cgX, solved.neutralPointX, smPct),
        line: synLine,
        group: "SYNTHS",
      });
    } else if (smPct > 45.0) {
      diags.push({
        id: DatcomErrorCode.EXCESSIVE_STATIC_MARGIN.id,
        code: DatcomErrorCode.EXCESSIVE_STATIC_MARGIN.code,
        rule: DatcomErrorCode.EXCESSIVE_STATIC_MARGIN.rule,
        severity: DatcomErrorCode.EXCESSIVE_STATIC_MARGIN.severity,
        message: DatcomErrorCode.EXCESSIVE_STATIC_MARGIN.message(smPct),
        line: synLine,
        group: "SYNTHS",
      });
    }
  }

  return diags;
}

/**
 * Lints all cases in a parsed Digital DATCOM deck.
 */
export function lintDatcom(deck: DatcomDeck): DatcomDiagnostic[] {
  const diags: DatcomDiagnostic[] = [];
  for (const c of deck.cases) {
    diags.push(...lintDatcomCase(c));
  }
  return diags;
}
