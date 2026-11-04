// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/bngl — Pre-flight Rule-Based Biochemical Network Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M9051 - M9060) for BioNetGen (.bngl) models.
 */

import { BnglErrorCode, type DiagnosticItem } from "../errors.js";
import { serializeComplexPattern } from "../parser/bngl-parser.js";
import type { BnglComplexPattern, BnglDocument } from "../types.js";

const BUILTIN_MATH_IDENTIFIERS = new Set([
  "time",
  "t",
  "exp",
  "log",
  "ln",
  "log10",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "sqrt",
  "pow",
  "abs",
  "min",
  "max",
  "floor",
  "ceil",
  "pi",
  "e",
  "avogadro",
  "na",
  "true",
  "false",
  "if",
  "sat",
  "mm",
  "hill",
]);

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

/**
 * Extracts all variable/function identifiers from a rate expression without regular expressions.
 */
function extractFormulaIdentifiers(formula: string): string[] {
  const ids: string[] = [];
  const n = formula.length;
  let i = 0;

  while (i < n) {
    const ch = formula[i] ?? "";
    if (isAlpha(ch)) {
      const prev = i > 0 ? (formula[i - 1] ?? "") : "";
      let ident = "";
      while (i < n && isAlphaNum(formula[i] ?? "")) {
        ident += formula[i] ?? "";
        i++;
      }
      // Skip scientific notation exponent suffix like 1e-3 or 2.5E4
      if ((ident[0] === "e" || ident[0] === "E") && (isDigit(prev) || prev === ".")) {
        continue;
      }
      ids.push(ident);
      continue;
    }
    i++;
  }

  return ids;
}

export function lintBngl(doc: BnglDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const model = doc.model;
  const rulesList = model.reactionRuleList ?? Array.from(model.reactionRules.values());
  const obsList = model.observableList ?? Array.from(model.observables.values());

  // M9058: Empty BioNetGen model
  if (model.moleculeTypes.size === 0 && model.seedSpecies.length === 0 && rulesList.length === 0) {
    diagnostics.push({
      code: BnglErrorCode.EMPTY_BIONETGEN_MODEL.code,
      rule: BnglErrorCode.EMPTY_BIONETGEN_MODEL.rule,
      severity: BnglErrorCode.EMPTY_BIONETGEN_MODEL.severity,
      message: BnglErrorCode.EMPTY_BIONETGEN_MODEL.message(model.id),
      range: model.range,
    });
    return diagnostics;
  }

  // Helper to validate a BnglComplexPattern for M9051, M9052, M9053, M9054
  const validatePattern = (pattern: BnglComplexPattern, contextName: string): void => {
    const patternStr = pattern.raw ?? serializeComplexPattern(pattern);

    // M9054: Dangling bond label (!1 appears != 2 times in a complex pattern)
    const bondCounts = new Map<string, number>();
    for (const mol of pattern.molecules) {
      for (const comp of mol.components) {
        if (comp.bond !== undefined && comp.bond !== "+" && comp.bond !== "?" && comp.bond !== "-") {
          bondCounts.set(comp.bond, (bondCounts.get(comp.bond) ?? 0) + 1);
        }
      }
    }

    for (const [bondLabel, count] of bondCounts) {
      if (count !== 2) {
        diagnostics.push({
          code: BnglErrorCode.DANGLING_BOND_LABEL.code,
          rule: BnglErrorCode.DANGLING_BOND_LABEL.rule,
          severity: BnglErrorCode.DANGLING_BOND_LABEL.severity,
          message: BnglErrorCode.DANGLING_BOND_LABEL.message(bondLabel, patternStr, count),
          range: pattern.range ?? model.range,
        });
      }
    }

    // M9051, M9052, M9053: Molecule type, component site, and internal state validation
    for (const mol of pattern.molecules) {
      const molDef = model.moleculeTypes.get(mol.name);
      if (!molDef) {
        diagnostics.push({
          code: BnglErrorCode.UNDECLARED_MOLECULE_TYPE.code,
          rule: BnglErrorCode.UNDECLARED_MOLECULE_TYPE.rule,
          severity: BnglErrorCode.UNDECLARED_MOLECULE_TYPE.severity,
          message: BnglErrorCode.UNDECLARED_MOLECULE_TYPE.message(mol.name, contextName),
          range: mol.range ?? pattern.range ?? model.range,
        });
        continue;
      }

      const siteDefMap = new Map<string, string[]>();
      for (const s of molDef.sites) {
        siteDefMap.set(s.name, s.allowedStates);
      }

      for (const comp of mol.components) {
        const allowedStates = siteDefMap.get(comp.name);
        if (allowedStates === undefined) {
          diagnostics.push({
            code: BnglErrorCode.UNDECLARED_COMPONENT_SITE.code,
            rule: BnglErrorCode.UNDECLARED_COMPONENT_SITE.rule,
            severity: BnglErrorCode.UNDECLARED_COMPONENT_SITE.severity,
            message: BnglErrorCode.UNDECLARED_COMPONENT_SITE.message(comp.name, mol.name),
            range: comp.range ?? mol.range ?? pattern.range ?? model.range,
          });
          continue;
        }

        if (comp.state !== undefined && comp.state !== "?") {
          if (!allowedStates.includes(comp.state)) {
            diagnostics.push({
              code: BnglErrorCode.INVALID_INTERNAL_STATE.code,
              rule: BnglErrorCode.INVALID_INTERNAL_STATE.rule,
              severity: BnglErrorCode.INVALID_INTERNAL_STATE.severity,
              message: BnglErrorCode.INVALID_INTERNAL_STATE.message(comp.state, comp.name, mol.name),
              range: comp.range ?? mol.range ?? pattern.range ?? model.range,
            });
          }
        }
      }
    }
  };

  // Validate Seed Species (M9051-M9054, M9057)
  for (const sp of model.seedSpecies) {
    const patText = sp.pattern.raw ?? serializeComplexPattern(sp.pattern);
    validatePattern(sp.pattern, `seed species ${patText}`);

    // M9057: Negative seed concentration
    if (sp.initialConcentration < 0) {
      diagnostics.push({
        code: BnglErrorCode.NEGATIVE_SEED_CONCENTRATION.code,
        rule: BnglErrorCode.NEGATIVE_SEED_CONCENTRATION.rule,
        severity: BnglErrorCode.NEGATIVE_SEED_CONCENTRATION.severity,
        message: BnglErrorCode.NEGATIVE_SEED_CONCENTRATION.message(patText, sp.initialConcentration),
        range: sp.range ?? model.range,
      });
    }
  }

  // Validate Observables (M9051-M9054, M9059)
  const seenObservableNames = new Set<string>();
  for (const obs of obsList) {
    if (seenObservableNames.has(obs.name)) {
      diagnostics.push({
        code: BnglErrorCode.DUPLICATE_OBSERVABLE_NAME.code,
        rule: BnglErrorCode.DUPLICATE_OBSERVABLE_NAME.rule,
        severity: BnglErrorCode.DUPLICATE_OBSERVABLE_NAME.severity,
        message: BnglErrorCode.DUPLICATE_OBSERVABLE_NAME.message(obs.name),
        range: obs.range ?? model.range,
      });
    } else {
      seenObservableNames.add(obs.name);
    }

    for (const pat of obs.patterns) {
      validatePattern(pat, `observable ${obs.name}`);
    }
  }

  // Check if generate_network action specifies max_stoich
  const hasMaxStoichBound = doc.actions.some(
    (a) => a.command === "generate_network" && a.args["max_stoich"] !== undefined,
  );

  // Validate Reaction Rules (M9051-M9056, M9060)
  for (const rule of rulesList) {
    for (const rPat of rule.reactants) {
      validatePattern(rPat, `rule ${rule.id}`);
    }
    for (const pPat of rule.products) {
      validatePattern(pPat, `rule ${rule.id}`);
    }

    // M9056: Reversible rule missing reverse rate
    if (rule.reversible && (!rule.reverseRate || rule.reverseRate.trim().length === 0)) {
      diagnostics.push({
        code: BnglErrorCode.REVERSIBLE_RULE_MISSING_REVERSE_RATE.code,
        rule: BnglErrorCode.REVERSIBLE_RULE_MISSING_REVERSE_RATE.rule,
        severity: BnglErrorCode.REVERSIBLE_RULE_MISSING_REVERSE_RATE.severity,
        message: BnglErrorCode.REVERSIBLE_RULE_MISSING_REVERSE_RATE.message(rule.id),
        range: rule.range ?? model.range,
      });
    }

    // M9055: Undefined rate parameter
    const rateExprs: string[] = [rule.forwardRate];
    if (rule.reverseRate && rule.reverseRate.trim().length > 0) {
      rateExprs.push(rule.reverseRate);
    }

    const seenUndefinedParams = new Set<string>();
    for (const rateExpr of rateExprs) {
      if (!rateExpr || rateExpr.trim().length === 0) continue;
      const ids = extractFormulaIdentifiers(rateExpr);
      for (const sym of ids) {
        if (seenUndefinedParams.has(sym) || BUILTIN_MATH_IDENTIFIERS.has(sym.toLowerCase())) {
          continue;
        }
        const isDefined =
          model.parameters.has(sym) ||
          model.functions.has(sym) ||
          model.observables.has(sym) ||
          model.compartments.has(sym);

        if (!isDefined) {
          seenUndefinedParams.add(sym);
          diagnostics.push({
            code: BnglErrorCode.UNDEFINED_RATE_PARAMETER.code,
            rule: BnglErrorCode.UNDEFINED_RATE_PARAMETER.rule,
            severity: BnglErrorCode.UNDEFINED_RATE_PARAMETER.severity,
            message: BnglErrorCode.UNDEFINED_RATE_PARAMETER.message(rule.id, sym),
            range: rule.range ?? model.range,
          });
        }
      }
    }

    // M9060: Unbounded polymerization rule
    if (!hasMaxStoichBound && rule.reactants.length >= 2) {
      const reportedPolyMols = new Set<string>();
      for (const prod of rule.products) {
        const prodMolCounts = new Map<string, number>();
        for (const m of prod.molecules) {
          prodMolCounts.set(m.name, (prodMolCounts.get(m.name) ?? 0) + 1);
        }

        for (const [molName, countInProd] of prodMolCounts) {
          if (countInProd < 2 || reportedPolyMols.has(molName)) continue;

          const maxInSingleReactant = Math.max(
            0,
            ...rule.reactants.map((r) => r.molecules.filter((m) => m.name === molName).length),
          );
          if (countInProd <= maxInSingleReactant) continue;

          // Check how many sites this molecule type has
          const molDef = model.moleculeTypes.get(molName);
          const declaredSiteCount = molDef ? molDef.sites.length : 0;
          const usedSiteNames = new Set<string>();
          for (const r of rule.reactants) {
            for (const m of r.molecules) {
              if (m.name === molName) {
                for (const c of m.components) usedSiteNames.add(c.name);
              }
            }
          }
          for (const m of prod.molecules) {
            if (m.name === molName) {
              for (const c of m.components) usedSiteNames.add(c.name);
            }
          }

          const totalSites = Math.max(declaredSiteCount, usedSiteNames.size);
          if (totalSites >= 2) {
            // Check if any reactant or product instance omits a site OR leaves an unbound site for chain elongation
            let canElongate = false;
            for (const m of prod.molecules) {
              if (m.name !== molName) continue;
              if (m.components.length < totalSites) {
                canElongate = true;
              }
              for (const c of m.components) {
                if (c.bond === undefined || c.bond === "?") {
                  canElongate = true;
                }
              }
            }

            if (canElongate) {
              reportedPolyMols.add(molName);
              diagnostics.push({
                code: BnglErrorCode.UNBOUNDED_POLYMERIZATION_RULE.code,
                rule: BnglErrorCode.UNBOUNDED_POLYMERIZATION_RULE.rule,
                severity: BnglErrorCode.UNBOUNDED_POLYMERIZATION_RULE.severity,
                message: BnglErrorCode.UNBOUNDED_POLYMERIZATION_RULE.message(rule.id, molName),
                range: rule.range ?? model.range,
              });
            }
          }
        }
      }
    }
  }

  return diagnostics;
}
