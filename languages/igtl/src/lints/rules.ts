// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/igtl — OpenIGTLink & PLUS Surgical Navigation Semantic Linter.
 *
 * Implements diagnostic rules M9801–M9810:
 * - M9801 (igtl-non-orthogonal-rotation): Upper-left 3x3 rotation submatrix R violates orthogonality (||R^T R - I||_F > 1e-3) or det(R) <= 0.
 * - M9802 (igtl-invalid-homogeneous-bottom-row): Bottom row of 4x4 transform matrix is not [0, 0, 0, 1].
 * - M9803 (igtl-disconnected-coordinate-frame): Coordinate frame graph is disconnected or lacks a path for requested transforms.
 * - M9804 (igtl-cyclic-transform-chain): Coordinate transform definitions form a directed cycle.
 * - M9805 (igtl-excessive-registration-error): Pivot calibration or fiducial registration RMS error exceeds threshold (> 2.0 mm).
 * - M9806 (igtl-invalid-acquisition-rate): Tracker or ultrasound device AcquisitionRate is <= 0 Hz.
 * - M9807 (igtl-unresolved-device-or-channel): <Channel> or <PlusOpenIGTLinkServer> references an undeclared device or output channel ID.
 * - M9808 (igtl-self-transform-identity-mismatch): Transform with identical From and To frame is not the 4x4 identity matrix.
 * - M9809 (igtl-invalid-server-port): OpenIGTLink server ListeningPort is outside valid TCP port range [1024, 65535].
 * - M9810 (igtl-duplicate-transform-edge): Duplicate <Transform> defined for the same (From, To) coordinate frame pair.
 */

import {
  computeOrthogonalityError,
  computeRotationDeterminant,
  solveTransformChainAndPivot,
} from "../kinematics/index.js";
import { IDENTITY_4X4 } from "../parser/index.js";
import type { IgtlDiagnostic, IgtlDocument, Matrix4x4 } from "../types.js";

export const MAX_CLINICAL_REGISTRATION_ERROR_MM = 2.0;

export const IgtlErrorCode = {
  NON_ORTHOGONAL_ROTATION: {
    code: "M9801",
    rule: "igtl-non-orthogonal-rotation",
    severity: "error" as const,
    message: (from: string, to: string, frobErr: number, det: number) =>
      `Transform '${from} -> ${to}' has non-orthogonal or reflection 3x3 rotation block (||R^T R - I||_F = ${frobErr}, det(R) = ${det}).`,
  },
  INVALID_HOMOGENEOUS_BOTTOM_ROW: {
    code: "M9802",
    rule: "igtl-invalid-homogeneous-bottom-row",
    severity: "error" as const,
    message: (from: string, to: string, rowStr: string) =>
      `Transform '${from} -> ${to}' has invalid 4x4 homogeneous bottom row '[${rowStr}]' (expected '[0, 0, 0, 1]').`,
  },
  DISCONNECTED_COORDINATE_FRAME: {
    code: "M9803",
    rule: "igtl-disconnected-coordinate-frame",
    severity: "error" as const,
    message: (detail: string) => `Coordinate frame graph is disconnected: ${detail}.`,
  },
  CYCLIC_TRANSFORM_CHAIN: {
    code: "M9804",
    rule: "igtl-cyclic-transform-chain",
    severity: "error" as const,
    message: (cycleStr: string) => `Directed cycle detected in coordinate transform definitions: '${cycleStr}'.`,
  },
  EXCESSIVE_REGISTRATION_ERROR: {
    code: "M9805",
    rule: "igtl-excessive-registration-error",
    severity: "warning" as const,
    message: (contextName: string, errorMm: number, thresholdMm: number) =>
      `Registration or calibration RMS error '${errorMm} mm' on '${contextName}' exceeds clinical safety threshold '${thresholdMm} mm'.`,
  },
  INVALID_ACQUISITION_RATE: {
    code: "M9806",
    rule: "igtl-invalid-acquisition-rate",
    severity: "error" as const,
    message: (deviceId: string, rateHz: number) =>
      `Device '${deviceId}' has invalid AcquisitionRate '${rateHz} Hz' (must be > 0 Hz).`,
  },
  UNRESOLVED_DEVICE_OR_CHANNEL: {
    code: "M9807",
    rule: "igtl-unresolved-device-or-channel",
    severity: "error" as const,
    message: (contextName: string, refKind: string, refId: string) =>
      `'${contextName}' references undeclared ${refKind} '${refId}'.`,
  },
  SELF_TRANSFORM_IDENTITY_MISMATCH: {
    code: "M9808",
    rule: "igtl-self-transform-identity-mismatch",
    severity: "error" as const,
    message: (frameName: string) => `Self-transform '${frameName} -> ${frameName}' must be the 4x4 identity matrix.`,
  },
  INVALID_SERVER_PORT: {
    code: "M9809",
    rule: "igtl-invalid-server-port",
    severity: "error" as const,
    message: (serverId: string, port: number) =>
      `OpenIGTLink server '${serverId}' ListeningPort '${port}' is outside valid TCP port range [1024, 65535].`,
  },
  DUPLICATE_TRANSFORM_EDGE: {
    code: "M9810",
    rule: "igtl-duplicate-transform-edge",
    severity: "error" as const,
    message: (from: string, to: string) =>
      `Duplicate '<Transform>' defined for coordinate frame pair '(${from}, ${to})'.`,
  },
};

function isIdentityMatrix4x4(T: Matrix4x4): boolean {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(T[i]! - IDENTITY_4X4[i]!) > 1e-6) return false;
  }
  return true;
}

export function lintIgtlDocument(doc: IgtlDocument): IgtlDiagnostic[] {
  const diagnostics: IgtlDiagnostic[] = [];

  // 1. Transform checks: M9801, M9802, M9805, M9808, M9810
  const seenEdges = new Set<string>();
  const directedAdj = new Map<string, string[]>();
  const undirectedAdj = new Map<string, Set<string>>();
  const allFrames = new Set<string>();

  for (const tf of doc.transforms) {
    const edgeKey = `${tf.from}->${tf.to}`;
    if (seenEdges.has(edgeKey)) {
      diagnostics.push({
        code: IgtlErrorCode.DUPLICATE_TRANSFORM_EDGE.code,
        rule: IgtlErrorCode.DUPLICATE_TRANSFORM_EDGE.rule,
        severity: IgtlErrorCode.DUPLICATE_TRANSFORM_EDGE.severity,
        message: IgtlErrorCode.DUPLICATE_TRANSFORM_EDGE.message(tf.from, tf.to),
        range: tf.range,
      });
    } else {
      seenEdges.add(edgeKey);
    }

    // M9808: Self-transform identity check
    if (tf.from === tf.to) {
      if (!isIdentityMatrix4x4(tf.matrix)) {
        diagnostics.push({
          code: IgtlErrorCode.SELF_TRANSFORM_IDENTITY_MISMATCH.code,
          rule: IgtlErrorCode.SELF_TRANSFORM_IDENTITY_MISMATCH.rule,
          severity: IgtlErrorCode.SELF_TRANSFORM_IDENTITY_MISMATCH.severity,
          message: IgtlErrorCode.SELF_TRANSFORM_IDENTITY_MISMATCH.message(tf.from),
          range: tf.range,
        });
      }
    } else {
      allFrames.add(tf.from);
      allFrames.add(tf.to);

      const dList = directedAdj.get(tf.from) ?? [];
      dList.push(tf.to);
      directedAdj.set(tf.from, dList);

      const uFrom = undirectedAdj.get(tf.from) ?? new Set<string>();
      uFrom.add(tf.to);
      undirectedAdj.set(tf.from, uFrom);

      const uTo = undirectedAdj.get(tf.to) ?? new Set<string>();
      uTo.add(tf.from);
      undirectedAdj.set(tf.to, uTo);
    }

    // M9801: 3x3 rotation orthogonality and positive determinant
    const frobErr = Math.round(computeOrthogonalityError(tf.matrix) * 1e6) / 1e6;
    const det = Math.round(computeRotationDeterminant(tf.matrix) * 1e6) / 1e6;
    if (frobErr > 1e-3 || det <= 0) {
      diagnostics.push({
        code: IgtlErrorCode.NON_ORTHOGONAL_ROTATION.code,
        rule: IgtlErrorCode.NON_ORTHOGONAL_ROTATION.rule,
        severity: IgtlErrorCode.NON_ORTHOGONAL_ROTATION.severity,
        message: IgtlErrorCode.NON_ORTHOGONAL_ROTATION.message(tf.from, tf.to, frobErr, det),
        range: tf.range,
      });
    }

    // M9802: Homogeneous bottom row [0, 0, 0, 1]
    const b0 = tf.matrix[12]!,
      b1 = tf.matrix[13]!,
      b2 = tf.matrix[14]!,
      b3 = tf.matrix[15]!;
    if (Math.abs(b0) > 1e-6 || Math.abs(b1) > 1e-6 || Math.abs(b2) > 1e-6 || Math.abs(b3 - 1.0) > 1e-6) {
      diagnostics.push({
        code: IgtlErrorCode.INVALID_HOMOGENEOUS_BOTTOM_ROW.code,
        rule: IgtlErrorCode.INVALID_HOMOGENEOUS_BOTTOM_ROW.rule,
        severity: IgtlErrorCode.INVALID_HOMOGENEOUS_BOTTOM_ROW.severity,
        message: IgtlErrorCode.INVALID_HOMOGENEOUS_BOTTOM_ROW.message(tf.from, tf.to, `${b0}, ${b1}, ${b2}, ${b3}`),
        range: tf.range,
      });
    }

    // M9805: Excessive registration/calibration error (> 2.0 mm)
    if (tf.errorMm !== undefined && tf.errorMm > MAX_CLINICAL_REGISTRATION_ERROR_MM) {
      diagnostics.push({
        code: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.code,
        rule: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.rule,
        severity: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.severity,
        message: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.message(
          `${tf.from} -> ${tf.to}`,
          tf.errorMm,
          MAX_CLINICAL_REGISTRATION_ERROR_MM,
        ),
        range: tf.range,
      });
    }
  }

  // Also check fiducialConfig FRE/TRE and pivotCalibration RMS error for M9805
  if (doc.fiducialConfig) {
    if (doc.fiducialConfig.freMm !== undefined && doc.fiducialConfig.freMm > MAX_CLINICAL_REGISTRATION_ERROR_MM) {
      diagnostics.push({
        code: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.code,
        rule: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.rule,
        severity: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.severity,
        message: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.message(
          "FiducialRegistration (FRE)",
          doc.fiducialConfig.freMm,
          MAX_CLINICAL_REGISTRATION_ERROR_MM,
        ),
        range: doc.fiducialConfig.range,
      });
    }
    if (doc.fiducialConfig.treMm !== undefined && doc.fiducialConfig.treMm > MAX_CLINICAL_REGISTRATION_ERROR_MM) {
      diagnostics.push({
        code: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.code,
        rule: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.rule,
        severity: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.severity,
        message: IgtlErrorCode.EXCESSIVE_REGISTRATION_ERROR.message(
          "FiducialRegistration (TRE)",
          doc.fiducialConfig.treMm,
          MAX_CLINICAL_REGISTRATION_ERROR_MM,
        ),
        range: doc.fiducialConfig.range,
      });
    }
  }

  // 2. M9804: Directed cycle detection in CoordinateDefinitions
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const findCycle = (node: string, path: string[]): string[] | null => {
    visited.add(node);
    onStack.add(node);
    for (const next of directedAdj.get(node) ?? []) {
      if (!visited.has(next)) {
        const cyc = findCycle(next, [...path, next]);
        if (cyc) return cyc;
      } else if (onStack.has(next)) {
        const idx = path.indexOf(next);
        return idx >= 0 ? [...path.slice(idx), next] : [...path, next];
      }
    }
    onStack.delete(node);
    return null;
  };

  for (const frame of allFrames) {
    if (!visited.has(frame)) {
      const cycle = findCycle(frame, [frame]);
      if (cycle) {
        diagnostics.push({
          code: IgtlErrorCode.CYCLIC_TRANSFORM_CHAIN.code,
          rule: IgtlErrorCode.CYCLIC_TRANSFORM_CHAIN.rule,
          severity: IgtlErrorCode.CYCLIC_TRANSFORM_CHAIN.severity,
          message: IgtlErrorCode.CYCLIC_TRANSFORM_CHAIN.message(cycle.join(" -> ")),
          range: doc.transforms[0]?.range ?? doc.range,
        });
        break;
      }
    }
  }

  // 3. M9803: Disconnected coordinate frame graph or unreachable server TransformNames
  if (allFrames.size > 0) {
    const startFrame = Array.from(allFrames)[0]!;
    const compVisited = new Set<string>([startFrame]);
    const queue = [startFrame];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of undirectedAdj.get(cur) ?? []) {
        if (!compVisited.has(nb)) {
          compVisited.add(nb);
          queue.push(nb);
        }
      }
    }

    if (compVisited.size < allFrames.size) {
      const unreachable = Array.from(allFrames).filter((f) => !compVisited.has(f));
      diagnostics.push({
        code: IgtlErrorCode.DISCONNECTED_COORDINATE_FRAME.code,
        rule: IgtlErrorCode.DISCONNECTED_COORDINATE_FRAME.rule,
        severity: IgtlErrorCode.DISCONNECTED_COORDINATE_FRAME.severity,
        message: IgtlErrorCode.DISCONNECTED_COORDINATE_FRAME.message(
          `frames [${unreachable.join(", ")}] are disconnected from '${startFrame}'`,
        ),
        range: doc.transforms[doc.transforms.length - 1]?.range ?? doc.range,
      });
    }
  }

  for (const srv of doc.servers) {
    for (const tn of srv.transformNames) {
      const res = solveTransformChainAndPivot(doc, { fromFrame: tn.from, toFrame: tn.to });
      if (!res.isConnected) {
        diagnostics.push({
          code: IgtlErrorCode.DISCONNECTED_COORDINATE_FRAME.code,
          rule: IgtlErrorCode.DISCONNECTED_COORDINATE_FRAME.rule,
          severity: IgtlErrorCode.DISCONNECTED_COORDINATE_FRAME.severity,
          message: IgtlErrorCode.DISCONNECTED_COORDINATE_FRAME.message(
            `no transform path from '${tn.from}' to '${tn.to}' for '${tn.rawName}'`,
          ),
          range: srv.range,
        });
      }
    }
  }

  // 4. Device & Channel checks: M9806 (invalid AcquisitionRate <= 0), M9807 (unresolved channel/device)
  const declaredDevices = new Set<string>();
  const declaredOutputChannels = new Set<string>();
  for (const dev of doc.devices) {
    declaredDevices.add(dev.id);
    for (const oc of dev.outputChannelIds) {
      declaredOutputChannels.add(oc);
    }
    if (dev.acquisitionRate !== undefined && dev.acquisitionRate <= 0) {
      diagnostics.push({
        code: IgtlErrorCode.INVALID_ACQUISITION_RATE.code,
        rule: IgtlErrorCode.INVALID_ACQUISITION_RATE.rule,
        severity: IgtlErrorCode.INVALID_ACQUISITION_RATE.severity,
        message: IgtlErrorCode.INVALID_ACQUISITION_RATE.message(dev.id, dev.acquisitionRate),
        range: dev.range,
      });
    }
  }

  for (const dev of doc.devices) {
    for (const ic of dev.inputChannelIds) {
      if (!declaredOutputChannels.has(ic)) {
        diagnostics.push({
          code: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.code,
          rule: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.rule,
          severity: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.severity,
          message: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.message(dev.id, "InputChannel", ic),
          range: dev.range,
        });
      }
    }
  }

  // 5. Server checks: M9807 (unresolved OutputChannelId / DeviceId), M9809 (invalid ListeningPort)
  for (const srv of doc.servers) {
    if (srv.listeningPort < 1024 || srv.listeningPort > 65535 || !Number.isInteger(srv.listeningPort)) {
      diagnostics.push({
        code: IgtlErrorCode.INVALID_SERVER_PORT.code,
        rule: IgtlErrorCode.INVALID_SERVER_PORT.rule,
        severity: IgtlErrorCode.INVALID_SERVER_PORT.severity,
        message: IgtlErrorCode.INVALID_SERVER_PORT.message(srv.id, srv.listeningPort),
        range: srv.range,
      });
    }

    if (srv.outputChannelId && !declaredOutputChannels.has(srv.outputChannelId)) {
      diagnostics.push({
        code: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.code,
        rule: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.rule,
        severity: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.severity,
        message: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.message(srv.id, "OutputChannelId", srv.outputChannelId),
        range: srv.range,
      });
    }

    if (srv.deviceId && !declaredDevices.has(srv.deviceId)) {
      diagnostics.push({
        code: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.code,
        rule: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.rule,
        severity: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.severity,
        message: IgtlErrorCode.UNRESOLVED_DEVICE_OR_CHANNEL.message(srv.id, "DeviceId", srv.deviceId),
        range: srv.range,
      });
    }
  }

  return diagnostics;
}
