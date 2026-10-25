// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SimaDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  target?: string;
}

export const SimaErrorCode = {
  NEGATIVE_METACENTRIC_HEIGHT: {
    code: 7001,
    id: "M7001",
    rule: "negative-metacentric-height",
    severity: "error" as const,
    message: (vessel: string, gmType: string, val: number) =>
      `Hydrostatic instability on vessel '${vessel}': negative ${gmType} metacentric height (GM = ${val.toFixed(2)} m < 0).`,
  },
  LINE_LENGTH_UNDERFLOW: {
    code: 7002,
    id: "M7002",
    rule: "line-length-underflow",
    severity: "error" as const,
    message: (line: string, len: number, depth: number) =>
      `Mooring line '${line}' total length (${len.toFixed(1)} m) is less than water depth (${depth.toFixed(1)} m), causing immediate vertical anchor snap load.`,
  },
  ACOUSTIC_COURANT_VIOLATION: {
    code: 7003,
    id: "M7003",
    rule: "acoustic-courant-violation",
    severity: "error" as const,
    message: (seg: string, dt: number, criticalDt: number) =>
      `Time step dt=${dt.toFixed(4)}s exceeds Courant axial acoustic wave limit (${criticalDt.toFixed(4)}s) for segment '${seg}'.`,
  },
  UNCONNECTED_ATTACHMENT_NODE: {
    code: 7004,
    id: "M7004",
    rule: "unconnected-attachment-node",
    severity: "error" as const,
    message: (line: string, fairleadId: string) =>
      `Mooring line '${line}' references unresolved fairlead attachment '${fairleadId}' not found on any vessel.`,
  },
  RAO_FREQUENCY_EXTRAPOLATION: {
    code: 7005,
    id: "M7005",
    rule: "rao-frequency-extrapolation",
    severity: "warning" as const,
    message: (omega: number, minOmega: number, maxOmega: number) =>
      `Environmental wave peak frequency (${omega.toFixed(3)} rad/s) is outside hydrodynamic RAO table range [${minOmega.toFixed(3)}, ${maxOmega.toFixed(3)}] rad/s.`,
  },
  INVALID_STIFFNESS_HIERARCHY: {
    code: 7006,
    id: "M7006",
    rule: "invalid-stiffness-hierarchy",
    severity: "error" as const,
    message: (seg: string, prop: string, val: number) =>
      `Non-physical cross-sectional stiffness on segment '${seg}': ${prop} (${val}) must be strictly positive.`,
  },
  UNPHYSICAL_SEABED_FRICTION: {
    code: 7007,
    id: "M7007",
    rule: "unphysical-seabed-friction",
    severity: "warning" as const,
    message: (val: number) =>
      `Unrealistic seabed friction coefficient (μ = ${val.toFixed(2)}): expected value between 0.0 and 2.0.`,
  },
  MISSING_HYDROSTATIC_MATRIX: {
    code: 7008,
    id: "M7008",
    rule: "missing-hydrostatic-matrix",
    severity: "error" as const,
    message: (vessel: string) =>
      `Vessel '${vessel}' has zero or missing hydrostatic restoring matrix C; floating body cannot equilibrate in heave/roll/pitch.`,
  },
  DUPLICATE_LINE_IDENTIFIER: {
    code: 7009,
    id: "M7009",
    rule: "duplicate-line-identifier",
    severity: "error" as const,
    message: (id: string) => `Duplicate line identifier '${id}' declared in the slender system.`,
  },
  SLACK_COMPRESSION_HAZARD: {
    code: 7010,
    id: "M7010",
    rule: "slack-compression-hazard",
    severity: "warning" as const,
    message: (line: string) =>
      `Mooring line '${line}' has negligible pre-tension under severe sea state (Hs > 8m), risking compression slack-snap loading.`,
  },
  MORISON_DRAG_UNSPECIFIED: {
    code: 7011,
    id: "M7011",
    rule: "morison-drag-unspecified",
    severity: "warning" as const,
    message: (seg: string) =>
      `Segment '${seg}' in wave zone has zero Morison drag coefficient (Cd = 0); hydrodynamic damping will be neglected.`,
  },
  ANCHOR_UPLIFT_WARNING: {
    code: 7012,
    id: "M7012",
    rule: "anchor-uplift-warning",
    severity: "warning" as const,
    message: (line: string, angleDeg: number) =>
      `Catenary line '${line}' exhibits vertical uplift angle (${angleDeg.toFixed(1)}°) at anchor; drag-embedment anchors will pull out.`,
  },
  MASS_MATRIX_ASYMMETRIC: {
    code: 7013,
    id: "M7013",
    rule: "mass-matrix-asymmetric",
    severity: "error" as const,
    message: (vessel: string, r: number, c: number) =>
      `Vessel '${vessel}' structural mass matrix is asymmetric at index (${r}, ${c}).`,
  },
  QTF_SYMMETRY_VIOLATION: {
    code: 7014,
    id: "M7014",
    rule: "qtf-symmetry-violation",
    severity: "warning" as const,
    message: (vessel: string) => `Vessel '${vessel}' 2nd-order drift force QTF matrix violates conjugate symmetry.`,
  },
  EXCEEDS_MINIMUM_BEND_RADIUS: {
    code: 7015,
    id: "M7015",
    rule: "exceeds-minimum-bend-radius",
    severity: "error" as const,
    message: (line: string, curvatureRadius: number, mbr: number) =>
      `Line '${line}' minimum radius of curvature (${curvatureRadius.toFixed(2)} m) is below allowable MBR (${mbr.toFixed(2)} m).`,
  },
};
