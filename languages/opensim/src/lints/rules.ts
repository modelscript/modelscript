// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opensim — Biomechanical & Musculoskeletal Semantic Linter (M9101–M9110).
 *
 * Implements diagnostic rules:
 * - M9101 (opensim-unresolved-body-frame): Joint, marker, wrap object, or muscle path point references undefined body frame.
 * - M9102 (opensim-non-positive-body-mass): Body specifies mass <= 0 or non-positive principal inertia components (Ixx, Iyy, Izz <= 0).
 * - M9103 (opensim-kinematic-tree-cycle): Kinematic joint graph contains a cycle or multiple parent joints targeting the same child body without a ConstraintSet entry.
 * - M9104 (opensim-invalid-coordinate-range): Coordinate rangeMin >= rangeMax or defaultValue outside [rangeMin, rangeMax].
 * - M9105 (opensim-invalid-muscle-parameters): Muscle maxIsometricForce <= 0, optimalFiberLength <= 0, or tendonSlackLength <= 0.
 * - M9106 (opensim-excessive-pennation-angle): Muscle pennationAngleAtOptimal < 0 or >= Math.PI / 2 radians.
 * - M9107 (opensim-insufficient-muscle-path-points): Muscle has fewer than 2 path points or all path points attach to the exact same body frame.
 * - M9108 (opensim-unresolved-wrap-object): Muscle references an undefined WrapObject name.
 * - M9109 (opensim-invalid-time-constants): Muscle activationTimeConstant <= 0, deactivationTimeConstant <= 0, or activationTimeConstant > deactivationTimeConstant.
 * - M9110 (opensim-duplicate-component-name): Duplicate body, joint, coordinate, or muscle name.
 */

import type { OpenSimDiagnostic, OpenSimDocument } from "../types.js";

export const OpenSimErrorCode = {
  UNRESOLVED_BODY_FRAME: {
    code: "M9101",
    rule: "opensim-unresolved-body-frame",
    severity: "error" as const,
    message: (componentKind: string, componentName: string, frameName: string) =>
      `${componentKind} '${componentName}' references undefined body frame '${frameName}'.`,
  },
  NON_POSITIVE_BODY_MASS: {
    code: "M9102",
    rule: "opensim-non-positive-body-mass",
    severity: "error" as const,
    message: (bodyName: string, detail: string) =>
      `Body '${bodyName}' specifies invalid mass or principal inertia (${detail}).`,
  },
  KINEMATIC_TREE_CYCLE: {
    code: "M9103",
    rule: "opensim-kinematic-tree-cycle",
    severity: "error" as const,
    message: (jointName: string, detail: string) => `Kinematic tree topology error at joint '${jointName}': ${detail}.`,
  },
  INVALID_COORDINATE_RANGE: {
    code: "M9104",
    rule: "opensim-invalid-coordinate-range",
    severity: "error" as const,
    message: (coordName: string, rangeMin: number, rangeMax: number, defaultValue: number) =>
      `Coordinate '${coordName}' has invalid range ['${rangeMin}', '${rangeMax}'] or default value '${defaultValue}' outside range.`,
  },
  INVALID_MUSCLE_PARAMETERS: {
    code: "M9105",
    rule: "opensim-invalid-muscle-parameters",
    severity: "error" as const,
    message: (muscleName: string, detail: string) =>
      `Muscle '${muscleName}' has non-positive Hill parameter (${detail}).`,
  },
  EXCESSIVE_PENNATION_ANGLE: {
    code: "M9106",
    rule: "opensim-excessive-pennation-angle",
    severity: "error" as const,
    message: (muscleName: string, angleRad: number) =>
      `Muscle '${muscleName}' has invalid pennation angle '${angleRad}' rad (must be in [0, pi/2)).`,
  },
  INSUFFICIENT_MUSCLE_PATH_POINTS: {
    code: "M9107",
    rule: "opensim-insufficient-muscle-path-points",
    severity: "error" as const,
    message: (muscleName: string, detail: string) => `Muscle '${muscleName}' has invalid geometry path (${detail}).`,
  },
  UNRESOLVED_WRAP_OBJECT: {
    code: "M9108",
    rule: "opensim-unresolved-wrap-object",
    severity: "error" as const,
    message: (muscleName: string, wrapName: string) =>
      `Muscle '${muscleName}' references undefined WrapObject '${wrapName}'.`,
  },
  INVALID_TIME_CONSTANTS: {
    code: "M9109",
    rule: "opensim-invalid-time-constants",
    severity: "warning" as const,
    message: (muscleName: string, tauAct: number, tauDeact: number) =>
      `Muscle '${muscleName}' has invalid activation/deactivation time constants (tau_act='${tauAct}', tau_deact='${tauDeact}').`,
  },
  DUPLICATE_COMPONENT_NAME: {
    code: "M9110",
    rule: "opensim-duplicate-component-name",
    severity: "error" as const,
    message: (componentKind: string, name: string) =>
      `Duplicate ${componentKind} name '${name}' declared in OpenSim model.`,
  },
};

function canonicalBodyFrame(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "ground" || trimmed === "/ground") return "ground";
  return trimmed.replace(/^\/?bodyset\//i, "").replace(/^\//, "");
}

export function lintOpenSimDocument(doc: OpenSimDocument): OpenSimDiagnostic[] {
  const diagnostics: OpenSimDiagnostic[] = [];

  // ───────────────────────────────────────────────────────────────────────────
  // 1. M9110: Duplicate component names (Body, Joint, Coordinate, Muscle)
  // ───────────────────────────────────────────────────────────────────────────
  const seenBodies = new Set<string>();
  for (const b of doc.bodies) {
    if (seenBodies.has(b.name)) {
      diagnostics.push({
        code: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.code,
        rule: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.rule,
        severity: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.severity,
        message: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.message("body", b.name),
        range: b.range,
      });
    } else {
      seenBodies.add(b.name);
    }
  }

  const seenJoints = new Set<string>();
  const seenCoords = new Set<string>();
  for (const j of doc.joints) {
    if (seenJoints.has(j.name)) {
      diagnostics.push({
        code: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.code,
        rule: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.rule,
        severity: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.severity,
        message: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.message("joint", j.name),
        range: j.range,
      });
    } else {
      seenJoints.add(j.name);
    }

    for (const c of j.coordinates) {
      if (seenCoords.has(c.name)) {
        diagnostics.push({
          code: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.code,
          rule: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.rule,
          severity: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.severity,
          message: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.message("coordinate", c.name),
          range: c.range,
        });
      } else {
        seenCoords.add(c.name);
      }
    }
  }

  const seenMuscles = new Set<string>();
  for (const m of doc.muscles) {
    if (seenMuscles.has(m.name)) {
      diagnostics.push({
        code: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.code,
        rule: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.rule,
        severity: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.severity,
        message: OpenSimErrorCode.DUPLICATE_COMPONENT_NAME.message("muscle", m.name),
        range: m.range,
      });
    } else {
      seenMuscles.add(m.name);
    }
  }

  // Build valid body frame lookup set
  const validBodyFrames = new Set<string>(["ground", "/ground"]);
  for (const b of doc.bodies) {
    validBodyFrames.add(b.name);
    validBodyFrames.add(b.id);
  }

  const isFrameValid = (frame: string): boolean => {
    if (!frame) return false;
    if (validBodyFrames.has(frame)) return true;
    const canon = canonicalBodyFrame(frame);
    return validBodyFrames.has(canon);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // 2. M9102: Body mass and principal moments of inertia
  // ───────────────────────────────────────────────────────────────────────────
  for (const b of doc.bodies) {
    const [ixx, iyy, izz] = b.inertia;
    if (b.mass <= 0) {
      diagnostics.push({
        code: OpenSimErrorCode.NON_POSITIVE_BODY_MASS.code,
        rule: OpenSimErrorCode.NON_POSITIVE_BODY_MASS.rule,
        severity: OpenSimErrorCode.NON_POSITIVE_BODY_MASS.severity,
        message: OpenSimErrorCode.NON_POSITIVE_BODY_MASS.message(b.name, `mass=${b.mass} <= 0`),
        range: b.range,
      });
    } else if (ixx <= 0 || iyy <= 0 || izz <= 0) {
      diagnostics.push({
        code: OpenSimErrorCode.NON_POSITIVE_BODY_MASS.code,
        rule: OpenSimErrorCode.NON_POSITIVE_BODY_MASS.rule,
        severity: OpenSimErrorCode.NON_POSITIVE_BODY_MASS.severity,
        message: OpenSimErrorCode.NON_POSITIVE_BODY_MASS.message(
          b.name,
          `Ixx=${ixx}, Iyy=${iyy}, Izz=${izz} must all be > 0`,
        ),
        range: b.range,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. M9101, M9103, M9104: Joints, Kinematic Tree Topology, and Coordinates
  // ───────────────────────────────────────────────────────────────────────────
  const constrainedBodies = new Set<string>();
  for (const c of doc.constraints) {
    if (c.body1) constrainedBodies.add(canonicalBodyFrame(c.body1));
    if (c.body2) constrainedBodies.add(canonicalBodyFrame(c.body2));
  }

  const parentByChild = new Map<string, { parent: string; jointName: string }>();
  const adj = new Map<string, Array<{ child: string; jointIndex: number }>>();

  for (let jIdx = 0; jIdx < doc.joints.length; jIdx++) {
    const j = doc.joints[jIdx]!;

    // M9101: Parent & Child body frame resolution
    const pValid = isFrameValid(j.parentFrame);
    const cValid = isFrameValid(j.childFrame);

    if (!pValid) {
      diagnostics.push({
        code: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.code,
        rule: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.rule,
        severity: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.severity,
        message: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.message("Joint", j.name, j.parentFrame),
        range: j.range,
      });
    }
    if (!cValid) {
      diagnostics.push({
        code: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.code,
        rule: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.rule,
        severity: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.severity,
        message: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.message("Joint", j.name, j.childFrame),
        range: j.range,
      });
    }

    // M9104: Coordinate ranges
    for (const coord of j.coordinates) {
      if (
        coord.rangeMin >= coord.rangeMax ||
        coord.defaultValue < coord.rangeMin ||
        coord.defaultValue > coord.rangeMax
      ) {
        diagnostics.push({
          code: OpenSimErrorCode.INVALID_COORDINATE_RANGE.code,
          rule: OpenSimErrorCode.INVALID_COORDINATE_RANGE.rule,
          severity: OpenSimErrorCode.INVALID_COORDINATE_RANGE.severity,
          message: OpenSimErrorCode.INVALID_COORDINATE_RANGE.message(
            coord.name,
            coord.rangeMin,
            coord.rangeMax,
            coord.defaultValue,
          ),
          range: coord.range,
        });
      }
    }

    if (pValid && cValid) {
      const pCanon = canonicalBodyFrame(j.parentFrame);
      const cCanon = canonicalBodyFrame(j.childFrame);

      if (pCanon === cCanon) {
        diagnostics.push({
          code: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.code,
          rule: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.rule,
          severity: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.severity,
          message: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.message(j.name, `self-loop on body '${cCanon}'`),
          range: j.range,
        });
      } else {
        const existingParent = parentByChild.get(cCanon);
        const hasLoopConstraint =
          doc.constraints.length > 0 && (constrainedBodies.has(cCanon) || constrainedBodies.has(pCanon));
        if (existingParent && !hasLoopConstraint) {
          diagnostics.push({
            code: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.code,
            rule: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.rule,
            severity: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.severity,
            message: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.message(
              j.name,
              `child body '${cCanon}' already has parent joint '${existingParent.jointName}' without a ConstraintSet entry`,
            ),
            range: j.range,
          });
        } else {
          parentByChild.set(cCanon, { parent: pCanon, jointName: j.name });
        }

        // Check if adding pCanon -> cCanon creates a directed cycle
        let cursor: string | undefined = pCanon;
        const visited = new Set<string>([cCanon]);
        let formsCycle = false;
        while (cursor !== undefined && cursor !== "ground") {
          if (visited.has(cursor)) {
            formsCycle = true;
            break;
          }
          visited.add(cursor);
          cursor = parentByChild.get(cursor)?.parent;
        }

        if (formsCycle) {
          diagnostics.push({
            code: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.code,
            rule: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.rule,
            severity: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.severity,
            message: OpenSimErrorCode.KINEMATIC_TREE_CYCLE.message(
              j.name,
              `cycle detected in kinematic chain '${pCanon} -> ${cCanon}'`,
            ),
            range: j.range,
          });
        }

        const list = adj.get(pCanon) ?? [];
        list.push({ child: cCanon, jointIndex: jIdx });
        adj.set(pCanon, list);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. M9101: Markers and WrapObjects body frame resolution
  // ───────────────────────────────────────────────────────────────────────────
  for (const mk of doc.markers) {
    if (!isFrameValid(mk.bodyFrame)) {
      diagnostics.push({
        code: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.code,
        rule: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.rule,
        severity: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.severity,
        message: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.message("Marker", mk.name, mk.bodyFrame),
        range: mk.range,
      });
    }
  }

  const definedWrapNames = new Set<string>();
  for (const w of doc.wrapObjects) {
    definedWrapNames.add(w.name);
    definedWrapNames.add(w.id);
    if (!isFrameValid(w.bodyFrame)) {
      diagnostics.push({
        code: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.code,
        rule: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.rule,
        severity: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.severity,
        message: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.message("WrapObject", w.name, w.bodyFrame),
        range: w.range,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. M9101, M9105, M9106, M9107, M9108, M9109: Muscles
  // ───────────────────────────────────────────────────────────────────────────
  for (const m of doc.muscles) {
    // M9105: Non-positive Hill muscle parameters
    if (m.maxIsometricForce <= 0 || m.optimalFiberLength <= 0 || m.tendonSlackLength <= 0) {
      diagnostics.push({
        code: OpenSimErrorCode.INVALID_MUSCLE_PARAMETERS.code,
        rule: OpenSimErrorCode.INVALID_MUSCLE_PARAMETERS.rule,
        severity: OpenSimErrorCode.INVALID_MUSCLE_PARAMETERS.severity,
        message: OpenSimErrorCode.INVALID_MUSCLE_PARAMETERS.message(
          m.name,
          `maxIsometricForce=${m.maxIsometricForce}, optimalFiberLength=${m.optimalFiberLength}, tendonSlackLength=${m.tendonSlackLength}`,
        ),
        range: m.range,
      });
    }

    // M9106: Pennation angle at optimal fiber length in [0, pi/2)
    if (m.pennationAngleAtOptimal < 0 || m.pennationAngleAtOptimal >= Math.PI / 2) {
      diagnostics.push({
        code: OpenSimErrorCode.EXCESSIVE_PENNATION_ANGLE.code,
        rule: OpenSimErrorCode.EXCESSIVE_PENNATION_ANGLE.rule,
        severity: OpenSimErrorCode.EXCESSIVE_PENNATION_ANGLE.severity,
        message: OpenSimErrorCode.EXCESSIVE_PENNATION_ANGLE.message(m.name, m.pennationAngleAtOptimal),
        range: m.range,
      });
    }

    // M9107: Path points count >= 2 and spanning at least 2 distinct body frames
    const attachedFrames = new Set<string>();
    for (const pp of m.pathPoints) {
      if (!isFrameValid(pp.bodyFrame)) {
        diagnostics.push({
          code: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.code,
          rule: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.rule,
          severity: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.severity,
          message: OpenSimErrorCode.UNRESOLVED_BODY_FRAME.message("PathPoint", pp.name, pp.bodyFrame),
          range: pp.range ?? m.range,
        });
      }
      if (pp.bodyFrame) {
        attachedFrames.add(canonicalBodyFrame(pp.bodyFrame));
      }
    }

    if (m.pathPoints.length < 2) {
      diagnostics.push({
        code: OpenSimErrorCode.INSUFFICIENT_MUSCLE_PATH_POINTS.code,
        rule: OpenSimErrorCode.INSUFFICIENT_MUSCLE_PATH_POINTS.rule,
        severity: OpenSimErrorCode.INSUFFICIENT_MUSCLE_PATH_POINTS.severity,
        message: OpenSimErrorCode.INSUFFICIENT_MUSCLE_PATH_POINTS.message(
          m.name,
          `requires at least 2 path points, found ${m.pathPoints.length}`,
        ),
        range: m.range,
      });
    } else if (attachedFrames.size < 2) {
      diagnostics.push({
        code: OpenSimErrorCode.INSUFFICIENT_MUSCLE_PATH_POINTS.code,
        rule: OpenSimErrorCode.INSUFFICIENT_MUSCLE_PATH_POINTS.rule,
        severity: OpenSimErrorCode.INSUFFICIENT_MUSCLE_PATH_POINTS.severity,
        message: OpenSimErrorCode.INSUFFICIENT_MUSCLE_PATH_POINTS.message(
          m.name,
          `all path points attach to the same body frame '${Array.from(attachedFrames)[0] ?? ""}'`,
        ),
        range: m.range,
      });
    }

    // M9108: Unresolved WrapObject references
    for (const wrapRef of m.wrapObjects) {
      if (!definedWrapNames.has(wrapRef)) {
        diagnostics.push({
          code: OpenSimErrorCode.UNRESOLVED_WRAP_OBJECT.code,
          rule: OpenSimErrorCode.UNRESOLVED_WRAP_OBJECT.rule,
          severity: OpenSimErrorCode.UNRESOLVED_WRAP_OBJECT.severity,
          message: OpenSimErrorCode.UNRESOLVED_WRAP_OBJECT.message(m.name, wrapRef),
          range: m.range,
        });
      }
    }

    // M9109: Activation / deactivation time constants
    if (
      m.activationTimeConstant <= 0 ||
      m.deactivationTimeConstant <= 0 ||
      m.activationTimeConstant > m.deactivationTimeConstant
    ) {
      diagnostics.push({
        code: OpenSimErrorCode.INVALID_TIME_CONSTANTS.code,
        rule: OpenSimErrorCode.INVALID_TIME_CONSTANTS.rule,
        severity: OpenSimErrorCode.INVALID_TIME_CONSTANTS.severity,
        message: OpenSimErrorCode.INVALID_TIME_CONSTANTS.message(
          m.name,
          m.activationTimeConstant,
          m.deactivationTimeConstant,
        ),
        range: m.range,
      });
    }
  }

  return diagnostics;
}
