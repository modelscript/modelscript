// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — OpenSim Musculoskeletal Kinematic Tree & Hill-Type Force-Length SVG Diagram Builder.
 *
 * Provides interactive dark-mode vector visualizations for biomechanics & orthopedic workflows:
 *   1. Musculoskeletal Kinematic Topology (Ground -> Rigid Bodies with mass/inertia badges,
 *      Pin/Slider/Ball/Weld/Custom joints with coordinate ranges, wrapping surfaces, and
 *      Hill-type muscle-tendon routing chords colored by max isometric force F^M_0).
 *   2. Hill-Type Active/Passive Force-Length (f_L, f_PE) & Simulated Activation/Force Trajectories.
 */

export interface OpenSimBodyLike {
  id?: string | undefined;
  name: string;
  mass: number;
  massCenter?: [number, number, number] | undefined;
  inertia?: [number, number, number, number, number, number] | undefined;
}

export interface OpenSimCoordinateLike {
  id?: string | undefined;
  name: string;
  motionType?: "rotational" | "translational" | "coupled" | string | undefined;
  defaultValue?: number | undefined;
  rangeMin: number;
  rangeMax: number;
  clamped?: boolean | undefined;
  locked?: boolean | undefined;
}

export interface OpenSimJointLike {
  id?: string | undefined;
  name: string;
  jointType: "PinJoint" | "SliderJoint" | "BallJoint" | "WeldJoint" | "CustomJoint" | "FreeJoint" | string;
  parentFrame: string;
  childFrame: string;
  locationInParent?: [number, number, number] | undefined;
  orientationInParent?: [number, number, number] | undefined;
  coordinates: OpenSimCoordinateLike[];
}

export interface OpenSimPathPointLike {
  name: string;
  bodyFrame: string;
  location: [number, number, number];
}

export interface OpenSimWrapObjectLike {
  id?: string | undefined;
  name: string;
  wrapType: "WrapCylinder" | "WrapSphere" | "WrapEllipsoid" | string;
  bodyFrame: string;
  radius: number;
  length?: number | undefined;
}

export interface OpenSimMuscleLike {
  id?: string | undefined;
  name: string;
  muscleType?: "Thelen2003Muscle" | "Millard2012EquilibriumMuscle" | "Schutte1993Muscle" | string | undefined;
  maxIsometricForce: number;
  optimalFiberLength: number;
  tendonSlackLength: number;
  pennationAngleAtOptimal?: number | undefined;
  activationTimeConstant?: number | undefined;
  deactivationTimeConstant?: number | undefined;
  maxContractionVelocity?: number | undefined;
  pathPoints: OpenSimPathPointLike[];
  wrapObjects?: string[] | undefined;
}

export interface OpenSimMarkerLike {
  id?: string | undefined;
  name: string;
  bodyFrame: string;
  location: [number, number, number];
}

export interface OpenSimConstraintLike {
  id?: string | undefined;
  name: string;
  constraintType: string;
  body1: string;
  body2: string;
}

export interface OpenSimDocumentLike {
  modelName?: string | undefined;
  version?: string | undefined;
  gravity?: [number, number, number] | undefined;
  bodies: OpenSimBodyLike[];
  joints: OpenSimJointLike[];
  muscles: OpenSimMuscleLike[];
  markers?: OpenSimMarkerLike[] | undefined;
  wrapObjects?: OpenSimWrapObjectLike[] | undefined;
  constraints?: OpenSimConstraintLike[] | undefined;
}

export interface OpenSimCoordinateTrajectoryLike {
  q: number[];
  u?: number[] | undefined;
  qdd?: number[] | undefined;
}

export interface OpenSimMuscleTrajectoryLike {
  activation: number[];
  fiberLength?: number[] | undefined;
  tendonForce: number[];
  activeForce?: number[] | undefined;
  passiveForce?: number[] | undefined;
}

export interface OpenSimSimulationLike {
  time: number[];
  steps?: number | undefined;
  coordinates?: Record<string, OpenSimCoordinateTrajectoryLike> | undefined;
  muscles: Record<string, OpenSimMuscleTrajectoryLike>;
  finalState?:
    | {
        coordinates?: Record<string, { q: number; u: number }> | undefined;
        muscles?: Record<string, { activation: number; fiberLength: number; tendonForce: number }> | undefined;
      }
    | undefined;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function canonicalBodyFrame(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "ground" || trimmed === "/ground") return "ground";
  return trimmed
    .replace(/^\/?bodyset\//i, "")
    .replace(/_offset$/i, "")
    .replace(/^\//, "");
}

function muscleForceColor(fMax0: number): string {
  if (fMax0 >= 1200) return "#ef4444";
  if (fMax0 >= 700) return "#f97316";
  if (fMax0 >= 350) return "#f59e0b";
  return "#38bdf8";
}

function jointBadgeColor(jointType: string): string {
  switch (jointType) {
    case "PinJoint":
      return "#38bdf8";
    case "SliderJoint":
      return "#a855f7";
    case "BallJoint":
      return "#22c55e";
    case "WeldJoint":
      return "#94a3b8";
    case "CustomJoint":
      return "#f59e0b";
    default:
      return "#ec4899";
  }
}

function computeActiveForceLength(normFiberLength: number, gamma = 0.45): number {
  const diff = normFiberLength - 1.0;
  return Math.exp(-(diff * diff) / Math.max(1e-6, gamma));
}

function computePassiveForceLength(normFiberLength: number, kpe = 4.0, eps0 = 0.6): number {
  if (normFiberLength <= 1.0) return 0.0;
  const strain = Math.min(normFiberLength - 1.0, eps0 * 2.0);
  return (Math.exp((kpe * strain) / eps0) - 1.0) / (Math.exp(kpe) - 1.0);
}

/**
 * Renders the OpenSim musculoskeletal kinematic tree:
 *   - Rigid bodies with mass/inertia badges and attached wrapping surfaces
 *   - Pin/Slider/Ball/Weld/Custom joints with coordinate ranges
 *   - Hill-type muscle-tendon routing chords colored by max isometric force F^M_0
 */
export function renderOpenSimTopologySvg(doc: OpenSimDocumentLike): string {
  const width = 940;
  const bodies = doc.bodies ?? [];
  const joints = doc.joints ?? [];
  const muscles = doc.muscles ?? [];
  const wrapObjects = doc.wrapObjects ?? [];
  const markers = doc.markers ?? [];

  const rowCount = Math.max(2, bodies.length + 1);
  const height = Math.max(520, 120 + rowCount * 108);
  const parts: string[] = [];

  const totalMass = bodies.reduce((acc, b) => acc + (Number.isFinite(b.mass) ? b.mass : 0), 0);
  const totalDofs = joints.reduce((acc, j) => acc + (j.coordinates?.length ?? 0), 0);

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );
  parts.push(`<defs>
    <marker id="osimJointArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path d="M0,1 L7,4 L0,7 Z" fill="#38bdf8"/>
    </marker>
    <linearGradient id="osimBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>`);

  // Header Bar
  parts.push(`<rect x="0" y="0" width="${width}" height="42" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="26" fill="#f8fafc" font-size="13" font-weight="600">OpenSim Musculoskeletal Kinematic Tree &amp; Hill-Type Muscle-Tendon Routing</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="26" fill="#38bdf8" font-size="11.5" font-weight="600" text-anchor="end">Model: ${escapeXml(doc.modelName ?? "OpenSimModel")} | Mass: ${totalMass.toFixed(2)} kg | DOFs: ${totalDofs} | Muscles: ${muscles.length}</text>`,
  );

  // Map wrapping surfaces & markers by body frame
  const wrapsByBody = new Map<string, OpenSimWrapObjectLike[]>();
  for (const w of wrapObjects) {
    const bf = canonicalBodyFrame(w.bodyFrame);
    const list = wrapsByBody.get(bf) ?? [];
    list.push(w);
    wrapsByBody.set(bf, list);
  }

  const markersByBody = new Map<string, OpenSimMarkerLike[]>();
  for (const m of markers) {
    const bf = canonicalBodyFrame(m.bodyFrame);
    const list = markersByBody.get(bf) ?? [];
    list.push(m);
    markersByBody.set(bf, list);
  }

  // Position bodies vertically in kinematic chain order
  const bodyPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const bodyX = 64;
  const bodyW = 290;
  const bodyH = 78;

  // Ground Frame Node at top
  const groundY = 64;
  bodyPos.set("ground", { x: bodyX, y: groundY, w: bodyW, h: 56 });

  parts.push(
    `<rect x="${bodyX}" y="${groundY}" width="${bodyW}" height="56" rx="6" fill="#1e293b" stroke="#64748b" stroke-width="1.8" stroke-dasharray="5,3"/>`,
  );
  parts.push(
    `<text x="${bodyX + 14}" y="${groundY + 23}" fill="#f8fafc" font-size="12" font-weight="700">ground (Inertial Frame)</text>`,
  );
  const gVec = doc.gravity ?? [0, -9.80665, 0];
  parts.push(
    `<text x="${bodyX + 14}" y="${groundY + 42}" fill="#94a3b8" font-size="10">Gravity: [${gVec[0].toFixed(2)}, ${gVec[1].toFixed(2)}, ${gVec[2].toFixed(2)}] m/s²</text>`,
  );

  bodies.forEach((body, idx) => {
    const by = 148 + idx * 106;
    bodyPos.set(body.name, { x: bodyX, y: by, w: bodyW, h: bodyH });
    bodyPos.set(canonicalBodyFrame(body.name), { x: bodyX, y: by, w: bodyW, h: bodyH });
  });

  // Render Joints connecting Parent -> Child
  joints.forEach((joint, idx) => {
    const pName = canonicalBodyFrame(joint.parentFrame);
    const cName = canonicalBodyFrame(joint.childFrame);
    const pPos = bodyPos.get(pName) ?? bodyPos.get("ground")!;
    const cPos = bodyPos.get(cName) ?? {
      x: bodyX,
      y: 148 + idx * 106,
      w: bodyW,
      h: bodyH,
    };

    const jColor = jointBadgeColor(joint.jointType);
    const x1 = pPos.x + 42;
    const y1 = pPos.y + pPos.h;
    const x2 = cPos.x + 42;
    const y2 = cPos.y;

    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${jColor}" stroke-width="2.2" marker-end="url(#osimJointArrow)"/>`,
    );

    // Joint Callout Pill between parent and child
    const pillX = bodyX + bodyW + 24;
    const pillY = Math.round((y1 + y2) / 2) - 18;
    const pillW = 245;
    const pillH = 38;

    parts.push(
      `<line x1="${(x1 + x2) / 2}" y1="${(y1 + y2) / 2}" x2="${pillX}" y2="${pillY + 19}" stroke="${jColor}" stroke-width="1.2" stroke-dasharray="3,2"/>`,
    );
    parts.push(
      `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="5" fill="#1e293b" stroke="${jColor}" stroke-width="1.5"/>`,
    );
    parts.push(
      `<text x="${pillX + 10}" y="${pillY + 15}" fill="#f8fafc" font-size="10.5" font-weight="700">${escapeXml(joint.name)} (${escapeXml(joint.jointType)})</text>`,
    );

    const coordSummary =
      joint.coordinates.length > 0
        ? joint.coordinates
            .map((c) => `${c.name}: [${c.rangeMin.toFixed(2)}, ${c.rangeMax.toFixed(2)}]${c.locked ? " (LOCKED)" : ""}`)
            .join(", ")
        : "0 DOF (Weld)";
    parts.push(
      `<text x="${pillX + 10}" y="${pillY + 30}" fill="#cbd5e1" font-size="9.5">${escapeXml(coordSummary.slice(0, 42))}</text>`,
    );
  });

  // Render Rigid Body Cards
  bodies.forEach((body) => {
    const pos = bodyPos.get(body.name)!;
    const inertia = body.inertia ?? [0, 0, 0, 0, 0, 0];
    const bodyWraps = wrapsByBody.get(canonicalBodyFrame(body.name)) ?? [];
    const bodyMarkers = markersByBody.get(canonicalBodyFrame(body.name)) ?? [];

    parts.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}" rx="6" fill="url(#osimBodyGrad)" stroke="#38bdf8" stroke-width="1.8"/>`,
    );
    parts.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${pos.w}" height="24" rx="6" fill="#38bdf8" fill-opacity="0.18"/>`,
    );
    parts.push(
      `<text x="${pos.x + 12}" y="${pos.y + 16}" fill="#f8fafc" font-size="12" font-weight="700">${escapeXml(body.name)}</text>`,
    );
    parts.push(
      `<text x="${pos.x + pos.w - 10}" y="${pos.y + 16}" fill="#38bdf8" font-size="10.5" font-weight="700" text-anchor="end">${body.mass.toFixed(2)} kg</text>`,
    );

    parts.push(
      `<text x="${pos.x + 12}" y="${pos.y + 41}" fill="#cbd5e1" font-size="10">Inertia Ixx/yy/zz: [${inertia[0].toFixed(4)}, ${inertia[1].toFixed(4)}, ${inertia[2].toFixed(4)}] kg·m²</text>`,
    );

    const wrapInfo =
      bodyWraps.length > 0
        ? `Wrap: ${bodyWraps.map((w) => `${w.name} (${w.wrapType}, r=${w.radius}m)`).join(", ")}`
        : `COM: [${(body.massCenter ?? [0, 0, 0]).map((v) => v.toFixed(2)).join(", ")}] m`;
    parts.push(
      `<text x="${pos.x + 12}" y="${pos.y + 58}" fill="#94a3b8" font-size="9.5">${escapeXml(wrapInfo.slice(0, 48))}</text>`,
    );

    if (bodyMarkers.length > 0) {
      parts.push(
        `<text x="${pos.x + pos.w - 10}" y="${pos.y + 71}" fill="#a855f7" font-size="9" font-weight="600" text-anchor="end">Markers: ${bodyMarkers.length}</text>`,
      );
    }
  });

  // Render Hill-Type Muscle-Tendon Routing Chords on the Right Column
  const musclePanelX = 645;
  muscles.forEach((muscle, idx) => {
    const fCol = muscleForceColor(muscle.maxIsometricForce);
    const cardY = 66 + idx * 96;
    const cardW = 272;
    const cardH = 82;

    // Find origin & insertion bodies from pathPoints
    const firstPt = muscle.pathPoints[0];
    const lastPt = muscle.pathPoints[muscle.pathPoints.length - 1];
    const originPos = firstPt ? bodyPos.get(canonicalBodyFrame(firstPt.bodyFrame)) : undefined;
    const insertPos = lastPt ? bodyPos.get(canonicalBodyFrame(lastPt.bodyFrame)) : undefined;

    if (originPos) {
      const ox = originPos.x + originPos.w;
      const oy = originPos.y + 28 + (idx % 3) * 12;
      const mx = Math.round((ox + musclePanelX) / 2);
      parts.push(
        `<path d="M ${ox} ${oy} C ${mx} ${oy}, ${mx} ${cardY + 24}, ${musclePanelX} ${cardY + 24}" fill="none" stroke="${fCol}" stroke-width="2.2" stroke-opacity="0.85"/>`,
      );
      parts.push(`<circle cx="${ox}" cy="${oy}" r="3.5" fill="${fCol}"/>`);
    }
    if (insertPos && insertPos !== originPos) {
      const ix = insertPos.x + insertPos.w;
      const iy = insertPos.y + 44 + (idx % 3) * 10;
      const mx = Math.round((ix + musclePanelX) / 2);
      parts.push(
        `<path d="M ${musclePanelX} ${cardY + 52} C ${mx} ${cardY + 52}, ${mx} ${iy}, ${ix} ${iy}" fill="none" stroke="${fCol}" stroke-width="2.2" stroke-dasharray="5,3" stroke-opacity="0.85"/>`,
      );
      parts.push(`<circle cx="${ix}" cy="${iy}" r="3.5" fill="${fCol}"/>`);
    }

    // Muscle Actuator Telemetry Card
    parts.push(
      `<rect x="${musclePanelX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="6" fill="#1e293b" stroke="${fCol}" stroke-width="1.8"/>`,
    );
    parts.push(
      `<rect x="${musclePanelX}" y="${cardY}" width="${cardW}" height="24" rx="6" fill="${fCol}" fill-opacity="0.22"/>`,
    );
    parts.push(
      `<text x="${musclePanelX + 10}" y="${cardY + 16}" fill="#f8fafc" font-size="11.5" font-weight="700">${escapeXml(muscle.name)}</text>`,
    );
    parts.push(
      `<text x="${musclePanelX + cardW - 10}" y="${cardY + 16}" fill="${fCol}" font-size="10.5" font-weight="700" text-anchor="end">F0 = ${muscle.maxIsometricForce.toFixed(0)} N</text>`,
    );

    parts.push(
      `<text x="${musclePanelX + 10}" y="${cardY + 40}" fill="#cbd5e1" font-size="10">l_opt: ${muscle.optimalFiberLength.toFixed(3)} m | l_slack: ${muscle.tendonSlackLength.toFixed(3)} m</text>`,
    );

    const pathChain = muscle.pathPoints.map((p) => canonicalBodyFrame(p.bodyFrame)).join(" → ");
    const wrapStr =
      muscle.wrapObjects && muscle.wrapObjects.length > 0 ? ` | Wrap: ${muscle.wrapObjects.join(",")}` : "";
    parts.push(
      `<text x="${musclePanelX + 10}" y="${cardY + 57}" fill="#94a3b8" font-size="9.5">Path: ${escapeXml((pathChain + wrapStr).slice(0, 42))}</text>`,
    );
    parts.push(
      `<text x="${musclePanelX + 10}" y="${cardY + 73}" fill="#64748b" font-size="9">Type: ${escapeXml(muscle.muscleType ?? "Thelen2003Muscle")} (${muscle.pathPoints.length} pts)</text>`,
    );
  });

  // Footer Legend
  parts.push(
    `<rect x="16" y="${height - 42}" width="${width - 32}" height="28" rx="4" fill="#1e293b" stroke="#334155"/>`,
  );
  parts.push(
    `<circle cx="32" cy="${height - 28}" r="5" fill="#ef4444"/><text x="42" y="${height - 24}" fill="#cbd5e1" font-size="10.5">F0 ≥ 1200 N</text>`,
  );
  parts.push(
    `<circle cx="135" cy="${height - 28}" r="5" fill="#f97316"/><text x="145" y="${height - 24}" fill="#cbd5e1" font-size="10.5">700–1200 N</text>`,
  );
  parts.push(
    `<circle cx="240" cy="${height - 28}" r="5" fill="#f59e0b"/><text x="250" y="${height - 24}" fill="#cbd5e1" font-size="10.5">350–700 N</text>`,
  );
  parts.push(
    `<circle cx="340" cy="${height - 28}" r="5" fill="#38bdf8"/><text x="350" y="${height - 24}" fill="#cbd5e1" font-size="10.5">&lt; 350 N</text>`,
  );
  parts.push(
    `<text x="${width - 28}" y="${height - 24}" fill="#94a3b8" font-size="10.5" text-anchor="end">Wrap Surfaces: ${wrapObjects.length} | Markers: ${markers.length}</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * Renders the Hill-type active/passive muscle force-length (f_L(l_tilde), f_PE(l_tilde)) curves
 * and simulated muscle activation / tendon force time trajectories.
 */
export function renderOpenSimForceCurveSvg(doc: OpenSimDocumentLike, simResult?: OpenSimSimulationLike): string {
  const width = 940;
  const height = 460;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );

  // Header
  parts.push(`<rect x="0" y="0" width="${width}" height="40" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="25" fill="#f8fafc" font-size="13" font-weight="600">Hill-Type Muscle Force-Length (f_L, f_PE) &amp; Forward Dynamics Activation / Force Trajectories</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="25" fill="#38bdf8" font-size="11.5" font-weight="600" text-anchor="end">Model: ${escapeXml(doc.modelName ?? "OpenSimModel")}</text>`,
  );

  // ── Left Panel: Normalized Hill Force-Length Curve f_L(l~^M) & f_PE(l~^M) ──
  const flX = 58;
  const flY = 72;
  const flW = 380;
  const flH = 310;

  parts.push(
    `<rect x="${flX}" y="${flY}" width="${flW}" height="${flH}" fill="#1e293b" fill-opacity="0.45" stroke="#334155" stroke-width="1.2"/>`,
  );
  parts.push(
    `<text x="${flX + flW / 2}" y="${flY - 10}" fill="#e2e8f0" font-size="11.5" font-weight="600" text-anchor="middle">Normalized Force-Length Curve f_L(l̃^M) &amp; f_PE(l̃^M)</text>`,
  );

  const lMin = 0.4;
  const lMax = 1.6;
  const fMax = 1.6;

  const mapLX = (lTilde: number) => flX + ((lTilde - lMin) / (lMax - lMin)) * flW;
  const mapFY = (fMult: number) => flY + flH - (Math.max(0, Math.min(fMax, fMult)) / fMax) * flH;

  // Grid lines
  for (const tickL of [0.5, 0.75, 1.0, 1.25, 1.5]) {
    const gx = mapLX(tickL);
    parts.push(
      `<line x1="${gx.toFixed(1)}" y1="${flY}" x2="${gx.toFixed(1)}" y2="${flY + flH}" stroke="${tickL === 1.0 ? "#475569" : "#1e293b"}" stroke-dasharray="${tickL === 1.0 ? "4,3" : "2,2"}"/>`,
    );
    parts.push(
      `<text x="${gx.toFixed(1)}" y="${flY + flH + 16}" fill="#94a3b8" font-size="10" text-anchor="middle">${tickL.toFixed(2)}</text>`,
    );
  }
  for (const tickF of [0.0, 0.5, 1.0, 1.5]) {
    const gy = mapFY(tickF);
    parts.push(`<line x1="${flX}" y1="${gy.toFixed(1)}" x2="${flX + flW}" y2="${gy.toFixed(1)}" stroke="#1e293b"/>`);
    parts.push(
      `<text x="${flX - 8}" y="${(gy + 4).toFixed(1)}" fill="#94a3b8" font-size="10" text-anchor="end">${tickF.toFixed(1)}</text>`,
    );
  }

  parts.push(
    `<text x="${flX + flW / 2}" y="${flY + flH + 34}" fill="#cbd5e1" font-size="10.5" text-anchor="middle">Normalized Fiber Length l̃^M = l^M / l^M_opt</text>`,
  );

  // Sample Active, Passive, and Total curves
  const activePts: string[] = [];
  const passivePts: string[] = [];
  const totalPts: string[] = [];
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const lTilde = lMin + (i / N) * (lMax - lMin);
    const fAct = computeActiveForceLength(lTilde);
    const fPas = computePassiveForceLength(lTilde);
    const fTot = fAct + fPas;
    const sx = mapLX(lTilde).toFixed(1);
    activePts.push(`${sx},${mapFY(fAct).toFixed(1)}`);
    passivePts.push(`${sx},${mapFY(fPas).toFixed(1)}`);
    totalPts.push(`${sx},${mapFY(fTot).toFixed(1)}`);
  }

  parts.push(
    `<polyline points="${totalPts.join(" ")}" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-dasharray="5,3"/>`,
  );
  parts.push(`<polyline points="${passivePts.join(" ")}" fill="none" stroke="#a855f7" stroke-width="2.2"/>`);
  parts.push(`<polyline points="${activePts.join(" ")}" fill="none" stroke="#38bdf8" stroke-width="2.5"/>`);

  // Optimal fiber length marker at (1.0, 1.0)
  const optX = mapLX(1.0);
  const optY = mapFY(1.0);
  parts.push(
    `<circle cx="${optX.toFixed(1)}" cy="${optY.toFixed(1)}" r="4.5" fill="#38bdf8" stroke="#0f172a" stroke-width="1.5"/>`,
  );
  parts.push(
    `<text x="${(optX + 8).toFixed(1)}" y="${(optY - 6).toFixed(1)}" fill="#38bdf8" font-size="10" font-weight="600">Peak Isometric (l̃^M=1.0)</text>`,
  );

  // ── Right Panel: Simulated Muscle Activation & Tendon Force Trajectories ──
  const trX = 496;
  const trY = 72;
  const trW = 414;
  const trH = 310;

  parts.push(
    `<rect x="${trX}" y="${trY}" width="${trW}" height="${trH}" fill="#1e293b" fill-opacity="0.45" stroke="#334155" stroke-width="1.2"/>`,
  );
  parts.push(
    `<text x="${trX + trW / 2}" y="${trY - 10}" fill="#e2e8f0" font-size="11.5" font-weight="600" text-anchor="middle">Simulated Muscle Activation a(t) &amp; Tendon Force F^T(t)</text>`,
  );

  const palette = ["#22c55e", "#ef4444", "#38bdf8", "#f59e0b", "#a855f7"];
  const muscles = doc.muscles ?? [];
  const timeVec =
    simResult && simResult.time.length >= 2 ? simResult.time : Array.from({ length: 25 }, (_, i) => i * 0.02);
  const tMax = Math.max(0.1, timeVec[timeVec.length - 1] ?? 0.5);

  let maxForceObserved = 100;
  for (const m of muscles) {
    if (m.maxIsometricForce > maxForceObserved) maxForceObserved = m.maxIsometricForce;
  }
  if (simResult) {
    for (const traj of Object.values(simResult.muscles)) {
      for (const f of traj.tendonForce) {
        if (f > maxForceObserved) maxForceObserved = f;
      }
    }
  }

  const mapTX = (t: number) => trX + (t / tMax) * trW;
  const mapForceY = (f: number) => trY + trH - (Math.max(0, Math.min(maxForceObserved, f)) / maxForceObserved) * trH;
  const mapActY = (a: number) => trY + trH - Math.max(0, Math.min(1, a)) * trH;

  muscles.slice(0, 5).forEach((m, idx) => {
    const col = palette[idx % palette.length]!;
    const simTraj = simResult?.muscles[m.name];
    const forcePts: string[] = [];
    const actPts: string[] = [];

    timeVec.forEach((t, ti) => {
      const sx = mapTX(t).toFixed(1);
      const act =
        simTraj && simTraj.activation[ti] !== undefined
          ? simTraj.activation[ti]!
          : 0.15 + 0.75 * (1 - Math.exp(-t / 0.06));
      const force =
        simTraj && simTraj.tendonForce[ti] !== undefined ? simTraj.tendonForce[ti]! : m.maxIsometricForce * act * 0.82;
      forcePts.push(`${sx},${mapForceY(force).toFixed(1)}`);
      actPts.push(`${sx},${mapActY(act).toFixed(1)}`);
    });

    parts.push(`<polyline points="${forcePts.join(" ")}" fill="none" stroke="${col}" stroke-width="2.2"/>`);
    parts.push(
      `<polyline points="${actPts.join(" ")}" fill="none" stroke="${col}" stroke-width="1.4" stroke-dasharray="3,3"/>`,
    );

    // Legend entry inside trajectory chart
    const legY = trY + 18 + idx * 18;
    parts.push(
      `<line x1="${trX + 12}" y1="${legY - 4}" x2="${trX + 30}" y2="${legY - 4}" stroke="${col}" stroke-width="2.4"/>`,
    );
    parts.push(
      `<text x="${trX + 36}" y="${legY}" fill="#f8fafc" font-size="10" font-weight="600">${escapeXml(m.name)} (F0=${m.maxIsometricForce}N)</text>`,
    );
  });

  parts.push(
    `<text x="${trX + trW / 2}" y="${trY + trH + 34}" fill="#cbd5e1" font-size="10.5" text-anchor="middle">Simulation Time t (0.00 – ${tMax.toFixed(2)} s)</text>`,
  );

  // Footer Legend
  parts.push(
    `<rect x="16" y="${height - 38}" width="${width - 32}" height="26" rx="4" fill="#1e293b" stroke="#334155"/>`,
  );
  parts.push(
    `<line x1="28" y1="${height - 25}" x2="48" y2="${height - 25}" stroke="#38bdf8" stroke-width="2.5"/><text x="54" y="${height - 21}" fill="#cbd5e1" font-size="10.5">Active f_L(l̃^M)</text>`,
  );
  parts.push(
    `<line x1="160" y1="${height - 25}" x2="180" y2="${height - 25}" stroke="#a855f7" stroke-width="2.2"/><text x="186" y="${height - 21}" fill="#cbd5e1" font-size="10.5">Passive f_PE(l̃^M)</text>`,
  );
  parts.push(
    `<line x1="305" y1="${height - 25}" x2="325" y2="${height - 25}" stroke="#f59e0b" stroke-width="1.8" stroke-dasharray="5,3"/><text x="331" y="${height - 21}" fill="#cbd5e1" font-size="10.5">Total f_L + f_PE</text>`,
  );
  parts.push(
    `<text x="${width - 28}" y="${height - 21}" fill="#94a3b8" font-size="10.5" text-anchor="end">Solid: Tendon Force F^T(t) | Dashed: Activation a(t)</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("\n");
}
