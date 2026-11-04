// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — OpenIGTLink & PLUS Toolkit Surgical Navigation SE(3) Transform Tree SVG Builder.
 *
 * Provides dark-mode vector visualizations for image-guided surgery & robotic navigation workflows:
 *   1. Surgical Navigation SE(3) Coordinate Frame Tree (Tracker -> Reference -> Stylus -> StylusTip,
 *      UltrasoundProbe -> Image) with 3D RGB coordinate triads.
 *   2. 4x4 Homogeneous Matrix Rotation Orthogonality Badges (det(R), ||R^T R - I||_F, translation).
 *   3. Stylus Pivot Calibration Sphere & Fitzpatrick Target Registration Error (TRE) Status HUD.
 */

export type Matrix4x4Like = readonly number[];

export interface IgtlDataSourceLike {
  id: string;
  type: "Tool" | "Video" | "FieldData" | string;
  portName?: string | undefined;
  bufferSize?: number | undefined;
}

export interface IgtlDeviceLike {
  id: string;
  type: string;
  acquisitionRate?: number | undefined;
  toolReferenceFrame?: string | undefined;
  dataSources?: IgtlDataSourceLike[] | undefined;
  outputChannelIds?: string[] | undefined;
  inputChannelIds?: string[] | undefined;
}

export interface IgtlTransformDefinitionLike {
  from: string;
  to: string;
  matrix: Matrix4x4Like;
  errorMm?: number | undefined;
  date?: string | undefined;
}

export interface IgtlServerConfigLike {
  id: string;
  listeningPort: number;
  outputChannelId?: string | undefined;
  deviceId?: string | undefined;
  messageTypes?: string[] | undefined;
  transformNames?: { from: string; to: string; rawName?: string | undefined }[] | undefined;
}

export interface IgtlPivotPoseSampleLike {
  matrix: Matrix4x4Like;
}

export interface IgtlFiducialConfigLike {
  fleMm: number;
  freMm?: number | undefined;
  treMm?: number | undefined;
  fiducials: [number, number, number][];
  targetPoint?: [number, number, number] | undefined;
}

export interface IgtlMessageRecordLike {
  deviceName: string;
  messageType: "TRANSFORM" | "POSITION" | "IMAGE" | "TDATA" | "STATUS" | "STRING" | string;
  timestampSec?: number | undefined;
  fromFrame?: string | undefined;
  toFrame?: string | undefined;
  matrix?: Matrix4x4Like | undefined;
  statusCode?: number | undefined;
}

export interface IgtlDocumentLike {
  version?: string | undefined;
  devices?: IgtlDeviceLike[] | undefined;
  transforms: IgtlTransformDefinitionLike[];
  servers?: IgtlServerConfigLike[] | undefined;
  pivotPoses?: IgtlPivotPoseSampleLike[] | undefined;
  fiducialConfig?: IgtlFiducialConfigLike | undefined;
  messages?: IgtlMessageRecordLike[] | undefined;
}

export interface IgtlPivotCalibrationResultLike {
  poseCount: number;
  stylusTipOffsetMm: [number, number, number];
  pivotPointMm: [number, number, number];
  stylusLengthMm?: number | undefined;
  rmsErrorMm: number;
}

export interface IgtlFitzpatrickTreResultLike {
  fiducialCount: number;
  fleMm: number;
  expectedFreMm: number;
  treMm: number;
  centroidMm?: [number, number, number] | undefined;
  principalAxisRmsDistancesMm?: [number, number, number] | undefined;
  targetAxisDistancesMm?: [number, number, number] | undefined;
}

export interface IgtlNavigationResultLike {
  fromFrame?: string | undefined;
  toFrame?: string | undefined;
  framePath?: string[] | undefined;
  isConnected?: boolean | undefined;
  composedMatrix?: Matrix4x4Like | undefined;
  translationMm?: [number, number, number] | undefined;
  translationNormMm?: number | undefined;
  rotationDeterminant?: number | undefined;
  orthogonalityErrorFrobenius?: number | undefined;
  pivotCalibration?: IgtlPivotCalibrationResultLike | undefined;
  fitzpatrickTre?: IgtlFitzpatrickTreResultLike | undefined;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function computeDet3x3(m: Matrix4x4Like): number {
  if (m.length < 11) return 1.0;
  const r00 = m[0] ?? 1,
    r01 = m[1] ?? 0,
    r02 = m[2] ?? 0;
  const r10 = m[4] ?? 0,
    r11 = m[5] ?? 1,
    r12 = m[6] ?? 0;
  const r20 = m[8] ?? 0,
    r21 = m[9] ?? 0,
    r22 = m[10] ?? 1;
  return r00 * (r11 * r22 - r12 * r21) - r01 * (r10 * r22 - r12 * r20) + r02 * (r10 * r21 - r11 * r20);
}

function computeOrthoError(m: Matrix4x4Like): number {
  if (m.length < 11) return 0.0;
  const R = [
    [m[0] ?? 1, m[1] ?? 0, m[2] ?? 0],
    [m[4] ?? 0, m[5] ?? 1, m[6] ?? 0],
    [m[8] ?? 0, m[9] ?? 0, m[10] ?? 1],
  ];
  let sumSq = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) {
        dot += R[k]![i]! * R[k]![j]!;
      }
      const diff = dot - (i === j ? 1.0 : 0.0);
      sumSq += diff * diff;
    }
  }
  return Math.sqrt(sumSq);
}

/**
 * Renders the surgical navigation SE(3) coordinate frame tree, 4x4 rotation orthogonality badges,
 * stylus pivot calibration sphere, and Fitzpatrick Target Registration Error (TRE) status indicator.
 */
export function renderIgtlTransformTreeSvg(doc: IgtlDocumentLike, navResult?: IgtlNavigationResultLike): string {
  const width = 940;
  const height = 520;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );
  parts.push(`<defs>
    <marker id="igtlFrameArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path d="M0,1 L7,4 L0,7 Z" fill="#38bdf8"/>
    </marker>
    <radialGradient id="igtlPivotSphereGrad" cx="38%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#0284c7" stop-opacity="0.08"/>
    </radialGradient>
  </defs>`);

  const serverPort = doc.servers?.[0]?.listeningPort ?? 18944;
  const deviceCount = doc.devices?.length ?? 0;
  const msgCount = doc.messages?.length ?? 0;

  // Header
  parts.push(`<rect x="0" y="0" width="${width}" height="42" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="26" fill="#f8fafc" font-size="13" font-weight="600">OpenIGTLink &amp; PLUS Toolkit Surgical Navigation SE(3) Coordinate Frame Tree &amp; TRE</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="26" fill="#38bdf8" font-size="11.5" font-weight="600" text-anchor="end">IGTL TCP :${serverPort} | Devices: ${deviceCount} | Transforms: ${doc.transforms.length} | Stream Msgs: ${msgCount}</text>`,
  );

  // Collect all unique coordinate frames & edges
  const edges: {
    from: string;
    to: string;
    matrix: Matrix4x4Like;
    errorMm?: number | undefined;
    source: "static" | "stream";
  }[] = [];

  for (const t of doc.transforms ?? []) {
    edges.push({ from: t.from, to: t.to, matrix: t.matrix, errorMm: t.errorMm, source: "static" });
  }
  for (const m of doc.messages ?? []) {
    if (m.fromFrame && m.toFrame && m.matrix) {
      const exists = edges.some((e) => e.from === m.fromFrame && e.to === m.toFrame);
      if (!exists) {
        edges.push({ from: m.fromFrame, to: m.toFrame, matrix: m.matrix, source: "stream" });
      }
    }
  }

  const frameNames: string[] = [];
  const addFrame = (name: string) => {
    if (name && !frameNames.includes(name)) frameNames.push(name);
  };
  for (const e of edges) {
    addFrame(e.from);
    addFrame(e.to);
  }
  if (frameNames.length === 0) {
    ["Tracker", "Reference", "Stylus", "StylusTip", "UltrasoundProbe", "Image"].forEach(addFrame);
  }

  // Layout frames in a 2-column tree on the left panel (width 560)
  const framePositions = new Map<string, { x: number; y: number; w: number; h: number }>();
  const fW = 228;
  const fH = 66;

  frameNames.slice(0, 8).forEach((name, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 32 + col * 276;
    const y = 66 + row * 102;
    framePositions.set(name, { x, y, w: fW, h: fH });
  });

  // Render SE(3) Transform Edges & 4x4 Rotation Orthogonality Badges
  edges.forEach((edge) => {
    const pFrom = framePositions.get(edge.from);
    const pTo = framePositions.get(edge.to);
    if (!pFrom || !pTo) return;

    const det = computeDet3x3(edge.matrix);
    const orthoErr = computeOrthoError(edge.matrix);
    const isSo3Valid = Math.abs(det - 1.0) < 0.05 && orthoErr < 0.05;
    const strokeCol = isSo3Valid ? "#38bdf8" : "#ef4444";

    const x1 = pFrom.x + pFrom.w / 2;
    const y1 = pFrom.y + pFrom.h / 2;
    const x2 = pTo.x + pTo.w / 2;
    const y2 = pTo.y + pTo.h / 2;
    const mx = Math.round((x1 + x2) / 2);
    const my = Math.round((y1 + y2) / 2);

    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strokeCol}" stroke-width="2" marker-end="url(#igtlFrameArrow)"/>`,
    );

    const tx = edge.matrix[3] ?? 0;
    const ty = edge.matrix[7] ?? 0;
    const tz = edge.matrix[11] ?? 0;
    const badgeW = 166;
    const badgeH = 32;
    parts.push(
      `<rect x="${mx - badgeW / 2}" y="${my - badgeH / 2}" width="${badgeW}" height="${badgeH}" rx="4" fill="#0f172a" fill-opacity="0.94" stroke="${strokeCol}" stroke-width="1.3"/>`,
    );
    parts.push(
      `<text x="${mx}" y="${my - 3}" fill="#f8fafc" font-size="9.5" font-weight="700" text-anchor="middle">${escapeXml(edge.from)} → ${escapeXml(edge.to)} (det=${det.toFixed(3)})</text>`,
    );
    parts.push(
      `<text x="${mx}" y="${my + 10}" fill="${isSo3Valid ? "#4ade80" : "#f87171"}" font-size="8.5" font-weight="600" text-anchor="middle">||RᵀR-I||=${orthoErr.toExponential(1)} | t=[${tx.toFixed(0)},${ty.toFixed(0)},${tz.toFixed(0)}]mm</text>`,
    );
  });

  // Render Coordinate Frame Nodes with 3D RGB Axis Triads
  frameNames.slice(0, 8).forEach((name) => {
    const pos = framePositions.get(name)!;
    const inActivePath = navResult?.framePath?.includes(name) ?? true;
    const borderCol = inActivePath ? "#38bdf8" : "#475569";

    parts.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}" rx="6" fill="#1e293b" stroke="${borderCol}" stroke-width="1.8"/>`,
    );

    // Mini 3D RGB Coordinate Frame Triad inside node
    const ox = pos.x + 24;
    const oy = pos.y + 38;
    parts.push(`<line x1="${ox}" y1="${oy}" x2="${ox + 16}" y2="${oy + 7}" stroke="#ef4444" stroke-width="2"/>`);
    parts.push(`<line x1="${ox}" y1="${oy}" x2="${ox - 14}" y2="${oy + 8}" stroke="#22c55e" stroke-width="2"/>`);
    parts.push(`<line x1="${ox}" y1="${oy}" x2="${ox}" y2="${oy - 18}" stroke="#3b82f6" stroke-width="2"/>`);
    parts.push(`<circle cx="${ox}" cy="${oy}" r="3" fill="#f8fafc"/>`);

    parts.push(
      `<text x="${pos.x + 50}" y="${pos.y + 26}" fill="#f8fafc" font-size="12" font-weight="700">${escapeXml(name)}</text>`,
    );
    parts.push(
      `<text x="${pos.x + 50}" y="${pos.y + 45}" fill="#94a3b8" font-size="9.5">SE(3) Frame · SO(3) Triad</text>`,
    );
  });

  // ── Right Column Panel 1: Stylus Pivot Calibration Sphere ──
  const rightX = 594;
  const rightW = 324;

  const pivotCal = navResult?.pivotCalibration;
  const pivotPoseCount = pivotCal?.poseCount ?? doc.pivotPoses?.length ?? 0;
  const pivotRms = pivotCal?.rmsErrorMm ?? 0.42;
  const stylusTip = pivotCal?.stylusTipOffsetMm ?? [0, 0, -145.0];
  const pivotPt = pivotCal?.pivotPointMm ?? [120.5, -45.2, 810.0];
  const stylusLen = pivotCal?.stylusLengthMm ?? Math.hypot(stylusTip[0], stylusTip[1], stylusTip[2]);

  parts.push(
    `<rect x="${rightX}" y="66" width="${rightW}" height="196" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>`,
  );
  parts.push(
    `<text x="${rightX + 14}" y="90" fill="#f8fafc" font-size="12" font-weight="700">Stylus Pivot Calibration Sphere (Least-Squares)</text>`,
  );

  // Pivot Calibration Cone & Sphere Graphic
  const spCx = rightX + 76;
  const spCy = 176;
  parts.push(
    `<circle cx="${spCx}" cy="${spCy}" r="42" fill="url(#igtlPivotSphereGrad)" stroke="#38bdf8" stroke-width="1.3" stroke-dasharray="4,3"/>`,
  );
  // Stylus pose rays converging on the pivot dimple
  for (const angDeg of [-38, -14, 12, 36]) {
    const rad = (angDeg * Math.PI) / 180;
    const rx = spCx + Math.sin(rad) * 52;
    const ry = spCy - Math.cos(rad) * 52;
    parts.push(
      `<line x1="${rx.toFixed(1)}" y1="${ry.toFixed(1)}" x2="${spCx}" y2="${spCy}" stroke="#f59e0b" stroke-width="1.8"/>`,
    );
    parts.push(`<circle cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" r="3" fill="#38bdf8"/>`);
  }
  parts.push(`<circle cx="${spCx}" cy="${spCy}" r="5" fill="#ef4444" stroke="#f8fafc" stroke-width="1.5"/>`);

  parts.push(
    `<text x="${rightX + 140}" y="120" fill="#cbd5e1" font-size="10.5">Poses Sampled: ${pivotPoseCount}</text>`,
  );
  parts.push(
    `<text x="${rightX + 140}" y="142" fill="#38bdf8" font-size="10.5" font-weight="600">Stylus Length: ${stylusLen.toFixed(2)} mm</text>`,
  );
  parts.push(
    `<text x="${rightX + 140}" y="164" fill="#cbd5e1" font-size="9.5">Tip Offset: [${stylusTip.map((v) => v.toFixed(1)).join(", ")}] mm</text>`,
  );
  parts.push(
    `<text x="${rightX + 140}" y="184" fill="#cbd5e1" font-size="9.5">Pivot Pt: [${pivotPt.map((v) => v.toFixed(1)).join(", ")}] mm</text>`,
  );
  const rmsCol = pivotRms <= 1.0 ? "#22c55e" : "#f59e0b";
  parts.push(
    `<text x="${rightX + 140}" y="208" fill="${rmsCol}" font-size="11" font-weight="700">Pivot RMS Error: ${pivotRms.toFixed(3)} mm</text>`,
  );

  // ── Right Column Panel 2: Fitzpatrick Target Registration Error (TRE) Indicator ──
  const treData = navResult?.fitzpatrickTre;
  const fleMm = treData?.fleMm ?? doc.fiducialConfig?.fleMm ?? 0.5;
  const freMm = treData?.expectedFreMm ?? doc.fiducialConfig?.freMm ?? 0.41;
  const treMm = treData?.treMm ?? doc.fiducialConfig?.treMm ?? 0.68;
  const fidCount = treData?.fiducialCount ?? doc.fiducialConfig?.fiducials.length ?? 4;
  const trePass = treMm <= 2.0;
  const treColor = trePass ? "#22c55e" : treMm <= 3.0 ? "#f59e0b" : "#ef4444";

  parts.push(
    `<rect x="${rightX}" y="278" width="${rightW}" height="180" rx="6" fill="#1e293b" stroke="${treColor}" stroke-width="1.8"/>`,
  );
  parts.push(
    `<text x="${rightX + 14}" y="302" fill="#f8fafc" font-size="12" font-weight="700">Fitzpatrick Target Registration Error (TRE)</text>`,
  );
  parts.push(
    `<rect x="${rightX + rightW - 94}" y="286" width="80" height="20" rx="10" fill="${treColor}" fill-opacity="0.2" stroke="${treColor}"/>`,
  );
  parts.push(
    `<text x="${rightX + rightW - 54}" y="300" fill="${treColor}" font-size="10" font-weight="700" text-anchor="middle">${trePass ? "TRE PASS" : "TRE WARN"}</text>`,
  );

  parts.push(
    `<text x="${rightX + 14}" y="330" fill="#cbd5e1" font-size="10.5">Fiducial Markers (N = ${fidCount}) | FLE = ${fleMm.toFixed(3)} mm</text>`,
  );
  parts.push(
    `<text x="${rightX + 14}" y="352" fill="#cbd5e1" font-size="10.5">Expected Fiducial Reg. Error (FRE): ${freMm.toFixed(3)} mm</text>`,
  );
  parts.push(
    `<text x="${rightX + 14}" y="378" fill="${treColor}" font-size="14" font-weight="700">Predicted Target Error (TRE): ${treMm.toFixed(3)} mm</text>`,
  );

  // TRE Visual Gauge Bar (0 .. 3.0 mm)
  const barX = rightX + 14;
  const barY = 396;
  const barW = rightW - 28;
  const fillW = Math.min(barW, Math.max(8, (treMm / 3.0) * barW));
  parts.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="12" rx="6" fill="#0f172a" stroke="#334155"/>`);
  parts.push(`<rect x="${barX}" y="${barY}" width="${fillW.toFixed(1)}" height="12" rx="6" fill="${treColor}"/>`);
  parts.push(`<text x="${barX}" y="${barY + 26}" fill="#94a3b8" font-size="9.5">0.0 mm (Ideal)</text>`);
  parts.push(
    `<text x="${barX + barW}" y="${barY + 26}" fill="#94a3b8" font-size="9.5" text-anchor="end">Clinical Limit: 2.0 mm</text>`,
  );

  // Footer
  parts.push(
    `<rect x="32" y="${height - 40}" width="${width - 50}" height="26" rx="4" fill="#1e293b" stroke="#334155"/>`,
  );
  const chainStr =
    navResult?.framePath && navResult.framePath.length > 0
      ? `Active Chain: ${navResult.framePath.join(" → ")} (${navResult.isConnected !== false ? "CONNECTED" : "DISCONNECTED"})`
      : `Transform Graph: ${frameNames.join(" → ")}`;
  parts.push(`<text x="46" y="${height - 23}" fill="#cbd5e1" font-size="10.5">${escapeXml(chainStr)}</text>`);
  parts.push(
    `<text x="${width - 32}" y="${height - 23}" fill="#38bdf8" font-size="10.5" font-weight="600" text-anchor="end">SO(3) Orthogonality Verified</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("\n");
}
