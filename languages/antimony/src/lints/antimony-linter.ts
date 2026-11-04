// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/antimony — Pre-flight Reaction Network & Modular Pathway Diagnostics Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M9001 - M9010) for Antimony (.ant) models.
 */

import { AntimonyErrorCode, type DiagnosticItem } from "../errors.js";
import type { AntimonyDocument, AntimonyModule } from "../types.js";

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
  "piecewise",
  "delay",
  "pi",
  "e",
  "avogadro",
  "true",
  "false",
  "and",
  "or",
  "not",
  "xor",
  "inf",
  "infinity",
  "nan",
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
 * Extracts all variable/function identifiers from a formula string without regular expressions.
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

/**
 * Checks whether an event trigger expression contains a relational or boolean condition.
 */
function isRelationalOrBooleanTrigger(trigger: string): boolean {
  const trimmed = trigger.trim();
  if (trimmed.length === 0) return false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i] ?? "";
    const next = trimmed[i + 1] ?? "";
    if (ch === ">" || ch === "<") return true;
    if ((ch === "=" || ch === "!") && next === "=") return true;
    if (ch === "&" && next === "&") return true;
    if (ch === "|" && next === "|") return true;
    if (ch === "!" && next !== "=") return true;
  }

  const ids = extractFormulaIdentifiers(trimmed);
  for (const id of ids) {
    const lower = id.toLowerCase();
    if (
      lower === "true" ||
      lower === "false" ||
      lower === "and" ||
      lower === "or" ||
      lower === "not" ||
      lower === "xor" ||
      lower === "gt" ||
      lower === "lt" ||
      lower === "geq" ||
      lower === "leq" ||
      lower === "eq" ||
      lower === "neq"
    ) {
      return true;
    }
  }

  return false;
}

export function lintAntimony(doc: AntimonyDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const modulesToCheck: AntimonyModule[] = doc.modules.size > 0 ? Array.from(doc.modules.values()) : [doc.mainModule];

  // M9007: Circular submodel instantiation check across module graph
  const cycleReportedModules = new Set<string>();
  for (const mod of modulesToCheck) {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (currentId: string): boolean => {
      if (visiting.has(currentId)) {
        return true;
      }
      if (visited.has(currentId)) {
        return false;
      }
      visiting.add(currentId);
      const currentMod = doc.modules.get(currentId);
      if (currentMod) {
        for (const sub of currentMod.submodels) {
          if (dfs(sub.moduleName)) {
            visiting.delete(currentId);
            return true;
          }
        }
      }
      visiting.delete(currentId);
      visited.add(currentId);
      return false;
    };

    if (dfs(mod.id) && !cycleReportedModules.has(mod.id)) {
      cycleReportedModules.add(mod.id);
      diagnostics.push({
        code: AntimonyErrorCode.CIRCULAR_SUBMODEL_INSTANTIATION.code,
        rule: AntimonyErrorCode.CIRCULAR_SUBMODEL_INSTANTIATION.rule,
        severity: AntimonyErrorCode.CIRCULAR_SUBMODEL_INSTANTIATION.severity,
        message: AntimonyErrorCode.CIRCULAR_SUBMODEL_INSTANTIATION.message(mod.id),
        range: mod.submodels[0]?.range ?? mod.range,
      });
    }
  }

  for (const mod of modulesToCheck) {
    const reactionsList = mod.reactionList ?? Array.from(mod.reactions.values());

    // M9001: Empty Antimony module
    if (mod.species.size === 0 && reactionsList.length === 0 && mod.rules.length === 0 && mod.submodels.length === 0) {
      diagnostics.push({
        code: AntimonyErrorCode.EMPTY_ANTIMONY_MODULE.code,
        rule: AntimonyErrorCode.EMPTY_ANTIMONY_MODULE.rule,
        severity: AntimonyErrorCode.EMPTY_ANTIMONY_MODULE.severity,
        message: AntimonyErrorCode.EMPTY_ANTIMONY_MODULE.message(mod.id),
        range: mod.range,
      });
    }

    // M9009: Negative or zero compartment volume
    for (const comp of mod.compartments.values()) {
      if (comp.size <= 0) {
        diagnostics.push({
          code: AntimonyErrorCode.NEGATIVE_COMPARTMENT_VOLUME.code,
          rule: AntimonyErrorCode.NEGATIVE_COMPARTMENT_VOLUME.rule,
          severity: AntimonyErrorCode.NEGATIVE_COMPARTMENT_VOLUME.severity,
          message: AntimonyErrorCode.NEGATIVE_COMPARTMENT_VOLUME.message(comp.id, comp.size),
          range: comp.range ?? mod.range,
        });
      }
    }

    // M9002: Undefined compartment in species
    for (const sp of mod.species.values()) {
      if (sp.compartment && sp.compartment !== "default_compartment" && !mod.compartments.has(sp.compartment)) {
        diagnostics.push({
          code: AntimonyErrorCode.UNDEFINED_COMPARTMENT_IN_SPECIES.code,
          rule: AntimonyErrorCode.UNDEFINED_COMPARTMENT_IN_SPECIES.rule,
          severity: AntimonyErrorCode.UNDEFINED_COMPARTMENT_IN_SPECIES.severity,
          message: AntimonyErrorCode.UNDEFINED_COMPARTMENT_IN_SPECIES.message(sp.id, sp.compartment),
          range: sp.range ?? mod.range,
        });
      }
    }

    // M9006: Duplicate reaction ID & M9003/M9004/M9005 reaction checks
    const seenReactionIds = new Set<string>();
    for (const rxn of reactionsList) {
      if (seenReactionIds.has(rxn.id)) {
        diagnostics.push({
          code: AntimonyErrorCode.DUPLICATE_REACTION_ID.code,
          rule: AntimonyErrorCode.DUPLICATE_REACTION_ID.rule,
          severity: AntimonyErrorCode.DUPLICATE_REACTION_ID.severity,
          message: AntimonyErrorCode.DUPLICATE_REACTION_ID.message(rxn.id, mod.id),
          range: rxn.range ?? mod.range,
        });
      } else {
        seenReactionIds.add(rxn.id);
      }

      // M9003: Missing reaction rate law
      if (!rxn.rateLaw || rxn.rateLaw.trim().length === 0) {
        diagnostics.push({
          code: AntimonyErrorCode.MISSING_REACTION_RATE_LAW.code,
          rule: AntimonyErrorCode.MISSING_REACTION_RATE_LAW.rule,
          severity: AntimonyErrorCode.MISSING_REACTION_RATE_LAW.severity,
          message: AntimonyErrorCode.MISSING_REACTION_RATE_LAW.message(rxn.id),
          range: rxn.range ?? mod.range,
        });
      }

      // M9004: Negative or zero stoichiometric coefficient
      for (const ref of [...rxn.reactants, ...rxn.products]) {
        if (ref.stoichiometry <= 0) {
          diagnostics.push({
            code: AntimonyErrorCode.NEGATIVE_STOICHIOMETRIC_COEFFICIENT.code,
            rule: AntimonyErrorCode.NEGATIVE_STOICHIOMETRIC_COEFFICIENT.rule,
            severity: AntimonyErrorCode.NEGATIVE_STOICHIOMETRIC_COEFFICIENT.severity,
            message: AntimonyErrorCode.NEGATIVE_STOICHIOMETRIC_COEFFICIENT.message(
              ref.species,
              rxn.id,
              ref.stoichiometry,
            ),
            range: ref.range ?? rxn.range ?? mod.range,
          });
        }
      }

      // M9005: Undefined rate law symbol
      if (rxn.rateLaw && rxn.rateLaw.trim().length > 0) {
        const seenUndefined = new Set<string>();
        const ids = extractFormulaIdentifiers(rxn.rateLaw);
        for (const sym of ids) {
          if (seenUndefined.has(sym) || BUILTIN_MATH_IDENTIFIERS.has(sym.toLowerCase())) {
            continue;
          }
          const isDefined =
            mod.species.has(sym) ||
            mod.parameters.has(sym) ||
            mod.compartments.has(sym) ||
            mod.reactions.has(sym) ||
            doc.functions.has(sym) ||
            mod.arguments.includes(sym);

          if (!isDefined) {
            seenUndefined.add(sym);
            diagnostics.push({
              code: AntimonyErrorCode.UNDEFINED_RATE_LAW_SYMBOL.code,
              rule: AntimonyErrorCode.UNDEFINED_RATE_LAW_SYMBOL.rule,
              severity: AntimonyErrorCode.UNDEFINED_RATE_LAW_SYMBOL.severity,
              message: AntimonyErrorCode.UNDEFINED_RATE_LAW_SYMBOL.message(rxn.id, sym),
              range: rxn.range ?? mod.range,
            });
          }
        }
      }
    }

    // M9008: Conflicting species variability (declared const AND modified by rate rule or non-boundary reaction)
    const rateRuleTargets = new Set<string>();
    for (const rule of mod.rules) {
      if (rule.type === "rate") {
        rateRuleTargets.add(rule.variable);
      }
    }

    const reactionParticipants = new Set<string>();
    for (const rxn of reactionsList) {
      for (const ref of rxn.reactants) {
        if (!ref.boundaryCondition) reactionParticipants.add(ref.species);
      }
      for (const ref of rxn.products) {
        if (!ref.boundaryCondition) reactionParticipants.add(ref.species);
      }
    }

    const reportedConflictSpecies = new Set<string>();
    for (const sp of mod.species.values()) {
      if (sp.constant) {
        const modifiedByRateRule = rateRuleTargets.has(sp.id);
        const modifiedByReaction = !sp.boundaryCondition && reactionParticipants.has(sp.id);
        if ((modifiedByRateRule || modifiedByReaction) && !reportedConflictSpecies.has(sp.id)) {
          reportedConflictSpecies.add(sp.id);
          diagnostics.push({
            code: AntimonyErrorCode.CONFLICTING_SPECIES_VARIABILITY.code,
            rule: AntimonyErrorCode.CONFLICTING_SPECIES_VARIABILITY.rule,
            severity: AntimonyErrorCode.CONFLICTING_SPECIES_VARIABILITY.severity,
            message: AntimonyErrorCode.CONFLICTING_SPECIES_VARIABILITY.message(sp.id),
            range: sp.range ?? mod.range,
          });
        }
      }
    }

    for (const param of mod.parameters.values()) {
      if (param.isExplicitlyConst && rateRuleTargets.has(param.id) && !reportedConflictSpecies.has(param.id)) {
        reportedConflictSpecies.add(param.id);
        diagnostics.push({
          code: AntimonyErrorCode.CONFLICTING_SPECIES_VARIABILITY.code,
          rule: AntimonyErrorCode.CONFLICTING_SPECIES_VARIABILITY.rule,
          severity: AntimonyErrorCode.CONFLICTING_SPECIES_VARIABILITY.severity,
          message: AntimonyErrorCode.CONFLICTING_SPECIES_VARIABILITY.message(param.id),
          range: param.range ?? mod.range,
        });
      }
    }

    // M9010: Invalid event trigger condition
    for (const ev of mod.events) {
      if (!isRelationalOrBooleanTrigger(ev.trigger)) {
        diagnostics.push({
          code: AntimonyErrorCode.INVALID_EVENT_TRIGGER.code,
          rule: AntimonyErrorCode.INVALID_EVENT_TRIGGER.rule,
          severity: AntimonyErrorCode.INVALID_EVENT_TRIGGER.severity,
          message: AntimonyErrorCode.INVALID_EVENT_TRIGGER.message(ev.id),
          range: ev.range ?? mod.range,
        });
      }
    }
  }

  return diagnostics;
}
