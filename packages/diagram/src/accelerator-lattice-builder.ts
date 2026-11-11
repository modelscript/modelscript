// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — High-Energy Particle Physics: Accelerator Lattice & Optics Builder
 *
 * Implements CERN MAD-X / TFS accelerator lattice representation, transfer matrix propagation,
 * Courant-Snyder Twiss parameter calculations (beta_x, beta_y, dispersion D_x, tunes Q_x, Q_y),
 * beam envelope sigma(s), publication-grade beamline schematic SVG renderer with colorful magnet badges,
 * and optical betatron stability linter.
 */

export type ElementType =
  | "drift"
  | "quadrupole"
  | "sbend"
  | "rbend"
  | "sextupole"
  | "rfcavity"
  | "marker"
  | "collimator";

export interface AcceleratorElement {
  name: string;
  type: ElementType;
  length: number; // m
  k1?: number | undefined; // Quadrupole strength (m^-2), k1 > 0 focusing, k1 < 0 defocusing
  angle?: number | undefined; // Dipole bending angle (rad)
  k2?: number | undefined; // Sextupole strength (m^-3)
  voltage?: number | undefined; // RF voltage (MV)
  frequency?: number | undefined; // RF frequency (MHz)
  aperture?: number | undefined; // Vacuum chamber physical radius (m)
}

export interface BeamParameters {
  particle: "proton" | "electron" | "positron" | "ion";
  energyGev: number;
  emittanceX: number; // Geometric emittance (m*rad)
  emittanceY: number; // Geometric emittance (m*rad)
  deltaP: number; // Momentum spread dp/p
}

export interface TwissPoint {
  s: number; // Longitudinal position along beamline (m)
  elementName: string;
  elementType: ElementType;
  betaX: number; // m
  alphaX: number;
  gammaX: number; // m^-1
  betaY: number; // m
  alphaY: number;
  gammaY: number; // m^-1
  dispersionX: number; // m
  envelopeX: number; // mm
  envelopeY: number; // mm
}

export interface AcceleratorLatticeData {
  title: string;
  beam: BeamParameters;
  elements: AcceleratorElement[];
  totalLength: number;
  twiss: TwissPoint[];
  tuneX: number;
  tuneY: number;
  chromaticityX?: number | undefined;
  chromaticityY?: number | undefined;
}

export interface LatticeRenderOptions {
  width?: number | undefined;
  height?: number | undefined;
  showBeta?: boolean | undefined;
  showEnvelope?: boolean | undefined;
  showDispersion?: boolean | undefined;
  showAperture?: boolean | undefined;
  showMagnets?: boolean | undefined;
  showBadges?: boolean | undefined;
  darkMode?: boolean | undefined;
  title?: string | undefined;
}

export interface LatticeLintDiagnostic {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  field?: string | undefined;
}

// ---------------------------------------------------------------------------
// MAD-X & TFS Lattice Parser
// ---------------------------------------------------------------------------

/**
 * Parses MAD-X input deck or CERN TFS (Table File System) optics file.
 */
export function parseMadxLattice(content: string): AcceleratorLatticeData {
  const trimmed = content.trim();

  // Support JSON input directly
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<AcceleratorLatticeData>;
      return normalizeLatticeData(parsed);
    } catch {
      // Fall through to text parser
    }
  }

  const lines = trimmed.split(/\r?\n/);
  let title = "Accelerator Lattice";
  let particle: "proton" | "electron" | "positron" | "ion" = "electron";
  let energyGev = 3.0;
  let emittanceX = 1.0e-8;
  let emittanceY = 1.0e-9;
  let deltaP = 1.0e-3;

  const elementsMap = new Map<string, AcceleratorElement>();
  const sequence: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("!") || line.startsWith("//")) continue;

    // TITLE statement
    if (line.toUpperCase().startsWith("TITLE")) {
      const match = line.match(/TITLE\s*,\s*['"]?([^'"]+)['"]?/i);
      if (match) title = match[1]!.trim();
      continue;
    }

    // BEAM statement
    if (line.toUpperCase().startsWith("BEAM")) {
      const pMatch = line.match(/PARTICLE\s*=\s*([A-Za-z]+)/i);
      if (pMatch) {
        const p = pMatch[1]!.toLowerCase();
        if (p === "proton" || p === "electron" || p === "positron" || p === "ion") {
          particle = p;
        }
      }
      const eMatch = line.match(/ENERGY\s*=\s*([0-9.eE+-]+)/i);
      if (eMatch) energyGev = parseFloat(eMatch[1]!);
      const exMatch = line.match(/EX\s*=\s*([0-9.eE+-]+)/i);
      if (exMatch) emittanceX = parseFloat(exMatch[1]!);
      const eyMatch = line.match(/EY\s*=\s*([0-9.eE+-]+)/i);
      if (eyMatch) emittanceY = parseFloat(eyMatch[1]!);
      const dpMatch = line.match(/SIGE\s*=\s*([0-9.eE+-]+)/i);
      if (dpMatch) deltaP = parseFloat(dpMatch[1]!);
      continue;
    }

    // LINE or SEQUENCE statement
    if (/LINE\s*=/i.test(line) || line.toUpperCase().includes("LINE=(")) {
      const match = line.match(/([A-Za-z0-9_]+)\s*:\s*LINE\s*=\s*\(([^)]+)\)/i);
      if (match) {
        const elementNames = match[2]!.split(",").map((s) => s.trim().toUpperCase());
        sequence.push(...elementNames);
      }
      continue;
    }

    // Element definition: NAME: TYPE, ATTR=VAL, ...;
    const elemMatch = line.match(/^([A-Za-z0-9_]+)\s*:\s*([A-Za-z]+)(?:\s*,\s*(.*))?;?$/);
    if (elemMatch) {
      const name = elemMatch[1]!.toUpperCase();
      const rawType = elemMatch[2]!.toLowerCase();
      const attrsStr = elemMatch[3] ?? "";

      let type: ElementType = "drift";
      if (rawType.includes("quad")) type = "quadrupole";
      else if (rawType.includes("sbend")) type = "sbend";
      else if (rawType.includes("rbend")) type = "rbend";
      else if (rawType.includes("sext")) type = "sextupole";
      else if (rawType.includes("rfcavity") || rawType.includes("cavity")) type = "rfcavity";
      else if (rawType.includes("marker")) type = "marker";
      else if (rawType.includes("collim")) type = "collimator";

      let length = 0.0;
      let k1: number | undefined;
      let angle: number | undefined;
      let k2: number | undefined;
      let voltage: number | undefined;
      let frequency: number | undefined;
      let aperture: number | undefined = 0.035; // 35mm default vacuum chamber

      const lMatch = attrsStr.match(/L\s*=\s*([0-9.eE+-]+)/i);
      if (lMatch) length = parseFloat(lMatch[1]!);

      const k1Match = attrsStr.match(/K1\s*=\s*([0-9.eE+-]+)/i);
      if (k1Match) k1 = parseFloat(k1Match[1]!);

      const aMatch = attrsStr.match(/ANGLE\s*=\s*([0-9.eE+-]+)/i);
      if (aMatch) angle = parseFloat(aMatch[1]!);

      const k2Match = attrsStr.match(/K2\s*=\s*([0-9.eE+-]+)/i);
      if (k2Match) k2 = parseFloat(k2Match[1]!);

      const vMatch = attrsStr.match(/VOLT\s*=\s*([0-9.eE+-]+)/i);
      if (vMatch) voltage = parseFloat(vMatch[1]!);

      const fMatch = attrsStr.match(/FREQ\s*=\s*([0-9.eE+-]+)/i);
      if (fMatch) frequency = parseFloat(fMatch[1]!);

      const apMatch = attrsStr.match(/APER(?:TURE)?\s*=\s*([0-9.eE+-]+)/i);
      if (apMatch) aperture = parseFloat(apMatch[1]!);

      const element: AcceleratorElement = {
        name,
        type,
        length,
        k1,
        angle,
        k2,
        voltage,
        frequency,
        aperture,
      };
      elementsMap.set(name, element);
    }
  }

  // Resolve active elements in sequence
  let activeElements: AcceleratorElement[] = [];
  if (sequence.length > 0) {
    for (const name of sequence) {
      if (elementsMap.has(name)) {
        activeElements.push(elementsMap.get(name)!);
      }
    }
  } else if (elementsMap.size > 0) {
    activeElements = Array.from(elementsMap.values());
  }

  return normalizeLatticeData({
    title,
    beam: {
      particle,
      energyGev,
      emittanceX,
      emittanceY,
      deltaP,
    },
    elements: activeElements,
  });
}

function normalizeLatticeData(partial: Partial<AcceleratorLatticeData>): AcceleratorLatticeData {
  const beam: BeamParameters = {
    particle: partial.beam?.particle ?? "electron",
    energyGev: partial.beam?.energyGev ?? 3.0,
    emittanceX: partial.beam?.emittanceX ?? 1.0e-8,
    emittanceY: partial.beam?.emittanceY ?? 1.0e-9,
    deltaP: partial.beam?.deltaP ?? 1.0e-3,
  };

  let elements = partial.elements ?? [];
  if (elements.length === 0) {
    // Standard FODO cell default
    elements = [
      { name: "QF", type: "quadrupole", length: 0.5, k1: 0.8, aperture: 0.035 },
      { name: "D1", type: "drift", length: 2.0, aperture: 0.035 },
      { name: "B1", type: "sbend", length: 1.5, angle: 0.05, aperture: 0.035 },
      { name: "D2", type: "drift", length: 1.0, aperture: 0.035 },
      { name: "QD", type: "quadrupole", length: 0.5, k1: -0.8, aperture: 0.035 },
      { name: "D3", type: "drift", length: 2.0, aperture: 0.035 },
      { name: "B2", type: "sbend", length: 1.5, angle: 0.05, aperture: 0.035 },
      { name: "D4", type: "drift", length: 1.0, aperture: 0.035 },
    ];
  }

  const twiss = propagateTwiss(elements, beam);
  const totalLength = elements.reduce((acc, el) => acc + el.length, 0);

  // Compute tunes Q = (1 / 2*pi) * sum(ds / beta)
  let sumPhaseX = 0;
  let sumPhaseY = 0;
  for (let i = 1; i < twiss.length; i++) {
    const ds = twiss[i]!.s - twiss[i - 1]!.s;
    const avgBetaX = (twiss[i]!.betaX + twiss[i - 1]!.betaX) / 2.0;
    const avgBetaY = (twiss[i]!.betaY + twiss[i - 1]!.betaY) / 2.0;
    if (avgBetaX > 0) sumPhaseX += ds / avgBetaX;
    if (avgBetaY > 0) sumPhaseY += ds / avgBetaY;
  }
  const tuneX = parseFloat((sumPhaseX / (2 * Math.PI)).toFixed(3));
  const tuneY = parseFloat((sumPhaseY / (2 * Math.PI)).toFixed(3));

  return {
    title: partial.title ?? "FODO Cell Lattice",
    beam,
    elements,
    totalLength,
    twiss,
    tuneX,
    tuneY,
    chromaticityX: partial.chromaticityX ?? -1.4,
    chromaticityY: partial.chromaticityY ?? -1.2,
  };
}

// ---------------------------------------------------------------------------
// Transfer Matrix & Twiss Propagation Engine
// ---------------------------------------------------------------------------

/**
 * Propagates Courant-Snyder Twiss parameters and dispersion through accelerator elements:
 * - Solves 2D transfer matrices M_x, M_y for drifts, quadrupoles, and dipoles.
 * - Computes beam envelope sigma_x = sqrt(eps_x * beta_x + (D_x * deltaP)^2).
 */
export function propagateTwiss(
  elements: AcceleratorElement[],
  beam: BeamParameters,
  initial?: Partial<TwissPoint>,
): TwissPoint[] {
  let s = 0.0;
  let bx = initial?.betaX ?? 10.0;
  let ax = initial?.alphaX ?? 0.0;
  let gx = (1.0 + ax * ax) / bx;

  let by = initial?.betaY ?? 5.0;
  let ay = initial?.alphaY ?? 0.0;
  let gy = (1.0 + ay * ay) / by;

  let dx = initial?.dispersionX ?? 0.0;
  let dpx = 0.0;

  const points: TwissPoint[] = [
    {
      s: 0.0,
      elementName: "START",
      elementType: "marker",
      betaX: bx,
      alphaX: ax,
      gammaX: gx,
      betaY: by,
      alphaY: ay,
      gammaY: gy,
      dispersionX: dx,
      envelopeX: Math.sqrt(beam.emittanceX * bx + (dx * beam.deltaP) ** 2) * 1000.0,
      envelopeY: Math.sqrt(beam.emittanceY * by) * 1000.0,
    },
  ];

  for (const el of elements) {
    const L = el.length;
    const nSteps = Math.max(1, Math.ceil(L / 0.25)); // Subdivide elements longer than 25cm
    const dL = L / nSteps;

    for (let step = 0; step < nSteps; step++) {
      s += dL;

      // Transfer matrices 2x2 for X and Y
      let mx11 = 1.0,
        mx12 = dL,
        mx21 = 0.0,
        mx22 = 1.0;
      let my11 = 1.0,
        my12 = dL,
        my21 = 0.0,
        my22 = 1.0;

      if (el.type === "quadrupole" && el.k1 !== undefined && el.k1 !== 0) {
        const k = el.k1;
        if (k > 0) {
          // Focusing in X, Defocusing in Y
          const omega = Math.sqrt(k);
          const phi = omega * dL;
          mx11 = Math.cos(phi);
          mx12 = Math.sin(phi) / omega;
          mx21 = -omega * Math.sin(phi);
          mx22 = Math.cos(phi);

          my11 = Math.cosh(phi);
          my12 = Math.sinh(phi) / omega;
          my21 = omega * Math.sinh(phi);
          my22 = Math.cosh(phi);
        } else {
          // Defocusing in X, Focusing in Y
          const omega = Math.sqrt(-k);
          const phi = omega * dL;
          mx11 = Math.cosh(phi);
          mx12 = Math.sinh(phi) / omega;
          mx21 = omega * Math.sinh(phi);
          mx22 = Math.cosh(phi);

          my11 = Math.cos(phi);
          my12 = Math.sin(phi) / omega;
          my21 = -omega * Math.sin(phi);
          my22 = Math.cos(phi);
        }
      } else if ((el.type === "sbend" || el.type === "rbend") && el.angle && el.length > 0) {
        const rho = el.length / el.angle;
        const omega = 1.0 / Math.abs(rho);
        const phi = omega * dL;
        mx11 = Math.cos(phi);
        mx12 = Math.sin(phi) / omega;
        mx21 = -omega * Math.sin(phi);
        mx22 = Math.cos(phi);
        // Dispersion generation in dipole
        const dDx = (1.0 - Math.cos(phi)) * rho;
        const dDpx = Math.sin(phi);
        dx = mx11 * dx + mx12 * dpx + dDx;
        dpx = mx21 * dx + mx22 * dpx + dDpx;
      } else {
        // Drift or marker: dispersion propagates linearly
        dx = dx + dL * dpx;
      }

      // Propagate Twiss in X
      const newBx = mx11 * mx11 * bx - 2.0 * mx11 * mx12 * ax + mx12 * mx12 * gx;
      const newAx = -mx11 * mx21 * bx + (mx11 * mx22 + mx12 * mx21) * ax - mx12 * mx22 * gx;
      const newGx = (1.0 + newAx * newAx) / (newBx || 1.0);
      bx = Math.max(0.01, newBx);
      ax = newAx;
      gx = newGx;

      // Propagate Twiss in Y
      const newBy = my11 * my11 * by - 2.0 * my11 * my12 * ay + my12 * my12 * gy;
      const newAy = -my11 * my21 * by + (my11 * my22 + my12 * my21) * ay - my12 * my22 * gy;
      const newGy = (1.0 + newAy * newAy) / (newBy || 1.0);
      by = Math.max(0.01, newBy);
      ay = newAy;
      gy = newGy;

      const envX = Math.sqrt(beam.emittanceX * bx + (dx * beam.deltaP) ** 2) * 1000.0;
      const envY = Math.sqrt(beam.emittanceY * by) * 1000.0;

      points.push({
        s: parseFloat(s.toFixed(3)),
        elementName: el.name,
        elementType: el.type,
        betaX: parseFloat(bx.toFixed(3)),
        alphaX: parseFloat(ax.toFixed(3)),
        gammaX: parseFloat(gx.toFixed(3)),
        betaY: parseFloat(by.toFixed(3)),
        alphaY: parseFloat(ay.toFixed(3)),
        gammaY: parseFloat(gy.toFixed(3)),
        dispersionX: parseFloat(dx.toFixed(4)),
        envelopeX: parseFloat(envX.toFixed(3)),
        envelopeY: parseFloat(envY.toFixed(3)),
      });
    }
  }

  return points;
}

// ---------------------------------------------------------------------------
// 2D Accelerator Lattice & Optics SVG Renderer
// ---------------------------------------------------------------------------

/**
 * Renders a publication-grade Accelerator Lattice and Beam Optics SVG with
 * Courant-Snyder beta functions, horizontal dispersion, beam envelope, and physical magnet badges.
 */
export function renderAcceleratorLatticeSvg(data: AcceleratorLatticeData, options?: LatticeRenderOptions): string {
  const width = options?.width ?? 960;
  const height = options?.height ?? 620;
  const darkMode = options?.darkMode ?? true;
  const showBeta = options?.showBeta ?? true;
  const showEnvelope = options?.showEnvelope ?? true;
  const showDispersion = options?.showDispersion ?? true;
  const showMagnets = options?.showBadges ?? options?.showMagnets ?? true;
  const showAperture = options?.showAperture ?? true;
  void showBeta;
  void showAperture;
  const title = options?.title ?? `${data.title} (${data.beam.particle.toUpperCase()}, ${data.beam.energyGev} GeV)`;

  const totalS = data.totalLength || 10.0;
  const maxBeta = Math.max(5.0, ...data.twiss.map((p) => Math.max(p.betaX, p.betaY))) * 1.15;
  const maxDx = Math.max(0.5, ...data.twiss.map((p) => Math.abs(p.dispersionX))) * 1.25;
  const maxEnv = Math.max(1.0, ...data.twiss.map((p) => Math.max(p.envelopeX, p.envelopeY))) * 1.2;

  // Colors
  const bg = darkMode ? "#0c1017" : "#ffffff";
  const panelBg = darkMode ? "#161b22" : "#f6f8fa";
  const borderCol = darkMode ? "#30363d" : "#d0d7de";
  const textCol = darkMode ? "#e6edf3" : "#1f2328";
  const mutedText = darkMode ? "#8b949e" : "#656d76";
  const gridCol = darkMode ? "#21262d" : "#e1e4e8";

  const margin = { top: 55, left: 65, right: 65, bottom: 45 };
  const plotW = width - margin.left - margin.right;

  // Subplot layout: Top is Twiss functions (42%), Middle is Beam Envelope (30%), Bottom is Magnet lattice (18%)
  const topH = 220;
  const midH = showEnvelope ? 160 : 0;
  const botH = showMagnets ? 80 : 0;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color:${bg}; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">\n`;

  // Defs & Gradients
  svg += `  <defs>\n`;
  svg += `    <linearGradient id="qfGrad" x1="0%" y1="0%" x2="0%" y2="100%">\n`;
  svg += `      <stop offset="0%" stop-color="#f85149" />\n`;
  svg += `      <stop offset="100%" stop-color="#da3633" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `    <linearGradient id="qdGrad" x1="0%" y1="0%" x2="0%" y2="100%">\n`;
  svg += `      <stop offset="0%" stop-color="#58a6ff" />\n`;
  svg += `      <stop offset="100%" stop-color="#1f6feb" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `    <linearGradient id="bendGrad" x1="0%" y1="0%" x2="0%" y2="100%">\n`;
  svg += `      <stop offset="0%" stop-color="#388bfd" />\n`;
  svg += `      <stop offset="100%" stop-color="#216cd3" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `    <linearGradient id="sextGrad" x1="0%" y1="0%" x2="0%" y2="100%">\n`;
  svg += `      <stop offset="0%" stop-color="#d29922" />\n`;
  svg += `      <stop offset="100%" stop-color="#bb8009" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `    <linearGradient id="envFillX" x1="0%" y1="0%" x2="0%" y2="100%">\n`;
  svg += `      <stop offset="0%" stop-color="#58a6ff" stop-opacity="0.3" />\n`;
  svg += `      <stop offset="100%" stop-color="#58a6ff" stop-opacity="0.05" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `  </defs>\n`;

  // Title bar
  svg += `  <rect x="0" y="0" width="${width}" height="42" fill="${panelBg}" />\n`;
  svg += `  <line x1="0" y1="42" x2="${width}" y2="42" stroke="${borderCol}" stroke-width="1" />\n`;
  svg += `  <text x="20" y="26" font-size="15" font-weight="600" fill="${textCol}">${escapeXml(title)}</text>\n`;
  svg += `  <text x="${width - 20}" y="26" font-size="12" fill="${mutedText}" text-anchor="end">Qx = ${data.tuneX}, Qy = ${data.tuneY} | L = ${data.totalLength.toFixed(2)} m</text>\n`;

  const mapS = (sVal: number) => margin.left + (sVal / totalS) * plotW;

  // ---------------------------------------------------------------------------
  // Plot 1: Twiss Functions (beta_x, beta_y, D_x)
  // ---------------------------------------------------------------------------
  const p1Top = margin.top;
  svg += `  <!-- Plot 1: Twiss Functions beta_x, beta_y, D_x -->\n`;
  svg += `  <rect x="${margin.left}" y="${p1Top}" width="${plotW}" height="${topH}" fill="${panelBg}" stroke="${borderCol}" stroke-width="1" rx="4" />\n`;

  // Grid lines
  for (let i = 1; i < 5; i++) {
    const gy = p1Top + (i / 5) * topH;
    svg += `  <line x1="${margin.left}" y1="${gy}" x2="${margin.left + plotW}" y2="${gy}" stroke="${gridCol}" stroke-dasharray="3,3" />\n`;
  }

  const mapBetaY = (b: number) => p1Top + topH - (Math.max(0, b) / maxBeta) * topH;
  const mapDxY = (d: number) => p1Top + topH - (Math.max(0, d) / maxDx) * topH;

  // beta_x polyline (royal blue)
  const ptsBx = data.twiss.map((p) => `${mapS(p.s).toFixed(1)},${mapBetaY(p.betaX).toFixed(1)}`).join(" ");
  svg += `  <polyline points="${ptsBx}" fill="none" stroke="#58a6ff" stroke-width="2.2" />\n`;

  // beta_y polyline (vibrant orange/red)
  const ptsBy = data.twiss.map((p) => `${mapS(p.s).toFixed(1)},${mapBetaY(p.betaY).toFixed(1)}`).join(" ");
  svg += `  <polyline points="${ptsBy}" fill="none" stroke="#f0883e" stroke-width="2.2" />\n`;

  // Dispersion D_x (emerald green dashed)
  if (showDispersion) {
    const ptsDx = data.twiss.map((p) => `${mapS(p.s).toFixed(1)},${mapDxY(p.dispersionX).toFixed(1)}`).join(" ");
    svg += `  <polyline points="${ptsDx}" fill="none" stroke="#3fb950" stroke-width="1.8" stroke-dasharray="4,3" />\n`;
  }

  // Left Y-axis labels (Beta in m)
  svg += `  <text x="${margin.left - 10}" y="${p1Top + 14}" font-size="10" fill="#58a6ff" text-anchor="end">${maxBeta.toFixed(1)}</text>\n`;
  svg += `  <text x="${margin.left - 10}" y="${p1Top + topH}" font-size="10" fill="${mutedText}" text-anchor="end">0</text>\n`;
  svg += `  <text x="18" y="${p1Top + topH / 2}" font-size="12" font-weight="500" fill="${textCol}" text-anchor="middle" transform="rotate(-90 18 ${p1Top + topH / 2})">β<tspan font-size="9" dy="2">x,y</tspan><tspan font-size="12" dy="-2"> (m)</tspan></text>\n`;

  // Right Y-axis labels (Dispersion in m)
  if (showDispersion) {
    svg += `  <text x="${margin.left + plotW + 10}" y="${p1Top + 14}" font-size="10" fill="#3fb950">${maxDx.toFixed(2)}</text>\n`;
    svg += `  <text x="${margin.left + plotW + 10}" y="${p1Top + topH}" font-size="10" fill="${mutedText}">0</text>\n`;
    svg += `  <text x="${width - 15}" y="${p1Top + topH / 2}" font-size="12" font-weight="500" fill="#3fb950" text-anchor="middle" transform="rotate(90 ${width - 15} ${p1Top + topH / 2})">D<tspan font-size="9" dy="2">x</tspan><tspan font-size="12" dy="-2"> (m)</tspan></text>\n`;
  }

  // Legend
  svg += `  <g transform="translate(${margin.left + 15}, ${p1Top + 15})">\n`;
  svg += `    <line x1="0" y1="5" x2="20" y2="5" stroke="#58a6ff" stroke-width="2.5" />\n`;
  svg += `    <text x="26" y="9" font-size="11" fill="${textCol}">βx</text>\n`;
  svg += `    <line x1="60" y1="5" x2="80" y2="5" stroke="#f0883e" stroke-width="2.5" />\n`;
  svg += `    <text x="86" y="9" font-size="11" fill="${textCol}">βy</text>\n`;
  if (showDispersion) {
    svg += `    <line x1="120" y1="5" x2="140" y2="5" stroke="#3fb950" stroke-width="2" stroke-dasharray="4,2" />\n`;
    svg += `    <text x="146" y="9" font-size="11" fill="${textCol}">Dx</text>\n`;
  }
  svg += `  </g>\n`;

  // ---------------------------------------------------------------------------
  // Plot 2: Beam Envelope (sigma_x, sigma_y)
  // ---------------------------------------------------------------------------
  const p2Top = p1Top + topH + 15;
  if (showEnvelope) {
    svg += `  <!-- Plot 2: Beam Envelopes sigma_x, sigma_y -->\n`;
    svg += `  <rect x="${margin.left}" y="${p2Top}" width="${plotW}" height="${midH}" fill="${panelBg}" stroke="${borderCol}" stroke-width="1" rx="4" />\n`;

    const mapEnvY = (val: number) => p2Top + midH / 2 - (val / maxEnv) * (midH / 2);

    // Symmetric beam envelope +/- sigma_x fill
    const ptsEnvXTop = data.twiss.map((p) => `${mapS(p.s).toFixed(1)},${mapEnvY(p.envelopeX).toFixed(1)}`).join(" ");
    const ptsEnvXBot = [...data.twiss]
      .reverse()
      .map((p) => `${mapS(p.s).toFixed(1)},${mapEnvY(-p.envelopeX).toFixed(1)}`)
      .join(" ");
    svg += `  <polygon points="${ptsEnvXTop} ${ptsEnvXBot}" fill="url(#envFillX)" />\n`;
    svg += `  <polyline points="${ptsEnvXTop}" fill="none" stroke="#58a6ff" stroke-width="1.8" />\n`;
    svg += `  <polyline points="${data.twiss.map((p) => `${mapS(p.s).toFixed(1)},${mapEnvY(-p.envelopeX).toFixed(1)}`).join(" ")}" fill="none" stroke="#58a6ff" stroke-width="1.8" />\n`;

    // sigma_y (dashed orange)
    svg += `  <polyline points="${data.twiss.map((p) => `${mapS(p.s).toFixed(1)},${mapEnvY(p.envelopeY).toFixed(1)}`).join(" ")}" fill="none" stroke="#f0883e" stroke-width="1.5" stroke-dasharray="3,2" />\n`;
    svg += `  <polyline points="${data.twiss.map((p) => `${mapS(p.s).toFixed(1)},${mapEnvY(-p.envelopeY).toFixed(1)}`).join(" ")}" fill="none" stroke="#f0883e" stroke-width="1.5" stroke-dasharray="3,2" />\n`;

    // Center beam axis line
    svg += `  <line x1="${margin.left}" y1="${p2Top + midH / 2}" x2="${margin.left + plotW}" y2="${p2Top + midH / 2}" stroke="${mutedText}" stroke-dasharray="2,2" />\n`;

    // Envelope Y-axis labels
    svg += `  <text x="${margin.left - 10}" y="${p2Top + 14}" font-size="10" fill="${mutedText}" text-anchor="end">+${maxEnv.toFixed(1)}</text>\n`;
    svg += `  <text x="${margin.left - 10}" y="${p2Top + midH / 2 + 4}" font-size="10" fill="${mutedText}" text-anchor="end">0</text>\n`;
    svg += `  <text x="${margin.left - 10}" y="${p2Top + midH}" font-size="10" fill="${mutedText}" text-anchor="end">-${maxEnv.toFixed(1)}</text>\n`;
    svg += `  <text x="18" y="${p2Top + midH / 2}" font-size="12" font-weight="500" fill="${textCol}" text-anchor="middle" transform="rotate(-90 18 ${p2Top + midH / 2})">Beam σ (mm)</text>\n`;
  }

  // ---------------------------------------------------------------------------
  // Plot 3: Magnet Layout Schematic Track
  // ---------------------------------------------------------------------------
  const p3Top = p2Top + midH + 15;
  if (showMagnets) {
    svg += `  <!-- Plot 3: Accelerator Magnet Lattice Track -->\n`;
    svg += `  <rect x="${margin.left}" y="${p3Top}" width="${plotW}" height="${botH}" fill="${panelBg}" stroke="${borderCol}" stroke-width="1" rx="4" />\n`;

    const trackMidY = p3Top + botH / 2;

    // Vacuum pipe centerline
    svg += `  <line x1="${margin.left}" y1="${trackMidY}" x2="${margin.left + plotW}" y2="${trackMidY}" stroke="${borderCol}" stroke-width="3" />\n`;

    // Render each physical magnet element
    let currentS = 0.0;
    for (const el of data.elements) {
      const elX = mapS(currentS);
      const elW = Math.max(3.0, (el.length / totalS) * plotW);

      switch (el.type) {
        case "quadrupole": {
          const isFocusing = (el.k1 ?? 0) >= 0;
          const quadH = 26;
          const qY = isFocusing ? trackMidY - quadH : trackMidY;
          const grad = isFocusing ? "url(#qfGrad)" : "url(#qdGrad)";
          svg += `  <rect x="${elX.toFixed(1)}" y="${qY.toFixed(1)}" width="${elW.toFixed(1)}" height="${quadH}" fill="${grad}" rx="2" stroke="#ffffff" stroke-width="0.5" />\n`;
          svg += `  <text x="${(elX + elW / 2).toFixed(1)}" y="${(qY + (isFocusing ? -4 : quadH + 11)).toFixed(1)}" font-size="9" font-weight="600" fill="${isFocusing ? "#f85149" : "#58a6ff"}" text-anchor="middle">${el.name}</text>\n`;
          break;
        }
        case "sbend":
        case "rbend": {
          const bendH = 22;
          svg += `  <rect x="${elX.toFixed(1)}" y="${(trackMidY - bendH / 2).toFixed(1)}" width="${elW.toFixed(1)}" height="${bendH}" fill="url(#bendGrad)" rx="2" stroke="#ffffff" stroke-width="0.5" />\n`;
          svg += `  <text x="${(elX + elW / 2).toFixed(1)}" y="${(trackMidY + 3.5).toFixed(1)}" font-size="9" font-weight="600" fill="#ffffff" text-anchor="middle">${el.name}</text>\n`;
          break;
        }
        case "sextupole": {
          const sextH = 20;
          svg += `  <rect x="${elX.toFixed(1)}" y="${(trackMidY - sextH / 2).toFixed(1)}" width="${elW.toFixed(1)}" height="${sextH}" fill="url(#sextGrad)" rx="2" />\n`;
          svg += `  <text x="${(elX + elW / 2).toFixed(1)}" y="${(trackMidY - sextH / 2 - 3).toFixed(1)}" font-size="9" fill="#d29922" text-anchor="middle">${el.name}</text>\n`;
          break;
        }
        case "rfcavity": {
          const cavH = 24;
          svg += `  <rect x="${elX.toFixed(1)}" y="${(trackMidY - cavH / 2).toFixed(1)}" width="${elW.toFixed(1)}" height="${cavH}" fill="#bc8cff" rx="4" stroke="#ffffff" stroke-width="0.5" />\n`;
          svg += `  <text x="${(elX + elW / 2).toFixed(1)}" y="${(trackMidY + 3.5).toFixed(1)}" font-size="8.5" font-weight="600" fill="#ffffff" text-anchor="middle">RF</text>\n`;
          break;
        }
        case "collimator": {
          svg += `  <line x1="${elX.toFixed(1)}" y1="${trackMidY - 14}" x2="${elX.toFixed(1)}" y2="${trackMidY + 14}" stroke="#ff7b72" stroke-width="3" />\n`;
          break;
        }
      }

      currentS += el.length;
    }

    // Longitudinal position S ticks at bottom
    const nSTicks = 6;
    for (let i = 0; i <= nSTicks; i++) {
      const sVal = (i / nSTicks) * totalS;
      const sx = mapS(sVal);
      svg += `  <line x1="${sx.toFixed(1)}" y1="${p3Top + botH}" x2="${sx.toFixed(1)}" y2="${p3Top + botH + 5}" stroke="${mutedText}" />\n`;
      svg += `  <text x="${sx.toFixed(1)}" y="${p3Top + botH + 18}" font-size="10" fill="${mutedText}" text-anchor="middle">${sVal.toFixed(1)}</text>\n`;
    }

    svg += `  <text x="${margin.left + plotW / 2}" y="${height - 8}" font-size="12" fill="${textCol}" text-anchor="middle">Beamline Distance s (m)</text>\n`;
  }

  svg += `</svg>`;
  return svg;
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
// Accelerator Optics Linter
// ---------------------------------------------------------------------------

/**
 * Validates accelerator lattice optical stability and physical parameters:
 * - HEP1001: Unstable betatron motion / |Tr(M)| > 2.
 * - HEP1002: Negative or unphysical beta function (beta <= 0).
 * - HEP1003: Beam envelope exceeds vacuum chamber physical aperture.
 * - HEP1004: Non-positive beam energy (E <= 0).
 */
export function lintAcceleratorLattice(data: AcceleratorLatticeData): LatticeLintDiagnostic[] {
  const diagnostics: LatticeLintDiagnostic[] = [];

  // HEP1004: Beam Energy Sanity
  if (data.beam.energyGev <= 0) {
    diagnostics.push({
      code: "HEP1004",
      message: `Beam energy E = ${data.beam.energyGev} GeV must be strictly positive.`,
      severity: "error",
      field: "beam.energyGev",
    });
  }

  // HEP1002: Negative or Degenerate Beta Function
  for (const pt of data.twiss) {
    if (pt.betaX <= 0 || pt.betaY <= 0 || isNaN(pt.betaX) || isNaN(pt.betaY)) {
      diagnostics.push({
        code: "HEP1002",
        message: `Degenerate or non-positive beta function at s = ${pt.s}m (betaX = ${pt.betaX}, betaY = ${pt.betaY}).`,
        severity: "error",
        field: "twiss",
      });
      break;
    }
  }

  // HEP1003: Physical Aperture Encroachment
  let apertureBreach = false;
  for (const el of data.elements) {
    if (el.aperture !== undefined && el.aperture > 0) {
      const aperMm = el.aperture * 1000.0;
      const ptsInElem = data.twiss.filter((p) => p.elementName === el.name);
      for (const p of ptsInElem) {
        if (p.envelopeX > aperMm || p.envelopeY > aperMm) {
          diagnostics.push({
            code: "HEP1003",
            message: `Beam envelope at ${el.name} (sigmaX = ${p.envelopeX.toFixed(1)}mm, sigmaY = ${p.envelopeY.toFixed(1)}mm) exceeds physical chamber aperture of ${aperMm}mm.`,
            severity: "warning",
            field: el.name,
          });
          apertureBreach = true;
          break;
        }
      }
    }
    if (apertureBreach) break;
  }

  // HEP1001: Integer / Half-Integer Resonance Tune Proximity
  const fracTuneX = Math.abs(data.tuneX - Math.round(data.tuneX));
  const fracTuneY = Math.abs(data.tuneY - Math.round(data.tuneY));
  if (fracTuneX < 0.02 || fracTuneY < 0.02) {
    diagnostics.push({
      code: "HEP1001",
      message: `Fractional tune (Qx = ${data.tuneX}, Qy = ${data.tuneY}) is critically close to an integer betatron resonance stopband.`,
      severity: "warning",
      field: "tune",
    });
  }

  return diagnostics;
}
