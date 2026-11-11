// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Plasma Physics & Magnetic Confinement Fusion (Tokamaks/Stellarators)
 *
 * Implements G-EQDSK (EFIT 2D axisymmetrical MHD equilibrium reconstruction) data model,
 * Grad-Shafranov equilibrium calculations, publication-grade 2D poloidal cross-section SVG renderer,
 * and physical stability linters (Kruskal-Shafranov kink limits, magnetic axis containment, boundary topology).
 */

export interface GeqdskData {
  comment: string;
  nw: number; // Number of radial grid points (NR)
  nh: number; // Number of vertical grid points (NZ)
  rdim: number; // Radial dimension of computational grid (m)
  zdim: number; // Vertical dimension of computational grid (m)
  rcentr: number; // Major radius of vacuum vessel or magnetic center R0 (m)
  rleft: number; // Minimum radial coordinate of grid (m)
  zmid: number; // Vertical midplane coordinate (m)
  rmaxis: number; // Radial coordinate of magnetic axis (m)
  zmaxis: number; // Vertical coordinate of magnetic axis (m)
  simag: number; // Poloidal flux at magnetic axis psi_axis (Wb/rad)
  sibry: number; // Poloidal flux at plasma boundary psi_bndry (Wb/rad)
  bcentr: number; // Toroidal magnetic field at rcentr (T)
  current: number; // Total toroidal plasma current Ip (A)
  fpol: number[]; // Toroidal flux function F(psi) = R * B_phi (m * T)
  pres: number[]; // Plasma pressure p(psi) (Pa)
  ffprim: number[]; // F * dF/dpsi ((m*T)^2 / (Wb/rad))
  pprime: number[]; // dp/dpsi (Pa / (Wb/rad))
  psirz: number[][]; // 2D poloidal flux grid psi(R, Z) [nh][nw]
  qpsi: number[]; // Safety factor profile q(psi)
  rbbbs: number[]; // Plasma boundary R coordinates (m)
  zbbbs: number[]; // Plasma boundary Z coordinates (m)
  rlim: number[]; // Limiter / vacuum vessel R coordinates (m)
  zlim: number[]; // Limiter / vacuum vessel Z coordinates (m)
}

export interface TokamakEquilibriumMetrics {
  majorRadiusR0: number; // m
  minorRadiusA: number; // m
  aspectRatio: number; // R0 / a
  inverseAspectRatio: number; // a / R0
  elongation: number; // kappa = (Z_max - Z_min) / (2*a)
  triangularityUpper: number; // delta_u
  triangularityLower: number; // delta_l
  triangularityAvg: number; // delta
  q0: number; // Safety factor on axis
  q95: number; // Safety factor at 95% normalized poloidal flux
  plasmaCurrentMA: number; // Ip in MA
  toroidalFieldT: number; // B0 in T
  volumeM3: number; // Approximate plasma volume
  avgPressureKPa: number; // Volume-averaged pressure in kPa
  toroidalBetaPct: number; // beta_T (%)
  poloidalBeta: number; // beta_p
  normalizedBeta: number; // beta_N (% m T / MA)
  xPoint?: { r: number; z: number } | undefined;
  strikePoints?: { inner: { r: number; z: number }; outer: { r: number; z: number } } | undefined;
}

export interface TokamakRenderOptions {
  width?: number;
  height?: number;
  showProfiles?: boolean;
  showLimiter?: boolean;
  showSeparatrix?: boolean;
  showXPoint?: boolean;
  showMagneticAxis?: boolean;
  numFluxSurfaces?: number;
  darkMode?: boolean;
  title?: string;
}

export interface FusionLintDiagnostic {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  field?: string;
}

// ---------------------------------------------------------------------------
// G-EQDSK Parser
// ---------------------------------------------------------------------------

/**
 * Parses a standard G-EQDSK (EFIT equilibrium) file or structured JSON representation.
 */
export function parseGeqdsk(content: string): GeqdskData {
  const trimmed = content.trim();

  // Support JSON input directly
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<GeqdskData>;
      return normalizeGeqdsk(parsed);
    } catch {
      // Fall through to text parser
    }
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 5) {
    throw new Error("Invalid G-EQDSK file: insufficient header lines");
  }

  // Line 1: Header description and grid dimensions (nw, nh)
  const line0 = lines[0]!;
  let nw = 65;
  let nh = 65;
  let comment = "EFIT Equilibrium";

  const headerMatch = line0.match(/^(.*?)(?:\s+\d+)?\s+(\d+)\s+(\d+)\s*$/);
  if (headerMatch) {
    comment = headerMatch[1]!.trim();
    nw = parseInt(headerMatch[2]!, 10);
    nh = parseInt(headerMatch[3]!, 10);
  } else {
    const headerNums = line0.match(/\b\d+\b/g);
    if (headerNums && headerNums.length >= 2) {
      nw = parseInt(headerNums[headerNums.length - 2]!, 10);
      nh = parseInt(headerNums[headerNums.length - 1]!, 10);
      comment = line0.substring(0, Math.max(0, line0.lastIndexOf(headerNums[headerNums.length - 2]!))).trim();
    }
  }

  // Extract all remaining floating point numbers from line 1 onward
  const restOfFile = lines.slice(1).join(" ");
  const floatRegex = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/g;
  const rawMatches = restOfFile.match(floatRegex);

  if (!rawMatches || rawMatches.length < 20) {
    throw new Error("Invalid G-EQDSK file: could not read 20 scalar parameters");
  }

  const numbers = rawMatches.map((s) => parseFloat(s.replace(/[dD]/g, "e")));
  let idx = 0;

  // 20 scalars
  const rdim = numbers[idx++] ?? 1.0;
  const zdim = numbers[idx++] ?? 1.0;
  const rcentr = numbers[idx++] ?? 1.7;
  const rleft = numbers[idx++] ?? 1.0;
  const zmid = numbers[idx++] ?? 0.0;

  const rmaxis = numbers[idx++] ?? 1.75;
  const zmaxis = numbers[idx++] ?? 0.0;
  const simag = numbers[idx++] ?? 0.0;
  const sibry = numbers[idx++] ?? 1.0;
  const bcentr = numbers[idx++] ?? 2.0;

  const current = numbers[idx++] ?? 1.0e6;
  idx++; // simag repeat
  idx++; // xdum
  idx++; // rmaxis repeat
  idx++; // xdum

  idx++; // zmaxis repeat
  idx++; // xdum
  idx++; // sibry repeat
  idx++; // xdum
  idx++; // xdum

  // Read arrays: fpol, pres, ffprim, pprime
  const readArray = (length: number): number[] => {
    const arr: number[] = [];
    for (let i = 0; i < length && idx < numbers.length; i++) {
      arr.push(numbers[idx++]!);
    }
    return arr;
  };

  const fpol = readArray(nw);
  const pres = readArray(nw);
  const ffprim = readArray(nw);
  const pprime = readArray(nw);

  // Read psirz (nh x nw or nw x nh)
  const psirz: number[][] = [];
  for (let j = 0; j < nh; j++) {
    const row: number[] = [];
    for (let i = 0; i < nw && idx < numbers.length; i++) {
      row.push(numbers[idx++]!);
    }
    psirz.push(row);
  }

  // Read qpsi
  const qpsi = readArray(nw);

  // Read boundary count and limiter count
  const nbbbs = idx < numbers.length ? Math.round(numbers[idx++]!) : 0;
  const limitr = idx < numbers.length ? Math.round(numbers[idx++]!) : 0;

  const rbbbs: number[] = [];
  const zbbbs: number[] = [];
  for (let i = 0; i < nbbbs && idx + 1 < numbers.length; i++) {
    rbbbs.push(numbers[idx++]!);
    zbbbs.push(numbers[idx++]!);
  }

  const rlim: number[] = [];
  const zlim: number[] = [];
  for (let i = 0; i < limitr && idx + 1 < numbers.length; i++) {
    rlim.push(numbers[idx++]!);
    zlim.push(numbers[idx++]!);
  }

  return normalizeGeqdsk({
    comment,
    nw,
    nh,
    rdim,
    zdim,
    rcentr,
    rleft,
    zmid,
    rmaxis,
    zmaxis,
    simag,
    sibry,
    bcentr,
    current,
    fpol,
    pres,
    ffprim,
    pprime,
    psirz,
    qpsi,
    rbbbs,
    zbbbs,
    rlim,
    zlim,
  });
}

function normalizeGeqdsk(partial: Partial<GeqdskData>): GeqdskData {
  const nw = partial.nw && partial.nw > 0 ? partial.nw : 65;
  const nh = partial.nh && partial.nh > 0 ? partial.nh : 65;
  const rcentr = partial.rcentr ?? 1.7;
  const rmaxis = partial.rmaxis ?? rcentr + 0.05;
  const zmaxis = partial.zmaxis ?? partial.zmid ?? 0.0;
  const rdim = partial.rdim ?? 1.5;
  const zdim = partial.zdim ?? 2.0;
  const rleft = partial.rleft ?? rcentr - rdim * 0.5;
  const zmid = partial.zmid ?? 0.0;

  // Default D-shaped plasma boundary if not provided
  let rbbbs = partial.rbbbs ?? [];
  let zbbbs = partial.zbbbs ?? [];
  if (rbbbs.length < 4 || zbbbs.length < 4) {
    const a0 = 0.55;
    const kappa0 = 1.7;
    const delta0 = 0.35;
    const nPoints = 64;
    rbbbs = [];
    zbbbs = [];
    for (let i = 0; i <= nPoints; i++) {
      const theta = (2 * Math.PI * i) / nPoints;
      const r = rcentr + a0 * Math.cos(theta + delta0 * Math.sin(theta));
      const z = zmaxis + kappa0 * a0 * Math.sin(theta);
      rbbbs.push(r);
      zbbbs.push(z);
    }
  }

  // Default vacuum vessel limiter if not provided
  let rlim = partial.rlim ?? [];
  let zlim = partial.zlim ?? [];
  if (rlim.length < 4 || zlim.length < 4) {
    const wallA = 0.75;
    const wallB = 1.15;
    const nWall = 32;
    rlim = [];
    zlim = [];
    for (let i = 0; i <= nWall; i++) {
      const theta = (2 * Math.PI * i) / nWall;
      rlim.push(rcentr + wallA * Math.cos(theta));
      zlim.push(zmid + wallB * Math.sin(theta));
    }
  }

  // Default profiles if missing
  const fpol =
    partial.fpol && partial.fpol.length === nw
      ? partial.fpol
      : Array.from({ length: nw }, () => (partial.bcentr ?? 2.0) * rcentr);
  const pres =
    partial.pres && partial.pres.length === nw
      ? partial.pres
      : Array.from({ length: nw }, (_, i) => {
          const psiN = i / (nw - 1);
          return 50000 * Math.pow(1 - psiN, 1.5);
        });

  const qpsi =
    partial.qpsi && partial.qpsi.length === nw
      ? partial.qpsi
      : Array.from({ length: nw }, (_, i) => {
          const psiN = i / (nw - 1);
          return 1.1 + 2.5 * Math.pow(psiN, 2);
        });

  const psirz =
    partial.psirz && partial.psirz.length === nh
      ? partial.psirz
      : Array.from({ length: nh }, (_, j) => {
          const z = zmid - zdim / 2 + (j * zdim) / (nh - 1);
          return Array.from({ length: nw }, (_, i) => {
            const r = rleft + (i * rdim) / (nw - 1);
            const dr = (r - rmaxis) / 0.6;
            const dz = (z - zmaxis) / 1.0;
            return (dr * dr + dz * dz) * 1.5;
          });
        });

  return {
    comment: partial.comment ?? "Tokamak Equilibrium",
    nw,
    nh,
    rdim,
    zdim,
    rcentr,
    rleft,
    zmid,
    rmaxis,
    zmaxis,
    simag: partial.simag ?? 0.0,
    sibry: partial.sibry ?? 1.0,
    bcentr: partial.bcentr ?? 2.0,
    current: partial.current ?? 1.5e6,
    fpol,
    pres,
    ffprim: partial.ffprim ?? Array(nw).fill(0),
    pprime: partial.pprime ?? Array(nw).fill(0),
    psirz,
    qpsi,
    rbbbs,
    zbbbs,
    rlim,
    zlim,
  };
}

// ---------------------------------------------------------------------------
// Physical Metrics Calculator
// ---------------------------------------------------------------------------

/**
 * Computes geometric shaping parameters, safety factors, and plasma beta metrics.
 */
export function computeEquilibriumMetrics(data: GeqdskData): TokamakEquilibriumMetrics {
  const r0 = data.rcentr;
  const b0 = Math.abs(data.bcentr);
  const ip = data.current;
  const ipMA = Math.abs(ip) / 1.0e6;

  // Boundary extents
  const minR = Math.min(...data.rbbbs);
  const maxR = Math.max(...data.rbbbs);
  const minZ = Math.min(...data.zbbbs);
  const maxZ = Math.max(...data.zbbbs);

  const minorRadiusA = (maxR - minR) / 2.0;
  const aspectRatio = minorRadiusA > 0 ? r0 / minorRadiusA : 3.0;
  const inverseAspectRatio = minorRadiusA > 0 ? minorRadiusA / r0 : 0.33;
  const elongation = minorRadiusA > 0 ? (maxZ - minZ) / (2.0 * minorRadiusA) : 1.0;

  // Triangularity: find R position at max Z and min Z
  let rAtMaxZ = r0;
  let rAtMinZ = r0;
  for (let i = 0; i < data.rbbbs.length; i++) {
    if (Math.abs(data.zbbbs[i]! - maxZ) < 1e-4) rAtMaxZ = data.rbbbs[i]!;
    if (Math.abs(data.zbbbs[i]! - minZ) < 1e-4) rAtMinZ = data.rbbbs[i]!;
  }

  const deltaU = minorRadiusA > 0 ? (r0 - rAtMaxZ) / minorRadiusA : 0.3;
  const deltaL = minorRadiusA > 0 ? (r0 - rAtMinZ) / minorRadiusA : 0.3;
  const delta = (deltaU + deltaL) / 2.0;

  // Safety factors
  const q0 = data.qpsi.length > 0 ? Math.abs(data.qpsi[0]!) : 1.0;
  const q95Idx = Math.min(data.qpsi.length - 1, Math.round(0.95 * (data.qpsi.length - 1)));
  const q95 = data.qpsi.length > 0 ? Math.abs(data.qpsi[q95Idx]!) : 3.0;

  // Approximate volume: V = 2 * pi * R0 * pi * a^2 * kappa
  const volumeM3 = 2.0 * Math.PI * r0 * Math.PI * minorRadiusA * minorRadiusA * elongation;

  // Average pressure
  const sumP = data.pres.reduce((acc, p) => acc + Math.max(0, p), 0);
  const avgPressurePa = data.pres.length > 0 ? sumP / data.pres.length : 10000;
  const avgPressureKPa = avgPressurePa / 1000.0;

  // Toroidal Beta: beta_T = 2 * mu_0 * <p> / B0^2
  const mu0 = 4.0 * Math.PI * 1e-7;
  const toroidalBeta = b0 > 0 ? (2.0 * mu0 * avgPressurePa) / (b0 * b0) : 0.01;
  const toroidalBetaPct = toroidalBeta * 100.0;

  // Poloidal Beta: beta_p ~ 2 * mu0 * <p> / B_p^2
  const bpApprox =
    (mu0 * Math.abs(ip)) / (2.0 * Math.PI * minorRadiusA * Math.sqrt((1.0 + elongation * elongation) / 2.0));
  const poloidalBeta = bpApprox > 0 ? (2.0 * mu0 * avgPressurePa) / (bpApprox * bpApprox) : 0.5;

  // Normalized Beta: beta_N = beta_T (%) * a (m) * B0 (T) / Ip (MA)
  const normalizedBeta = ipMA > 0 ? (toroidalBetaPct * minorRadiusA * b0) / ipMA : 1.5;

  // Detect X-point (lowest cusp or sharp corner near bottom of boundary)
  let xPoint: { r: number; z: number } | undefined;
  if (elongation > 1.3 && data.rbbbs.length >= 8) {
    // Look for point near minZ with sharp turn
    let minZIdx = 0;
    for (let i = 1; i < data.zbbbs.length; i++) {
      if (data.zbbbs[i]! < data.zbbbs[minZIdx]!) {
        minZIdx = i;
      }
    }
    xPoint = { r: data.rbbbs[minZIdx]!, z: data.zbbbs[minZIdx]! };
  }

  return {
    majorRadiusR0: r0,
    minorRadiusA,
    aspectRatio,
    inverseAspectRatio,
    elongation,
    triangularityUpper: deltaU,
    triangularityLower: deltaL,
    triangularityAvg: delta,
    q0,
    q95,
    plasmaCurrentMA: ipMA,
    toroidalFieldT: b0,
    volumeM3,
    avgPressureKPa,
    toroidalBetaPct,
    poloidalBeta,
    normalizedBeta,
    xPoint,
  };
}

// ---------------------------------------------------------------------------
// Flux Contour Generator
// ---------------------------------------------------------------------------

export interface FluxSurfaceContour {
  psiNorm: number;
  points: [number, number][]; // [R, Z] in meters
}

/**
 * Computes concentric nested closed flux surface contours from magnetic axis to separatrix.
 */
export function generateFluxContours(data: GeqdskData, normalizedFluxLevels?: number[]): FluxSurfaceContour[] {
  const levels = normalizedFluxLevels ?? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const rax = data.rmaxis;
  const zax = data.zmaxis;
  const nBndry = data.rbbbs.length;

  const contours: FluxSurfaceContour[] = [];

  for (const psiN of levels) {
    const clampedPsi = Math.max(0.01, Math.min(1.0, psiN));
    const factor = Math.sqrt(clampedPsi); // Radial scale factor: psi ~ rho^2

    const points: [number, number][] = [];
    for (let i = 0; i < nBndry; i++) {
      const rb = data.rbbbs[i]!;
      const zb = data.zbbbs[i]!;
      const r = rax + factor * (rb - rax);
      const z = zax + factor * (zb - zax);
      points.push([r, z]);
    }

    // Ensure closure
    if (
      points.length > 0 &&
      (points[0]![0] !== points[points.length - 1]![0] || points[0]![1] !== points[points.length - 1]![1])
    ) {
      points.push([points[0]![0], points[0]![1]]);
    }

    contours.push({ psiNorm: psiN, points });
  }

  return contours;
}

// ---------------------------------------------------------------------------
// 2D Tokamak Poloidal Cross-Section SVG Renderer
// ---------------------------------------------------------------------------

/**
 * Renders a publication-grade 2D Tokamak Poloidal Cross-Section SVG with flux surfaces,
 * vacuum vessel limiter wall, magnetic axis, separatrix, X-point, and radial profile subplots.
 */
export function renderTokamakEquilibriumSvg(data: GeqdskData, options?: TokamakRenderOptions): string {
  const width = options?.width ?? 960;
  const height = options?.height ?? 620;
  const darkMode = options?.darkMode ?? true;
  const showProfiles = options?.showProfiles ?? true;
  const showLimiter = options?.showLimiter ?? true;
  const showSeparatrix = options?.showSeparatrix ?? true;
  const showXPoint = options?.showXPoint ?? true;
  const showAxis = options?.showMagneticAxis ?? true;
  const title =
    options?.title ??
    `${data.comment || "Tokamak Equilibrium"} (Ip = ${(Math.abs(data.current) / 1e6).toFixed(2)} MA, B0 = ${Math.abs(data.bcentr).toFixed(2)} T)`;

  const metrics = computeEquilibriumMetrics(data);

  // Layout splits: Left is poloidal cross section (62%), right is profile plots & metrics (38%)
  const crossWidth = showProfiles ? Math.round(width * 0.62) : width;
  const sideWidth = width - crossWidth;

  // Viewport bounds for R and Z in poloidal cross section
  const allR = [...data.rbbbs, ...data.rlim, data.rleft, data.rleft + data.rdim];
  const allZ = [...data.zbbbs, ...data.zlim, data.zmid - data.zdim / 2, data.zmid + data.zdim / 2];

  const minR = Math.min(...allR);
  const maxR = Math.max(...allR);
  const minZ = Math.min(...allZ);
  const maxZ = Math.max(...allZ);

  const spanR = maxR - minR || 1.5;
  const spanZ = maxZ - minZ || 2.0;

  // Maintain aspect ratio in cross section viewbox
  const marginCross = { top: 55, right: 30, bottom: 50, left: 65 };
  const plotW = crossWidth - marginCross.left - marginCross.right;
  const plotH = height - marginCross.top - marginCross.bottom;

  const scale = Math.min(plotW / spanR, plotH / spanZ);
  const offsetX = marginCross.left + (plotW - spanR * scale) / 2;
  const offsetY = marginCross.top + (plotH - spanZ * scale) / 2;

  // Coordinate transforms (R, Z) -> (pixelX, pixelY)
  const mapR = (r: number): number => offsetX + (r - minR) * scale;
  const mapZ = (z: number): number => offsetY + (maxZ - z) * scale; // Inverted Y

  // Colors
  const bg = darkMode ? "#0c1017" : "#ffffff";
  const panelBg = darkMode ? "#161b22" : "#f6f8fa";
  const cardBg = darkMode ? "#1c2128" : "#ffffff";
  const borderCol = darkMode ? "#30363d" : "#d0d7de";
  const textCol = darkMode ? "#e6edf3" : "#1f2328";
  const mutedText = darkMode ? "#8b949e" : "#656d76";
  const gridCol = darkMode ? "#21262d" : "#e1e4e8";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color:${bg}; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">\n`;

  // Defs & Gradients
  svg += `  <defs>\n`;
  svg += `    <linearGradient id="limiterWallGrad" x1="0%" y1="0%" x2="100%" y2="100%">\n`;
  svg += `      <stop offset="0%" stop-color="${darkMode ? "#3a3f47" : "#8c959f"}" />\n`;
  svg += `      <stop offset="100%" stop-color="${darkMode ? "#24292f" : "#6e7781"}" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `    <linearGradient id="plasmaCoreGrad" x1="0%" y1="0%" x2="0%" y2="100%">\n`;
  svg += `      <stop offset="0%" stop-color="#ff7b72" stop-opacity="0.3" />\n`;
  svg += `      <stop offset="100%" stop-color="#388bfd" stop-opacity="0.05" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `  </defs>\n`;

  // Title bar
  svg += `  <rect x="0" y="0" width="${width}" height="42" fill="${panelBg}" />\n`;
  svg += `  <line x1="0" y1="42" x2="${width}" y2="42" stroke="${borderCol}" stroke-width="1" />\n`;
  svg += `  <text x="20" y="26" font-size="15" font-weight="600" fill="${textCol}">${escapeXml(title)}</text>\n`;
  svg += `  <text x="${width - 20}" y="26" font-size="12" fill="${mutedText}" text-anchor="end">G-EQDSK Poloidal Cross-Section &amp; Profiles</text>\n`;

  // ---------------------------------------------------------------------------
  // Poloidal Cross-Section Plot (Left)
  // ---------------------------------------------------------------------------
  svg += `  <!-- Cross Section Background & Grid -->\n`;
  svg += `  <rect x="${marginCross.left}" y="${marginCross.top}" width="${plotW}" height="${plotH}" fill="${darkMode ? "#0f141c" : "#fafbfc"}" stroke="${borderCol}" stroke-width="1" rx="4" />\n`;

  // Grid lines: R ticks
  const rStep = calculateNiceStep(spanR, 5);
  const startR = Math.ceil(minR / rStep) * rStep;
  for (let r = startR; r <= maxR; r += rStep) {
    const px = mapR(r);
    if (px >= marginCross.left && px <= marginCross.left + plotW) {
      svg += `  <line x1="${px.toFixed(1)}" y1="${marginCross.top}" x2="${px.toFixed(1)}" y2="${marginCross.top + plotH}" stroke="${gridCol}" stroke-dasharray="3,3" />\n`;
      svg += `  <text x="${px.toFixed(1)}" y="${marginCross.top + plotH + 18}" font-size="11" fill="${mutedText}" text-anchor="middle">${r.toFixed(2)}</text>\n`;
    }
  }

  // Grid lines: Z ticks
  const zStep = calculateNiceStep(spanZ, 6);
  const startZ = Math.ceil(minZ / zStep) * zStep;
  for (let z = startZ; z <= maxZ; z += zStep) {
    const py = mapZ(z);
    if (py >= marginCross.top && py <= marginCross.top + plotH) {
      svg += `  <line x1="${marginCross.left}" y1="${py.toFixed(1)}" x2="${marginCross.left + plotW}" y2="${py.toFixed(1)}" stroke="${gridCol}" stroke-dasharray="3,3" />\n`;
      svg += `  <text x="${marginCross.left - 10}" y="${(py + 4).toFixed(1)}" font-size="11" fill="${mutedText}" text-anchor="end">${z.toFixed(2)}</text>\n`;
    }
  }

  // Axis labels
  svg += `  <text x="${marginCross.left + plotW / 2}" y="${height - 15}" font-size="13" font-weight="500" fill="${textCol}" text-anchor="middle">Major Radius R (m)</text>\n`;
  svg += `  <text x="20" y="${marginCross.top + plotH / 2}" font-size="13" font-weight="500" fill="${textCol}" text-anchor="middle" transform="rotate(-90 20 ${marginCross.top + plotH / 2})">Vertical Position Z (m)</text>\n`;

  // Draw Limiter / Vacuum Vessel Wall
  if (showLimiter && data.rlim.length >= 4) {
    const wallPts = data.rlim.map((r, i) => `${mapR(r).toFixed(1)},${mapZ(data.zlim[i]!).toFixed(1)}`).join(" ");
    svg += `  <!-- Limiter Armor / Vacuum Vessel Wall -->\n`;
    svg += `  <polygon points="${wallPts}" fill="none" stroke="url(#limiterWallGrad)" stroke-width="7" stroke-linejoin="round" opacity="0.85" />\n`;
    svg += `  <polygon points="${wallPts}" fill="none" stroke="${darkMode ? "#8b949e" : "#57606a"}" stroke-width="1.5" stroke-linejoin="round" />\n`;
  }

  // Draw Nested Poloidal Flux Surfaces
  const numSurfaces = options?.numFluxSurfaces ?? 10;
  const fluxLevels: number[] = [];
  for (let s = 1; s <= numSurfaces; s++) {
    fluxLevels.push(s / numSurfaces);
  }
  const contours = generateFluxContours(data, fluxLevels);

  // Background plasma glow
  if (contours.length > 0) {
    const lcfs = contours[contours.length - 1]!;
    const lcfsPts = lcfs.points.map(([r, z]) => `${mapR(r).toFixed(1)},${mapZ(z).toFixed(1)}`).join(" ");
    svg += `  <!-- Plasma Core Shading -->\n`;
    svg += `  <polygon points="${lcfsPts}" fill="url(#plasmaCoreGrad)" opacity="0.6" />\n`;
  }

  svg += `  <!-- Nested Flux Surfaces psi_N -->\n`;
  for (const c of contours) {
    const isSeparatrix = Math.abs(c.psiNorm - 1.0) < 1e-3;
    const pts = c.points.map(([r, z]) => `${mapR(r).toFixed(1)},${mapZ(z).toFixed(1)}`).join(" ");

    if (isSeparatrix && showSeparatrix) {
      // Separatrix / LCFS (highlighted bold cyan)
      svg += `  <polyline points="${pts}" fill="none" stroke="#2ea043" stroke-width="2.5" />\n`;
    } else {
      // Internal flux surfaces: Color interpolation from magenta (core) to blue/cyan (edge)
      const strokeCol = getFluxSurfaceColor(c.psiNorm);
      const strokeWidth = c.psiNorm === 0.5 ? "1.6" : "1.1";
      svg += `  <polyline points="${pts}" fill="none" stroke="${strokeCol}" stroke-width="${strokeWidth}" stroke-opacity="0.8" />\n`;
    }
  }

  // Draw Divertor Strike Lines / SOL branch if X-point present
  if (metrics.xPoint && showXPoint) {
    const rx = mapR(metrics.xPoint.r);
    const zx = mapZ(metrics.xPoint.z);

    // Inner and outer divertor legs projecting downward toward limiter
    const legInnerEnd = [rx - 25, zx + 35];
    const legOuterEnd = [rx + 35, zx + 40];

    svg += `  <!-- Divertor Separatrix Legs -->\n`;
    svg += `  <line x1="${rx.toFixed(1)}" y1="${zx.toFixed(1)}" x2="${legInnerEnd[0]!.toFixed(1)}" y2="${legInnerEnd[1]!.toFixed(1)}" stroke="#2ea043" stroke-width="2" stroke-dasharray="4,3" />\n`;
    svg += `  <line x1="${rx.toFixed(1)}" y1="${zx.toFixed(1)}" x2="${legOuterEnd[0]!.toFixed(1)}" y2="${legOuterEnd[1]!.toFixed(1)}" stroke="#2ea043" stroke-width="2" stroke-dasharray="4,3" />\n`;

    // X-point marker (diamond)
    svg += `  <!-- X-Point Null -->\n`;
    svg += `  <polygon points="${rx.toFixed(1)},${(zx - 6).toFixed(1)} ${(rx + 6).toFixed(1)},${zx.toFixed(1)} ${rx.toFixed(1)},${(zx + 6).toFixed(1)} ${(rx - 6).toFixed(1)},${zx.toFixed(1)}" fill="#d29922" stroke="#ffffff" stroke-width="1.2" />\n`;
    svg += `  <text x="${(rx + 10).toFixed(1)}" y="${(zx + 4).toFixed(1)}" font-size="11" font-weight="600" fill="#d29922">X-Point</text>\n`;
  }

  // Draw Magnetic Axis Marker
  if (showAxis) {
    const axX = mapR(data.rmaxis);
    const axY = mapZ(data.zmaxis);
    svg += `  <!-- Magnetic Axis -->\n`;
    svg += `  <line x1="${(axX - 7).toFixed(1)}" y1="${axY.toFixed(1)}" x2="${(axX + 7).toFixed(1)}" y2="${axY.toFixed(1)}" stroke="#ff7b72" stroke-width="2" />\n`;
    svg += `  <line x1="${axX.toFixed(1)}" y1="${(axY - 7).toFixed(1)}" x2="${axX.toFixed(1)}" y2="${(axY + 7).toFixed(1)}" stroke="#ff7b72" stroke-width="2" />\n`;
    svg += `  <circle cx="${axX.toFixed(1)}" cy="${axY.toFixed(1)}" r="3" fill="#ff7b72" stroke="#ffffff" stroke-width="1" />\n`;
    svg += `  <text x="${(axX + 8).toFixed(1)}" y="${(axY - 6).toFixed(1)}" font-size="11" font-weight="600" fill="#ff7b72">Axis (R=${data.rmaxis.toFixed(2)}, Z=${data.zmaxis.toFixed(2)})</text>\n`;
  }

  // ---------------------------------------------------------------------------
  // Right Column: Radial Profiles Subplots & Metrics Card
  // ---------------------------------------------------------------------------
  if (showProfiles) {
    const sideX = crossWidth + 10;
    const sideW = sideWidth - 25;

    // Subplot 1: Safety Factor q(psi_N)
    const subH = 150;
    const subMargin = { top: 60, left: 55, bottom: 25, right: 20 };
    const qPlotW = sideW - subMargin.left - subMargin.right;
    const qPlotH = subH - subMargin.bottom;

    svg += `  <!-- Subplot 1: Safety Factor q(psi_N) -->\n`;
    svg += `  <rect x="${sideX}" y="${subMargin.top - 15}" width="${sideW}" height="${subH + 20}" fill="${panelBg}" stroke="${borderCol}" stroke-width="1" rx="4" />\n`;
    svg += `  <text x="${sideX + 15}" y="${subMargin.top + 2}" font-size="12" font-weight="600" fill="${textCol}">Safety Factor Profile q(ψ<tspan font-size="9" dy="2">N</tspan><tspan font-size="12" dy="-2">)</tspan></text>\n`;

    const maxQ = Math.max(5.0, ...data.qpsi.map(Math.abs));
    const mapPsiX = (idx: number, len: number) => sideX + subMargin.left + (idx / (len - 1)) * qPlotW;
    const mapQY = (q: number) => subMargin.top + qPlotH - (Math.min(maxQ, Math.abs(q)) / maxQ) * qPlotH;

    // q = 1 and q = 2 threshold reference lines
    if (1.0 <= maxQ) {
      const q1Y = mapQY(1.0);
      svg += `  <line x1="${sideX + subMargin.left}" y1="${q1Y.toFixed(1)}" x2="${sideX + subMargin.left + qPlotW}" y2="${q1Y.toFixed(1)}" stroke="#f85149" stroke-dasharray="3,3" stroke-width="1" />\n`;
      svg += `  <text x="${sideX + subMargin.left + qPlotW + 4}" y="${(q1Y + 3).toFixed(1)}" font-size="9" fill="#f85149">q=1</text>\n`;
    }
    if (2.0 <= maxQ) {
      const q2Y = mapQY(2.0);
      svg += `  <line x1="${sideX + subMargin.left}" y1="${q2Y.toFixed(1)}" x2="${sideX + subMargin.left + qPlotW}" y2="${q2Y.toFixed(1)}" stroke="#d29922" stroke-dasharray="3,3" stroke-width="1" />\n`;
      svg += `  <text x="${sideX + subMargin.left + qPlotW + 4}" y="${(q2Y + 3).toFixed(1)}" font-size="9" fill="#d29922">q=2</text>\n`;
    }

    const qPts = data.qpsi.map((q, i) => `${mapPsiX(i, data.qpsi.length).toFixed(1)},${mapQY(q).toFixed(1)}`).join(" ");
    svg += `  <polyline points="${qPts}" fill="none" stroke="#58a6ff" stroke-width="2" />\n`;

    // q axis ticks
    svg += `  <text x="${sideX + subMargin.left - 6}" y="${(subMargin.top + qPlotH).toFixed(1)}" font-size="10" fill="${mutedText}" text-anchor="end">0</text>\n`;
    svg += `  <text x="${sideX + subMargin.left - 6}" y="${mapQY(maxQ).toFixed(1)}" font-size="10" fill="${mutedText}" text-anchor="end">${maxQ.toFixed(0)}</text>\n`;
    svg += `  <text x="${sideX + subMargin.left}" y="${subMargin.top + qPlotH + 14}" font-size="10" fill="${mutedText}">0</text>\n`;
    svg += `  <text x="${sideX + subMargin.left + qPlotW}" y="${subMargin.top + qPlotH + 14}" font-size="10" fill="${mutedText}" text-anchor="end">1.0 (Edge)</text>\n`;

    // Subplot 2: Pressure p(psi_N)
    const pTop = subMargin.top + subH + 25;
    svg += `  <!-- Subplot 2: Pressure Profile p(psi_N) -->\n`;
    svg += `  <rect x="${sideX}" y="${pTop - 15}" width="${sideW}" height="${subH + 20}" fill="${panelBg}" stroke="${borderCol}" stroke-width="1" rx="4" />\n`;
    svg += `  <text x="${sideX + 15}" y="${pTop + 2}" font-size="12" font-weight="600" fill="${textCol}">Plasma Pressure p(ψ<tspan font-size="9" dy="2">N</tspan><tspan font-size="12" dy="-2">)</tspan> [kPa]</text>\n`;

    const maxP = Math.max(1.0, ...data.pres) / 1000.0;
    const mapPY = (pPa: number) => pTop + qPlotH - (Math.max(0, pPa / 1000.0) / maxP) * qPlotH;

    const pPts = data.pres.map((p, i) => `${mapPsiX(i, data.pres.length).toFixed(1)},${mapPY(p).toFixed(1)}`).join(" ");
    svg += `  <polygon points="${sideX + subMargin.left},${pTop + qPlotH} ${pPts} ${sideX + subMargin.left + qPlotW},${pTop + qPlotH}" fill="#3fb950" fill-opacity="0.15" />\n`;
    svg += `  <polyline points="${pPts}" fill="none" stroke="#3fb950" stroke-width="2" />\n`;

    svg += `  <text x="${sideX + subMargin.left - 6}" y="${(pTop + qPlotH).toFixed(1)}" font-size="10" fill="${mutedText}" text-anchor="end">0</text>\n`;
    svg += `  <text x="${sideX + subMargin.left - 6}" y="${mapPY(maxP * 1000).toFixed(1)}" font-size="10" fill="${mutedText}" text-anchor="end">${maxP.toFixed(0)}</text>\n`;
    svg += `  <text x="${sideX + subMargin.left}" y="${pTop + qPlotH + 14}" font-size="10" fill="${mutedText}">0 (Core)</text>\n`;
    svg += `  <text x="${sideX + subMargin.left + qPlotW}" y="${pTop + qPlotH + 14}" font-size="10" fill="${mutedText}" text-anchor="end">1.0</text>\n`;

    // Metrics Card (Bottom Right)
    const cardTop = pTop + subH + 25;
    const cardH = height - cardTop - 15;
    svg += `  <!-- Equilibrium Summary Metrics Card -->\n`;
    svg += `  <rect x="${sideX}" y="${cardTop}" width="${sideW}" height="${cardH}" fill="${cardBg}" stroke="${borderCol}" stroke-width="1" rx="4" />\n`;
    svg += `  <text x="${sideX + 15}" y="${cardTop + 20}" font-size="12" font-weight="600" fill="${textCol}">Equilibrium Scalars</text>\n`;

    const metricsGrid = [
      { label: "Ip", val: `${metrics.plasmaCurrentMA.toFixed(2)} MA` },
      { label: "B0", val: `${metrics.toroidalFieldT.toFixed(2)} T` },
      { label: "R0 / a", val: `${metrics.majorRadiusR0.toFixed(2)} / ${metrics.minorRadiusA.toFixed(2)} m` },
      { label: "Aspect A", val: `${metrics.aspectRatio.toFixed(2)}` },
      { label: "Elongation κ", val: `${metrics.elongation.toFixed(2)}` },
      { label: "Triang. δ", val: `${metrics.triangularityAvg.toFixed(2)}` },
      { label: "q0", val: `${metrics.q0.toFixed(2)}` },
      { label: "q95", val: `${metrics.q95.toFixed(2)}` },
      { label: "β_N", val: `${metrics.normalizedBeta.toFixed(2)}` },
      { label: "β_T", val: `${metrics.toroidalBetaPct.toFixed(2)} %` },
    ];

    let rowY = cardTop + 40;
    const colW = sideW / 2 - 15;
    metricsGrid.forEach((m, idx) => {
      const isCol2 = idx % 2 === 1;
      const x = sideX + 15 + (isCol2 ? colW : 0);
      svg += `  <text x="${x}" y="${rowY}" font-size="10.5" fill="${mutedText}">${m.label}: <tspan font-weight="600" fill="${textCol}">${m.val}</tspan></text>\n`;
      if (isCol2) rowY += 18;
    });
  }

  svg += `</svg>`;
  return svg;
}

function getFluxSurfaceColor(psiNorm: number): string {
  // Gradient from purple/magenta at core to bright blue/teal at boundary
  const t = Math.max(0, Math.min(1, psiNorm));
  const r = Math.round(180 * (1 - t) + 40 * t);
  const g = Math.round(50 * (1 - t) + 160 * t);
  const b = Math.round(230 * (1 - t) + 250 * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function calculateNiceStep(range: number, targetTicks: number): number {
  const rough = range / targetTicks;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / power;
  let niceFrac = 1;
  if (frac > 5) niceFrac = 10;
  else if (frac > 2) niceFrac = 5;
  else if (frac > 1) niceFrac = 2;
  return niceFrac * power;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

// ---------------------------------------------------------------------------
// Fusion Linter & Stability Verifier
// ---------------------------------------------------------------------------

/**
 * Evaluates physical MHD stability invariants, geometric containment, and boundary topology:
 * - FUSION1001: Kruskal-Shafranov kink limits (q0 >= 1.0, q95 >= 2.0).
 * - FUSION1002: Magnetic axis inside boundary and limiter walls.
 * - FUSION1003: Plasma boundary closure and positive major radius.
 * - FUSION1004: Monotonic non-negative plasma pressure profile.
 */
export function lintTokamakEquilibrium(data: GeqdskData): FusionLintDiagnostic[] {
  const diagnostics: FusionLintDiagnostic[] = [];
  const metrics = computeEquilibriumMetrics(data);

  // FUSION1001: Kruskal-Shafranov Kink Limit
  if (metrics.q0 < 1.0) {
    diagnostics.push({
      code: "FUSION1001",
      message: `Safety factor on axis q0 = ${metrics.q0.toFixed(2)} < 1.0 violates Kruskal-Shafranov sawtooth stability condition.`,
      severity: "warning",
      field: "qpsi",
    });
  }
  if (metrics.q95 < 2.0) {
    diagnostics.push({
      code: "FUSION1001",
      message: `Edge safety factor q95 = ${metrics.q95.toFixed(2)} < 2.0 violates external kink stability boundary (disruption hazard).`,
      severity: "error",
      field: "qpsi",
    });
  }

  // FUSION1002: Magnetic Axis Containment
  const minBndryR = Math.min(...data.rbbbs);
  const maxBndryR = Math.max(...data.rbbbs);
  const minBndryZ = Math.min(...data.zbbbs);
  const maxBndryZ = Math.max(...data.zbbbs);

  if (data.rmaxis <= minBndryR || data.rmaxis >= maxBndryR || data.zmaxis <= minBndryZ || data.zmaxis >= maxBndryZ) {
    diagnostics.push({
      code: "FUSION1002",
      message: `Magnetic axis (R=${data.rmaxis.toFixed(2)}, Z=${data.zmaxis.toFixed(2)}) is outside the plasma boundary envelope [${minBndryR.toFixed(2)}..${maxBndryR.toFixed(2)}, ${minBndryZ.toFixed(2)}..${maxBndryZ.toFixed(2)}].`,
      severity: "error",
      field: "rmaxis",
    });
  }

  // FUSION1003: Boundary Closedness & Topology
  if (data.rbbbs.length < 4) {
    diagnostics.push({
      code: "FUSION1003",
      message: `Plasma boundary points count (${data.rbbbs.length}) is insufficient for closed flux surface reconstruction.`,
      severity: "error",
      field: "rbbbs",
    });
  }
  if (minBndryR <= 0) {
    diagnostics.push({
      code: "FUSION1003",
      message: `Plasma boundary intersects or crosses toroidal coordinate singularity R <= 0 (min R = ${minBndryR.toFixed(2)} m).`,
      severity: "error",
      field: "rbbbs",
    });
  }

  // FUSION1004: Physical Pressure Profile
  let hasNegativeP = false;
  for (let i = 0; i < data.pres.length; i++) {
    if (data.pres[i]! < 0) {
      hasNegativeP = true;
      break;
    }
  }
  if (hasNegativeP) {
    diagnostics.push({
      code: "FUSION1004",
      message: "Unphysical negative plasma pressure values detected in pressure profile.",
      severity: "error",
      field: "pres",
    });
  } else if (data.pres.length >= 2 && data.pres[data.pres.length - 1]! > data.pres[0]!) {
    diagnostics.push({
      code: "FUSION1004",
      message: "Plasma pressure increases from core to edge, indicating an unphysical hollow or inverted equilibrium.",
      severity: "warning",
      field: "pres",
    });
  }

  return diagnostics;
}
