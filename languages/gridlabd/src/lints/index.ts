// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gridlabd — Semantic & Structural Linter for GridLAB-D (.glm) Models.
 */

import { parseGlmNumber, parseGlmVoltageV } from "../parser/gridlabd-parser.js";
import type { GlmDiagnostic, GlmModel, GlmObject } from "../types.js";

const POWERFLOW_NODE_CLASSES = new Set([
  "node",
  "meter",
  "load",
  "triplex_node",
  "triplex_meter",
  "triplex_load",
  "capacitor",
]);

const POWERFLOW_LINK_CLASSES = new Set([
  "overhead_line",
  "underground_line",
  "triplex_line",
  "transformer",
  "switch",
  "fuse",
  "recloser",
  "regulator",
  "series_reactor",
]);

const GENERATOR_CLASSES = new Set(["solar", "inverter", "battery", "diesel_dg", "windturb_dg"]);

function normalizePhases(raw: string | undefined): Set<string> {
  const result = new Set<string>();
  if (!raw) return result;
  for (const ch of raw.toUpperCase()) {
    if (ch === "A" || ch === "B" || ch === "C" || ch === "S" || ch === "1" || ch === "2") {
      result.add(ch);
    }
  }
  return result;
}

function makeDiag(code: string, severity: GlmDiagnostic["severity"], message: string, obj?: GlmObject): GlmDiagnostic {
  const span = obj?.span ?? { line: 1, column: 1, endLine: 1, endColumn: 1, startOffset: 0, endOffset: 0 };
  return {
    code,
    severity,
    message,
    line: span.line,
    column: span.column,
    endLine: span.endLine,
    endColumn: span.endColumn,
    objectName: obj?.name,
  };
}

/**
 * Validate a parsed GlmModel and return structural/semantic diagnostics.
 */
export function lintGridlabd(model: GlmModel): GlmDiagnostic[] {
  const diagnostics: GlmDiagnostic[] = [];

  if (model.allObjects.length > 0 && !model.clock) {
    diagnostics.push(makeDiag("GLM1001", "warning", "Missing 'clock' block; simulation time horizon is unspecified."));
  } else if (model.clock) {
    if (!model.clock.starttime && !model.clock.timestamp) {
      diagnostics.push({
        code: "GLM1002",
        severity: "warning",
        message: "Clock block is missing 'starttime' (or 'timestamp').",
        line: model.clock.span.line,
        column: model.clock.span.column,
        endLine: model.clock.span.endLine,
        endColumn: model.clock.span.endColumn,
      });
    }
  }

  // Check duplicate object names
  const seenNames = new Map<string, GlmObject>();
  let hasPowerflowObjects = false;
  const swingBuses: GlmObject[] = [];

  for (const obj of model.allObjects) {
    if (obj.name) {
      const existing = seenNames.get(obj.name);
      if (existing) {
        diagnostics.push(
          makeDiag(
            "GLM2001",
            "error",
            `Duplicate object name '${obj.name}' (previously declared at line ${existing.span.line}).`,
            obj,
          ),
        );
      } else {
        seenNames.set(obj.name, obj);
      }
    }

    if (POWERFLOW_NODE_CLASSES.has(obj.className) || POWERFLOW_LINK_CLASSES.has(obj.className)) {
      hasPowerflowObjects = true;
    }

    if (POWERFLOW_NODE_CLASSES.has(obj.className)) {
      const bustype = obj.properties["bustype"]?.toUpperCase();
      if (bustype === "SWING" || bustype === "SWING_PQ") {
        swingBuses.push(obj);
      }

      const nomV = obj.properties["nominal_voltage"];
      if (!nomV && !obj.parent) {
        diagnostics.push(
          makeDiag(
            "GLM3003",
            "warning",
            `Powerflow node '${obj.name ?? obj.className}' is missing 'nominal_voltage'.`,
            obj,
          ),
        );
      } else if (nomV) {
        const parsedNum = parseGlmNumber(nomV);
        const parsedV = parseGlmVoltageV(nomV);
        if ((parsedNum !== null && parsedNum.value <= 0) || (parsedV !== null && parsedV <= 0)) {
          diagnostics.push(
            makeDiag(
              "GLM3003",
              "error",
              `Invalid non-positive 'nominal_voltage' (${nomV}) on '${obj.name ?? obj.className}'.`,
              obj,
            ),
          );
        }
      }
    }

    // Check parent reference
    if (obj.parent && !model.objectsByName.has(obj.parent)) {
      diagnostics.push(
        makeDiag(
          "GLM2002",
          "error",
          `Unresolved parent reference '${obj.parent}' on '${obj.name ?? obj.className}'.`,
          obj,
        ),
      );
    }

    // Check configuration reference
    const configRef = obj.properties["configuration"];
    if (configRef && !model.objectsByName.has(configRef)) {
      diagnostics.push(
        makeDiag("GLM2002", "error", `Unresolved configuration '${configRef}' on '${obj.name ?? obj.className}'.`, obj),
      );
    }

    // Check powerflow links
    if (POWERFLOW_LINK_CLASSES.has(obj.className)) {
      const from = obj.properties["from"];
      const to = obj.properties["to"];
      if (!from || !to) {
        diagnostics.push(
          makeDiag(
            "GLM3002",
            "error",
            `Link object '${obj.name ?? obj.className}' (${obj.className}) must specify both 'from' and 'to' buses.`,
            obj,
          ),
        );
      } else {
        const fromObj = model.objectsByName.get(from);
        const toObj = model.objectsByName.get(to);
        if (!fromObj) {
          diagnostics.push(
            makeDiag("GLM2002", "error", `Unresolved 'from' bus '${from}' on '${obj.name ?? obj.className}'.`, obj),
          );
        }
        if (!toObj) {
          diagnostics.push(
            makeDiag("GLM2002", "error", `Unresolved 'to' bus '${to}' on '${obj.name ?? obj.className}'.`, obj),
          );
        }

        // Phase compatibility check (skip for transformers which may convert phases/split-phase)
        if (obj.className !== "transformer" && fromObj && toObj) {
          const linkPhases = normalizePhases(obj.properties["phases"]);
          const fromPhases = normalizePhases(fromObj.properties["phases"]);
          const toPhases = normalizePhases(toObj.properties["phases"]);
          if (linkPhases.size > 0 && fromPhases.size > 0) {
            for (const p of linkPhases) {
              if (!fromPhases.has(p)) {
                diagnostics.push(
                  makeDiag(
                    "GLM3004",
                    "warning",
                    `Phase '${p}' on '${obj.name ?? obj.className}' is not present on 'from' bus '${from}'.`,
                    obj,
                  ),
                );
                break;
              }
            }
          }
          if (linkPhases.size > 0 && toPhases.size > 0) {
            for (const p of linkPhases) {
              if (!toPhases.has(p)) {
                diagnostics.push(
                  makeDiag(
                    "GLM3004",
                    "warning",
                    `Phase '${p}' on '${obj.name ?? obj.className}' is not present on 'to' bus '${to}'.`,
                    obj,
                  ),
                );
                break;
              }
            }
          }
        }
      }
    }

    // Check generator/inverter parent
    if (GENERATOR_CLASSES.has(obj.className) && !obj.parent) {
      diagnostics.push(
        makeDiag(
          "GLM3002",
          "warning",
          `Generator/DER object '${obj.name ?? obj.className}' (${obj.className}) has no 'parent' meter/inverter.`,
          obj,
        ),
      );
    }
  }

  if (hasPowerflowObjects && !model.modulesByName.has("powerflow")) {
    diagnostics.push(
      makeDiag("GLM3001", "error", "Powerflow objects are present, but 'module powerflow;' is not declared."),
    );
  }

  if (hasPowerflowObjects && swingBuses.length === 0) {
    diagnostics.push(makeDiag("GLM4001", "warning", "No 'bustype SWING' node found in powerflow network."));
  } else if (swingBuses.length > 1) {
    diagnostics.push(
      makeDiag(
        "GLM4002",
        "warning",
        `Multiple SWING buses declared (${swingBuses.map((b) => b.name ?? b.className).join(", ")}).`,
        swingBuses[1],
      ),
    );
  }

  return diagnostics;
}
