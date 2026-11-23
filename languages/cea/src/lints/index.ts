// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Pre-flight Linter for NASA CEA Problem Decks (CEA1001–CEA5006).
 */

import { CeaErrorCode, type CeaDiagnostic } from "../errors.js";
import { parseCeaDeck } from "../parser/cea-parser.js";
import { lookupCeaSpecies } from "../solver/thermo-db.js";
import type { CeaDeck } from "../types.js";

export { CeaErrorCode, type CeaDiagnostic, type CeaDiagnosticSeverity } from "../errors.js";

/**
 * Validates a parsed `CeaDeck` and returns structured pre-flight diagnostics.
 */
export function lintCeaDeck(deck: CeaDeck): CeaDiagnostic[] {
  const diags: CeaDiagnostic[] = [];

  // CEA1001: Syntax errors recorded by the parser
  for (const err of deck.parseErrors) {
    diags.push({
      code: CeaErrorCode.SYNTAX_ERROR.code,
      rule: CeaErrorCode.SYNTAX_ERROR.rule,
      severity: CeaErrorCode.SYNTAX_ERROR.severity,
      message: CeaErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // CEA1002: Missing problem dataset
  if (!deck.hasProblem) {
    diags.push({
      code: CeaErrorCode.MISSING_PROBLEM.code,
      rule: CeaErrorCode.MISSING_PROBLEM.rule,
      severity: CeaErrorCode.MISSING_PROBLEM.severity,
      message: CeaErrorCode.MISSING_PROBLEM.message(),
      line: 1,
      column: 1,
    });
  }

  // CEA1003: Missing reactants dataset
  if (!deck.hasReactants || deck.reactants.length === 0) {
    diags.push({
      code: CeaErrorCode.MISSING_REACTANTS.code,
      rule: CeaErrorCode.MISSING_REACTANTS.rule,
      severity: CeaErrorCode.MISSING_REACTANTS.severity,
      message: CeaErrorCode.MISSING_REACTANTS.message(),
      line: deck.problem.span?.startLine ?? 1,
      column: 1,
    });
  }

  // CEA1004: Missing end terminator
  if (!deck.hasEnd) {
    const lastLine = Math.max(1, deck.rawText.split(/\r?\n/).length);
    diags.push({
      code: CeaErrorCode.MISSING_END.code,
      rule: CeaErrorCode.MISSING_END.rule,
      severity: CeaErrorCode.MISSING_END.severity,
      message: CeaErrorCode.MISSING_END.message(),
      line: lastLine,
      column: 1,
    });
  }

  const probLine = deck.problem.span?.startLine ?? 1;

  // CEA2001: Unknown problem type / unrecognized problem tokens
  for (const unk of deck.problem.unknownTokens) {
    diags.push({
      code: CeaErrorCode.UNKNOWN_PROBLEM_TYPE.code,
      rule: CeaErrorCode.UNKNOWN_PROBLEM_TYPE.rule,
      severity: CeaErrorCode.UNKNOWN_PROBLEM_TYPE.severity,
      message: CeaErrorCode.UNKNOWN_PROBLEM_TYPE.message(unk.token),
      line: unk.line,
      column: unk.column,
    });
  }

  // CEA3001: Non-positive pressure
  for (const p of deck.problem.pressuresBar) {
    if (!Number.isFinite(p) || p <= 0) {
      diags.push({
        code: CeaErrorCode.NON_POSITIVE_PRESSURE.code,
        rule: CeaErrorCode.NON_POSITIVE_PRESSURE.rule,
        severity: CeaErrorCode.NON_POSITIVE_PRESSURE.severity,
        message: CeaErrorCode.NON_POSITIVE_PRESSURE.message(p),
        line: probLine,
        column: 1,
      });
    }
  }

  // CEA3002: Non-positive temperature (in problem section and reactants)
  for (const t of deck.problem.temperaturesK) {
    if (!Number.isFinite(t) || t <= 0) {
      diags.push({
        code: CeaErrorCode.NON_POSITIVE_TEMPERATURE.code,
        rule: CeaErrorCode.NON_POSITIVE_TEMPERATURE.rule,
        severity: CeaErrorCode.NON_POSITIVE_TEMPERATURE.severity,
        message: CeaErrorCode.NON_POSITIVE_TEMPERATURE.message(t),
        line: probLine,
        column: 1,
      });
    }
  }
  for (const r of deck.reactants) {
    if (r.temperatureK !== undefined && (!Number.isFinite(r.temperatureK) || r.temperatureK <= 0)) {
      diags.push({
        code: CeaErrorCode.NON_POSITIVE_TEMPERATURE.code,
        rule: CeaErrorCode.NON_POSITIVE_TEMPERATURE.rule,
        severity: CeaErrorCode.NON_POSITIVE_TEMPERATURE.severity,
        message: CeaErrorCode.NON_POSITIVE_TEMPERATURE.message(r.temperatureK),
        line: r.line,
        column: r.column,
      });
    }
  }

  // CEA3003: Non-positive expansion or pressure ratio
  for (const v of deck.problem.supar) {
    if (!Number.isFinite(v) || v <= 0) {
      diags.push({
        code: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.code,
        rule: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.rule,
        severity: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.severity,
        message: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.message("supar", v),
        line: probLine,
        column: 1,
      });
    }
  }
  for (const v of deck.problem.subar) {
    if (!Number.isFinite(v) || v <= 0) {
      diags.push({
        code: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.code,
        rule: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.rule,
        severity: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.severity,
        message: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.message("subar", v),
        line: probLine,
        column: 1,
      });
    }
  }
  for (const v of deck.problem.piPeRatios) {
    if (!Number.isFinite(v) || v <= 0) {
      diags.push({
        code: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.code,
        rule: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.rule,
        severity: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.severity,
        message: CeaErrorCode.NON_POSITIVE_EXPANSION_RATIO.message("pi/pe", v),
        line: probLine,
        column: 1,
      });
    }
  }

  // CEA3004: Negative o/f or phi
  for (const v of deck.problem.ofRatios) {
    if (!Number.isFinite(v) || v < 0) {
      diags.push({
        code: CeaErrorCode.NEGATIVE_MIXTURE_RATIO.code,
        rule: CeaErrorCode.NEGATIVE_MIXTURE_RATIO.rule,
        severity: CeaErrorCode.NEGATIVE_MIXTURE_RATIO.severity,
        message: CeaErrorCode.NEGATIVE_MIXTURE_RATIO.message("o/f", v),
        line: probLine,
        column: 1,
      });
    }
  }
  for (const v of deck.problem.phiRatios) {
    if (!Number.isFinite(v) || v < 0) {
      diags.push({
        code: CeaErrorCode.NEGATIVE_MIXTURE_RATIO.code,
        rule: CeaErrorCode.NEGATIVE_MIXTURE_RATIO.rule,
        severity: CeaErrorCode.NEGATIVE_MIXTURE_RATIO.severity,
        message: CeaErrorCode.NEGATIVE_MIXTURE_RATIO.message("phi", v),
        line: probLine,
        column: 1,
      });
    }
  }

  // Reactant checks: CEA2002, CEA5004, CEA5005, CEA4001, CEA4002
  const seenReactants = new Set<string>();
  let fuelWtSum = 0;
  let fuelWtCount = 0;
  let fuelFirstLine = probLine;
  let oxidWtSum = 0;
  let oxidWtCount = 0;
  let oxidFirstLine = probLine;
  let hasFuel = false;
  let hasOxid = false;

  for (const r of deck.reactants) {
    if (r.role === "fuel") hasFuel = true;
    if (r.role === "oxid") hasOxid = true;

    const sp = lookupCeaSpecies(r.name);
    if (!sp && !r.formula) {
      diags.push({
        code: CeaErrorCode.UNKNOWN_REACTANT_SPECIES.code,
        rule: CeaErrorCode.UNKNOWN_REACTANT_SPECIES.rule,
        severity: CeaErrorCode.UNKNOWN_REACTANT_SPECIES.severity,
        message: CeaErrorCode.UNKNOWN_REACTANT_SPECIES.message(r.name),
        line: r.line,
        column: r.column,
      });
    }

    const dedupKey = `${r.role}:${r.name.toUpperCase()}`;
    if (seenReactants.has(dedupKey)) {
      diags.push({
        code: CeaErrorCode.DUPLICATE_REACTANT.code,
        rule: CeaErrorCode.DUPLICATE_REACTANT.rule,
        severity: CeaErrorCode.DUPLICATE_REACTANT.severity,
        message: CeaErrorCode.DUPLICATE_REACTANT.message(r.name),
        line: r.line,
        column: r.column,
      });
    }
    seenReactants.add(dedupKey);

    if (r.wtPercent !== undefined) {
      if (r.wtPercent <= 0) {
        diags.push({
          code: CeaErrorCode.NON_POSITIVE_REACTANT_AMOUNT.code,
          rule: CeaErrorCode.NON_POSITIVE_REACTANT_AMOUNT.rule,
          severity: CeaErrorCode.NON_POSITIVE_REACTANT_AMOUNT.severity,
          message: CeaErrorCode.NON_POSITIVE_REACTANT_AMOUNT.message(r.name, r.wtPercent),
          line: r.line,
          column: r.column,
        });
      }
      if (r.role === "fuel") {
        if (fuelWtCount === 0) fuelFirstLine = r.line;
        fuelWtCount++;
        fuelWtSum += r.wtPercent;
      } else if (r.role === "oxid") {
        if (oxidWtCount === 0) oxidFirstLine = r.line;
        oxidWtCount++;
        oxidWtSum += r.wtPercent;
      }
    }

    if (r.moles !== undefined && r.moles <= 0) {
      diags.push({
        code: CeaErrorCode.NON_POSITIVE_REACTANT_AMOUNT.code,
        rule: CeaErrorCode.NON_POSITIVE_REACTANT_AMOUNT.rule,
        severity: CeaErrorCode.NON_POSITIVE_REACTANT_AMOUNT.severity,
        message: CeaErrorCode.NON_POSITIVE_REACTANT_AMOUNT.message(r.name, r.moles),
        line: r.line,
        column: r.column,
      });
    }
  }

  // CEA4001: fuel wt% sum != 100
  if (fuelWtCount > 0 && Math.abs(fuelWtSum - 100.0) > 1e-2) {
    diags.push({
      code: CeaErrorCode.FUEL_WEIGHT_PERCENT_SUM.code,
      rule: CeaErrorCode.FUEL_WEIGHT_PERCENT_SUM.rule,
      severity: CeaErrorCode.FUEL_WEIGHT_PERCENT_SUM.severity,
      message: CeaErrorCode.FUEL_WEIGHT_PERCENT_SUM.message(fuelWtSum),
      line: fuelFirstLine,
      column: 1,
    });
  }

  // CEA4002: oxid wt% sum != 100
  if (oxidWtCount > 0 && Math.abs(oxidWtSum - 100.0) > 1e-2) {
    diags.push({
      code: CeaErrorCode.OXID_WEIGHT_PERCENT_SUM.code,
      rule: CeaErrorCode.OXID_WEIGHT_PERCENT_SUM.rule,
      severity: CeaErrorCode.OXID_WEIGHT_PERCENT_SUM.severity,
      message: CeaErrorCode.OXID_WEIGHT_PERCENT_SUM.message(oxidWtSum),
      line: oxidFirstLine,
      column: 1,
    });
  }

  // CEA4003 & CEA2003: only / omit / insert validation
  const onlySet = new Set(deck.only.map((s) => s.toUpperCase()));
  const omitSet = new Set(deck.omit.map((s) => s.toUpperCase()));
  for (const sp of deck.only) {
    if (omitSet.has(sp.toUpperCase())) {
      diags.push({
        code: CeaErrorCode.CONFLICTING_ONLY_OMIT.code,
        rule: CeaErrorCode.CONFLICTING_ONLY_OMIT.rule,
        severity: CeaErrorCode.CONFLICTING_ONLY_OMIT.severity,
        message: CeaErrorCode.CONFLICTING_ONLY_OMIT.message(sp),
        line: probLine,
        column: 1,
      });
    }
    if (!lookupCeaSpecies(sp)) {
      diags.push({
        code: CeaErrorCode.UNKNOWN_FILTER_SPECIES.code,
        rule: CeaErrorCode.UNKNOWN_FILTER_SPECIES.rule,
        severity: CeaErrorCode.UNKNOWN_FILTER_SPECIES.severity,
        message: CeaErrorCode.UNKNOWN_FILTER_SPECIES.message("only", sp),
        line: probLine,
        column: 1,
      });
    }
  }
  for (const sp of deck.omit) {
    if (!onlySet.has(sp.toUpperCase()) && !lookupCeaSpecies(sp)) {
      diags.push({
        code: CeaErrorCode.UNKNOWN_FILTER_SPECIES.code,
        rule: CeaErrorCode.UNKNOWN_FILTER_SPECIES.rule,
        severity: CeaErrorCode.UNKNOWN_FILTER_SPECIES.severity,
        message: CeaErrorCode.UNKNOWN_FILTER_SPECIES.message("omit", sp),
        line: probLine,
        column: 1,
      });
    }
  }
  for (const sp of deck.insert) {
    if (!lookupCeaSpecies(sp)) {
      diags.push({
        code: CeaErrorCode.UNKNOWN_FILTER_SPECIES.code,
        rule: CeaErrorCode.UNKNOWN_FILTER_SPECIES.rule,
        severity: CeaErrorCode.UNKNOWN_FILTER_SPECIES.severity,
        message: CeaErrorCode.UNKNOWN_FILTER_SPECIES.message("insert", sp),
        line: probLine,
        column: 1,
      });
    }
  }

  // CEA5001: Missing pressure for pressure-specified problem types
  const pt = deck.problem.problemType;
  if (
    deck.hasProblem &&
    pt &&
    (pt === "hp" || pt === "tp" || pt === "sp" || pt === "rocket" || pt === "deton") &&
    deck.problem.pressuresBar.length === 0
  ) {
    diags.push({
      code: CeaErrorCode.MISSING_PRESSURE.code,
      rule: CeaErrorCode.MISSING_PRESSURE.rule,
      severity: CeaErrorCode.MISSING_PRESSURE.severity,
      message: CeaErrorCode.MISSING_PRESSURE.message(pt),
      line: probLine,
      column: 1,
    });
  }

  // CEA5002: Missing temperature for tp/tv
  if (deck.hasProblem && pt && (pt === "tp" || pt === "tv") && deck.problem.temperaturesK.length === 0) {
    diags.push({
      code: CeaErrorCode.MISSING_TEMPERATURE.code,
      rule: CeaErrorCode.MISSING_TEMPERATURE.rule,
      severity: CeaErrorCode.MISSING_TEMPERATURE.severity,
      message: CeaErrorCode.MISSING_TEMPERATURE.message(pt),
      line: probLine,
      column: 1,
    });
  }

  // CEA5003: o/f or phi specified without both fuel and oxid
  if (deck.hasReactants && deck.reactants.length > 0) {
    if (deck.problem.ofRatios.length > 0 && (!hasFuel || !hasOxid)) {
      diags.push({
        code: CeaErrorCode.MISSING_FUEL_OR_OXID.code,
        rule: CeaErrorCode.MISSING_FUEL_OR_OXID.rule,
        severity: CeaErrorCode.MISSING_FUEL_OR_OXID.severity,
        message: CeaErrorCode.MISSING_FUEL_OR_OXID.message("o/f"),
        line: probLine,
        column: 1,
      });
    }
    if (deck.problem.phiRatios.length > 0 && (!hasFuel || !hasOxid)) {
      diags.push({
        code: CeaErrorCode.MISSING_FUEL_OR_OXID.code,
        rule: CeaErrorCode.MISSING_FUEL_OR_OXID.rule,
        severity: CeaErrorCode.MISSING_FUEL_OR_OXID.severity,
        message: CeaErrorCode.MISSING_FUEL_OR_OXID.message("phi"),
        line: probLine,
        column: 1,
      });
    }
  }

  // CEA5006: Invalid trace threshold
  if (
    deck.output.trace !== undefined &&
    (!Number.isFinite(deck.output.trace) || deck.output.trace <= 0 || deck.output.trace > 1)
  ) {
    diags.push({
      code: CeaErrorCode.INVALID_TRACE_THRESHOLD.code,
      rule: CeaErrorCode.INVALID_TRACE_THRESHOLD.rule,
      severity: CeaErrorCode.INVALID_TRACE_THRESHOLD.severity,
      message: CeaErrorCode.INVALID_TRACE_THRESHOLD.message(deck.output.trace),
      line: deck.output.span?.startLine ?? probLine,
      column: 1,
    });
  }

  return diags;
}

/**
 * Convenience helper to parse and lint a NASA CEA deck string.
 */
export function lintCeaSource(source: string): CeaDiagnostic[] {
  return lintCeaDeck(parseCeaDeck(source));
}
