// SPDX-License-Identifier: AGPL-3.0-or-later

import { SimpackErrorCode } from "../errors.js";
import { analyzeMobility } from "../kinematics/mobility.js";
import type { SimpackModel } from "../types.js";

export interface SimpackDiagnostic {
  code: string;
  rule?: string;
  severity: "error" | "warning";
  message: string;
}

export function lintSimpackModel(model: SimpackModel): SimpackDiagnostic[] {
  const diagnostics: SimpackDiagnostic[] = [];
  const connectedMarkers = new Set<string>();

  for (const [id, body] of model.bodies.entries()) {
    if (body.markerId) {
      connectedMarkers.add(body.markerId);
    }
    if (body.mass <= 0) {
      diagnostics.push({
        code: SimpackErrorCode.INVALID_BODY_MASS.code,
        rule: SimpackErrorCode.INVALID_BODY_MASS.rule,
        severity: SimpackErrorCode.INVALID_BODY_MASS.severity,
        message: SimpackErrorCode.INVALID_BODY_MASS.message(id, body.mass),
      });
    }
    const { ixx, iyy, izz } = body.inertia;
    if (
      ixx <= 0 ||
      iyy <= 0 ||
      izz <= 0 ||
      ixx + iyy < izz ||
      iyy + izz < ixx ||
      izz + ixx < iyy
    ) {
      diagnostics.push({
        code: SimpackErrorCode.DEGENERATE_INERTIA_TENSOR.code,
        rule: SimpackErrorCode.DEGENERATE_INERTIA_TENSOR.rule,
        severity: SimpackErrorCode.DEGENERATE_INERTIA_TENSOR.severity,
        message: SimpackErrorCode.DEGENERATE_INERTIA_TENSOR.message(id),
      });
    }
  }

  for (const [, joint] of model.joints.entries()) {
    if (joint.fromMarker) connectedMarkers.add(joint.fromMarker);
    if (joint.toMarker) connectedMarkers.add(joint.toMarker);
  }

  for (const [id, force] of model.forces.entries()) {
    if (force.markerA) connectedMarkers.add(force.markerA);
    if (force.markerB) connectedMarkers.add(force.markerB);

    if (force.type === "contact" && (!force.railProfile || force.railProfile.trim().length === 0)) {
      diagnostics.push({
        code: SimpackErrorCode.UNPAIRED_WHEEL_RAIL.code,
        rule: SimpackErrorCode.UNPAIRED_WHEEL_RAIL.rule,
        severity: SimpackErrorCode.UNPAIRED_WHEEL_RAIL.severity,
        message: SimpackErrorCode.UNPAIRED_WHEEL_RAIL.message(id),
      });
    }

    const { x: kx, y: ky, z: kz } = force.stiffness;
    const minK = Math.min(kx, ky, kz);
    const maxK = Math.max(kx, ky, kz);
    if (minK < 0 || (force.type === "bushing" && maxK <= 0)) {
      const badVal = minK < 0 ? minK : maxK;
      diagnostics.push({
        code: SimpackErrorCode.NEGATIVE_BUSHING_STIFFNESS.code,
        rule: SimpackErrorCode.NEGATIVE_BUSHING_STIFFNESS.rule,
        severity: SimpackErrorCode.NEGATIVE_BUSHING_STIFFNESS.severity,
        message: SimpackErrorCode.NEGATIVE_BUSHING_STIFFNESS.message(id, badVal),
      });
    }
  }

  for (const [id, marker] of model.markers.entries()) {
    if (marker.bodyId !== "$inertial" && !model.bodies.has(marker.bodyId)) {
      diagnostics.push({
        code: SimpackErrorCode.DANGLING_BODY_REFERENCE.code,
        rule: SimpackErrorCode.DANGLING_BODY_REFERENCE.rule,
        severity: SimpackErrorCode.DANGLING_BODY_REFERENCE.severity,
        message: SimpackErrorCode.DANGLING_BODY_REFERENCE.message(id, marker.bodyId),
      });
    }
    if (!connectedMarkers.has(id)) {
      diagnostics.push({
        code: SimpackErrorCode.UNCONNECTED_SUBSYSTEM_MARKER.code,
        rule: SimpackErrorCode.UNCONNECTED_SUBSYSTEM_MARKER.rule,
        severity: SimpackErrorCode.UNCONNECTED_SUBSYSTEM_MARKER.severity,
        message: SimpackErrorCode.UNCONNECTED_SUBSYSTEM_MARKER.message(id),
      });
    }
  }

  for (const [id, joint] of model.joints.entries()) {
    if (!model.markers.has(joint.fromMarker)) {
      diagnostics.push({
        code: SimpackErrorCode.UNKNOWN_FROM_MARKER.code,
        rule: SimpackErrorCode.UNKNOWN_FROM_MARKER.rule,
        severity: SimpackErrorCode.UNKNOWN_FROM_MARKER.severity,
        message: SimpackErrorCode.UNKNOWN_FROM_MARKER.message(id, joint.fromMarker),
      });
    }
    if (!model.markers.has(joint.toMarker)) {
      diagnostics.push({
        code: SimpackErrorCode.UNKNOWN_TO_MARKER.code,
        rule: SimpackErrorCode.UNKNOWN_TO_MARKER.rule,
        severity: SimpackErrorCode.UNKNOWN_TO_MARKER.severity,
        message: SimpackErrorCode.UNKNOWN_TO_MARKER.message(id, joint.toMarker),
      });
    }
    if (
      joint.baumgarteAlpha !== undefined &&
      (joint.baumgarteAlpha <= 0 || !Number.isFinite(joint.baumgarteAlpha) || joint.baumgarteAlpha > 1e5)
    ) {
      diagnostics.push({
        code: SimpackErrorCode.BAUMGARTE_DIVERGENCE.code,
        rule: SimpackErrorCode.BAUMGARTE_DIVERGENCE.rule,
        severity: SimpackErrorCode.BAUMGARTE_DIVERGENCE.severity,
        message: SimpackErrorCode.BAUMGARTE_DIVERGENCE.message(id, "alpha", joint.baumgarteAlpha),
      });
    }
    if (
      joint.baumgarteBeta !== undefined &&
      (joint.baumgarteBeta <= 0 || !Number.isFinite(joint.baumgarteBeta) || joint.baumgarteBeta > 1e5)
    ) {
      diagnostics.push({
        code: SimpackErrorCode.BAUMGARTE_DIVERGENCE.code,
        rule: SimpackErrorCode.BAUMGARTE_DIVERGENCE.rule,
        severity: SimpackErrorCode.BAUMGARTE_DIVERGENCE.severity,
        message: SimpackErrorCode.BAUMGARTE_DIVERGENCE.message(id, "beta", joint.baumgarteBeta),
      });
    }
  }

  const mobility = analyzeMobility(model);
  if (mobility.isOverconstrained) {
    diagnostics.push({
      code: SimpackErrorCode.OVERCONSTRAINED_MOBILITY.code,
      rule: SimpackErrorCode.OVERCONSTRAINED_MOBILITY.rule,
      severity: SimpackErrorCode.OVERCONSTRAINED_MOBILITY.severity,
      message: SimpackErrorCode.OVERCONSTRAINED_MOBILITY.message(mobility.calculatedMobility),
    });
  }

  return diagnostics;
}

