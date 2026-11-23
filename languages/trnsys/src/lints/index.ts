// SPDX-License-Identifier: AGPL-3.0-or-later

import { getTrnsysTypeSpec } from "../catalog/library-package-adapter.js";
import { TrnsysErrorCode } from "../errors.js";
import { extractExpressionIdentifiers } from "../parser/deck-parser.js";
import type { TrnsysDeck, TrnsysDiagnostic, TrnsysUnit } from "../types.js";

/**
 * Validates a parsed TRNSYS `.dck` deck against semantic and structural rules (`TRN1001`–`TRN5006`).
 */
export function lintTrnsysDeck(deck: TrnsysDeck): TrnsysDiagnostic[] {
  const diagnostics: TrnsysDiagnostic[] = [];

  // 1. TRN1001: Syntax errors reported during parsing
  for (const err of deck.parseErrors) {
    diagnostics.push({
      code: TrnsysErrorCode.SYNTAX_ERROR.code,
      rule: TrnsysErrorCode.SYNTAX_ERROR.rule,
      severity: TrnsysErrorCode.SYNTAX_ERROR.severity,
      message: TrnsysErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // 2. TRN4001 / TRN4003 / TRN4004: SIMULATION card & time range validation
  if (!deck.simulation) {
    diagnostics.push({
      code: TrnsysErrorCode.MISSING_SIMULATION_CARD.code,
      rule: TrnsysErrorCode.MISSING_SIMULATION_CARD.rule,
      severity: TrnsysErrorCode.MISSING_SIMULATION_CARD.severity,
      message: TrnsysErrorCode.MISSING_SIMULATION_CARD.message(),
      line: 1,
      column: 1,
    });
  } else {
    if (deck.simulation.dt <= 0) {
      diagnostics.push({
        code: TrnsysErrorCode.INVALID_TIMESTEP.code,
        rule: TrnsysErrorCode.INVALID_TIMESTEP.rule,
        severity: TrnsysErrorCode.INVALID_TIMESTEP.severity,
        message: TrnsysErrorCode.INVALID_TIMESTEP.message(deck.simulation.dt),
        line: deck.simulation.line,
        column: 1,
      });
    }
    if (deck.simulation.tStart >= deck.simulation.tStop) {
      diagnostics.push({
        code: TrnsysErrorCode.INVALID_TIME_RANGE.code,
        rule: TrnsysErrorCode.INVALID_TIME_RANGE.rule,
        severity: TrnsysErrorCode.INVALID_TIME_RANGE.severity,
        message: TrnsysErrorCode.INVALID_TIME_RANGE.message(deck.simulation.tStart, deck.simulation.tStop),
        line: deck.simulation.line,
        column: 1,
      });
    }
  }

  // 3. TRN4002: Missing END card
  if (!deck.hasEnd) {
    diagnostics.push({
      code: TrnsysErrorCode.MISSING_END_CARD.code,
      rule: TrnsysErrorCode.MISSING_END_CARD.rule,
      severity: TrnsysErrorCode.MISSING_END_CARD.severity,
      message: TrnsysErrorCode.MISSING_END_CARD.message(),
      line: Math.max(1, deck.units[deck.units.length - 1]?.line ?? 1),
      column: 1,
    });
  }

  // 4. TRN2004: Undefined variable references in EQUATIONS
  const definedVars = new Set<string>(["TIME", "START", "STOP", "STEP", "PI"]);
  for (const c of deck.constants) {
    definedVars.add(c.name.toUpperCase());
  }
  for (const block of deck.equationBlocks) {
    for (const eq of block.equations) {
      const refs = extractExpressionIdentifiers(eq.expression);
      for (const ref of refs) {
        if (!definedVars.has(ref.toUpperCase())) {
          diagnostics.push({
            code: TrnsysErrorCode.UNDEFINED_EQUATION_VAR.code,
            rule: TrnsysErrorCode.UNDEFINED_EQUATION_VAR.rule,
            severity: TrnsysErrorCode.UNDEFINED_EQUATION_VAR.severity,
            message: TrnsysErrorCode.UNDEFINED_EQUATION_VAR.message(ref, eq.name),
            line: eq.line,
            column: 1,
          });
        }
      }
      definedVars.add(eq.name.toUpperCase());
    }
  }

  // 5. TRN2001: Duplicate UNIT numbers & TRN5006: Unknown TYPE numbers
  const unitMap = new Map<number, TrnsysUnit>();
  for (const unit of deck.units) {
    if (unitMap.has(unit.unitNumber)) {
      diagnostics.push({
        code: TrnsysErrorCode.DUPLICATE_UNIT.code,
        rule: TrnsysErrorCode.DUPLICATE_UNIT.rule,
        severity: TrnsysErrorCode.DUPLICATE_UNIT.severity,
        message: TrnsysErrorCode.DUPLICATE_UNIT.message(unit.unitNumber),
        line: unit.line,
        column: 1,
        unitNumber: unit.unitNumber,
      });
    } else {
      unitMap.set(unit.unitNumber, unit);
    }

    const spec = getTrnsysTypeSpec(unit.typeNumber);
    if (!spec) {
      diagnostics.push({
        code: TrnsysErrorCode.UNKNOWN_TYPE_NUMBER.code,
        rule: TrnsysErrorCode.UNKNOWN_TYPE_NUMBER.rule,
        severity: TrnsysErrorCode.UNKNOWN_TYPE_NUMBER.severity,
        message: TrnsysErrorCode.UNKNOWN_TYPE_NUMBER.message(unit.unitNumber, unit.typeNumber),
        line: unit.line,
        column: 1,
        unitNumber: unit.unitNumber,
      });
    }
  }

  // 6. TRN3001 / TRN3002: PARAMETERS & INPUTS count mismatches
  //    TRN2002 / TRN2003: INPUTS unit & output index checks
  for (const unit of deck.units) {
    if (unit.parametersDeclared !== undefined && unit.parameters.length !== unit.parametersDeclared) {
      diagnostics.push({
        code: TrnsysErrorCode.PARAMETER_COUNT_MISMATCH.code,
        rule: TrnsysErrorCode.PARAMETER_COUNT_MISMATCH.rule,
        severity: TrnsysErrorCode.PARAMETER_COUNT_MISMATCH.severity,
        message: TrnsysErrorCode.PARAMETER_COUNT_MISMATCH.message(
          unit.unitNumber,
          unit.parametersDeclared,
          unit.parameters.length,
        ),
        line: unit.line,
        column: 1,
        unitNumber: unit.unitNumber,
      });
    }

    if (unit.inputsDeclared !== undefined && unit.inputs.length !== unit.inputsDeclared) {
      diagnostics.push({
        code: TrnsysErrorCode.INPUT_COUNT_MISMATCH.code,
        rule: TrnsysErrorCode.INPUT_COUNT_MISMATCH.rule,
        severity: TrnsysErrorCode.INPUT_COUNT_MISMATCH.severity,
        message: TrnsysErrorCode.INPUT_COUNT_MISMATCH.message(unit.unitNumber, unit.inputsDeclared, unit.inputs.length),
        line: unit.line,
        column: 1,
        unitNumber: unit.unitNumber,
      });
    }

    for (const inp of unit.inputs) {
      if (inp.kind !== "connection") continue;
      const target = unitMap.get(inp.unitNumber);
      if (!target) {
        diagnostics.push({
          code: TrnsysErrorCode.UNDEFINED_UNIT_REF.code,
          rule: TrnsysErrorCode.UNDEFINED_UNIT_REF.rule,
          severity: TrnsysErrorCode.UNDEFINED_UNIT_REF.severity,
          message: TrnsysErrorCode.UNDEFINED_UNIT_REF.message(unit.unitNumber, inp.unitNumber),
          line: inp.line,
          column: 1,
          unitNumber: unit.unitNumber,
        });
        continue;
      }
      const targetSpec = getTrnsysTypeSpec(target.typeNumber);
      if (targetSpec && (inp.outputIndex < 1 || inp.outputIndex > targetSpec.numOutputs)) {
        diagnostics.push({
          code: TrnsysErrorCode.OUTPUT_INDEX_OUT_OF_RANGE.code,
          rule: TrnsysErrorCode.OUTPUT_INDEX_OUT_OF_RANGE.rule,
          severity: TrnsysErrorCode.OUTPUT_INDEX_OUT_OF_RANGE.severity,
          message: TrnsysErrorCode.OUTPUT_INDEX_OUT_OF_RANGE.message(
            unit.unitNumber,
            inp.unitNumber,
            inp.outputIndex,
            target.typeNumber,
            targetSpec.numOutputs,
          ),
          line: inp.line,
          column: 1,
          unitNumber: unit.unitNumber,
        });
      }
    }
  }

  // 7. TRN5001: Algebraic loop detection among non-state-breaking units
  detectAlgebraicLoops(deck.units, unitMap, diagnostics);

  return diagnostics;
}

function detectAlgebraicLoops(
  units: TrnsysUnit[],
  unitMap: Map<number, TrnsysUnit>,
  diagnostics: TrnsysDiagnostic[],
): void {
  // Build directed dependency graph restricted to algebraic (non-state-breaking) units:
  // edge u -> v means unit u depends instantaneously on unit v.
  const algebraicIds = new Set<number>();
  for (const u of units) {
    const spec = getTrnsysTypeSpec(u.typeNumber);
    if (!spec || !spec.stateBreaking) {
      algebraicIds.add(u.unitNumber);
    }
  }

  const adj = new Map<number, number[]>();
  for (const u of units) {
    if (!algebraicIds.has(u.unitNumber)) continue;
    const deps: number[] = [];
    for (const inp of u.inputs) {
      if (inp.kind === "connection" && algebraicIds.has(inp.unitNumber)) {
        deps.push(inp.unitNumber);
      }
    }
    adj.set(u.unitNumber, deps);
  }

  // 0 = unvisited, 1 = visiting, 2 = visited
  const state = new Map<number, number>();
  const stack: number[] = [];
  const reportedCycles = new Set<string>();

  function dfs(node: number): void {
    state.set(node, 1);
    stack.push(node);
    const deps = adj.get(node) ?? [];
    for (const next of deps) {
      const nextState = state.get(next) ?? 0;
      if (nextState === 1) {
        const idx = stack.indexOf(next);
        const cycleNodes = [...stack.slice(idx), next];
        const canonical = [...cycleNodes.slice(0, -1)].sort((a, b) => a - b).join(",");
        if (!reportedCycles.has(canonical)) {
          reportedCycles.add(canonical);
          const uObj = unitMap.get(next);
          diagnostics.push({
            code: TrnsysErrorCode.ALGEBRAIC_LOOP.code,
            rule: TrnsysErrorCode.ALGEBRAIC_LOOP.rule,
            severity: TrnsysErrorCode.ALGEBRAIC_LOOP.severity,
            message: TrnsysErrorCode.ALGEBRAIC_LOOP.message(cycleNodes.map((n) => `UNIT ${n}`).join(" -> ")),
            line: uObj?.line ?? 1,
            column: 1,
            unitNumber: next,
          });
        }
      } else if (nextState === 0) {
        dfs(next);
      }
    }
    stack.pop();
    state.set(node, 2);
  }

  for (const id of algebraicIds) {
    if ((state.get(id) ?? 0) === 0) {
      dfs(id);
    }
  }
}
