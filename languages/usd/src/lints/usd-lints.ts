// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/usd — OpenUSD & UsdPhysics Semantic Linter.
 */

import type { SourceRange, UsdDiagnostic, UsdStage } from "../types.js";

const DEFAULT_RANGE: SourceRange = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 };

export function lintUsdStage(stage: UsdStage): UsdDiagnostic[] {
  const diagnostics: UsdDiagnostic[] = [];

  // 1. Stage metadata checks
  if (stage.metadata.upAxis && stage.metadata.upAxis !== "Y" && stage.metadata.upAxis !== "Z") {
    diagnostics.push({
      code: "USD1003",
      severity: "error",
      message: `Invalid stage upAxis '${stage.metadata.upAxis}'. OpenUSD requires 'Y' or 'Z'.`,
      range: DEFAULT_RANGE,
    });
  }

  // 2. Prim and relationship verification
  for (const prim of stage.prims.values()) {
    // Check physics mass
    const massAttr = prim.attributes.get("physics:mass");
    if (massAttr && typeof massAttr.value === "number" && massAttr.value <= 0) {
      diagnostics.push({
        code: "USD1004",
        severity: "error",
        message: `Physics mass for '${prim.name}' must be strictly positive (found: ${massAttr.value}).`,
        range: massAttr.range ?? prim.range ?? DEFAULT_RANGE,
      });
    }

    // Check diagonal inertia
    const inertiaAttr = prim.attributes.get("physics:diagonalInertia");
    if (inertiaAttr && Array.isArray(inertiaAttr.value)) {
      for (const val of inertiaAttr.value) {
        if (typeof val === "number" && val < 0) {
          diagnostics.push({
            code: "USD1005",
            severity: "error",
            message: `Diagonal inertia components for '${prim.name}' must be non-negative (found: ${val}).`,
            range: inertiaAttr.range ?? prim.range ?? DEFAULT_RANGE,
          });
          break;
        }
      }
    }

    // Check relationships: dangling targets
    for (const rel of prim.relationships.values()) {
      for (const target of rel.targets) {
        if (target && target.startsWith("/")) {
          if (!stage.prims.has(target)) {
            diagnostics.push({
              code: "USD1002",
              severity: "error",
              message: `Relationship '${rel.name}' on '${prim.name}' targets non-existent prim '<${target}>'.`,
              range: rel.range ?? prim.range ?? DEFAULT_RANGE,
            });
          }
        }
      }
    }

    // Check joints
    if (prim.typeName.startsWith("Physics") && prim.typeName.includes("Joint")) {
      const lowerAttr = prim.attributes.get("physics:lowerLimit");
      const upperAttr = prim.attributes.get("physics:upperLimit");

      if (
        lowerAttr &&
        upperAttr &&
        typeof lowerAttr.value === "number" &&
        typeof upperAttr.value === "number" &&
        lowerAttr.value > upperAttr.value
      ) {
        diagnostics.push({
          code: "USD1006",
          severity: "error",
          message: `Inverted joint limits on '${prim.name}': lowerLimit (${lowerAttr.value}) > upperLimit (${upperAttr.value}).`,
          range: lowerAttr.range ?? prim.range ?? DEFAULT_RANGE,
        });
      }

      const axisAttr = prim.attributes.get("physics:axis");
      if (axisAttr && typeof axisAttr.value === "string") {
        const ax = axisAttr.value.replace(/['"]/g, "");
        if (ax !== "X" && ax !== "Y" && ax !== "Z") {
          diagnostics.push({
            code: "USD1007",
            severity: "error",
            message: `Invalid joint axis '${ax}' on '${prim.name}'. Must be 'X', 'Y', or 'Z'.`,
            range: axisAttr.range ?? prim.range ?? DEFAULT_RANGE,
          });
        }
      }
    }
  }

  return diagnostics;
}
