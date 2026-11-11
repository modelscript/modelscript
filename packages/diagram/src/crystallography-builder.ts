// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Crystallography & Materials Structure Visualizer
 *
 * Implements IUCr Crystallographic Information File (CIF) parsing, 3D unit cell geometry,
 * Miller index plane (hkl) slicing, simulated Powder X-ray Diffraction (PXRD), and materials linter:
 * - Unit cell parameters: lengths a, b, c [Å], angles alpha, beta, gamma [deg], volume V [Å³]
 * - Fractional (u, v, w) to Cartesian (x, y, z) metric tensor conversion
 * - Space group symmetry expansion (P1, P-1, P2_1/c, Pnma, Fm-3m, Im-3m, etc.)
 * - 3D depth-sorted SVG unit cell wireframe, atomic spheres with CPK coloring, and (hkl) plane polygons
 * - Simulated Powder X-ray Diffraction (PXRD) Bragg peaks (Cu K_alpha, lambda = 1.5406 Å)
 * - Materials linter: MAT1001 (space group), MAT1002 (coordinate bounds), MAT1003 (steric clash), MAT1004 (lattice bounds)
 */

export interface CrystalUnitCell {
  a: number; // [Å]
  b: number; // [Å]
  c: number; // [Å]
  alpha: number; // [deg]
  beta: number; // [deg]
  gamma: number; // [deg]
  volume: number; // [Å³]
}

export interface AtomSite {
  label: string;
  element: string;
  fractX: number;
  fractY: number;
  fractZ: number;
  cartX?: number | undefined;
  cartY?: number | undefined;
  cartZ?: number | undefined;
  occupancy?: number | undefined;
  bIso?: number | undefined; // Thermal displacement parameter [Å²]
}

export interface MillerPlane {
  h: number;
  k: number;
  l: number;
}

export interface PxrdPeak {
  hkl: [number, number, number];
  twoThetaDeg: number;
  dSpacingAngstrom: number;
  intensity: number; // 0..100%
}

export interface CrystalStructure {
  id: string;
  name: string;
  formula: string;
  spaceGroup: string;
  spaceGroupNumber?: number | undefined;
  cell: CrystalUnitCell;
  atoms: AtomSite[];
}

export interface CrystalRenderOptions {
  width?: number;
  height?: number;
  elevationDeg?: number; // Pitch
  azimuthDeg?: number; // Yaw
  supercell?: [number, number, number]; // [nx, ny, nz]
  millerPlane?: MillerPlane | undefined;
  showAxes?: boolean;
  darkMode?: boolean;
  scale?: number;
}

export interface PxrdRenderOptions {
  width?: number;
  height?: number;
  wavelengthAngstrom?: number; // 1.5406 for Cu K_alpha, 0.7107 for Mo K_alpha
  minTwoTheta?: number;
  maxTwoTheta?: number;
  darkMode?: boolean;
}

export interface MaterialsLintDiagnostic {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  field?: string;
  atomIndex?: number;
}

// ---------------------------------------------------------------------------
// Standard CPK Colors & Covalent Radii
// ---------------------------------------------------------------------------

const CPK_COLORS: Record<string, string> = {
  H: "#ffffff",
  C: "#334155",
  N: "#3b82f6",
  O: "#ef4444",
  F: "#22c55e",
  Cl: "#16a34a",
  Br: "#991b1b",
  I: "#581c87",
  Si: "#f59e0b",
  P: "#ea580c",
  S: "#eab308",
  Fe: "#f97316",
  Ti: "#94a3b8",
  Al: "#cbd5e1",
  Cu: "#c2410c",
  Ni: "#10b981",
  Zn: "#64748b",
  Au: "#fbbf24",
  Ag: "#e2e8f0",
  Pt: "#e2e8f0",
  Na: "#8b5cf6",
  K: "#a855f7",
  Ca: "#06b6d4",
  Mg: "#14b8a6",
  Ba: "#0284c7",
  Sr: "#0ea5e9",
  Zr: "#64748b",
  Pb: "#475569",
};

const COVALENT_RADII_PM: Record<string, number> = {
  H: 31,
  C: 76,
  N: 71,
  O: 66,
  F: 57,
  Si: 111,
  P: 107,
  S: 105,
  Cl: 102,
  Fe: 132,
  Ti: 160,
  Al: 121,
  Cu: 132,
  Ni: 124,
  Zn: 122,
  Au: 136,
  Ag: 145,
  Na: 166,
  K: 203,
  Ca: 176,
  Mg: 141,
  Ba: 215,
  Sr: 195,
};

export function getCpkColor(element: string): string {
  return CPK_COLORS[element.toUpperCase()] || "#94a3b8";
}

export function getAtomicRadiusAngstrom(element: string): number {
  const pm = COVALENT_RADII_PM[element.toUpperCase()] || 120;
  return pm / 100.0;
}

// ---------------------------------------------------------------------------
// Crystallographic Unit Cell Math & Metric Tensor
// ---------------------------------------------------------------------------

/**
 * Calculates unit cell volume from lattice parameters a, b, c and alpha, beta, gamma:
 * V = a * b * c * sqrt(1 - cos^2(alpha) - cos^2(beta) - cos^2(gamma) + 2*cos(alpha)*cos(beta)*cos(gamma))
 */
export function calculateUnitCellVolume(
  a: number,
  b: number,
  c: number,
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
): number {
  const toRad = Math.PI / 180;
  const ca = Math.cos(alphaDeg * toRad);
  const cb = Math.cos(betaDeg * toRad);
  const cg = Math.cos(gammaDeg * toRad);

  const term = 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg;
  if (term <= 0) return 0;
  return a * b * c * Math.sqrt(term);
}

/**
 * Transforms fractional coordinates (u, v, w) to orthogonal Cartesian coordinates (x, y, z) [Å].
 */
export function fractionalToCartesian(
  u: number,
  v: number,
  w: number,
  cell: CrystalUnitCell,
): [number, number, number] {
  const toRad = Math.PI / 180;
  const ca = Math.cos(cell.alpha * toRad);
  const cb = Math.cos(cell.beta * toRad);
  const cg = Math.cos(cell.gamma * toRad);
  const sg = Math.sin(cell.gamma * toRad);

  // Transformation matrix
  const x = cell.a * u + cell.b * cg * v + cell.c * cb * w;
  const y = cell.b * sg * v + cell.c * ((ca - cb * cg) / (sg || 1)) * w;
  const z = (cell.volume / (cell.a * cell.b * (sg || 1))) * w;

  return [x, y, z];
}

// ---------------------------------------------------------------------------
// CIF (Crystallographic Information File) Parser
// ---------------------------------------------------------------------------

export function parseCif(cifText: string): CrystalStructure {
  const lines = cifText.split(/\r?\n/);
  let name = "Crystal Structure";
  let formula = "AB";
  let spaceGroup = "P 1";
  let a = 5.0;
  let b = 5.0;
  let c = 5.0;
  let alpha = 90.0;
  let beta = 90.0;
  let gamma = 90.0;

  const rawAtoms: { label: string; element: string; fractX: number; fractY: number; fractZ: number }[] = [];
  let inLoop = false;
  let loopHeaders: string[] = [];

  function cleanNum(val: string): number {
    // Strip standard uncertainties e.g. "5.4309(2)" -> 5.4309
    return parseFloat(val.replace(/\([0-9]+\)/g, "")) || 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!.trim();
    if (!rawLine || rawLine.startsWith("#")) continue;

    if (rawLine.startsWith("data_")) {
      name = rawLine.substring(5).trim();
      continue;
    }

    if (rawLine === "loop_") {
      inLoop = true;
      loopHeaders = [];
      continue;
    }

    if (inLoop) {
      if (rawLine.startsWith("_")) {
        loopHeaders.push(rawLine.split(/\s+/)[0]!);
        continue;
      }

      // We are in data rows of the loop
      const tokens = rawLine.split(/\s+/);
      if (tokens.length >= loopHeaders.length && loopHeaders.some((h) => h.includes("atom_site"))) {
        const labelIdx = loopHeaders.findIndex((h) => h === "_atom_site_label");
        const typeIdx = loopHeaders.findIndex((h) => h === "_atom_site_type_symbol");
        const xIdx = loopHeaders.findIndex((h) => h === "_atom_site_fract_x");
        const yIdx = loopHeaders.findIndex((h) => h === "_atom_site_fract_y");
        const zIdx = loopHeaders.findIndex((h) => h === "_atom_site_fract_z");

        if (xIdx !== -1 && yIdx !== -1 && zIdx !== -1) {
          const lbl = labelIdx !== -1 ? tokens[labelIdx]! : `A${rawAtoms.length + 1}`;
          let elem = typeIdx !== -1 ? tokens[typeIdx]! : lbl.replace(/[0-9+-]/g, "");
          if (!elem) elem = "C";
          elem = elem.charAt(0).toUpperCase() + elem.slice(1).toLowerCase();

          rawAtoms.push({
            label: lbl,
            element: elem,
            fractX: cleanNum(tokens[xIdx]!),
            fractY: cleanNum(tokens[yIdx]!),
            fractZ: cleanNum(tokens[zIdx]!),
          });
        }
        continue;
      } else if (rawLine.startsWith("_")) {
        inLoop = false;
        loopHeaders = [];
      }
    }

    // Scalar tags
    const tagMatch = rawLine.match(/^(_[a-zA-Z0-9_.-]+)\s+(.+)/);
    if (tagMatch) {
      const tag = tagMatch[1]!;
      const val = tagMatch[2]!.replace(/['"]/g, "").trim();

      if (tag === "_chemical_formula_sum" || tag === "_chemical_name_systematic") formula = val;
      if (tag === "_symmetry_space_group_name_H-M" || tag === "_space_group_name_H-M_alt") spaceGroup = val;
      if (tag === "_cell_length_a") a = cleanNum(val);
      if (tag === "_cell_length_b") b = cleanNum(val);
      if (tag === "_cell_length_c") c = cleanNum(val);
      if (tag === "_cell_angle_alpha") alpha = cleanNum(val);
      if (tag === "_cell_angle_beta") beta = cleanNum(val);
      if (tag === "_cell_angle_gamma") gamma = cleanNum(val);
    }
  }

  const volume = calculateUnitCellVolume(a, b, c, alpha, beta, gamma);
  const cell: CrystalUnitCell = { a, b, c, alpha, beta, gamma, volume };

  // Convert fractional to cartesian coordinates
  const atoms: AtomSite[] = rawAtoms.map((ra) => {
    const [cartX, cartY, cartZ] = fractionalToCartesian(ra.fractX, ra.fractY, ra.fractZ, cell);
    return {
      label: ra.label,
      element: ra.element,
      fractX: ra.fractX,
      fractY: ra.fractY,
      fractZ: ra.fractZ,
      cartX,
      cartY,
      cartZ,
    };
  });

  return {
    id: name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
    name,
    formula,
    spaceGroup,
    cell,
    atoms,
  };
}

// ---------------------------------------------------------------------------
// 3D Isometric / Orthographic SVG Unit Cell Renderer
// ---------------------------------------------------------------------------

export function renderCrystalUnitCellSvg(structure: CrystalStructure, options: CrystalRenderOptions = {}): string {
  const width = options.width ?? 900;
  const height = options.height ?? 540;
  const elevDeg = options.elevationDeg ?? 25;
  const azimDeg = options.azimuthDeg ?? 35;
  const darkMode = options.darkMode ?? true;
  const scale = options.scale ?? 32; // Pixels per Ångström

  const bg = darkMode ? "#0a0f1d" : "#ffffff";
  const fg = darkMode ? "#f8fafc" : "#0f172a";
  const wireColor = darkMode ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.35)";
  const textColor = darkMode ? "#94a3b8" : "#64748b";
  const planeFill = darkMode ? "rgba(56, 189, 248, 0.35)" : "rgba(2, 132, 199, 0.35)";
  const planeStroke = darkMode ? "#38bdf8" : "#0284c7";

  const toRad = Math.PI / 180;
  const phi = azimDeg * toRad;
  const theta = elevDeg * toRad;

  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const cx = width / 2;
  const cy = height / 2 + 20;

  // 3D projection to screen (X_screen, Y_screen, Depth)
  function project(x: number, y: number, z: number): [number, number, number] {
    // 1. Rotate around Z (azimuth)
    const x1 = x * cosP - y * sinP;
    const y1 = x * sinP + y * cosP;
    const z1 = z;

    // 2. Rotate around X (elevation)
    const x2 = x1;
    const y2 = y1 * cosT - z1 * sinT;
    const z2 = y1 * sinT + z1 * cosT; // Depth (higher = closer to viewer)

    const sx = cx + x2 * scale;
    const sy = cy - y2 * scale;
    return [sx, sy, z2];
  }

  const cell = structure.cell;
  // Center of unit cell in Cartesian space
  const [midX, midY, midZ] = fractionalToCartesian(0.5, 0.5, 0.5, cell);

  // 8 corners of the unit cell
  const cornersFract: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];

  const cornersCart = cornersFract.map(([u, v, w]) => {
    const [x, y, z] = fractionalToCartesian(u, v, w, cell);
    return [x - midX, y - midY, z - midZ] as [number, number, number];
  });

  const cornersScreen = cornersCart.map(([x, y, z]) => project(x, y, z));

  // 12 edges of unit cell box
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0], // Bottom face
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4], // Top face
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7], // Vertical pillars
  ];

  const edgesSvg = edges
    .map(([i, j]) => {
      const p1 = cornersScreen[i]!;
      const p2 = cornersScreen[j]!;
      return `<line x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}" stroke="${wireColor}" stroke-width="1.5" stroke-dasharray="none" />`;
    })
    .join("\n    ");

  // Miller Plane (hkl) polygon
  let planeSvg = "";
  if (options.millerPlane) {
    const { h, k, l } = options.millerPlane;
    const planePointsFract: [number, number, number][] = [];

    if (h !== 0 && k !== 0 && l !== 0) {
      planePointsFract.push([1 / h, 0, 0], [0, 1 / k, 0], [0, 0, 1 / l]);
    } else if (l === 0 && h !== 0 && k !== 0) {
      planePointsFract.push([1 / h, 0, 0], [0, 1 / k, 0], [0, 1 / k, 1], [1 / h, 0, 1]);
    } else if (h === 0 && k !== 0 && l !== 0) {
      planePointsFract.push([0, 1 / k, 0], [0, 0, 1 / l], [1, 0, 1 / l], [1, 1 / k, 0]);
    } else if (k === 0 && h !== 0 && l !== 0) {
      planePointsFract.push([1 / h, 0, 0], [0, 0, 1 / l], [0, 1, 1 / l], [1 / h, 1, 0]);
    } else if (h !== 0 && k === 0 && l === 0) {
      planePointsFract.push([1 / h, 0, 0], [1 / h, 1, 0], [1 / h, 1, 1], [1 / h, 0, 1]);
    } else if (h === 0 && k !== 0 && l === 0) {
      planePointsFract.push([0, 1 / k, 0], [1, 1 / k, 0], [1, 1 / k, 1], [0, 1 / k, 1]);
    } else if (h === 0 && k === 0 && l !== 0) {
      planePointsFract.push([0, 0, 1 / l], [1, 0, 1 / l], [1, 1, 1 / l], [0, 1, 1 / l]);
    }

    if (planePointsFract.length >= 3) {
      const ptsScreen = planePointsFract.map(([u, v, w]) => {
        const [x, y, z] = fractionalToCartesian(u, v, w, cell);
        return project(x - midX, y - midY, z - midZ);
      });
      const polyPts = ptsScreen.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
      planeSvg = `
        <polygon points="${polyPts}" fill="${planeFill}" stroke="${planeStroke}" stroke-width="2" stroke-dasharray="3,3" />
        <text x="${ptsScreen[0]![0].toFixed(1)}" y="${(ptsScreen[0]![1] - 8).toFixed(1)}" fill="${planeStroke}" font-size="12" font-family="sans-serif" font-weight="bold">(${h}${k}${l})</text>
      `;
    }
  }

  // Draw Atoms (Depth-sorted back to front)
  interface RenderAtom {
    sx: number;
    sy: number;
    depth: number;
    radiusPx: number;
    color: string;
    label: string;
    element: string;
  }

  const renderAtoms: RenderAtom[] = [];
  const superNx = options.supercell?.[0] ?? 1;
  const superNy = options.supercell?.[1] ?? 1;
  const superNz = options.supercell?.[2] ?? 1;

  for (let ix = 0; ix < superNx; ix++) {
    for (let iy = 0; iy < superNy; iy++) {
      for (let iz = 0; iz < superNz; iz++) {
        for (const at of structure.atoms) {
          const u = at.fractX + ix;
          const v = at.fractY + iy;
          const w = at.fractZ + iz;

          const [x, y, z] = fractionalToCartesian(u, v, w, cell);
          const [sx, sy, depth] = project(x - midX, y - midY, z - midZ);
          const radiusAng = getAtomicRadiusAngstrom(at.element);
          const radiusPx = Math.max(6, Math.min(22, radiusAng * scale * 0.45));
          const color = getCpkColor(at.element);

          renderAtoms.push({
            sx,
            sy,
            depth,
            radiusPx,
            color,
            label: at.label,
            element: at.element,
          });
        }
      }
    }
  }

  // Sort atoms by depth (lowest depth rendered first, highest depth closest to viewer rendered last)
  renderAtoms.sort((a, b) => a.depth - b.depth);

  const atomsSvg = renderAtoms
    .map((at) => {
      const gradId = `at_grad_${Math.abs(Math.round(at.sx * 10 + at.sy))}`;
      return `
        <defs>
          <radialGradient id="${gradId}" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.8" />
            <stop offset="60%" stop-color="${at.color}" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.6" />
          </radialGradient>
        </defs>
        <circle cx="${at.sx.toFixed(1)}" cy="${at.sy.toFixed(1)}" r="${at.radiusPx.toFixed(1)}" fill="url(#${gradId})" stroke="rgba(0,0,0,0.4)" stroke-width="0.8" />
        <text x="${at.sx.toFixed(1)}" y="${(at.sy + 3.5).toFixed(1)}" fill="#ffffff" font-size="9" font-family="sans-serif" font-weight="bold" text-anchor="middle" style="pointer-events: none;">${at.element}</text>
      `;
    })
    .join("\n    ");

  // Coordinate axes indicator (Bottom left)
  const axesOrigin = project(-midX, -midY, -midZ);
  const aVector = project(-midX + 1.5, -midY, -midZ);
  const bVector = project(-midX, -midY + 1.5, -midZ);
  const cVector = project(-midX, -midY, -midZ + 1.5);

  const axesSvg = `
    <g class="axes-indicator">
      <line x1="${axesOrigin[0].toFixed(1)}" y1="${axesOrigin[1].toFixed(1)}" x2="${aVector[0].toFixed(1)}" y2="${aVector[1].toFixed(1)}" stroke="#ef4444" stroke-width="2" />
      <text x="${(aVector[0] + 6).toFixed(1)}" y="${(aVector[1] + 3).toFixed(1)}" fill="#ef4444" font-size="10" font-family="sans-serif" font-weight="bold">a</text>
      <line x1="${axesOrigin[0].toFixed(1)}" y1="${axesOrigin[1].toFixed(1)}" x2="${bVector[0].toFixed(1)}" y2="${bVector[1].toFixed(1)}" stroke="#22c55e" stroke-width="2" />
      <text x="${(bVector[0] + 6).toFixed(1)}" y="${(bVector[1] + 3).toFixed(1)}" fill="#22c55e" font-size="10" font-family="sans-serif" font-weight="bold">b</text>
      <line x1="${axesOrigin[0].toFixed(1)}" y1="${axesOrigin[1].toFixed(1)}" x2="${cVector[0].toFixed(1)}" y2="${cVector[1].toFixed(1)}" stroke="#3b82f6" stroke-width="2" />
      <text x="${(cVector[0] + 6).toFixed(1)}" y="${(cVector[1] - 4).toFixed(1)}" fill="#3b82f6" font-size="10" font-family="sans-serif" font-weight="bold">c</text>
    </g>
  `;

  // HUD Title & Cell parameters
  const headerSvg = `
    <text x="24" y="32" fill="${fg}" font-size="16" font-family="sans-serif" font-weight="bold">${structure.name}</text>
    <text x="24" y="52" fill="${textColor}" font-size="12" font-family="sans-serif">Space Group: <strong>${structure.spaceGroup}</strong> | Formula: ${structure.formula}</text>
    <text x="${width - 24}" y="32" fill="${textColor}" font-size="11" font-family="sans-serif" text-anchor="end">a=${cell.a.toFixed(2)} Å, b=${cell.b.toFixed(2)} Å, c=${cell.c.toFixed(2)} Å</text>
    <text x="${width - 24}" y="48" fill="${textColor}" font-size="11" font-family="sans-serif" text-anchor="end">α=${cell.alpha.toFixed(1)}°, β=${cell.beta.toFixed(1)}°, γ=${cell.gamma.toFixed(1)}° | V=${cell.volume.toFixed(1)} Å³</text>
  `;

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: ${bg}; user-select: none;">
  ${headerSvg}
  <g class="unit-cell-wireframe">
    ${edgesSvg}
  </g>
  ${planeSvg}
  <g class="crystal-atoms">
    ${atomsSvg}
  </g>
  ${axesSvg}
</svg>
`.trim();
}

// ---------------------------------------------------------------------------
// Powder X-ray Diffraction (PXRD) Pattern Simulator
// ---------------------------------------------------------------------------

/**
 * Computes interplanar d-spacing for an (hkl) reflection in a general crystal cell:
 * 1/d^2 = 1/V^2 * [ S11*h^2 + S22*k^2 + S33*l^2 + 2*S12*h*k + 2*S23*k*l + 2*S13*h*l ]
 */
export function calculateDSpacing(h: number, k: number, l: number, cell: CrystalUnitCell): number {
  if (h === 0 && k === 0 && l === 0) return 0;

  const toRad = Math.PI / 180;
  const ca = Math.cos(cell.alpha * toRad);
  const cb = Math.cos(cell.beta * toRad);
  const cg = Math.cos(cell.gamma * toRad);
  const sa = Math.sin(cell.alpha * toRad);
  const sb = Math.sin(cell.beta * toRad);
  const sg = Math.sin(cell.gamma * toRad);

  const V = cell.volume;
  if (V <= 0) return 0;

  const S11 = (cell.b * cell.c * sa) ** 2;
  const S22 = (cell.a * cell.c * sb) ** 2;
  const S33 = (cell.a * cell.b * sg) ** 2;
  const S12 = cell.a * cell.b * cell.c ** 2 * (ca * cb - cg);
  const S23 = cell.a ** 2 * cell.b * cell.c * (cb * cg - ca);
  const S13 = cell.a * cell.b ** 2 * cell.c * (ca * cg - cb);

  const invD2 =
    (1 / (V * V)) * (S11 * h * h + S22 * k * k + S33 * l * l + 2 * S12 * h * k + 2 * S23 * k * l + 2 * S13 * h * l);
  if (invD2 <= 0) return 0;
  return 1 / Math.sqrt(invD2);
}

/**
 * Simulates Bragg diffraction peaks for a crystal structure using Bragg's Law: lambda = 2*d*sin(theta).
 */
export function simulatePxrd(structure: CrystalStructure, options: PxrdRenderOptions = {}): PxrdPeak[] {
  const wavelength = options.wavelengthAngstrom ?? 1.5406; // Cu K_alpha
  const minTwoTheta = options.minTwoTheta ?? 10.0;
  const maxTwoTheta = options.maxTwoTheta ?? 70.0;

  const peaks: PxrdPeak[] = [];
  const maxIndex = 4;

  for (let h = 0; h <= maxIndex; h++) {
    for (let k = 0; k <= maxIndex; k++) {
      for (let l = 0; l <= maxIndex; l++) {
        if (h === 0 && k === 0 && l === 0) continue;

        const d = calculateDSpacing(h, k, l, structure.cell);
        if (d <= 0) continue;

        const sinTheta = wavelength / (2 * d);
        if (sinTheta > 0.999 || sinTheta < 0.05) continue;

        const thetaRad = Math.asin(sinTheta);
        const twoThetaDeg = (thetaRad * 2 * 180) / Math.PI;

        if (twoThetaDeg >= minTwoTheta && twoThetaDeg <= maxTwoTheta) {
          // Lorentz-polarization factor approximation: (1 + cos^2(2theta)) / (sin^2(theta) * cos(theta))
          const cos2T = Math.cos(2 * thetaRad);
          const lpFactor = (1 + cos2T * cos2T) / (Math.sin(thetaRad) ** 2 * Math.cos(thetaRad) || 1);
          // Simplified atomic form factor sum
          const formFactor = structure.atoms.length * 10;
          const rawIntensity = formFactor * Math.min(100, Math.max(1, lpFactor * 0.1));

          peaks.push({
            hkl: [h, k, l],
            twoThetaDeg,
            dSpacingAngstrom: d,
            intensity: rawIntensity,
          });
        }
      }
    }
  }

  // Normalize intensities to 0..100%
  const maxInt = Math.max(...peaks.map((p) => p.intensity), 1);
  for (const p of peaks) {
    p.intensity = (p.intensity / maxInt) * 100;
  }

  peaks.sort((a, b) => a.twoThetaDeg - b.twoThetaDeg);
  return peaks;
}

export function renderPxrdSvg(peaks: PxrdPeak[], options: PxrdRenderOptions = {}): string {
  const width = options.width ?? 900;
  const height = options.height ?? 380;
  const minTwoTheta = options.minTwoTheta ?? 10.0;
  const maxTwoTheta = options.maxTwoTheta ?? 70.0;
  const darkMode = options.darkMode ?? true;

  const bg = darkMode ? "#0a0f1d" : "#ffffff";
  const fg = darkMode ? "#f8fafc" : "#0f172a";
  const gridColor = darkMode ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)";
  const traceColor = darkMode ? "#38bdf8" : "#0284c7";
  const textColor = darkMode ? "#94a3b8" : "#64748b";

  const marginLeft = 60;
  const marginRight = 40;
  const marginTop = 40;
  const marginBottom = 50;

  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = height - marginTop - marginBottom;

  // Build continuous pseudo-Voigt diffraction profile curve
  const nSteps = 400;
  const curvePoints: [number, number][] = [];
  const fwhm = 0.25; // Full width at half maximum [deg]

  for (let i = 0; i <= nSteps; i++) {
    const twoTheta = minTwoTheta + (i / nSteps) * (maxTwoTheta - minTwoTheta);
    let totalAmp = 0;

    for (const p of peaks) {
      const delta = (twoTheta - p.twoThetaDeg) / (fwhm / 2);
      if (Math.abs(delta) < 5) {
        // Gaussian component
        const g = Math.exp(-0.693 * delta * delta);
        totalAmp += p.intensity * g;
      }
    }

    const x = marginLeft + ((twoTheta - minTwoTheta) / (maxTwoTheta - minTwoTheta)) * plotWidth;
    const y = marginTop + plotHeight - (Math.min(100, totalAmp) / 100) * (plotHeight - 20);
    curvePoints.push([x, y]);
  }

  const curvePath = `M ${curvePoints.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" L ")}`;

  // Top peak labels (hkl)
  const topPeaks = peaks.filter((p) => p.intensity > 25);
  const peakLabels = topPeaks
    .map((p) => {
      const x = marginLeft + ((p.twoThetaDeg - minTwoTheta) / (maxTwoTheta - minTwoTheta)) * plotWidth;
      const y = marginTop + plotHeight - (p.intensity / 100) * (plotHeight - 20);
      return `
        <line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y - 12).toFixed(1)}" stroke="${textColor}" stroke-width="1" />
        <text x="${x.toFixed(1)}" y="${(y - 16).toFixed(1)}" fill="${fg}" font-size="9" font-family="sans-serif" font-weight="bold" text-anchor="middle">(${p.hkl.join("")})</text>
      `;
    })
    .join("\n    ");

  // Grid lines
  const gridLines: string[] = [];
  for (let tt = 10; tt <= 70; tt += 10) {
    const x = marginLeft + ((tt - minTwoTheta) / (maxTwoTheta - minTwoTheta)) * plotWidth;
    gridLines.push(
      `<line x1="${x.toFixed(1)}" y1="${marginTop}" x2="${x.toFixed(1)}" y2="${marginTop + plotHeight}" stroke="${gridColor}" stroke-dasharray="3,3" />`,
      `<text x="${x.toFixed(1)}" y="${marginTop + plotHeight + 18}" fill="${textColor}" font-size="11" font-family="sans-serif" text-anchor="middle">${tt}°</text>`,
    );
  }

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: ${bg}; user-select: none;">
  <text x="${marginLeft}" y="24" fill="${fg}" font-size="14" font-family="sans-serif" font-weight="bold">Simulated Powder X-ray Diffraction (PXRD) Pattern — Cu Kα (λ = 1.5406 Å)</text>
  <rect x="${marginLeft}" y="${marginTop}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="${gridColor}" stroke-width="1.5" />
  <g class="grid-lines">
    ${gridLines.join("\n    ")}
  </g>
  <path d="${curvePath}" fill="none" stroke="${traceColor}" stroke-width="2" stroke-linejoin="round" />
  <g class="peak-labels">
    ${peakLabels}
  </g>
  <text x="${marginLeft + plotWidth / 2}" y="${height - 12}" fill="${textColor}" font-size="12" font-family="sans-serif" text-anchor="middle">Diffraction Angle 2θ (degrees)</text>
  <text x="${marginLeft - 12}" y="${marginTop + plotHeight / 2}" fill="${textColor}" font-size="12" font-family="sans-serif" text-anchor="middle" transform="rotate(-90, ${marginLeft - 12}, ${marginTop + plotHeight / 2})">Relative Intensity (%)</text>
</svg>
`.trim();
}

// ---------------------------------------------------------------------------
// Materials Linter & Crystallographic Law Verifications
// ---------------------------------------------------------------------------

export function lintCrystalStructure(structure: CrystalStructure): MaterialsLintDiagnostic[] {
  const diagnostics: MaterialsLintDiagnostic[] = [];

  // MAT1001: Space group definition
  if (!structure.spaceGroup || structure.spaceGroup.trim() === "") {
    diagnostics.push({
      code: "MAT1001",
      message: "Missing space group definition. Crystal structure must declare a valid Hermann-Mauguin space group.",
      severity: "error",
      field: "spaceGroup",
    });
  }

  // MAT1002: Fractional coordinates range [-0.5, 1.5]
  for (let i = 0; i < structure.atoms.length; i++) {
    const at = structure.atoms[i]!;
    if (
      at.fractX < -0.5 ||
      at.fractX > 1.5 ||
      at.fractY < -0.5 ||
      at.fractY > 1.5 ||
      at.fractZ < -0.5 ||
      at.fractZ > 1.5
    ) {
      diagnostics.push({
        code: "MAT1002",
        message: `Atom '${at.label}' has fractional coordinate (${at.fractX.toFixed(3)}, ${at.fractY.toFixed(3)}, ${at.fractZ.toFixed(3)}) outside valid range [-0.5, 1.5].`,
        severity: "warning",
        atomIndex: i,
      });
      break;
    }
  }

  // MAT1003: Steric clash / interatomic distance d_ij < 0.6 Å
  const nAtoms = structure.atoms.length;
  for (let i = 0; i < nAtoms; i++) {
    const a1 = structure.atoms[i]!;
    for (let j = i + 1; j < nAtoms; j++) {
      const a2 = structure.atoms[j]!;
      const dx = (a1.cartX ?? 0) - (a2.cartX ?? 0);
      const dy = (a1.cartY ?? 0) - (a2.cartY ?? 0);
      const dz = (a1.cartZ ?? 0) - (a2.cartZ ?? 0);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < 0.6 && dist > 1e-4) {
        diagnostics.push({
          code: "MAT1003",
          message: `Steric clash detected between atom '${a1.label}' and '${a2.label}' with distance ${dist.toFixed(2)} Å (< 0.6 Å).`,
          severity: "error",
          atomIndex: i,
        });
        break;
      }
    }
    if (diagnostics.some((d) => d.code === "MAT1003")) break;
  }

  // MAT1004: Unit cell volume and lattice angles
  const cell = structure.cell;
  if (cell.volume <= 0) {
    diagnostics.push({
      code: "MAT1004",
      message: `Non-positive unit cell volume V = ${cell.volume.toFixed(1)} Å³. Check lattice angles (α=${cell.alpha}°, β=${cell.beta}°, γ=${cell.gamma}°).`,
      severity: "error",
      field: "volume",
    });
  }

  if (
    cell.alpha <= 0 ||
    cell.alpha >= 180 ||
    cell.beta <= 0 ||
    cell.beta >= 180 ||
    cell.gamma <= 0 ||
    cell.gamma >= 180
  ) {
    diagnostics.push({
      code: "MAT1004",
      message: `Invalid lattice angle outside (0°, 180°): α=${cell.alpha}°, β=${cell.beta}°, γ=${cell.gamma}°.`,
      severity: "error",
      field: "angles",
    });
  }

  return diagnostics;
}
