// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/adams — Pre-Flight Multibody Kinematic Linter Rules (M7301-M7320).
 *
 * Implements rigorous structural, kinematic, and physical checks for MSC Adams
 * models matching OpenModelica and industrial MBD solver diagnostic conventions.
 */

import type { AdamsDataset, AdamsDiagnostic, AdamsMobilityResult, SourceRange } from "../types.js";

const DEFAULT_RANGE: SourceRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
};

/**
 * Calculates Grübler-Kutzbach spatial mechanism mobility:
 * M = 6*(N - 1) - sum(c_i)
 * where N is number of bodies (including ground), c_i = 6 - dof_i.
 */
export function analyzeAdamsMobility(dataset: AdamsDataset): AdamsMobilityResult {
  let groundCount = 0;
  for (const part of dataset.parts.values()) {
    if (part.isGround) groundCount++;
  }

  // Treat ground as 1 body if present, else 0
  const movingBodies = Array.from(dataset.parts.values()).filter((p) => !p.isGround).length;
  const numBodies = movingBodies + (groundCount > 0 ? 1 : 0);

  let totalConstraintEquations = 0;
  for (const joint of dataset.joints.values()) {
    const c_i = 6 - joint.dofCount;
    totalConstraintEquations += c_i;
  }

  // Degrees of freedom M = 6 * movingBodies - totalConstraintEquations
  const calculatedMobility = movingBodies > 0 ? 6 * movingBodies - totalConstraintEquations : 0;
  const isOverconstrained = calculatedMobility < 0;

  return {
    numBodies,
    numJoints: dataset.joints.size,
    totalConstraintEquations,
    calculatedMobility,
    isOverconstrained,
  };
}

/**
 * Runs all pre-flight diagnostic rules (M7301-M7310) against an MSC Adams model.
 */
export function lintAdamsModel(dataset: AdamsDataset): AdamsDiagnostic[] {
  const diagnostics: AdamsDiagnostic[] = [];

  // 1. M7309: Missing ground part
  checkGroundPart(dataset, diagnostics);

  // 2. M7303: Dangling marker references
  checkDanglingReferences(dataset, diagnostics);

  // 3. M7304: Non-physical inertia tensor
  checkInertiaTensors(dataset, diagnostics);

  // 4. M7305: Massless part floating
  checkMasslessParts(dataset, diagnostics);

  // 5. M7301: Overconstrained mobility
  checkMobility(dataset, diagnostics);

  // 6. M7302: Gimbal lock orientation
  checkGimbalLock(dataset, diagnostics);

  // 7. M7307: Coincident joint markers
  checkCoincidentMarkers(dataset, diagnostics);

  // 8. M7308: Negative spring/damping
  checkSpringDamping(dataset, diagnostics);

  // 9. M7310: Unconstrained floating part
  checkDisconnectedParts(dataset, diagnostics);

  return diagnostics;
}

function checkGroundPart(dataset: AdamsDataset, diagnostics: AdamsDiagnostic[]): void {
  const hasGround = Array.from(dataset.parts.values()).some((p) => p.isGround);
  if (!hasGround && dataset.parts.size > 0) {
    diagnostics.push({
      code: "M7309",
      severity: "error",
      message: "Dataset does not define a ground reference body ('PART/... GROUND').",
      range: DEFAULT_RANGE,
      quickFix: {
        title: "Add ground part 'PART/1, GROUND'",
        edit: {
          text: "PART/1, GROUND\n",
          range: DEFAULT_RANGE,
        },
      },
    });
  }
}

function checkDanglingReferences(dataset: AdamsDataset, diagnostics: AdamsDiagnostic[]): void {
  // Check part CM marker references
  for (const part of dataset.parts.values()) {
    if (part.cmMarkerId !== undefined && !dataset.markers.has(part.cmMarkerId)) {
      diagnostics.push({
        code: "M7303",
        severity: "error",
        message: `Part '${part.id}' references non-existent CM marker '${part.cmMarkerId}'.`,
        range: part.range ?? DEFAULT_RANGE,
      });
    }
  }

  // Check marker parent part references
  for (const marker of dataset.markers.values()) {
    if (!dataset.parts.has(marker.partId)) {
      diagnostics.push({
        code: "M7303",
        severity: "error",
        message: `Marker '${marker.id}' references non-existent part '${marker.partId}'.`,
        range: marker.range ?? DEFAULT_RANGE,
      });
    }
  }

  // Check joint I and J markers
  for (const joint of dataset.joints.values()) {
    if (!dataset.markers.has(joint.iMarkerId)) {
      diagnostics.push({
        code: "M7303",
        severity: "error",
        message: `Joint '${joint.id}' references non-existent marker '${joint.iMarkerId}'.`,
        range: joint.range ?? DEFAULT_RANGE,
      });
    }
    if (!dataset.markers.has(joint.jMarkerId)) {
      diagnostics.push({
        code: "M7303",
        severity: "error",
        message: `Joint '${joint.id}' references non-existent marker '${joint.jMarkerId}'.`,
        range: joint.range ?? DEFAULT_RANGE,
      });
    }
  }

  // Check force I and J markers
  for (const force of dataset.forces.values()) {
    if (!dataset.markers.has(force.iMarkerId)) {
      diagnostics.push({
        code: "M7303",
        severity: "error",
        message: `Force element '${force.id}' references non-existent marker '${force.iMarkerId}'.`,
        range: force.range ?? DEFAULT_RANGE,
      });
    }
    if (!dataset.markers.has(force.jMarkerId)) {
      diagnostics.push({
        code: "M7303",
        severity: "error",
        message: `Force element '${force.id}' references non-existent marker '${force.jMarkerId}'.`,
        range: force.range ?? DEFAULT_RANGE,
      });
    }
  }
}

function checkInertiaTensors(dataset: AdamsDataset, diagnostics: AdamsDiagnostic[]): void {
  for (const part of dataset.parts.values()) {
    if (part.isGround) continue;

    const { ixx, iyy, izz } = part.inertia;
    if (ixx <= 0 || iyy <= 0 || izz <= 0) {
      diagnostics.push({
        code: "M7304",
        severity: "error",
        message: `Non-positive principal inertia for part '${part.id}' (Ixx=${ixx}, Iyy=${iyy}, Izz=${izz}).`,
        range: part.range ?? DEFAULT_RANGE,
      });
      continue;
    }

    // Triangle inequality for physical rigid bodies:
    // Ixx + Iyy >= Izz, Iyy + Izz >= Ixx, Izz + Ixx >= Iyy
    const eps = 1e-9;
    if (ixx + iyy + eps < izz || iyy + izz + eps < ixx || izz + ixx + eps < iyy) {
      diagnostics.push({
        code: "M7304",
        severity: "error",
        message: `Inertia tensor for part '${part.id}' violates physical rigid body triangle inequalities (Ixx=${ixx}, Iyy=${iyy}, Izz=${izz}).`,
        range: part.range ?? DEFAULT_RANGE,
      });
    }
  }
}

function checkMasslessParts(dataset: AdamsDataset, diagnostics: AdamsDiagnostic[]): void {
  for (const part of dataset.parts.values()) {
    if (part.isGround) continue;
    if (part.mass <= 0) {
      diagnostics.push({
        code: "M7305",
        severity: "error",
        message: `Moving part '${part.id}' has zero or negative mass (${part.mass} kg) and is not kinematically grounded.`,
        range: part.range ?? DEFAULT_RANGE,
      });
    }
  }
}

function checkMobility(dataset: AdamsDataset, diagnostics: AdamsDiagnostic[]): void {
  const mobility = analyzeAdamsMobility(dataset);
  if (mobility.isOverconstrained) {
    diagnostics.push({
      code: "M7301",
      severity: "warning",
      message: `Overconstrained mechanism: Grübler-Kutzbach mobility M = ${mobility.calculatedMobility} < 0 (moving bodies: ${mobility.numBodies}, constraints: ${mobility.totalConstraintEquations}).`,
      range: DEFAULT_RANGE,
    });
  }
}

function checkGimbalLock(dataset: AdamsDataset, diagnostics: AdamsDiagnostic[]): void {
  for (const marker of dataset.markers.values()) {
    if (!marker.useEuler) continue;

    // In Euler 3-1-3: theta near 0 deg (with non-zero collinear psi & phi) or 180 deg is singular
    // In Tait-Bryan 1-2-3: pitch near +/- 90 deg is singular
    const pitchDeg = Math.abs(marker.orientation.y * (180.0 / Math.PI));
    const hasCollinearZRotations =
      pitchDeg < 1.0 && Math.abs(marker.orientation.x) > 1e-6 && Math.abs(marker.orientation.z) > 1e-6;
    const isNear90 = Math.abs(pitchDeg - 90.0) < 1.0;
    const isNear180 = Math.abs(pitchDeg - 180.0) < 1.0;
    if (isNear90 || isNear180 || hasCollinearZRotations) {
      diagnostics.push({
        code: "M7302",
        severity: "warning",
        message: `Euler orientation of marker '${marker.id}' is near singularity (theta/pitch angle: ${pitchDeg.toFixed(2)} deg).`,
        range: marker.range ?? DEFAULT_RANGE,
      });
    }
  }
}

function checkCoincidentMarkers(dataset: AdamsDataset, diagnostics: AdamsDiagnostic[]): void {
  for (const joint of dataset.joints.values()) {
    if (joint.type === "REVOLUTE" || joint.type === "SPHERICAL" || joint.type === "UNIVERSAL") {
      const mA = dataset.markers.get(joint.iMarkerId);
      const mB = dataset.markers.get(joint.jMarkerId);
      if (!mA || !mB) continue;

      const dx = mA.position.x - mB.position.x;
      const dy = mA.position.y - mB.position.y;
      const dz = mA.position.z - mB.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Warning if distance exceeds 0.05 meters for concentric joints
      if (dist > 0.05) {
        diagnostics.push({
          code: "M7307",
          severity: "warning",
          message: `Joint '${joint.id}' connects non-coincident markers '${joint.iMarkerId}' and '${joint.jMarkerId}' (distance: ${dist.toFixed(4)} m).`,
          range: joint.range ?? DEFAULT_RANGE,
        });
      }
    }
  }
}

function checkSpringDamping(dataset: AdamsDataset, diagnostics: AdamsDiagnostic[]): void {
  for (const force of dataset.forces.values()) {
    if (force.stiffness !== undefined && force.stiffness < 0) {
      diagnostics.push({
        code: "M7308",
        severity: "error",
        message: `Force element '${force.id}' has negative stiffness parameter (K=${force.stiffness}).`,
        range: force.range ?? DEFAULT_RANGE,
      });
    }
    if (force.damping !== undefined && force.damping < 0) {
      diagnostics.push({
        code: "M7308",
        severity: "error",
        message: `Force element '${force.id}' has negative damping parameter (C=${force.damping}).`,
        range: force.range ?? DEFAULT_RANGE,
      });
    }
  }
}

function checkDisconnectedParts(dataset: AdamsDataset, diagnostics: AdamsDiagnostic[]): void {
  const connectedParts = new Set<string | number>();

  for (const joint of dataset.joints.values()) {
    const mA = dataset.markers.get(joint.iMarkerId);
    const mB = dataset.markers.get(joint.jMarkerId);
    if (mA) connectedParts.add(mA.partId);
    if (mB) connectedParts.add(mB.partId);
  }

  for (const force of dataset.forces.values()) {
    const mA = dataset.markers.get(force.iMarkerId);
    const mB = dataset.markers.get(force.jMarkerId);
    if (mA) connectedParts.add(mA.partId);
    if (mB) connectedParts.add(mB.partId);
  }

  for (const part of dataset.parts.values()) {
    if (part.isGround) continue;
    if (!connectedParts.has(part.id)) {
      diagnostics.push({
        code: "M7310",
        severity: "warning",
        message: `Moving part '${part.id}' is disconnected and has no kinematic joints or force elements attached.`,
        range: part.range ?? DEFAULT_RANGE,
      });
    }
  }
}
