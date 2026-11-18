// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/powerworld — Semantic & Structural Linter for PowerWorld (.aux) Models.
 */

import type { AuxDiagnostic, AuxSourceSpan, PowerWorldAuxModel } from "../types.js";

function diag(code: string, severity: AuxDiagnostic["severity"], message: string, span?: AuxSourceSpan): AuxDiagnostic {
  const s = span ?? { line: 1, column: 1, endLine: 1, endColumn: 1, startOffset: 0, endOffset: 0 };
  return {
    code,
    severity,
    message,
    line: s.line,
    column: s.column,
    endLine: s.endLine,
    endColumn: s.endColumn,
  };
}

/**
 * Validate a parsed PowerWorldAuxModel and return diagnostics.
 */
export function lintPowerWorldAux(model: PowerWorldAuxModel): AuxDiagnostic[] {
  const diagnostics: AuxDiagnostic[] = [];

  if (model.dataSections.length === 0 && model.scriptBlocks.length === 0) {
    diagnostics.push(diag("PW1001", "warning", "Empty PowerWorld .aux file: no DATA or SCRIPT blocks found."));
    return diagnostics;
  }

  const seenBuses = new Map<number, AuxSourceSpan>();
  let slackCount = 0;

  for (const bus of model.buses) {
    const prev = seenBuses.get(bus.busNum);
    if (prev) {
      diagnostics.push(
        diag("PW2001", "error", `Duplicate BusNum ${bus.busNum} (previously declared at line ${prev.line}).`, bus.span),
      );
    } else {
      seenBuses.set(bus.busNum, bus.span);
    }

    if (bus.nomVoltKv <= 0) {
      diagnostics.push(
        diag(
          "PW3001",
          "error",
          `Bus ${bus.busNum} ('${bus.busName}') has non-positive nominal voltage (${bus.nomVoltKv} kV).`,
          bus.span,
        ),
      );
    }

    if (bus.isSlack) slackCount++;
  }

  if (model.buses.length > 0 && slackCount === 0) {
    diagnostics.push(diag("PW4001", "warning", "No slack bus (BusSlack = YES) declared in Bus data."));
  }

  for (const gen of model.generators) {
    if (!model.busByNum.has(gen.busNum)) {
      diagnostics.push(
        diag("PW2002", "error", `Generator '${gen.genId}' references unresolved BusNum ${gen.busNum}.`, gen.span),
      );
    }
    if (gen.mwMax !== undefined && gen.mwMin !== undefined && gen.mwMax < gen.mwMin) {
      diagnostics.push(
        diag(
          "PW3002",
          "error",
          `Generator '${gen.genId}' at Bus ${gen.busNum} has GenMWMax (${gen.mwMax}) < GenMWMin (${gen.mwMin}).`,
          gen.span,
        ),
      );
    }
    if (
      gen.status === "Closed" &&
      ((gen.mwMax !== undefined && gen.mw > gen.mwMax) || (gen.mwMin !== undefined && gen.mw < gen.mwMin))
    ) {
      diagnostics.push(
        diag(
          "PW3002",
          "warning",
          `Generator '${gen.genId}' at Bus ${gen.busNum} dispatch (${gen.mw} MW) is outside [GenMWMin, GenMWMax].`,
          gen.span,
        ),
      );
    }
  }

  for (const load of model.loads) {
    if (!model.busByNum.has(load.busNum)) {
      diagnostics.push(
        diag("PW2002", "error", `Load '${load.loadId}' references unresolved BusNum ${load.busNum}.`, load.span),
      );
    }
  }

  for (const shunt of model.shunts) {
    if (!model.busByNum.has(shunt.busNum)) {
      diagnostics.push(
        diag("PW2002", "error", `Shunt '${shunt.shuntId}' references unresolved BusNum ${shunt.busNum}.`, shunt.span),
      );
    }
  }

  for (const br of model.branches) {
    if (!model.busByNum.has(br.fromBus)) {
      diagnostics.push(
        diag(
          "PW2002",
          "error",
          `Branch ${br.fromBus}-${br.toBus} (${br.circuit}) references unresolved BusNumFrom ${br.fromBus}.`,
          br.span,
        ),
      );
    }
    if (!model.busByNum.has(br.toBus)) {
      diagnostics.push(
        diag(
          "PW2002",
          "error",
          `Branch ${br.fromBus}-${br.toBus} (${br.circuit}) references unresolved BusNumTo ${br.toBus}.`,
          br.span,
        ),
      );
    }
    if (br.rPu === 0 && br.xPu === 0) {
      diagnostics.push(
        diag(
          "PW3001",
          "warning",
          `Branch ${br.fromBus}-${br.toBus} (${br.circuit}) has zero impedance (R=0, X=0).`,
          br.span,
        ),
      );
    }
    if (br.rateAMva <= 0) {
      diagnostics.push(
        diag(
          "PW4002",
          "warning",
          `Branch ${br.fromBus}-${br.toBus} (${br.circuit}) has non-positive thermal rating LineAMVA (${br.rateAMva}).`,
          br.span,
        ),
      );
    }
  }

  return diagnostics;
}
