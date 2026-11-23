// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis & Linter Engine for SIMSCRIPT II.5 (`SIMS1001`–`SIMS5006`).
 */

import { SimscriptErrorCode } from "../errors.js";
import type { SimscriptDistributionExpr, SimscriptModel, SimscriptRoutineBlock, SimscriptStatement } from "../types.js";

export { SimscriptErrorCode };

export interface SimscriptDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  symbol?: string | undefined;
}

function flattenStatements(stmts: SimscriptStatement[]): SimscriptStatement[] {
  const out: SimscriptStatement[] = [];
  for (const s of stmts) {
    out.push(s);
    if (s.kind === "FOR_LOOP") {
      out.push(...flattenStatements(s.body));
    }
  }
  return out;
}

function validateDistribution(
  dist: SimscriptDistributionExpr | undefined,
  span: { line: number; column: number; startOffset: number; endOffset: number },
  diags: SimscriptDiagnostic[],
): void {
  if (!dist || dist.kind === "CONSTANT") {
    if (dist && dist.args[0] !== undefined && dist.args[0] < 0) {
      const def = SimscriptErrorCode.INVALID_DISTRIBUTION_PARAM;
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message("CONSTANT", `duration ${dist.args[0]} must be non-negative`),
        ...span,
      });
    }
    return;
  }

  const def = SimscriptErrorCode.INVALID_DISTRIBUTION_PARAM;
  if (dist.kind === "EXPONENTIAL.F" || dist.kind === "POISSON.F") {
    const mean = dist.args[0];
    if (mean === undefined || mean <= 0) {
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(dist.kind, `mean (${mean ?? "missing"}) must be > 0`),
        ...span,
      });
    }
  } else if (dist.kind === "NORMAL.F") {
    const stdDev = dist.args[1];
    if (stdDev === undefined || stdDev <= 0) {
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(dist.kind, `standard deviation (${stdDev ?? "missing"}) must be > 0`),
        ...span,
      });
    }
  } else if (dist.kind === "UNIFORM.F") {
    const lo = dist.args[0];
    const hi = dist.args[1];
    if (lo === undefined || hi === undefined || hi <= lo) {
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(dist.kind, `upper bound (${hi ?? "missing"}) must be > lower bound (${lo ?? "missing"})`),
        ...span,
      });
    }
  } else if (dist.kind === "ERLANG.F") {
    const mean = dist.args[0];
    const k = dist.args[1];
    if (mean === undefined || mean <= 0 || k === undefined || k < 1 || !Number.isInteger(k)) {
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(
          dist.kind,
          `mean (${mean ?? "missing"}) must be > 0 and k (${k ?? "missing"}) must be integer >= 1`,
        ),
        ...span,
      });
    }
  }
}

/**
 * Runs all SIMSCRIPT II.5 static analysis rules on a parsed `SimscriptModel`.
 */
export function lintSimscript(model: SimscriptModel): SimscriptDiagnostic[] {
  const diags: SimscriptDiagnostic[] = [];

  // SIMS1001: Syntax errors
  for (const err of model.syntaxErrors) {
    const def = SimscriptErrorCode.SYNTAX_ERROR;
    diags.push({
      code: def.code,
      id: def.id,
      rule: def.rule,
      severity: def.severity,
      message: def.message(err.message),
      line: err.line,
      column: err.column,
      startOffset: err.startOffset,
      endOffset: err.endOffset,
    });
  }

  // SIMS1002: Missing PREAMBLE END
  if (model.preamble.present && !model.preamble.hasEnd) {
    const def = SimscriptErrorCode.MISSING_PREAMBLE_END;
    diags.push({
      code: def.code,
      id: def.id,
      rule: def.rule,
      severity: def.severity,
      message: def.message(),
      line: model.preamble.span?.line ?? 1,
      column: model.preamble.span?.column ?? 1,
      startOffset: model.preamble.span?.startOffset,
      endOffset: model.preamble.span?.endOffset,
    });
  }

  // Track declared symbols & check SIMS2001: Duplicate entity/process/resource/event declarations
  const seenDecl = new Set<string>();
  const declaredResources = new Set<string>();
  const declaredProcesses = new Set<string>();
  const declaredEvents = new Set<string>();
  const declaredEntities = new Set<string>();
  const declaredVars = new Set<string>();

  for (const ent of model.preamble.entities) {
    const key = ent.name.toUpperCase();
    const kindKey = `${ent.kind}:${key}`;
    if (seenDecl.has(kindKey)) {
      const def = SimscriptErrorCode.DUPLICATE_DECLARATION;
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(ent.kind, ent.name),
        ...ent.span,
        symbol: ent.name,
      });
    } else {
      seenDecl.add(kindKey);
    }

    declaredEntities.add(key);
    if (ent.kind === "resource") declaredResources.add(key);
    if (ent.kind === "process") declaredProcesses.add(key);
    if (ent.kind === "event") declaredEvents.add(key);
    for (const attr of ent.attributes) declaredVars.add(attr.toUpperCase());
  }

  // Also include defined processes/events from blocks
  for (const name of model.processes.keys()) declaredProcesses.add(name.toUpperCase());
  for (const name of model.events.keys()) declaredEvents.add(name.toUpperCase());

  for (const defDecl of model.preamble.defines) {
    for (const n of defDecl.names) declaredVars.add(n.toUpperCase());
  }
  for (const v of model.variables.keys()) declaredVars.add(v.toUpperCase());

  const declaredSets = new Set<string>();
  for (const s of model.preamble.sets.keys()) {
    declaredSets.add(s.toUpperCase());
  }

  // SIMS5001: Invalid resource capacity
  for (const [resName, cap] of model.resourceCapacities) {
    if (!Number.isFinite(cap) || cap <= 0 || !Number.isInteger(cap)) {
      const def = SimscriptErrorCode.INVALID_RESOURCE_CAPACITY;
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(resName, cap),
        symbol: resName,
      });
    }
  }

  // SIMS5005: TALLY / ACCUMULATE target validation
  for (const st of model.preamble.stats) {
    const tgt = st.target.toUpperCase();
    // Allow N.X.<RES>, N.Q.<RES>, U.<RES>, N.<SET> automatic SIMSCRIPT II.5 attributes
    const autoResMatch = tgt.match(/^(?:N\.X\.|N\.Q\.|U\.)([A-Z0-9._]+)$/);
    const autoSetMatch = tgt.match(/^N\.([A-Z0-9._]+)$/);
    const isKnownAuto =
      (autoResMatch && declaredResources.has(autoResMatch[1]!)) || (autoSetMatch && declaredSets.has(autoSetMatch[1]!));
    if (!isKnownAuto && !declaredVars.has(tgt) && !declaredEntities.has(tgt) && !declaredSets.has(tgt)) {
      const def = SimscriptErrorCode.UNREFERENCED_STAT_TARGET;
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(st.kind, st.statName, st.target),
        ...st.span,
        symbol: st.target,
      });
    }
  }

  // SIMS4001: Missing START SIMULATION in MAIN
  if (model.main) {
    const mainStmts = flattenStatements(model.main.statements);
    const hasStartSim = mainStmts.some((s) => s.kind === "START_SIMULATION");
    if (!hasStartSim) {
      const def = SimscriptErrorCode.MISSING_START_SIMULATION;
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(),
        ...model.main.span,
        symbol: "MAIN",
      });
    }
  }

  // Inspect all routine blocks (MAIN, PROCESS, EVENT, ROUTINE)
  const allBlocks: SimscriptRoutineBlock[] = [];
  if (model.main) allBlocks.push(model.main);
  for (const p of model.processes.values()) allBlocks.push(p);
  for (const e of model.events.values()) allBlocks.push(e);
  for (const r of model.routines.values()) allBlocks.push(r);

  for (const block of allBlocks) {
    const flat = flattenStatements(block.statements);

    // SIMS5006: Empty routine body
    if (flat.length === 0) {
      const def = SimscriptErrorCode.EMPTY_ROUTINE_BODY;
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(block.kind, block.name),
        ...block.span,
        symbol: block.name,
      });
      continue;
    }

    const reqTotals = new Map<string, number>();
    const relTotals = new Map<string, number>();

    for (const stmt of flat) {
      if (stmt.kind === "REQUEST") {
        const res = stmt.resource.toUpperCase();
        reqTotals.set(res, (reqTotals.get(res) ?? 0) + stmt.quantity);
        if (!declaredResources.has(res)) {
          const def = SimscriptErrorCode.UNDEFINED_RESOURCE;
          diags.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message("REQUEST", stmt.resource),
            ...stmt.span,
            symbol: stmt.resource,
          });
        }
      } else if (stmt.kind === "RELINQUISH") {
        const res = stmt.resource.toUpperCase();
        relTotals.set(res, (relTotals.get(res) ?? 0) + stmt.quantity);
        if (!declaredResources.has(res)) {
          const def = SimscriptErrorCode.UNDEFINED_RESOURCE;
          diags.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message("RELINQUISH", stmt.resource),
            ...stmt.span,
            symbol: stmt.resource,
          });
        }
      } else if (stmt.kind === "FILE" || stmt.kind === "REMOVE") {
        const setKey = stmt.setName.toUpperCase();
        if (!declaredSets.has(setKey)) {
          const def = SimscriptErrorCode.UNDEFINED_SET;
          diags.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message(stmt.kind, stmt.setName),
            ...stmt.span,
            symbol: stmt.setName,
          });
        }
      } else if (stmt.kind === "ACTIVATE") {
        const target = stmt.processName.toUpperCase();
        if (!declaredProcesses.has(target)) {
          const def = SimscriptErrorCode.UNDEFINED_PROCESS_TARGET;
          diags.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message(stmt.processName),
            ...stmt.span,
            symbol: stmt.processName,
          });
        }
        validateDistribution(stmt.delay, stmt.span, diags);
      } else if (stmt.kind === "SCHEDULE") {
        const target = stmt.eventName.toUpperCase();
        if (!declaredEvents.has(target)) {
          const def = SimscriptErrorCode.UNDEFINED_EVENT_TARGET;
          diags.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message(stmt.eventName),
            ...stmt.span,
            symbol: stmt.eventName,
          });
        }
        validateDistribution(stmt.delay, stmt.span, diags);
      } else if (stmt.kind === "WORK" || stmt.kind === "WAIT") {
        validateDistribution(stmt.duration, stmt.span, diags);
      }
    }

    // SIMS3001: Mismatched REQUEST / RELINQUISH in process/routine
    const touchedResources = new Set([...reqTotals.keys(), ...relTotals.keys()]);
    for (const res of touchedResources) {
      const req = reqTotals.get(res) ?? 0;
      const rel = relTotals.get(res) ?? 0;
      if (req !== rel) {
        const def = SimscriptErrorCode.MISMATCHED_REQUEST_RELINQUISH;
        diags.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(block.name, res, req, rel),
          ...block.span,
          symbol: res,
        });
      }
    }
  }

  return diags;
}
