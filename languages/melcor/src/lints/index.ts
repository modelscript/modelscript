// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/melcor — Static Pre-Flight Linter (MEL1001 - MEL5006).
 */

import { MelcorErrorCode, type MelcorDiagnostic } from "../errors.js";
import type { MelcorDeck } from "../types.js";

function makeDiag(
  spec: { code: string; rule: string; severity: "error" | "warning" | "info" },
  message: string,
  range?: MelcorDiagnostic["range"],
): MelcorDiagnostic {
  return {
    code: spec.code,
    rule: spec.rule,
    severity: spec.severity,
    message,
    range,
  };
}

export function lintMelcor(deck: MelcorDeck): MelcorDiagnostic[] {
  const diags: MelcorDiagnostic[] = [];

  // 1. Duplicate IDs (MEL2001 - MEL2005)
  for (const dup of deck.duplicateIds) {
    switch (dup.kind) {
      case "CV":
        diags.push(
          makeDiag(
            MelcorErrorCode.DUPLICATE_CV_ID,
            MelcorErrorCode.DUPLICATE_CV_ID.message(dup.id, dup.name),
            dup.range,
          ),
        );
        break;
      case "FL":
        diags.push(
          makeDiag(
            MelcorErrorCode.DUPLICATE_FL_ID,
            MelcorErrorCode.DUPLICATE_FL_ID.message(dup.id, dup.name),
            dup.range,
          ),
        );
        break;
      case "HS":
        diags.push(
          makeDiag(
            MelcorErrorCode.DUPLICATE_HS_ID,
            MelcorErrorCode.DUPLICATE_HS_ID.message(dup.id, dup.name),
            dup.range,
          ),
        );
        break;
      case "CF":
        diags.push(
          makeDiag(
            MelcorErrorCode.DUPLICATE_CF_ID,
            MelcorErrorCode.DUPLICATE_CF_ID.message(dup.id, dup.name),
            dup.range,
          ),
        );
        break;
      case "TF":
        diags.push(
          makeDiag(
            MelcorErrorCode.DUPLICATE_TF_ID,
            MelcorErrorCode.DUPLICATE_TF_ID.message(dup.id, dup.name),
            dup.range,
          ),
        );
        break;
    }
  }

  // 2. Control Volume checks (MEL4001, MEL4003, MEL4004)
  for (const cv of deck.controlVolumes.values()) {
    if (!Number.isFinite(cv.volume) || cv.volume <= 0) {
      diags.push(
        makeDiag(
          MelcorErrorCode.NON_POSITIVE_CV_VOLUME,
          MelcorErrorCode.NON_POSITIVE_CV_VOLUME.message(cv.id, cv.volume),
          cv.range,
        ),
      );
    }
    if (!Number.isFinite(cv.pressure) || cv.pressure <= 0) {
      diags.push(
        makeDiag(
          MelcorErrorCode.INVALID_INITIAL_PRESSURE,
          MelcorErrorCode.INVALID_INITIAL_PRESSURE.message(cv.id, cv.pressure),
          cv.range,
        ),
      );
    }
    if (!Number.isFinite(cv.temperature) || cv.temperature <= 0) {
      diags.push(
        makeDiag(
          MelcorErrorCode.INVALID_INITIAL_TEMPERATURE,
          MelcorErrorCode.INVALID_INITIAL_TEMPERATURE.message(`CV_${cv.id}`, cv.temperature),
          cv.range,
        ),
      );
    }
  }

  // 3. Flow Path checks (MEL3001, MEL4002, MEL5004)
  for (const fl of deck.flowPaths.values()) {
    if (!deck.controlVolumes.has(fl.fromCv)) {
      diags.push(
        makeDiag(
          MelcorErrorCode.UNDEFINED_FLOW_VOLUME,
          MelcorErrorCode.UNDEFINED_FLOW_VOLUME.message(fl.id, fl.fromCv, "from"),
          fl.range,
        ),
      );
    }
    if (!deck.controlVolumes.has(fl.toCv)) {
      diags.push(
        makeDiag(
          MelcorErrorCode.UNDEFINED_FLOW_VOLUME,
          MelcorErrorCode.UNDEFINED_FLOW_VOLUME.message(fl.id, fl.toCv, "to"),
          fl.range,
        ),
      );
    }
    if (!Number.isFinite(fl.area) || fl.area <= 0) {
      diags.push(
        makeDiag(
          MelcorErrorCode.NON_POSITIVE_FLOW_AREA,
          MelcorErrorCode.NON_POSITIVE_FLOW_AREA.message(fl.id, fl.area),
          fl.range,
        ),
      );
    }
    if (fl.forwardLoss < 0 || fl.reverseLoss < 0) {
      diags.push(
        makeDiag(
          MelcorErrorCode.NEGATIVE_FLOW_LOSS,
          MelcorErrorCode.NEGATIVE_FLOW_LOSS.message(fl.id, fl.forwardLoss, fl.reverseLoss),
          fl.range,
        ),
      );
    }
  }

  // 4. Heat Structure checks (MEL3002, MEL4004)
  for (const hs of deck.heatStructures.values()) {
    if (hs.leftBoundaryCv !== undefined && !deck.controlVolumes.has(hs.leftBoundaryCv)) {
      diags.push(
        makeDiag(
          MelcorErrorCode.UNDEFINED_HS_BOUNDARY_CV,
          MelcorErrorCode.UNDEFINED_HS_BOUNDARY_CV.message(hs.id, hs.leftBoundaryCv, "left"),
          hs.range,
        ),
      );
    }
    if (hs.rightBoundaryCv !== undefined && !deck.controlVolumes.has(hs.rightBoundaryCv)) {
      diags.push(
        makeDiag(
          MelcorErrorCode.UNDEFINED_HS_BOUNDARY_CV,
          MelcorErrorCode.UNDEFINED_HS_BOUNDARY_CV.message(hs.id, hs.rightBoundaryCv, "right"),
          hs.range,
        ),
      );
    }
    if (!Number.isFinite(hs.initialTemperature) || hs.initialTemperature <= 0) {
      diags.push(
        makeDiag(
          MelcorErrorCode.INVALID_INITIAL_TEMPERATURE,
          MelcorErrorCode.INVALID_INITIAL_TEMPERATURE.message(`HS_${hs.id}`, hs.initialTemperature),
          hs.range,
        ),
      );
    }
  }

  // 5. Core Package checks (MEL4004, MEL5005)
  if (deck.core?.present) {
    if (!Number.isFinite(deck.core.initialTemperatureK) || deck.core.initialTemperatureK <= 0) {
      diags.push(
        makeDiag(
          MelcorErrorCode.INVALID_INITIAL_TEMPERATURE,
          MelcorErrorCode.INVALID_INITIAL_TEMPERATURE.message("COR", deck.core.initialTemperatureK),
          deck.core.range,
        ),
      );
    }
    if (deck.core.coreMassKg <= 0 || deck.core.coreSpecificHeatJkgK <= 0) {
      diags.push(
        makeDiag(
          MelcorErrorCode.NON_POSITIVE_CORE_MASS,
          MelcorErrorCode.NON_POSITIVE_CORE_MASS.message(deck.core.coreMassKg, deck.core.coreSpecificHeatJkgK),
          deck.core.range,
        ),
      );
    }
  }

  // 6. Control Function dependency cycle & reference checks (MEL5001, MEL5006)
  const adj = new Map<number, number[]>();
  for (const cf of deck.controlFunctions.values()) {
    const deps: number[] = [];
    for (const arg of cf.arguments) {
      if (arg.kind === "CF" && typeof arg.targetId === "number") {
        if (deck.controlFunctions.has(arg.targetId)) {
          deps.push(arg.targetId);
        } else {
          diags.push(
            makeDiag(
              MelcorErrorCode.UNDEFINED_CF_ARGUMENT,
              MelcorErrorCode.UNDEFINED_CF_ARGUMENT.message(cf.id, "CF", arg.targetId),
              cf.range,
            ),
          );
        }
      } else if (arg.kind === "CVH" && typeof arg.targetId === "number" && !deck.controlVolumes.has(arg.targetId)) {
        diags.push(
          makeDiag(
            MelcorErrorCode.UNDEFINED_CF_ARGUMENT,
            MelcorErrorCode.UNDEFINED_CF_ARGUMENT.message(cf.id, "CVH", arg.targetId),
            cf.range,
          ),
        );
      } else if (arg.kind === "FL" && typeof arg.targetId === "number" && !deck.flowPaths.has(arg.targetId)) {
        diags.push(
          makeDiag(
            MelcorErrorCode.UNDEFINED_CF_ARGUMENT,
            MelcorErrorCode.UNDEFINED_CF_ARGUMENT.message(cf.id, "FL", arg.targetId),
            cf.range,
          ),
        );
      } else if (arg.kind === "TF" && typeof arg.targetId === "number" && !deck.tabularFunctions.has(arg.targetId)) {
        diags.push(
          makeDiag(
            MelcorErrorCode.UNDEFINED_CF_ARGUMENT,
            MelcorErrorCode.UNDEFINED_CF_ARGUMENT.message(cf.id, "TF", arg.targetId),
            cf.range,
          ),
        );
      }
    }
    adj.set(cf.id, deps);
  }

  // 3-color DFS for cycles in CF dependency graph
  const color = new Map<number, 0 | 1 | 2>();
  const stack: number[] = [];
  const reportedCycles = new Set<string>();

  const dfs = (u: number): void => {
    color.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? 0;
      if (c === 1) {
        const idx = stack.indexOf(v);
        const cycle = [...stack.slice(idx), v].map((id) => `CF_${id}`).join(" -> ");
        if (!reportedCycles.has(cycle)) {
          reportedCycles.add(cycle);
          diags.push(
            makeDiag(
              MelcorErrorCode.CYCLIC_CONTROL_FUNCTION,
              MelcorErrorCode.CYCLIC_CONTROL_FUNCTION.message(cycle),
              deck.controlFunctions.get(u)?.range,
            ),
          );
        }
      } else if (c === 0) {
        dfs(v);
      }
    }
    stack.pop();
    color.set(u, 2);
  };

  for (const cfId of deck.controlFunctions.keys()) {
    if ((color.get(cfId) ?? 0) === 0) {
      dfs(cfId);
    }
  }

  // 7. EXEC_INPUT time bounds (MEL5002, MEL5003)
  if (!deck.exec.present || deck.exec.tEnd <= deck.exec.tStart) {
    diags.push(
      makeDiag(
        MelcorErrorCode.MISSING_EXEC_TIME_BOUNDS,
        MelcorErrorCode.MISSING_EXEC_TIME_BOUNDS.message(),
        deck.exec.range,
      ),
    );
  }
  if (deck.exec.present && (deck.exec.dtMin <= 0 || deck.exec.dtMax <= 0 || deck.exec.dtMin > deck.exec.dtMax)) {
    diags.push(
      makeDiag(
        MelcorErrorCode.INVALID_TIME_STEP_BOUNDS,
        MelcorErrorCode.INVALID_TIME_STEP_BOUNDS.message(deck.exec.dtMin, deck.exec.dtMax),
        deck.exec.range,
      ),
    );
  }

  return diags;
}
