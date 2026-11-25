// SPDX-License-Identifier: AGPL-3.0-or-later

import { escapeXml } from "../../util/escape.js";
import { sampleScientificColormap } from "./colormap.js";
import type { PreprocessContext, PreprocessResult } from "./types.js";

export interface FeaDeckLike {
  heading?: string | undefined;
  nodes?: Map<number, { id: number; x: number; y: number; z: number }> | undefined;
  elements?: Map<number, { id: number; type: string; nodes: number[] }> | undefined;
  materials?: Map<string, unknown> | undefined;
  steps?: { length?: number | undefined; size?: number | undefined } | undefined;
  boundaries?: { length?: number | undefined; size?: number | undefined } | undefined;
  cloads?: { length?: number | undefined; size?: number | undefined } | undefined;
  dloads?: { length?: number | undefined; size?: number | undefined } | undefined;
  fixedNodes?: Set<number> | undefined;
  nodalLoads?: Map<number, [number, number, number]> | undefined;
}

export interface Su2ConfigLike {
  solver?: string | undefined;
  kindTurbModel?: string | undefined;
  mathProblem?: string | undefined;
  machNumber?: number | undefined;
  aoa?: number | undefined;
  reynoldsNumber?: number | undefined;
  markersEuler?: string[] | undefined;
  markersFar?: string[] | undefined;
  markersHeatflux?: string[] | undefined;
}

/**
 * Deterministically synthesizes a 3D isometric transonic swept supercritical wing contour mesh
 * and 3D aerodynamic flow streamlines SVG for SU2 CFD configurations.
 */
export function renderCfdConfigIsometricSvg(cfg: Su2ConfigLike, fallbackTitle = "SU2 CFD Flow"): string {
  void fallbackTitle;
  const width = 800;
  const height = 450;
  const mach = Number.isFinite(cfg.machNumber) && (cfg.machNumber ?? 0) > 0 ? cfg.machNumber! : 0.82;
  const aoaDeg = Number.isFinite(cfg.aoa) ? cfg.aoa! : 2.75;
  const aoaRad = (aoaDeg * Math.PI) / 180;

  const nSpan = 16;
  const nAirfoil = 28;
  const spanMinY = -8.5;
  const spanMaxY = 8.5;
  const rootChord = 9.4;
  const tipChord = 2.6;

  const points: [number, number, number][] = [];
  const nodalScalars: number[] = [];

  for (let j = 0; j <= nSpan; j++) {
    const s = j / nSpan;
    const y = spanMinY + s * (spanMaxY - spanMinY);
    const yehudiFactor = s < 0.35 ? 1.0 - 0.52 * (s / 0.35) : 0.48 - 0.48 * ((s - 0.35) / 0.65);
    const chord = tipChord + (rootChord - tipChord) * yehudiFactor;
    const xLE = -5.6 + 9.8 * s;
    const zDihedral = -0.5 + 1.3 * s;
    const twistRad = ((1.8 - 4.0 * s) * Math.PI) / 180;
    const cosT = Math.cos(twistRad);
    const sinT = Math.sin(twistRad);
    const tcRatio = 0.125 - 0.03 * s;
    const shockLoc = 0.58 - 0.06 * s;
    const ellipticalSpanLoad = Math.sqrt(Math.max(0.08, 1.0 - 0.72 * s * s));
    const transonicFactor = Math.min(1.35, Math.max(0.4, mach / 0.78));

    for (let k = 0; k < nAirfoil; k++) {
      const beta = (2 * Math.PI * k) / nAirfoil;
      const u = 0.5 * (1 + Math.cos(beta));
      const isUpper = Math.sin(beta) >= 0;

      const halfThick =
        5 *
        tcRatio *
        (0.2969 * Math.sqrt(Math.max(0, u)) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1015 * u * u * u * u);
      const camber = 0.022 * Math.sin(Math.PI * Math.pow(Math.max(0, u), 0.85)) + 0.014 * u * u * (1 - u);
      const zLocal = chord * (camber + (isUpper ? halfThick : -halfThick * 0.88));
      const xLocal = chord * u;

      const xRot = xLocal * cosT + zLocal * sinT;
      const zRot = -xLocal * sinT + zLocal * cosT;
      points.push([xLE + xRot, y, zDihedral + zRot]);

      const shockStep = 1.0 / (1.0 + Math.exp((u - shockLoc) * 24.0));
      let cp: number;
      if (isUpper) {
        const roofSuction =
          (-1.1 - 0.065 * aoaDeg) *
          transonicFactor *
          ellipticalSpanLoad *
          Math.pow(Math.sin(Math.min(1, u / 0.65) * Math.PI * 0.5), 0.55) *
          shockStep;
        const postShock = (1.0 - shockStep) * (-0.15 + 0.35 * Math.max(0, (u - shockLoc) / (1.0 - shockLoc)));
        const leStag = 0.75 * Math.exp(-u * 15.0);
        cp = Math.max(-1.6, Math.min(1.0, leStag + roofSuction + postShock));
      } else {
        const leStag = 0.9 * Math.exp(-u * 11.0);
        const lowerLoad = (0.18 + 0.035 * aoaDeg) * Math.sin(u * Math.PI) * ellipticalSpanLoad;
        cp = Math.max(-0.8, Math.min(1.0, leStag + lowerLoad));
      }
      // Map local Mach / suction intensity (-cp) so high-speed suction zone is warm/red-amber and stagnation is deep blue
      const localMach = mach * Math.sqrt(Math.max(0.1, 1.0 - cp));
      nodalScalars.push(localMach);
    }
  }

  const triFaces: [number, number, number][] = [];
  for (let j = 0; j < nSpan; j++) {
    const r0 = j * nAirfoil;
    const r1 = (j + 1) * nAirfoil;
    for (let k = 0; k < nAirfoil; k++) {
      const kNext = (k + 1) % nAirfoil;
      triFaces.push([r0 + k, r1 + k, r1 + kNext], [r0 + k, r1 + kNext, r0 + kNext]);
    }
  }

  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const v of nodalScalars) {
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  const valSpan = Math.max(1e-6, maxVal - minVal);

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [x, y, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const isoProject = (p: [number, number, number]): [number, number, number] => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    const cosA = 0.76604;
    const sinA = 0.64279;
    const cosP = 0.81915;
    const sinP = 0.57358;
    const rx = dx * cosA - dy * sinA;
    const ryPlanar = dx * sinA + dy * cosA;
    const sy = dz * cosP - ryPlanar * sinP;
    const depth = dz * sinP + ryPlanar * cosP;
    return [rx, -sy, depth];
  };

  let pMinX = Infinity,
    pMaxX = -Infinity,
    pMinY = Infinity,
    pMaxY = -Infinity;
  for (const pt of points) {
    const [px, py] = isoProject(pt);
    if (px < pMinX) pMinX = px;
    if (px > pMaxX) pMaxX = px;
    if (py < pMinY) pMinY = py;
    if (py > pMaxY) pMaxY = py;
  }

  const pSpanX = Math.max(1e-6, pMaxX - pMinX);
  const pSpanY = Math.max(1e-6, pMaxY - pMinY);
  const padX = 105;
  const padY = 64;
  const scale = Math.min((width - padX * 2) / pSpanX, (height - padY * 2) / pSpanY);
  const midPX = (pMinX + pMaxX) * 0.5;
  const midPY = (pMinY + pMaxY) * 0.5;

  const projectScreen = (p: [number, number, number]): [number, number, number] => {
    const [rx, ry, depth] = isoProject(p);
    return [+(width * 0.5 + (rx - midPX) * scale).toFixed(1), +(height * 0.5 + (ry - midPY) * scale).toFixed(1), depth];
  };

  interface ShadedTri {
    pts: [[number, number], [number, number], [number, number]];
    depth: number;
    fill: string;
    stroke: string;
  }

  const shadedTris: ShadedTri[] = [];
  for (const [i0, i1, i2] of triFaces) {
    const v0 = points[i0]!;
    const v1 = points[i1]!;
    const v2 = points[i2]!;
    const s0 = projectScreen(v0);
    const s1 = projectScreen(v1);
    const s2 = projectScreen(v2);
    const avgDepth = (s0[2] + s1[2] + s2[2]) / 3;
    const avgScalar = ((nodalScalars[i0] ?? minVal) + (nodalScalars[i1] ?? minVal) + (nodalScalars[i2] ?? minVal)) / 3;
    const normT = (avgScalar - minVal) / valSpan;
    const [cr, cg, cb] = sampleScientificColormap(normT);

    const ux = v1[0] - v0[0],
      uy = v1[1] - v0[1],
      uz = v1[2] - v0[2];
    const vx = v2[0] - v0[0],
      vy = v2[1] - v0[1],
      vz = v2[2] - v0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
    const shade = 0.68 + 0.32 * Math.abs(nx * 0.35 + ny * 0.45 + nz * 0.82);

    shadedTris.push({
      pts: [
        [s0[0], s0[1]],
        [s1[0], s1[1]],
        [s2[0], s2[1]],
      ],
      depth: avgDepth,
      fill: `rgb(${Math.min(255, Math.round(cr * shade))}, ${Math.min(255, Math.round(cg * shade))}, ${Math.min(255, Math.round(cb * shade))})`,
      stroke: "rgba(15, 23, 42, 0.28)",
    });
  }

  shadedTris.sort((a, b) => a.depth - b.depth);

  // Synthesize smooth 3D aerodynamic streamlines flowing over the swept wing
  const streamlines: string[] = [];
  const nStreams = 11;
  for (let sIdx = 0; sIdx < nStreams; sIdx++) {
    const sFrac = (sIdx + 0.5) / nStreams;
    const yBase = spanMinY + sFrac * (spanMaxY - spanMinY);
    const yehudiFactor = sFrac < 0.35 ? 1.0 - 0.52 * (sFrac / 0.35) : 0.48 - 0.48 * ((sFrac - 0.35) / 0.65);
    const chord = tipChord + (rootChord - tipChord) * yehudiFactor;
    const xLE = -5.6 + 9.8 * sFrac;
    const zDihedral = -0.5 + 1.3 * sFrac;

    const pathPts: [number, number][] = [];
    const nSteps = 22;
    for (let step = 0; step <= nSteps; step++) {
      const t = step / nSteps; // 0 upstream to 1 downstream
      const x = xLE - 3.2 + t * (chord + 6.8);
      const u = (x - xLE) / chord;
      const overWing = u >= -0.15 && u <= 1.15 ? Math.sin(Math.max(0, Math.min(1, (u + 0.15) / 1.3)) * Math.PI) : 0;
      const zLift =
        zDihedral + 0.65 + overWing * (0.85 * (chord / rootChord) + 0.25) + (t - 0.5) * Math.sin(aoaRad) * 2.2;
      const yDeflect =
        yBase + overWing * (-0.35 * sFrac) + (sFrac > 0.82 && u > 0.5 ? Math.sin((u - 0.5) * Math.PI * 2) * 0.45 : 0);
      const [sx, sy] = projectScreen([x, yDeflect, zLift]);
      pathPts.push([sx, sy]);
    }
    const dAttr = pathPts.map((pt, idx) => `${idx === 0 ? "M" : "L"}${pt[0]},${pt[1]}`).join(" ");
    const colorT = 0.55 + 0.4 * Math.sqrt(Math.max(0, 1 - sFrac * 0.75));
    const [sr, sg, sb] = sampleScientificColormap(colorT);
    streamlines.push(
      `<path d="${dAttr}" fill="none" stroke="rgba(${sr}, ${sg}, ${sb}, 0.82)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
  <!-- 3D Swept Supercritical Wing CFD Surface Contour Mesh -->
  <g>
    ${shadedTris
      .map(
        (t) =>
          `<polygon points="${t.pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="0.6" stroke-linejoin="round" />`,
      )
      .join("\n    ")}
  </g>
  <!-- 3D Aerodynamic Streamlines -->
  <g>
    ${streamlines.join("\n    ")}
  </g>
</svg>`;
}

export function buildFeaMeshSvgFromDeck(deck: FeaDeckLike, fallbackTitle: string): string {
  const width = 680;
  const height = 380;
  const padX = 54;
  const padTop = 66;
  const padBot = 44;
  const nodes: { id: number; x: number; y: number; z: number }[] = Array.from(deck.nodes?.values() ?? []);
  const elements: { id: number; type: string; nodes: number[] }[] = Array.from(deck.elements?.values() ?? []);
  const title = escapeXml(deck.heading || fallbackTitle);
  const stepCount = deck.steps?.length ?? deck.steps?.size ?? 0;

  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
      <rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
      <text x="24" y="32" fill="#e6edf3" font-family="monospace" font-size="13" font-weight="bold">FEA DECK // ${title}</text>
      <text x="24" y="60" fill="#8b949e" font-family="monospace" font-size="11">Materials: ${deck.materials?.size ?? 0} | Steps: ${stepCount} | Boundaries: ${deck.boundaries?.length ?? 0}</text>
    </svg>`;
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
    if (n.z < minZ) minZ = n.z;
    if (n.z > maxZ) maxZ = n.z;
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const rawSpanZ = maxZ - minZ;
  const is3D = rawSpanZ > 1e-4;
  // Boost Z depth visually when thickness is thin relative to XY span so 3D hex layers are clearly separated
  const zStretch = is3D && rawSpanZ < Math.max(spanX, spanY) * 0.22 ? (Math.max(spanX, spanY) * 0.22) / rawSpanZ : 1.0;

  // 3D trimetric projection (yaw = -24 deg, pitch = 20 deg)
  const yaw = (-24 * Math.PI) / 180;
  const pitch = (20 * Math.PI) / 180;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);

  const rotate3D = (x: number, y: number, z: number): [number, number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    const dz = (z - cz) * zStretch;
    if (!is3D) return [dx, dy, 0];
    const rx = dx * cosY - dz * sinY;
    const rz1 = dx * sinY + dz * cosY;
    const ry = dy * cosP - rz1 * sinP;
    const rz = dy * sinP + rz1 * cosP;
    return [rx, ry, rz];
  };

  let pMinX = Infinity,
    pMaxX = -Infinity,
    pMinY = Infinity,
    pMaxY = -Infinity;
  const rotatedMap = new Map<
    number,
    { rx: number; ry: number; rz: number; raw: { x: number; y: number; z: number } }
  >();
  for (const n of nodes) {
    const [rx, ry, rz] = rotate3D(n.x, n.y, n.z);
    rotatedMap.set(n.id, { rx, ry, rz, raw: n });
    if (rx < pMinX) pMinX = rx;
    if (rx > pMaxX) pMaxX = rx;
    if (ry < pMinY) pMinY = ry;
    if (ry > pMaxY) pMaxY = ry;
  }

  const pSpanX = Math.max(1e-6, pMaxX - pMinX);
  const pSpanY = Math.max(1e-6, pMaxY - pMinY);
  const availW = width - padX * 2;
  const availH = height - padTop - padBot;
  const scale = Math.min(availW / pSpanX, availH / pSpanY);
  const offsetX = padX + (availW - pSpanX * scale) * 0.5;

  const nodeMap = new Map<number, [number, number, number]>();
  for (const [id, r] of rotatedMap.entries()) {
    const sx = +(offsetX + (r.rx - pMinX) * scale).toFixed(1);
    const sy = +(height - padBot - (availH - pSpanY * scale) * 0.5 - (r.ry - pMinY) * scale).toFixed(1);
    nodeMap.set(id, [sx, sy, r.rz]);
  }

  // Decompose volume and shell elements into renderable faces for Painter's algorithm depth sorting
  interface FaceItem {
    pts: [number, number, number][];
    depth: number;
    shade: "top" | "front" | "side";
  }
  const faces: FaceItem[] = [];
  const lineSegments: [[number, number, number], [number, number, number]][] = [];

  const pushFace = (nids: number[], shade: "top" | "front" | "side") => {
    const pts = nids.map((id) => nodeMap.get(id)).filter((p): p is [number, number, number] => Boolean(p));
    if (pts.length >= 3) {
      const depth = pts.reduce((acc, p) => acc + p[2], 0) / pts.length;
      faces.push({ pts, depth, shade });
    }
  };

  for (const el of elements.slice(0, 600)) {
    const t = el.type.toUpperCase();
    const ns = el.nodes;
    if ((t.startsWith("C3D8") || t.startsWith("C3D20") || t.includes("CHEXA")) && ns.length >= 8) {
      const [n0, n1, n2, n3, n4, n5, n6, n7] = ns as [number, number, number, number, number, number, number, number];
      pushFace([n0, n1, n2, n3], "front");
      pushFace([n4, n5, n6, n7], "front");
      pushFace([n0, n1, n5, n4], "top");
      pushFace([n3, n2, n6, n7], "top");
      pushFace([n1, n2, n6, n5], "side");
      pushFace([n0, n3, n7, n4], "side");
    } else if ((t.startsWith("C3D4") || t.startsWith("C3D10") || t.includes("CTETRA")) && ns.length >= 4) {
      const [n0, n1, n2, n3] = ns as [number, number, number, number];
      pushFace([n0, n1, n2], "front");
      pushFace([n0, n1, n3], "top");
      pushFace([n1, n2, n3], "side");
      pushFace([n0, n2, n3], "side");
    } else if ((t.startsWith("C3D6") || t.startsWith("C3D15") || t.includes("CPENTA")) && ns.length >= 6) {
      const [n0, n1, n2, n3, n4, n5] = ns as [number, number, number, number, number, number];
      pushFace([n0, n1, n2], "front");
      pushFace([n3, n4, n5], "front");
      pushFace([n0, n1, n4, n3], "top");
      pushFace([n1, n2, n5, n4], "side");
      pushFace([n2, n0, n3, n5], "side");
    } else if (ns.length >= 3) {
      pushFace(ns, "front");
    } else if (ns.length === 2) {
      const p0 = nodeMap.get(ns[0]!);
      const p1 = nodeMap.get(ns[1]!);
      if (p0 && p1) lineSegments.push([p0, p1]);
    }
  }

  faces.sort((a, b) => a.depth - b.depth);

  const polys: string[] = [];
  for (const f of faces) {
    const fill =
      f.shade === "top"
        ? "rgba(56, 189, 248, 0.22)"
        : f.shade === "side"
          ? "rgba(14, 165, 233, 0.16)"
          : "rgba(30, 64, 175, 0.18)";
    const stroke = f.shade === "top" ? "#7dd3fc" : "#38bdf8";
    polys.push(
      `<polygon points="${f.pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="1.15" stroke-linejoin="round" />`,
    );
  }
  for (const [p0, p1] of lineSegments) {
    polys.push(`<line x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}" stroke="#38bdf8" stroke-width="1.6" />`);
  }

  // Render nodes, fixed boundary condition glyphs, and nodal load vectors
  const fixedSet = deck.fixedNodes ?? new Set<number>();
  const loadMap = deck.nodalLoads ?? new Map<number, [number, number, number]>();
  const dots: string[] = [];
  const bcGlyphs: string[] = [];
  const loadGlyphs: string[] = [];

  for (const n of nodes.slice(0, 400)) {
    const pt = nodeMap.get(n.id);
    if (!pt) continue;
    const isFixed = fixedSet.has(n.id);
    const loadVec = loadMap.get(n.id);
    if (isFixed) {
      bcGlyphs.push(
        `<polygon points="${pt[0]},${+(pt[1] - 4).toFixed(1)} ${+(pt[0] - 5).toFixed(1)},${+(pt[1] + 5).toFixed(1)} ${+(pt[0] + 5).toFixed(1)},${+(pt[1] + 5).toFixed(1)}" fill="#06b6d4" stroke="#083344" stroke-width="1" />`,
      );
    }
    if (loadVec) {
      const fx = loadVec[0] || 0;
      const fy = loadVec[1] || 0;
      const fz = loadVec[2] || 0;
      const mag = Math.hypot(fx, fy, fz) || 1;
      const dx = (fx / mag) * 20;
      const dy = -(fy / mag) * 20;
      const x2 = +(pt[0] + dx).toFixed(1);
      const y2 = +(pt[1] + dy).toFixed(1);
      loadGlyphs.push(
        `<line x1="${pt[0]}" y1="${pt[1]}" x2="${x2}" y2="${y2}" stroke="#f43f5e" stroke-width="2" marker-end="url(#fea-load-arrow)" />`,
      );
    }
    dots.push(
      `<circle cx="${pt[0]}" cy="${pt[1]}" r="${isFixed || loadVec ? "2.8" : "2.1"}" fill="${
        loadVec ? "#fda4af" : isFixed ? "#67e8f9" : "#e2e8f0"
      }" />`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
    <defs>
      <marker id="fea-load-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />
      </marker>
    </defs>
    <rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
    <text x="20" y="26" fill="#e6edf3" font-family="monospace" font-size="12" font-weight="bold">FEA MESH // ${title}</text>
    <text x="20" y="44" fill="#8b949e" font-family="monospace" font-size="10">Nodes: ${nodes.length} | Elements: ${elements.length} | Materials: ${deck.materials?.size ?? 0} | Steps: ${stepCount}</text>
    ${polys.join("\n    ")}
    ${bcGlyphs.join("\n    ")}
    ${dots.join("\n    ")}
    ${loadGlyphs.join("\n    ")}
    <g transform="translate(24, ${height - 20})" font-family="monospace" font-size="9.5" fill="#94a3b8">
      <rect x="0" y="-8" width="8" height="8" rx="1.5" fill="rgba(56, 189, 248, 0.35)" stroke="#38bdf8" stroke-width="1"/>
      <text x="13" y="-1">${is3D ? "3D Volumetric Mesh (Isometric)" : "2D Finite Element Mesh"}</text>
      <polygon points="198,-8 193,0 203,0" fill="#06b6d4"/>
      <text x="208" y="-1">Fixed BC (${fixedSet.size})</text>
      <circle cx="305" cy="-4" r="3.5" fill="#f43f5e"/>
      <text x="313" y="-1">Nodal Loads (${loadMap.size})</text>
    </g>
  </svg>`;
}

export async function preprocessFeaDeckArtifact(ctx: PreprocessContext): Promise<PreprocessResult> {
  const { parseInpDeck } = await import("@modelscript/fea");
  const deck = parseInpDeck(ctx.content) as unknown as FeaDeckLike;
  const svg = buildFeaMeshSvgFromDeck(deck, ctx.baseTitle);
  const stepCount = deck.steps?.length ?? deck.steps?.size ?? 0;
  const boundaryCount = deck.boundaries?.length ?? deck.boundaries?.size ?? 0;
  const cloadCount = deck.cloads?.length ?? deck.cloads?.size ?? 0;
  const dloadCount = deck.dloads?.length ?? deck.dloads?.size ?? 0;
  return {
    svg,
    metadata: {
      nodeCount: deck.nodes?.size ?? 0,
      elementCount: deck.elements?.size ?? 0,
      materialCount: deck.materials?.size ?? 0,
      stepCount,
    },
    viewConfigAdditions: {
      code: ctx.inlineCode,
      title: deck.heading || ctx.baseTitle,
      nodes: deck.nodes?.size ?? 0,
      elements: deck.elements?.size ?? 0,
      materials: deck.materials ? Array.from(deck.materials.keys()) : [],
      stepCount,
      boundaryCount,
      loadCount: cloadCount + dloadCount,
    },
  };
}

export async function preprocessCfdConfigArtifact(ctx: PreprocessContext): Promise<PreprocessResult> {
  const { parseSu2Config } = await import("@modelscript/cfd");
  const cfg = parseSu2Config(ctx.content) as unknown as Su2ConfigLike;
  const svg = renderCfdConfigIsometricSvg(cfg, ctx.baseTitle);
  return {
    svg,
    metadata: {
      solver: cfg.solver,
      machNumber: cfg.machNumber,
      aoa: cfg.aoa,
      reynoldsNumber: cfg.reynoldsNumber,
    },
    viewConfigAdditions: {
      code: ctx.inlineCode,
      title: ctx.baseTitle,
      solver: cfg.solver,
      turbulenceModel: cfg.kindTurbModel,
      mathProblem: cfg.mathProblem,
      machNumber: cfg.machNumber,
      aoa: cfg.aoa,
      reynoldsNumber: cfg.reynoldsNumber,
      markersEuler: cfg.markersEuler,
      markersFar: cfg.markersFar,
      markersHeatflux: cfg.markersHeatflux,
    },
  };
}
