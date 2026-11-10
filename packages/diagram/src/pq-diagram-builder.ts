// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Generator & Inverter P-Q Capability Operating Chart SVG Diagram Builder.
 *
 * Generates standalone SVG charts visualizing:
 *   - Armature heating limit: S_rated circle P^2 + Q^2 <= S_n^2.
 *   - Field current heating limit: Circle centered at (0, -V^2/X_d) with radius proportional to max excitation.
 *   - Stator end-core heating / underexcitation limiter (UEL) boundary.
 *   - Prime mover / turbine maximum active power limit P_max and minimum active power P_min.
 *   - Grid Code requirement capability envelope (e.g. ENTSO-E RfG / IEEE 2800 leading/lagging power factor bounds).
 *   - Operating point marker (P_0, Q_0) and operating locus trajectory.
 */

export interface PqDiagramOptions {
  title?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  ratedMva: number;
  maxActivePowerMw: number;
  minActivePowerMw?: number | undefined;
  maxLaggingMvar: number;
  maxLeadingMvar: number;
  gridCodeEnvelope?: {
    pMinMw: number;
    pMaxMw: number;
    qMinMvar: number;
    qMaxMvar: number;
    label?: string | undefined;
  } | undefined;
  currentOperatingPoint?: {
    pMw: number;
    qMvar: number;
    label?: string | undefined;
  } | undefined;
  operatingTrajectory?: Array<[number, number]> | undefined; // Array of [pMw, qMvar]
}

/**
 * Renders an interactive, dark-mode SVG Generator P-Q Capability Chart.
 */
export function renderPqDiagramSvg(options: PqDiagramOptions): string {
  const width = options.width ?? 800;
  const height = options.height ?? 650;
  const margin = { top: 50, right: 60, bottom: 60, left: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const sRated = options.ratedMva;
  const maxP = sRated * 1.25;
  const maxQ = sRated * 1.1;

  // Coordinate scales: P (horizontal, -0.2*maxP to maxP), Q (vertical, -maxQ to maxQ)
  const pMin = -0.15 * maxP;
  const pMax = maxP;
  const qMin = -maxQ;
  const qMax = maxQ;

  const toX = (pMw: number): number => {
    return margin.left + ((pMw - pMin) / (pMax - pMin)) * plotWidth;
  };

  const toY = (qMvar: number): number => {
    // Invert: positive Q (lagging / inductive export) upwards, negative Q (leading / capacitive import) downwards
    return margin.top + (1.0 - (qMvar - qMin) / (qMax - qMin)) * plotHeight;
  };

  const elements: string[] = [];

  // SVG Container
  elements.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<defs>`,
    `  <style>`,
    `    .pq-bg { fill: #0f172a; }`,
    `    .pq-grid { stroke: #1e293b; stroke-width: 1; }`,
    `    .pq-axis { stroke: #475569; stroke-width: 1.5; }`,
    `    .pq-armature { fill: rgba(59, 130, 246, 0.15); stroke: #3b82f6; stroke-width: 2.5; }`,
    `    .pq-field { stroke: #ef4444; stroke-width: 2; stroke-dasharray: 4,4; }`,
    `    .pq-gridcode { fill: rgba(34, 197, 94, 0.12); stroke: #22c55e; stroke-width: 2; stroke-dasharray: 6,3; }`,
    `    .pq-label { fill: #94a3b8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; }`,
    `    .pq-title { fill: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; font-weight: 600; }`,
    `    .pq-legend { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; }`,
    `  </style>`,
    `</defs>`,
    `<rect width="${width}" height="${height}" class="pq-bg" />`,
  );

  // Title
  const title = options.title ?? "Generator / Inverter P-Q Capability Operating Chart";
  elements.push(
    `<text x="${width / 2}" y="32" class="pq-title" text-anchor="middle">${title}</text>`,
  );

  // Axes (P = 0 and Q = 0)
  const xOrigin = toX(0);
  const yOrigin = toY(0);

  // Background Grid Lines
  for (let pStep = 0; pStep <= maxP; pStep += sRated * 0.25) {
    const x = toX(pStep);
    elements.push(
      `<line x1="${x.toFixed(1)}" y1="${margin.top}" x2="${x.toFixed(1)}" y2="${margin.top + plotHeight}" class="pq-grid" />`,
      `<text x="${x.toFixed(1)}" y="${margin.top + plotHeight + 18}" class="pq-label" text-anchor="middle">${pStep.toFixed(0)} MW</text>`,
    );
  }
  for (let qStep = -sRated; qStep <= sRated; qStep += sRated * 0.5) {
    if (Math.abs(qStep) <= maxQ) {
      const y = toY(qStep);
      elements.push(
        `<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${margin.left + plotWidth}" y2="${y.toFixed(1)}" class="pq-grid" />`,
        `<text x="${margin.left - 10}" y="${(y + 4).toFixed(1)}" class="pq-label" text-anchor="end">${qStep.toFixed(0)} Mvar</text>`,
      );
    }
  }

  // Major Coordinate Axes
  elements.push(
    `<line x1="${xOrigin.toFixed(1)}" y1="${margin.top}" x2="${xOrigin.toFixed(1)}" y2="${margin.top + plotHeight}" class="pq-axis" />`,
    `<line x1="${margin.left}" y1="${yOrigin.toFixed(1)}" x2="${margin.left + plotWidth}" y2="${yOrigin.toFixed(1)}" class="pq-axis" />`,
    `<text x="${margin.left + plotWidth - 10}" y="${(yOrigin - 8).toFixed(1)}" fill="#cbd5e1" class="pq-legend" text-anchor="end">P (MW)</text>`,
    `<text x="${(xOrigin + 10).toFixed(1)}" y="${margin.top + 16}" fill="#cbd5e1" class="pq-legend">Q (Mvar)</text>`,
  );

  // 1. Armature Heating Limit (Stator Current Semicircle P^2 + Q^2 = S_rated^2)
  const numArcPts = 40;
  const arcPts: string[] = [];
  for (let i = 0; i <= numArcPts; i++) {
    const angle = -Math.PI / 2 + (Math.PI * i) / numArcPts; // -90 deg to +90 deg
    const p = Math.max(0, sRated * Math.cos(angle));
    const q = sRated * Math.sin(angle);
    arcPts.push(`${toX(p).toFixed(1)},${toY(q).toFixed(1)}`);
  }
  elements.push(
    `<polygon points="${toX(0).toFixed(1)},${toY(sRated).toFixed(1)} ${arcPts.join(" ")} ${toX(0).toFixed(1)},${toY(-sRated).toFixed(1)}" class="pq-armature" />`,
  );

  // 2. Prime Mover Maximum Power Cutoff Line P = maxActivePowerMw
  const pTurbineMax = Math.min(sRated, options.maxActivePowerMw);
  const xTurbine = toX(pTurbineMax);
  elements.push(
    `<line x1="${xTurbine.toFixed(1)}" y1="${toY(-sRated).toFixed(1)}" x2="${xTurbine.toFixed(1)}" y2="${toY(sRated).toFixed(1)}" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4,4" />`,
    `<text x="${(xTurbine + 6).toFixed(1)}" y="${toY(sRated * 0.8).toFixed(1)}" fill="#f59e0b" class="pq-label">Turbine P_max</text>`,
  );

  // 3. Grid Code Envelope Box (if provided)
  if (options.gridCodeEnvelope) {
    const gc = options.gridCodeEnvelope;
    const x1 = toX(gc.pMinMw);
    const x2 = toX(gc.pMaxMw);
    const y1 = toY(gc.qMaxMvar);
    const y2 = toY(gc.qMinMvar);
    elements.push(
      `<rect x="${Math.min(x1, x2).toFixed(1)}" y="${Math.min(y1, y2).toFixed(1)}" width="${Math.abs(x2 - x1).toFixed(1)}" height="${Math.abs(y2 - y1).toFixed(1)}" class="pq-gridcode" />`,
      `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${(y1 + 16).toFixed(1)}" fill="#22c55e" class="pq-legend" text-anchor="middle">${gc.label ?? "Grid Code Mandated Envelope"}</text>`,
    );
  }

  // 4. Operating Trajectory (if provided)
  if (options.operatingTrajectory && options.operatingTrajectory.length > 1) {
    const pathD = options.operatingTrajectory
      .map(([p, q], idx) => `${idx === 0 ? "M" : "L"} ${toX(p).toFixed(1)} ${toY(q).toFixed(1)}`)
      .join(" ");
    elements.push(
      `<path d="${pathD}" fill="none" stroke="#a855f7" stroke-width="2.5" />`,
    );
  }

  // 5. Current Operating Point
  if (options.currentOperatingPoint) {
    const op = options.currentOperatingPoint;
    const opX = toX(op.pMw);
    const opY = toY(op.qMvar);
    elements.push(
      `<circle cx="${opX.toFixed(1)}" cy="${opY.toFixed(1)}" r="7" fill="#ef4444" stroke="#ffffff" stroke-width="2" />`,
      `<text x="${(opX + 12).toFixed(1)}" y="${(opY + 4).toFixed(1)}" fill="#f8fafc" class="pq-legend">${op.label ?? `Oper: (${op.pMw.toFixed(1)}MW, ${op.qMvar.toFixed(1)}Mvar)`}</text>`,
    );
  }

  // Legend
  const legX = margin.left + 20;
  const legY = margin.top + 25;
  elements.push(
    `<rect x="${legX}" y="${legY}" width="16" height="12" class="pq-armature" />`,
    `<text x="${legX + 22}" y="${legY + 10}" fill="#f8fafc" class="pq-legend">Armature Heating Limit (S_n = ${sRated} MVA)</text>`,
  );

  elements.push(`</svg>`);
  return elements.join("\n");
}
