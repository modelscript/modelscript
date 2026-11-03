// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — QIF (ISO 23952) MBD GD&T Callout, CMM Deviation Heatmap & SPC Diagram Builder.
 *
 * Provides high-fidelity vector visualizations for NIST Model-Based Enterprise (MBE) workflows:
 *   1. 3D-Projected MBD Callout & CMM Deviation Heatmap with ASME Y14.5 Feature Control Frames.
 *   2. Statistical Process Control (SPC) Capability Histogram & X-bar Control Chart (Cp / Cpk).
 *   3. QIF 4-Tier Digital Thread Traceability Graph (STEP AP242 <-> Nominal <-> Item <-> Actual <-> CMM).
 */

export interface QifFeatureLike {
  id: string;
  qpId?: string | undefined;
  name: string;
  featureType: string;
  isFeatureOfSize?: boolean | undefined;
  nominalSize?: number | undefined;
  location?: [number, number, number] | undefined;
  normal?: [number, number, number] | undefined;
  stepEntityId?: string | number | undefined;
  probingPoints?: [number, number, number][] | number | undefined;
}

export interface QifCharacteristicLike {
  id: string;
  qpId?: string | undefined;
  name: string;
  balloonNumber?: number | undefined;
  gdtType: string;
  nominalValue?: number | undefined;
  toleranceZone: number;
  upperTolerance?: number | undefined;
  lowerTolerance?: number | undefined;
  isDiametrical?: boolean | undefined;
  materialCondition?: "RFS" | "MMC" | "LMC" | undefined;
  datumReferences?: { datumLabel: string; materialCondition?: "RFS" | "MMC" | "LMC" | undefined }[] | undefined;
  featureIds: string[];
  deviceId?: string | undefined;
}

export interface QifActualLike {
  id: string;
  characteristicId: string;
  partSerialNumber?: string | undefined;
  measuredValue: number;
  actualFeatureSize?: number | undefined;
  deviationVector?: [number, number, number] | undefined;
  status: "PASS" | "FAIL" | "REWORK";
}

export interface QifDeviceLike {
  id: string;
  name: string;
  deviceType: string;
  calibrationUncertainty: number;
}

export interface QifDocumentLike {
  qpId?: string | undefined;
  features: QifFeatureLike[];
  characteristics: QifCharacteristicLike[];
  devices?: QifDeviceLike[] | undefined;
  actuals?: QifActualLike[] | undefined;
}

export interface QifSpcCharacteristicMetricLike {
  characteristicId: string;
  characteristicName: string;
  nominalValue: number;
  toleranceZone: number;
  effectiveTolerance: number;
  bonusTolerance: number;
  mean: number;
  stdDev: number;
  cp: number;
  cpk: number;
  tur?: number | undefined;
  passRate: number;
  sampleCount: number;
}

export interface QifSpcSummaryLike {
  metrics: QifSpcCharacteristicMetricLike[];
  overallPassRate: number;
  minCpk: number;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Maps ASME Y14.5 / ISO 1101 GD&T type names to standard engineering Unicode symbols.
 */
export function getGdtSymbol(gdtType: string): string {
  switch (gdtType) {
    case "Flatness":
      return "⏥";
    case "Straightness":
      return "⏤";
    case "Circularity":
      return "○";
    case "Cylindricity":
      return "⌭";
    case "ProfileOfLine":
      return "⌒";
    case "ProfileOfSurface":
      return "⌓";
    case "Perpendicularity":
      return "⊥";
    case "Parallelism":
      return "∥";
    case "Angularity":
      return "∠";
    case "Position":
      return "⌖";
    case "CircularRunout":
      return "↗";
    case "TotalRunout":
      return "⌰";
    case "Concentricity":
      return "◎";
    case "Symmetry":
      return "⌯";
    default:
      return "±";
  }
}

export function getMaterialModifierSymbol(mod?: "RFS" | "MMC" | "LMC"): string {
  if (mod === "MMC") return "Ⓜ";
  if (mod === "LMC") return "Ⓛ";
  return "";
}

/**
 * Renders a 3D-projected isometric CAD feature inspection view with ASME Y14.5 Feature Control Frames,
 * CMM probing points, and color-coded deviation heatmap overlays.
 */
export function renderQifMbdHeatmapSvg(doc: QifDocumentLike, spc?: QifSpcSummaryLike): string {
  const width = 920;
  const height = 520;
  const cx = 360;
  const cy = 280;

  // Isometric projection helper (mm -> screen px)
  const scale = 1.8;
  const projectIso = (x: number, y: number, z: number): { sx: number; sy: number } => {
    const cos30 = 0.8660254;
    const sin30 = 0.5;
    return {
      sx: Math.round((cx + (x - y) * cos30 * scale) * 10) / 10,
      sy: Math.round((cy - z * scale + (x + y) * sin30 * scale * 0.65) * 10) / 10,
    };
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );

  // Defs
  parts.push(`<defs>
    <linearGradient id="qifPartBody" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <marker id="qifProbeArrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,1 L7,4 L0,7 Z" fill="#38bdf8"/>
    </marker>
  </defs>`);

  // Header bar
  parts.push(`<rect x="0" y="0" width="${width}" height="40" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="25" fill="#f8fafc" font-size="13" font-weight="600">NIST MBE 3D GD&amp;T Callout &amp; CMM Deviation Heatmap (ISO 23952 QIF)</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="25" fill="#94a3b8" font-size="11" text-anchor="end">QPID: ${escapeXml(doc.qpId ?? "N/A")}</text>`,
  );

  // Coordinate Datum Reference Frame Triad (Datums A, B, C)
  const origin = projectIso(0, 0, 0);
  const xAxis = projectIso(85, 0, 0);
  const yAxis = projectIso(0, 85, 0);
  const zAxis = projectIso(0, 0, 85);

  // Reference Prismatic Part Envelope
  const b000 = projectIso(-60, -45, -20);
  const b100 = projectIso(60, -45, -20);
  const b110 = projectIso(60, 45, -20);
  const b010 = projectIso(-60, 45, -20);
  const t001 = projectIso(-60, -45, 25);
  const t101 = projectIso(60, -45, 25);
  const t111 = projectIso(60, 45, 25);
  const t011 = projectIso(-60, 45, 25);

  // Back & top faces of CAD envelope
  parts.push(
    `<polygon points="${t001.sx},${t001.sy} ${t101.sx},${t101.sy} ${t111.sx},${t111.sy} ${t011.sx},${t011.sy}" fill="#1e293b" fill-opacity="0.7" stroke="#475569" stroke-width="1.5"/>`,
  );
  parts.push(
    `<polygon points="${b100.sx},${b100.sy} ${b110.sx},${b110.sy} ${t111.sx},${t111.sy} ${t101.sx},${t101.sy}" fill="#334155" fill-opacity="0.55" stroke="#475569" stroke-width="1.5"/>`,
  );
  parts.push(
    `<polygon points="${b010.sx},${b010.sy} ${b110.sx},${b110.sy} ${t111.sx},${t111.sy} ${t011.sx},${t011.sy}" fill="#1e293b" fill-opacity="0.6" stroke="#475569" stroke-width="1.5"/>`,
  );
  parts.push(
    `<line x1="${b000.sx}" y1="${b000.sy}" x2="${t001.sx}" y2="${t001.sy}" stroke="#475569" stroke-dasharray="4,4"/>`,
  );

  // Datum Axes
  parts.push(
    `<line x1="${origin.sx}" y1="${origin.sy}" x2="${xAxis.sx}" y2="${xAxis.sy}" stroke="#ef4444" stroke-width="2"/>`,
  );
  parts.push(
    `<text x="${xAxis.sx + 6}" y="${xAxis.sy + 4}" fill="#f87171" font-size="11" font-weight="600">X (Datum B)</text>`,
  );
  parts.push(
    `<line x1="${origin.sx}" y1="${origin.sy}" x2="${yAxis.sx}" y2="${yAxis.sy}" stroke="#22c55e" stroke-width="2"/>`,
  );
  parts.push(
    `<text x="${yAxis.sx - 55}" y="${yAxis.sy + 14}" fill="#4ade80" font-size="11" font-weight="600">Y (Datum C)</text>`,
  );
  parts.push(
    `<line x1="${origin.sx}" y1="${origin.sy}" x2="${zAxis.sx}" y2="${zAxis.sy}" stroke="#3b82f6" stroke-width="2"/>`,
  );
  parts.push(
    `<text x="${zAxis.sx - 28}" y="${zAxis.sy - 8}" fill="#60a5fa" font-size="11" font-weight="600">Z (Datum A)</text>`,
  );

  const actualByChar = new Map<string, QifActualLike[]>();
  for (const act of doc.actuals ?? []) {
    const list = actualByChar.get(act.characteristicId) ?? [];
    list.push(act);
    actualByChar.set(act.characteristicId, list);
  }

  const spcByChar = new Map<string, QifSpcCharacteristicMetricLike>();
  for (const m of spc?.metrics ?? []) {
    spcByChar.set(m.characteristicId, m);
  }

  // Render features and their probing points + deviation heatmap
  const featureScreenPositions = new Map<string, { sx: number; sy: number }>();
  doc.features.forEach((feat, idx) => {
    const loc = feat.location ?? [((idx % 3) - 1) * 35, (Math.floor(idx / 3) - 0.5) * 30, 15];
    const pt = projectIso(loc[0], loc[1], loc[2]);
    featureScreenPositions.set(feat.id, pt);

    // Find linked characteristics to determine deviation color
    const linkedChars = doc.characteristics.filter((c) => c.featureIds.includes(feat.id));
    let worstRatio = 0;
    let hasFail = false;

    for (const c of linkedChars) {
      const acts = actualByChar.get(c.id) ?? [];
      for (const a of acts) {
        if (a.status === "FAIL") hasFail = true;
        const dev = c.nominalValue !== undefined ? Math.abs(a.measuredValue - c.nominalValue) : a.measuredValue;
        const ratio = c.toleranceZone > 0 ? dev / c.toleranceZone : 0;
        if (ratio > worstRatio) worstRatio = ratio;
      }
    }

    const heatColor = hasFail || worstRatio > 1.0 ? "#ef4444" : worstRatio > 0.75 ? "#f59e0b" : "#22c55e";
    const radius = Math.max(12, Math.min(28, (feat.nominalSize ?? 16) * 0.9));

    if (feat.featureType === "Cylinder" || feat.featureType === "Circle" || feat.featureType === "Sphere") {
      parts.push(
        `<ellipse cx="${pt.sx}" cy="${pt.sy}" rx="${radius}" ry="${Math.round(radius * 0.62)}" fill="${heatColor}" fill-opacity="0.28" stroke="${heatColor}" stroke-width="2.2"/>`,
      );
    } else {
      parts.push(
        `<rect x="${pt.sx - radius}" y="${pt.sy - radius * 0.55}" width="${radius * 2}" height="${radius * 1.1}" rx="3" fill="${heatColor}" fill-opacity="0.24" stroke="${heatColor}" stroke-width="2"/>`,
      );
    }

    // Probing hit points
    const probes: [number, number, number][] = Array.isArray(feat.probingPoints)
      ? feat.probingPoints
      : [
          [loc[0] + 6, loc[1], loc[2]],
          [loc[0] - 6, loc[1], loc[2]],
          [loc[0], loc[1] + 6, loc[2]],
          [loc[0], loc[1] - 6, loc[2]],
        ];
    for (const p of probes.slice(0, 8)) {
      const sp = projectIso(p[0], p[1], p[2]);
      parts.push(`<circle cx="${sp.sx}" cy="${sp.sy}" r="2.5" fill="#38bdf8" stroke="#0f172a" stroke-width="1"/>`);
    }

    parts.push(
      `<text x="${pt.sx}" y="${pt.sy + 4}" fill="#f8fafc" font-size="10" font-weight="600" text-anchor="middle">${escapeXml(feat.name)}</text>`,
    );
  });

  // Render ASME Y14.5 Feature Control Frame Callouts on the right panel
  const fcfStartX = 555;
  let fcfY = 72;

  doc.characteristics.slice(0, 7).forEach((char, idx) => {
    const sym = getGdtSymbol(char.gdtType);
    const diam = char.isDiametrical ? "⌀" : "";
    const mod = getMaterialModifierSymbol(char.materialCondition);
    const datums = (char.datumReferences ?? [])
      .map((d) => `${d.datumLabel}${getMaterialModifierSymbol(d.materialCondition)}`)
      .join(" | ");

    const acts = actualByChar.get(char.id) ?? [];
    const latestAct = acts[acts.length - 1];
    const spcMetric = spcByChar.get(char.id);
    const statusColor =
      latestAct?.status === "FAIL" ? "#ef4444" : latestAct?.status === "REWORK" ? "#f59e0b" : "#22c55e";

    // Leader line to feature
    const firstFeatId = char.featureIds[0];
    const featPos = (firstFeatId ? featureScreenPositions.get(firstFeatId) : undefined) ?? {
      sx: cx,
      sy: cy,
    };
    parts.push(
      `<polyline points="${featPos.sx},${featPos.sy} ${fcfStartX - 28},${fcfY + 14} ${fcfStartX},${fcfY + 14}" fill="none" stroke="${statusColor}" stroke-width="1.3" stroke-dasharray="3,2"/>`,
    );
    parts.push(`<circle cx="${featPos.sx}" cy="${featPos.sy}" r="3.5" fill="${statusColor}"/>`);

    // Balloon number circle
    const balloon = char.balloonNumber ?? idx + 1;
    parts.push(
      `<circle cx="${fcfStartX - 14}" cy="${fcfY + 14}" r="10" fill="#1e293b" stroke="${statusColor}" stroke-width="1.8"/>`,
    );
    parts.push(
      `<text x="${fcfStartX - 14}" y="${fcfY + 18}" fill="#f8fafc" font-size="10" font-weight="700" text-anchor="middle">${balloon}</text>`,
    );

    // Feature Control Frame Box
    const boxW = 340;
    const boxH = 48;
    parts.push(
      `<rect x="${fcfStartX}" y="${fcfY}" width="${boxW}" height="${boxH}" rx="4" fill="#1e293b" stroke="${statusColor}" stroke-width="1.6"/>`,
    );
    // Compartments inside FCF
    parts.push(`<line x1="${fcfStartX + 34}" y1="${fcfY}" x2="${fcfStartX + 34}" y2="${fcfY + 26}" stroke="#475569"/>`);
    parts.push(
      `<line x1="${fcfStartX + 135}" y1="${fcfY}" x2="${fcfStartX + 135}" y2="${fcfY + 26}" stroke="#475569"/>`,
    );
    parts.push(
      `<line x1="${fcfStartX}" y1="${fcfY + 26}" x2="${fcfStartX + boxW}" y2="${fcfY + 26}" stroke="#334155"/>`,
    );

    // Symbol compartment
    parts.push(
      `<text x="${fcfStartX + 17}" y="${fcfY + 18}" fill="#38bdf8" font-size="15" font-weight="700" text-anchor="middle">${sym}</text>`,
    );
    // Tolerance compartment
    parts.push(
      `<text x="${fcfStartX + 42}" y="${fcfY + 17}" fill="#f8fafc" font-size="12" font-weight="600">${diam}${char.toleranceZone} ${mod}</text>`,
    );
    // Datum compartments
    parts.push(
      `<text x="${fcfStartX + 143}" y="${fcfY + 17}" fill="#cbd5e1" font-size="11" font-weight="600">${escapeXml(datums || "Primary")}</text>`,
    );
    // Status pill
    parts.push(
      `<rect x="${fcfStartX + boxW - 62}" y="${fcfY + 4}" width="56" height="18" rx="9" fill="${statusColor}" fill-opacity="0.2" stroke="${statusColor}"/>`,
    );
    parts.push(
      `<text x="${fcfStartX + boxW - 34}" y="${fcfY + 16}" fill="${statusColor}" font-size="10" font-weight="700" text-anchor="middle">${latestAct?.status ?? "PLAN"}</text>`,
    );

    // Bottom row: Actual value, Bonus tolerance, & Cpk
    const actText = latestAct ? `Act: ${latestAct.measuredValue.toFixed(4)}` : "Act: Pending";
    const bonusText = spcMetric && spcMetric.bonusTolerance > 0 ? `+Bonus: ${spcMetric.bonusTolerance.toFixed(4)}` : "";
    const cpkText = spcMetric ? `Cpk: ${spcMetric.cpk.toFixed(2)}` : "";
    parts.push(
      `<text x="${fcfStartX + 8}" y="${fcfY + 41}" fill="#94a3b8" font-size="10.5">${escapeXml(char.name)} | ${actText} ${bonusText} ${cpkText}</text>`,
    );

    fcfY += 62;
  });

  // Legend
  parts.push(`<rect x="16" y="${height - 42}" width="510" height="28" rx="4" fill="#1e293b" stroke="#334155"/>`);
  parts.push(
    `<circle cx="32" cy="${height - 28}" r="5" fill="#22c55e"/><text x="44" y="${height - 24}" fill="#cbd5e1" font-size="11">In-Spec (&lt;75% Tol)</text>`,
  );
  parts.push(
    `<circle cx="170" cy="${height - 28}" r="5" fill="#f59e0b"/><text x="182" y="${height - 24}" fill="#cbd5e1" font-size="11">Marginal (75–100%)</text>`,
  );
  parts.push(
    `<circle cx="315" cy="${height - 28}" r="5" fill="#ef4444"/><text x="327" y="${height - 24}" fill="#cbd5e1" font-size="11">Out-of-Tol (&gt;100%)</text>`,
  );
  parts.push(
    `<circle cx="452" cy="${height - 28}" r="4" fill="#38bdf8"/><text x="462" y="${height - 24}" fill="#cbd5e1" font-size="11">CMM Hits</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * Renders a Statistical Process Control (SPC) capability chart showing Cp / Cpk bars and USL/LSL bounds.
 */
export function renderQifSpcChartSvg(spc: QifSpcSummaryLike): string {
  const width = 880;
  const height = 340;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="38" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="24" fill="#f8fafc" font-size="13" font-weight="600">QIF Statistical Process Control (SPC) Capability — Cp / Cpk &amp; TUR Benchmark</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="24" fill="#38bdf8" font-size="12" font-weight="600" text-anchor="end">Overall Pass Rate: ${(spc.overallPassRate * 100).toFixed(1)}% | Min Cpk: ${spc.minCpk.toFixed(2)}</text>`,
  );

  const chartX = 70;
  const chartY = 65;
  const chartW = 770;
  const chartH = 215;

  // Threshold reference lines (Cpk = 1.00 red, Cpk = 1.33 green)
  const maxCpkScale = 2.5;
  const yForCpk = (val: number) => {
    const clamped = Math.max(0, Math.min(maxCpkScale, val));
    return chartY + chartH - (clamped / maxCpkScale) * chartH;
  };

  parts.push(
    `<rect x="${chartX}" y="${chartY}" width="${chartW}" height="${chartH}" fill="#1e293b" fill-opacity="0.4" stroke="#334155"/>`,
  );

  const y100 = yForCpk(1.0);
  const y133 = yForCpk(1.33);
  parts.push(
    `<line x1="${chartX}" y1="${y100}" x2="${chartX + chartW}" y2="${y100}" stroke="#ef4444" stroke-dasharray="4,4"/>`,
  );
  parts.push(`<text x="${chartX - 8}" y="${y100 + 4}" fill="#f87171" font-size="10" text-anchor="end">1.00</text>`);
  parts.push(
    `<line x1="${chartX}" y1="${y133}" x2="${chartX + chartW}" y2="${y133}" stroke="#22c55e" stroke-dasharray="4,4"/>`,
  );
  parts.push(
    `<text x="${chartX - 8}" y="${y133 + 4}" fill="#4ade80" font-size="10" text-anchor="end">1.33 (6σ)</text>`,
  );

  const metrics = spc.metrics.slice(0, 10);
  const colW = metrics.length > 0 ? chartW / metrics.length : chartW;

  metrics.forEach((m, i) => {
    const bx = chartX + i * colW + colW * 0.2;
    const bw = Math.min(48, colW * 0.6);
    const barTop = yForCpk(m.cpk);
    const barH = Math.max(4, chartY + chartH - barTop);
    const color = m.cpk >= 1.33 ? "#22c55e" : m.cpk >= 1.0 ? "#f59e0b" : "#ef4444";

    parts.push(
      `<rect x="${bx}" y="${barTop}" width="${bw}" height="${barH}" rx="3" fill="${color}" fill-opacity="0.85"/>`,
    );
    parts.push(
      `<text x="${bx + bw / 2}" y="${barTop - 6}" fill="#f8fafc" font-size="11" font-weight="600" text-anchor="middle">${m.cpk.toFixed(2)}</text>`,
    );
    parts.push(
      `<text x="${bx + bw / 2}" y="${chartY + chartH + 18}" fill="#cbd5e1" font-size="10.5" text-anchor="middle">${escapeXml(m.characteristicName.slice(0, 14))}</text>`,
    );
    parts.push(
      `<text x="${bx + bw / 2}" y="${chartY + chartH + 32}" fill="#64748b" font-size="9.5" text-anchor="middle">TUR: ${m.tur !== undefined ? m.tur.toFixed(1) + ":1" : "N/A"}</text>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}
