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

export interface QifDatumDefinitionLike {
  id: string;
  label: string;
  featureId?: string | undefined;
}

export interface QifDocumentLike {
  qpId?: string | undefined;
  datumDefinitions?: QifDatumDefinitionLike[] | undefined;
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
 * Renders a 3D-projected isometric STEP AP242 CAD B-Rep feature inspection view with
 * ASME Y14.5 Feature Control Frames, Datum Reference Frames, CMM probing points,
 * and collision-free callout geometry.
 */
export function renderQifMbdHeatmapSvg(doc: QifDocumentLike, spc?: QifSpcSummaryLike): string {
  const width = 920;
  const height = 520;
  const cx = 270;
  const cy = 285;

  // Compute dynamic bounding box from feature locations
  let minX = -32;
  let maxX = 52;
  let minY = -26;
  let maxY = 26;
  let minZ = -6;
  let maxZ = 22;

  doc.features.forEach((feat, idx) => {
    const loc = feat.location ?? [((idx % 3) - 1) * 28, (Math.floor(idx / 3) - 0.5) * 24, 12];
    const r = (feat.nominalSize ?? 12) * 0.6;
    if (loc[0] - r - 12 < minX) minX = loc[0] - r - 12;
    if (loc[0] + r + 12 > maxX) maxX = loc[0] + r + 12;
    if (loc[1] - r - 12 < minY) minY = loc[1] - r - 12;
    if (loc[1] + r + 12 > maxY) maxY = loc[1] + r + 12;
    if (loc[2] - 6 < minZ) minZ = loc[2] - 6;
    if (loc[2] + 8 > maxZ) maxZ = loc[2] + 8;
  });

  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const midZ = (minZ + maxZ) / 2;
  const span = Math.max(80, maxX - minX, maxY - minY, (maxZ - minZ) * 2);
  const scale = Math.min(2.35, Math.max(1.45, 195 / span));

  const projectIso = (x: number, y: number, z: number): { sx: number; sy: number } => {
    const dx = x - midX;
    const dy = y - midY;
    const dz = z - midZ;
    const cos30 = 0.8660254;
    const sin30 = 0.5;
    return {
      sx: Math.round((cx + (dx - dy) * cos30 * scale) * 10) / 10,
      sy: Math.round((cy - dz * scale * 1.15 + (dx + dy) * sin30 * scale * 0.68) * 10) / 10,
    };
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );

  // Defs
  parts.push(`<defs>
    <linearGradient id="qifCadTopDeck" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#334155"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="qifCadRightWall" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#475569"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="qifCadLeftWall" x1="0%" y1="0%" x2="100%" y2="100%">
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
    `<text x="16" y="25" fill="#f8fafc" font-size="13" font-weight="600">NIST MBE 3D GD&amp;T Callout &amp; STEP AP242 CMM Deviation Heatmap (ISO 23952 QIF)</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="25" fill="#94a3b8" font-size="11" text-anchor="end">QPID: ${escapeXml(doc.qpId ?? "N/A")}</text>`,
  );

  // Render Multi-Tiered Stepped CAD Solid (Fir-Tree Root Lobe + Upper Platform Shroud)
  const renderIsoPrism = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, opacity: number) => {
    const b100 = projectIso(x1, y0, z0);
    const b110 = projectIso(x1, y1, z0);
    const b010 = projectIso(x0, y1, z0);
    const t001 = projectIso(x0, y0, z1);
    const t101 = projectIso(x1, y0, z1);
    const t111 = projectIso(x1, y1, z1);
    const t011 = projectIso(x0, y1, z1);

    parts.push(
      `<polygon points="${b100.sx},${b100.sy} ${b110.sx},${b110.sy} ${t111.sx},${t111.sy} ${t101.sx},${t101.sy}" fill="url(#qifCadRightWall)" fill-opacity="${opacity}" stroke="#64748b" stroke-width="1.2"/>`,
    );
    parts.push(
      `<polygon points="${b010.sx},${b010.sy} ${b110.sx},${b110.sy} ${t111.sx},${t111.sy} ${t011.sx},${t011.sy}" fill="url(#qifCadLeftWall)" fill-opacity="${opacity}" stroke="#64748b" stroke-width="1.2"/>`,
    );
    parts.push(
      `<polygon points="${t001.sx},${t001.sy} ${t101.sx},${t101.sy} ${t111.sx},${t111.sy} ${t011.sx},${t011.sy}" fill="url(#qifCadTopDeck)" fill-opacity="${opacity}" stroke="#94a3b8" stroke-width="1.4"/>`,
    );
  };

  const zMid1 = minZ + (maxZ - minZ) * 0.36;
  const zMid2 = minZ + (maxZ - minZ) * 0.68;
  // Lower fir-tree root base tang
  renderIsoPrism(minX + 6, maxX - 6, minY * 0.58, maxY * 0.58, minZ, zMid1, 0.78);
  // Middle fir-tree serration lobe
  renderIsoPrism(minX + 3, maxX - 3, minY * 0.78, maxY * 0.78, zMid1, zMid2, 0.82);
  // Upper platform shroud deck
  renderIsoPrism(minX, maxX, minY, maxY, zMid2, maxZ, 0.88);

  // Coordinate Datum Reference Frame Triad (Datums A, B, C) anchored at lower-left corner
  const triadOrigin = { sx: 68, sy: 425 };
  parts.push(
    `<line x1="${triadOrigin.sx}" y1="${triadOrigin.sy}" x2="${triadOrigin.sx + 42}" y2="${triadOrigin.sy + 18}" stroke="#ef4444" stroke-width="2"/>`,
  );
  parts.push(
    `<text x="${triadOrigin.sx + 46}" y="${triadOrigin.sy + 22}" fill="#f87171" font-size="10" font-weight="600">X (Datum B)</text>`,
  );
  parts.push(
    `<line x1="${triadOrigin.sx}" y1="${triadOrigin.sy}" x2="${triadOrigin.sx - 40}" y2="${triadOrigin.sy + 18}" stroke="#22c55e" stroke-width="2"/>`,
  );
  parts.push(
    `<text x="${triadOrigin.sx - 42}" y="${triadOrigin.sy + 31}" fill="#4ade80" font-size="10" font-weight="600" text-anchor="middle">Y (Datum C)</text>`,
  );
  parts.push(
    `<line x1="${triadOrigin.sx}" y1="${triadOrigin.sy}" x2="${triadOrigin.sx}" y2="${triadOrigin.sy - 46}" stroke="#3b82f6" stroke-width="2"/>`,
  );
  parts.push(
    `<text x="${triadOrigin.sx}" y="${triadOrigin.sy - 52}" fill="#60a5fa" font-size="10" font-weight="600" text-anchor="middle">Z (Datum A)</text>`,
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

  // Map featureId -> datumLabel (e.g., F_ROOT_BASE -> "A")
  const datumByFeature = new Map<string, string>();
  for (const d of doc.datumDefinitions ?? []) {
    if (d.featureId) datumByFeature.set(d.featureId, d.label);
  }
  if (datumByFeature.size === 0) {
    doc.features.slice(0, 3).forEach((f, i) => {
      if (f.name.endsWith("A") || i === 0) datumByFeature.set(f.id, "A");
      else if (f.name.endsWith("B") || i === 1) datumByFeature.set(f.id, "B");
      else if (f.name.endsWith("C") || i === 2) datumByFeature.set(f.id, "C");
    });
  }

  // Render 3D B-Rep features, probing hit clouds, and non-overlapping STEP entity callout badges
  const featureScreenPositions = new Map<string, { sx: number; sy: number }>();
  const placedBadgeRects: { x: number; y: number; w: number; h: number }[] = [];

  // Pre-assigned radial offset directions so feature tags fan outward cleanly around the CAD body
  const radialOffsets: [number, number][] = [
    [-95, 62],
    [-85, -72],
    [-115, -18],
    [55, -82],
    [68, 68],
    [-50, 88],
  ];

  doc.features.forEach((feat, idx) => {
    const loc = feat.location ?? [((idx % 3) - 1) * 28, (Math.floor(idx / 3) - 0.5) * 24, 12];
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
    const radius = Math.max(11, Math.min(26, (feat.nominalSize ?? 14) * 1.15));

    if (feat.featureType === "Cylinder" || feat.featureType === "Circle" || feat.featureType === "Sphere") {
      const ry = Math.round(radius * 0.58);
      const depth = 16;
      // 3D cylindrical bore wall & bottom ellipse
      parts.push(
        `<path d="M ${pt.sx - radius},${pt.sy} L ${pt.sx - radius},${pt.sy + depth} A ${radius} ${ry} 0 0 0 ${pt.sx + radius},${pt.sy + depth} L ${pt.sx + radius},${pt.sy} Z" fill="#0f172a" fill-opacity="0.72" stroke="${heatColor}" stroke-width="1.5"/>`,
      );
      parts.push(
        `<ellipse cx="${pt.sx}" cy="${pt.sy + depth}" rx="${radius}" ry="${ry}" fill="none" stroke="${heatColor}" stroke-width="1.2" stroke-dasharray="3,2"/>`,
      );
      parts.push(
        `<ellipse cx="${pt.sx}" cy="${pt.sy}" rx="${radius}" ry="${ry}" fill="${heatColor}" fill-opacity="0.32" stroke="${heatColor}" stroke-width="2.2"/>`,
      );
    } else if (feat.featureType === "Slot") {
      const w = radius * 2.1;
      const h = radius * 0.95;
      parts.push(
        `<rect x="${pt.sx - w / 2}" y="${pt.sy - h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="#0f172a" fill-opacity="0.75" stroke="${heatColor}" stroke-width="2"/>`,
      );
    } else {
      // Plane / Datum surface patch
      const w = radius * 2.4;
      const h = radius * 1.15;
      parts.push(
        `<polygon points="${pt.sx - w * 0.6},${pt.sy} ${pt.sx + w * 0.2},${pt.sy - h * 0.6} ${pt.sx + w * 0.6},${pt.sy} ${pt.sx - w * 0.2},${pt.sy + h * 0.6}" fill="${heatColor}" fill-opacity="0.22" stroke="${heatColor}" stroke-width="1.8" stroke-dasharray="4,2"/>`,
      );
    }

    // Probing hit points
    const probes: [number, number, number][] = Array.isArray(feat.probingPoints)
      ? feat.probingPoints
      : [
          [loc[0] + 5, loc[1], loc[2]],
          [loc[0] - 5, loc[1], loc[2]],
          [loc[0], loc[1] + 5, loc[2]],
          [loc[0], loc[1] - 5, loc[2]],
        ];
    for (const p of probes.slice(0, 8)) {
      const sp = projectIso(p[0], p[1], p[2]);
      parts.push(`<circle cx="${sp.sx}" cy="${sp.sy}" r="2.4" fill="#38bdf8" stroke="#0f172a" stroke-width="0.9"/>`);
    }

    // Compute collision-free badge position for STEP Entity + Datum tag (no raw overlapping feature names on part!)
    const datumLbl = datumByFeature.get(feat.id);
    const rawStepId = feat.stepEntityId !== undefined ? String(feat.stepEntityId) : `F${idx + 1}`;
    const stepTag = rawStepId.startsWith("#") || rawStepId.startsWith("F") ? rawStepId : `#${rawStepId}`;
    const shortBadgeText = datumLbl ? `${stepTag} · Datum ${datumLbl}` : `${stepTag} · ${feat.featureType}`;
    const badgeW = Math.max(68, shortBadgeText.length * 6.2 + 14);
    const badgeH = 20;

    const [offX, offY] = radialOffsets[idx % radialOffsets.length]!;
    let bx = Math.max(18, Math.min(445 - badgeW, pt.sx + offX - badgeW / 2));
    let by = Math.max(54, Math.min(height - 76, pt.sy + offY - badgeH / 2));

    // Resolve any vertical overlap with previously placed badges
    for (let attempt = 0; attempt < 8; attempt++) {
      const collides = placedBadgeRects.some(
        (r) => bx < r.x + r.w + 6 && bx + badgeW + 6 > r.x && by < r.y + r.h + 6 && by + badgeH + 6 > r.y,
      );
      if (!collides) break;
      by += attempt % 2 === 0 ? 26 : -26;
      by = Math.max(52, Math.min(height - 74, by));
    }
    placedBadgeRects.push({ x: bx, y: by, w: badgeW, h: badgeH });

    const badgeCx = bx + badgeW / 2;
    const badgeCy = by + badgeH / 2;
    parts.push(
      `<line x1="${pt.sx}" y1="${pt.sy}" x2="${badgeCx}" y2="${badgeCy}" stroke="#64748b" stroke-width="1.1" stroke-dasharray="2,2"/>`,
    );
    parts.push(
      `<rect x="${bx}" y="${by}" width="${badgeW}" height="${badgeH}" rx="4" fill="#0f172a" fill-opacity="0.92" stroke="${heatColor}" stroke-width="1.3"/>`,
    );
    parts.push(
      `<text x="${badgeCx}" y="${by + 13.5}" fill="#e2e8f0" font-size="9.5" font-weight="600" text-anchor="middle">${escapeXml(shortBadgeText)}</text>`,
    );
  });

  // Render ASME Y14.5 Feature Control Frame Callouts on the right panel
  const fcfStartX = 535;
  let fcfY = 66;

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
    const linkedFeat = doc.features.find((f) => f.id === firstFeatId);
    const featPos = (firstFeatId ? featureScreenPositions.get(firstFeatId) : undefined) ?? {
      sx: cx,
      sy: cy,
    };
    parts.push(
      `<polyline points="${featPos.sx},${featPos.sy} ${fcfStartX - 30},${fcfY + 14} ${fcfStartX},${fcfY + 14}" fill="none" stroke="${statusColor}" stroke-width="1.3" stroke-dasharray="3,2"/>`,
    );
    parts.push(`<circle cx="${featPos.sx}" cy="${featPos.sy}" r="3.5" fill="${statusColor}"/>`);

    // Balloon number circle
    const balloon = char.balloonNumber ?? idx + 1;
    parts.push(
      `<circle cx="${fcfStartX - 15}" cy="${fcfY + 14}" r="10" fill="#1e293b" stroke="${statusColor}" stroke-width="1.8"/>`,
    );
    parts.push(
      `<text x="${fcfStartX - 15}" y="${fcfY + 18}" fill="#f8fafc" font-size="10" font-weight="700" text-anchor="middle">${balloon}</text>`,
    );

    // Feature Control Frame Box
    const boxW = 365;
    const boxH = 50;
    parts.push(
      `<rect x="${fcfStartX}" y="${fcfY}" width="${boxW}" height="${boxH}" rx="4" fill="#1e293b" stroke="${statusColor}" stroke-width="1.6"/>`,
    );
    // Compartments inside FCF
    parts.push(`<line x1="${fcfStartX + 34}" y1="${fcfY}" x2="${fcfStartX + 34}" y2="${fcfY + 26}" stroke="#475569"/>`);
    parts.push(
      `<line x1="${fcfStartX + 132}" y1="${fcfY}" x2="${fcfStartX + 132}" y2="${fcfY + 26}" stroke="#475569"/>`,
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
      `<text x="${fcfStartX + 140}" y="${fcfY + 17}" fill="#cbd5e1" font-size="11" font-weight="600">${escapeXml(datums || "Primary")}</text>`,
    );
    // STEP Entity pill
    if (linkedFeat?.stepEntityId !== undefined) {
      const fStepRaw = String(linkedFeat.stepEntityId);
      const fStepTag = fStepRaw.startsWith("#") ? fStepRaw : `#${fStepRaw}`;
      parts.push(
        `<rect x="${fcfStartX + boxW - 118}" y="${fcfY + 4}" width="48" height="18" rx="4" fill="#0f172a" stroke="#38bdf8" stroke-opacity="0.45"/>`,
      );
      parts.push(
        `<text x="${fcfStartX + boxW - 94}" y="${fcfY + 16}" fill="#38bdf8" font-size="9.5" font-weight="700" text-anchor="middle">STEP ${escapeXml(fStepTag)}</text>`,
      );
    }
    // Status pill
    parts.push(
      `<rect x="${fcfStartX + boxW - 62}" y="${fcfY + 4}" width="56" height="18" rx="9" fill="${statusColor}" fill-opacity="0.2" stroke="${statusColor}"/>`,
    );
    parts.push(
      `<text x="${fcfStartX + boxW - 34}" y="${fcfY + 16}" fill="${statusColor}" font-size="10" font-weight="700" text-anchor="middle">${latestAct?.status ?? "PLAN"}</text>`,
    );

    // Bottom row: Feature name, Actual value, Bonus tolerance, & Cpk
    const actText = latestAct ? `Act: ${latestAct.measuredValue.toFixed(4)}` : "Act: Pending";
    const bonusText = spcMetric && spcMetric.bonusTolerance > 0 ? `+Bonus: ${spcMetric.bonusTolerance.toFixed(4)}` : "";
    const cpkText = spcMetric ? `Cpk: ${spcMetric.cpk.toFixed(2)}` : "";
    const featLabel = linkedFeat ? `${linkedFeat.name} (${char.name})` : char.name;
    const truncatedLabel = featLabel.length > 36 ? `${featLabel.slice(0, 34)}..` : featLabel;
    parts.push(
      `<text x="${fcfStartX + 8}" y="${fcfY + 42}" fill="#94a3b8" font-size="10">${escapeXml(truncatedLabel)} | ${actText} ${bonusText} ${cpkText}</text>`,
    );

    fcfY += 64;
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

export interface Qif3dIsometricOptions {
  stepContent?: string | undefined;
  fallbackTitle?: string | undefined;
  showAnnotations?: boolean | undefined;
  showProbes?: boolean | undefined;
  whiskerScale?: number | undefined;
}

/**
 * Renders a faithful 3D-projected isometric STEP AP242 CAD B-Rep solid with
 * ASME Y14.5 Feature Control Frames, Datum Reference Frames (DRF), and
 * 3D CMM Touch-Probe hits with deviation whiskers.
 *
 * Produces a transparent-background vector SVG matching the Three.js viewport
 * in QifViewer, ensuring seamless transition between thumbnail and interactive 3D scene.
 */
export function renderQif3dIsometricSvg(doc: QifDocumentLike, options: Qif3dIsometricOptions = {}): string {
  const width = 800;
  const height = 450;
  const showAnnotations = options.showAnnotations ?? true;
  const showProbes = options.showProbes ?? true;
  const whiskerScale = options.whiskerScale ?? 22.0;

  const dist3 = (a: [number, number, number], b: [number, number, number]): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const pushUniquePt = (arr: [number, number, number][], p: [number, number, number]) => {
    if (arr.length > 0) {
      const last = arr[arr.length - 1]!;
      if (dist3(last, p) < 1e-6) return;
    }
    arr.push(p);
  };

  const faces: [number, number, number][][] = [];
  const edgeCurvesList: [[number, number, number], [number, number, number]][] = [];
  const allPts: [number, number, number][] = [];

  // 1. Extract B-Rep faces from STEP if provided
  if (options.stepContent && options.stepContent.length > 0) {
    const stepContent = options.stepContent;
    const cartesianPoints = new Map<number, [number, number, number]>();
    const ptRe =
      /#(\d+)\s*=\s*CARTESIAN_POINT\s*\([^,]*,\s*\(\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = ptRe.exec(stepContent)) !== null) {
      const id = Number(m[1]);
      const x = Number(m[2]);
      const y = Number(m[3]);
      const z = Number(m[4]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        cartesianPoints.set(id, [x, y, z]);
      }
    }

    const vertexPoints = new Map<number, [number, number, number]>();
    const vpRe = /#(\d+)\s*=\s*VERTEX_POINT\s*\([^,]*,\s*#(\d+)\s*\)/g;
    while ((m = vpRe.exec(stepContent)) !== null) {
      const vid = Number(m[1]);
      const pid = Number(m[2]);
      const pt = cartesianPoints.get(pid);
      if (pt) vertexPoints.set(vid, pt);
    }

    const edgeCurves = new Map<number, [[number, number, number], [number, number, number]]>();
    const ecRe = /#(\d+)\s*=\s*EDGE_CURVE\s*\([^,]*,\s*#(\d+)\s*,\s*#(\d+)/g;
    while ((m = ecRe.exec(stepContent)) !== null) {
      const eid = Number(m[1]);
      const v1 = vertexPoints.get(Number(m[2])) ?? cartesianPoints.get(Number(m[2]));
      const v2 = vertexPoints.get(Number(m[3])) ?? cartesianPoints.get(Number(m[3]));
      if (v1 && v2) edgeCurves.set(eid, [v1, v2]);
    }

    const orientedEdges = new Map<number, { edgeId: number; forward: boolean }>();
    const oeRe = /#(\d+)\s*=\s*ORIENTED_EDGE\s*\([^,]*,[^,]*,[^,]*,\s*#(\d+)\s*,\s*\.(T|F)\./g;
    while ((m = oeRe.exec(stepContent)) !== null) {
      orientedEdges.set(Number(m[1]), { edgeId: Number(m[2]), forward: m[3] === "T" });
    }

    const elRe = /#(\d+)\s*=\s*EDGE_LOOP\s*\([^,]*,\s*\(([^)]+)\)\s*\)/g;
    while ((m = elRe.exec(stepContent)) !== null) {
      const refs = m[2]!.match(/#(\d+)/g);
      if (!refs || refs.length < 3) continue;
      const segs: [[number, number, number], [number, number, number]][] = [];
      for (const ref of refs) {
        const refId = Number(ref.slice(1));
        const oe = orientedEdges.get(refId);
        if (oe) {
          const curve = edgeCurves.get(oe.edgeId);
          if (curve) segs.push(oe.forward ? [curve[0], curve[1]] : [curve[1], curve[0]]);
        } else {
          const curve = edgeCurves.get(refId);
          if (curve) segs.push([curve[0], curve[1]]);
        }
      }
      if (segs.length < 2) continue;

      const poly: [number, number, number][] = [];
      let firstSeg = segs[0]!;
      const secondSeg = segs[1]!;
      const dEnd = Math.min(dist3(firstSeg[1], secondSeg[0]), dist3(firstSeg[1], secondSeg[1]));
      const dStart = Math.min(dist3(firstSeg[0], secondSeg[0]), dist3(firstSeg[0], secondSeg[1]));
      if (dStart + 1e-6 < dEnd) firstSeg = [firstSeg[1], firstSeg[0]];
      pushUniquePt(poly, firstSeg[0]);
      pushUniquePt(poly, firstSeg[1]);

      for (let i = 1; i < segs.length; i++) {
        let seg = segs[i]!;
        const lastPt = poly[poly.length - 1]!;
        if (dist3(lastPt, seg[1]) + 1e-6 < dist3(lastPt, seg[0])) seg = [seg[1], seg[0]];
        pushUniquePt(poly, seg[0]);
        pushUniquePt(poly, seg[1]);
      }

      if (poly.length >= 2 && dist3(poly[0]!, poly[poly.length - 1]!) < 1e-5) poly.pop();
      if (poly.length >= 3) {
        faces.push(poly);
        for (const p of poly) allPts.push(p);
      }
    }

    for (const ec of edgeCurves.values()) {
      edgeCurvesList.push(ec);
      allPts.push(ec[0], ec[1]);
    }
  }

  // 2. Synthesize feature 3D solids if no STEP faces were extracted
  if (faces.length === 0) {
    doc.features.forEach((feat, idx) => {
      const loc = feat.location ?? [((idx % 3) - 1) * 28, (Math.floor(idx / 3) - 0.5) * 22, 12];
      const r = (feat.nominalSize ?? 14) * 0.5;
      const h = 18;
      allPts.push(loc);

      if (feat.featureType === "Cylinder" || feat.featureType === "Circle") {
        const segs = 12;
        const topPts: [number, number, number][] = [];
        const botPts: [number, number, number][] = [];
        for (let s = 0; s < segs; s++) {
          const ang = (s / segs) * Math.PI * 2;
          const x = loc[0] + Math.cos(ang) * r;
          const y = loc[1] + Math.sin(ang) * r;
          topPts.push([x, y, loc[2] + h / 2]);
          botPts.push([x, y, loc[2] - h / 2]);
        }
        for (let s = 0; s < segs; s++) {
          const next = (s + 1) % segs;
          faces.push([botPts[s]!, botPts[next]!, topPts[next]!, topPts[s]!]);
        }
        faces.push(topPts);
        faces.push(botPts.slice().reverse());
        for (const p of [...topPts, ...botPts]) allPts.push(p);
      } else {
        const dx = r * 1.8;
        const dy = r * 1.5;
        const dz = h * 0.6;
        const c0 = [loc[0] - dx, loc[1] - dy, loc[2] - dz] as [number, number, number];
        const c1 = [loc[0] + dx, loc[1] + dy, loc[2] + dz] as [number, number, number];
        const b000: [number, number, number] = [c0[0], c0[1], c0[2]];
        const b100: [number, number, number] = [c1[0], c0[1], c0[2]];
        const b110: [number, number, number] = [c1[0], c1[1], c0[2]];
        const b010: [number, number, number] = [c0[0], c1[1], c0[2]];
        const t001: [number, number, number] = [c0[0], c0[1], c1[2]];
        const t101: [number, number, number] = [c1[0], c0[1], c1[2]];
        const t111: [number, number, number] = [c1[0], c1[1], c1[2]];
        const t011: [number, number, number] = [c0[0], c1[1], c1[2]];

        faces.push([b000, b100, t101, t001]); // Front
        faces.push([b100, b110, t111, t101]); // Right
        faces.push([b110, b010, t011, t111]); // Back
        faces.push([b010, b000, t001, t011]); // Left
        faces.push([t001, t101, t111, t011]); // Top
        faces.push([b000, b010, b110, b100]); // Bottom
        for (const p of [b000, b100, b110, b010, t001, t101, t111, t011]) allPts.push(p);
      }
    });
  }

  // Add origin point for DRF triad
  allPts.push([0, 0, 0]);

  // Compute 3D bounding box
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const pt of allPts) {
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
    if (pt[2] < minZ) minZ = pt[2];
    if (pt[2] > maxZ) maxZ = pt[2];
  }
  if (!Number.isFinite(minX)) {
    minX = -30;
    maxX = 50;
    minY = -22;
    maxY = 22;
    minZ = 0;
    maxZ = 22;
  }
  const midX = (minX + maxX) * 0.5;
  const midY = (minY + maxY) * 0.5;
  const midZ = (minZ + maxZ) * 0.5;

  // Axonometric isometric projection matching QifViewer Three.js camera ([36, -38, 28], Z-up)
  const cos30 = 0.86602540378;
  const sin30 = 0.5;
  const isoProjectRaw = (p: [number, number, number]): [number, number, number] => {
    const dx = p[0] - midX;
    const dy = p[1] - midY;
    const dz = p[2] - midZ;
    const px = (dx - dy) * cos30;
    const py = (dx + dy) * sin30 * 0.7071 - dz * 0.95;
    const depth = (dx + dy) * 0.7071 + dz * 0.5;
    return [px, py, depth];
  };

  let pMinX = Infinity,
    pMaxX = -Infinity,
    pMinY = Infinity,
    pMaxY = -Infinity;
  for (const pt of allPts) {
    const [px, py] = isoProjectRaw(pt);
    if (px < pMinX) pMinX = px;
    if (px > pMaxX) pMaxX = px;
    if (py < pMinY) pMinY = py;
    if (py > pMaxY) pMaxY = py;
  }

  const pSpanX = Math.max(1e-5, pMaxX - pMinX);
  const pSpanY = Math.max(1e-5, pMaxY - pMinY);
  const padX = 140; // Room for GD&T callout badges on sides
  const padY = 90;
  const scale = Math.min((width - padX * 2) / pSpanX, (height - padY * 2) / pSpanY);
  const midPX = (pMinX + pMaxX) * 0.5;
  const midPY = (pMinY + pMaxY) * 0.5;

  const projectScreen = (p: [number, number, number]): [number, number, number] => {
    const [rx, ry, depth] = isoProjectRaw(p);
    return [
      +(width * 0.5 + (rx - midPX) * scale).toFixed(1),
      +(height * 0.52 + (ry - midPY) * scale).toFixed(1),
      depth,
    ];
  };

  const renderedElements: string[] = [];

  // 3. Render 3D CAD B-Rep faces with lighting & depth sorting
  interface ProjectedFace {
    pts2d: [number, number][];
    depth: number;
    fill: string;
    stroke: string;
  }
  const projFaces: ProjectedFace[] = [];
  for (const poly of faces.slice(0, 1600)) {
    const proj = poly.map(projectScreen);
    let sumDepth = 0;
    for (const p of proj) sumDepth += p[2];
    const avgDepth = sumDepth / proj.length;

    const p0 = poly[0]!;
    const p1 = poly[1]!;
    const p2 = poly[2]!;
    const ux = p1[0] - p0[0],
      uy = p1[1] - p0[1],
      uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0],
      vy = p2[1] - p0[1],
      vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;

    const lightDot = Math.abs(nx * 0.45 + ny * 0.72 + nz * 0.52);
    const intensity = Math.min(1, Math.max(0.2, 0.22 + lightDot * 0.78));
    const r = Math.round(56 + intensity * 68);
    const g = Math.round(82 + intensity * 86);
    const b = Math.round(112 + intensity * 98);

    projFaces.push({
      pts2d: proj.map((p) => [p[0], p[1]]),
      depth: avgDepth,
      fill: `rgba(${r}, ${g}, ${b}, 0.92)`,
      stroke: `rgba(30, 41, 59, ${+(0.3 + intensity * 0.25).toFixed(2)})`,
    });
  }

  projFaces.sort((a, b) => a.depth - b.depth);
  for (const f of projFaces) {
    renderedElements.push(
      `<polygon points="${f.pts2d.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="${f.fill}" stroke="${f.stroke}" stroke-width="0.85" stroke-linejoin="round"/>`,
    );
  }

  // 4. Render Origin Coordinate Datum Reference Frame (DRF) Triad
  const origin3d: [number, number, number] = [0, 0, 0];
  const originSc = projectScreen(origin3d);
  const triadLen = Math.max(14, (maxX - minX) * 0.16);
  const xSc = projectScreen([origin3d[0] + triadLen, origin3d[1], origin3d[2]]);
  const ySc = projectScreen([origin3d[0], origin3d[1] + triadLen, origin3d[2]]);
  const zSc = projectScreen([origin3d[0], origin3d[1], origin3d[2] + triadLen]);

  renderedElements.push(`<!-- 3D Datum Reference Frame Origin Triad -->
    <line x1="${originSc[0]}" y1="${originSc[1]}" x2="${xSc[0]}" y2="${xSc[1]}" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round"/>
    <text x="${xSc[0] + 6}" y="${xSc[1] + 3}" fill="#f87171" font-size="10" font-weight="700" font-family="'JetBrains Mono', monospace">X</text>
    <line x1="${originSc[0]}" y1="${originSc[1]}" x2="${ySc[0]}" y2="${ySc[1]}" stroke="#22c55e" stroke-width="2.2" stroke-linecap="round"/>
    <text x="${ySc[0] - 12}" y="${ySc[1] + 5}" fill="#4ade80" font-size="10" font-weight="700" font-family="'JetBrains Mono', monospace">Y</text>
    <line x1="${originSc[0]}" y1="${originSc[1]}" x2="${zSc[0]}" y2="${zSc[1]}" stroke="#3b82f6" stroke-width="2.2" stroke-linecap="round"/>
    <text x="${zSc[0]}" y="${zSc[1] - 6}" fill="#60a5fa" font-size="10" font-weight="700" font-family="'JetBrains Mono', monospace" text-anchor="middle">Z</text>`);

  // Map characteristics by ID & Feature
  const charById = new Map<string, QifCharacteristicLike>();
  for (const c of doc.characteristics) charById.set(c.id, c);

  const actualsByChar = new Map<string, QifActualLike[]>();
  for (const a of doc.actuals ?? []) {
    const list = actualsByChar.get(a.characteristicId) ?? [];
    list.push(a);
    actualsByChar.set(a.characteristicId, list);
  }

  // 5. Render 3D CMM Touch-Probe Hits & Whisker Vectors
  if (showProbes) {
    const probeElements: string[] = [];
    doc.features.forEach((feat, idx) => {
      const featLoc = feat.location ?? [((idx % 3) - 1) * 28, (Math.floor(idx / 3) - 0.5) * 22, 12];
      const featNorm = feat.normal ?? [0, 0, 1];
      const linkedChars = doc.characteristics.filter((c) => c.featureIds.includes(feat.id));
      const acts: QifActualLike[] = [];
      for (const lc of linkedChars) {
        acts.push(...(actualsByChar.get(lc.id) ?? []));
      }

      const numPoints =
        typeof feat.probingPoints === "number"
          ? Math.min(feat.probingPoints, 8)
          : Array.isArray(feat.probingPoints)
            ? feat.probingPoints.length
            : Math.max(3, acts.length || 4);

      for (let pIdx = 0; pIdx < numPoints; pIdx++) {
        let pPos: [number, number, number];
        let pDev: [number, number, number] = [0, 0, 0];
        let pStatus: "PASS" | "FAIL" | "REWORK" = "PASS";

        if (pIdx < acts.length && acts[pIdx]) {
          const act = acts[pIdx]!;
          pStatus = act.status;
          pDev = act.deviationVector ?? [featNorm[0] * 0.02, featNorm[1] * 0.02, featNorm[2] * 0.02];
        }

        if (Array.isArray(feat.probingPoints) && feat.probingPoints[pIdx]) {
          pPos = feat.probingPoints[pIdx]!;
        } else if (feat.featureType === "Cylinder" || feat.featureType === "Circle") {
          const ang = (pIdx / numPoints) * Math.PI * 2;
          const r = (feat.nominalSize ?? 12) * 0.5;
          pPos = [featLoc[0] + Math.cos(ang) * r, featLoc[1] + Math.sin(ang) * r, featLoc[2]];
        } else {
          const u = ((pIdx % 3) - 1) * 6;
          const v = (Math.floor(pIdx / 3) - 0.5) * 6;
          pPos = [featLoc[0] + u, featLoc[1] + v, featLoc[2]];
        }

        const scPt = projectScreen(pPos);
        const statusColor = pStatus === "FAIL" ? "#ef4444" : pStatus === "REWORK" ? "#f59e0b" : "#22c55e";

        // 3D Sphere Highlight
        probeElements.push(
          `<circle cx="${scPt[0]}" cy="${scPt[1]}" r="4" fill="${statusColor}" stroke="#0f172a" stroke-width="1.2"/>`,
        );

        // Deviation whisker vector
        const devMag = Math.hypot(pDev[0], pDev[1], pDev[2]);
        if (devMag > 1e-4) {
          const tipPos: [number, number, number] = [
            pPos[0] + pDev[0] * whiskerScale,
            pPos[1] + pDev[1] * whiskerScale,
            pPos[2] + pDev[2] * whiskerScale,
          ];
          const scTip = projectScreen(tipPos);
          const whiskerColor = pStatus === "FAIL" ? "#ef4444" : "#38bdf8";
          probeElements.push(
            `<line x1="${scPt[0]}" y1="${scPt[1]}" x2="${scTip[0]}" y2="${scTip[1]}" stroke="${whiskerColor}" stroke-width="1.4" stroke-dasharray="2,2"/>`,
            `<circle cx="${scTip[0]}" cy="${scTip[1]}" r="2" fill="${whiskerColor}"/>`,
          );
        }
      }
    });

    if (probeElements.length > 0) {
      renderedElements.push(`<!-- 3D CMM Touch Probes & Deviation Whiskers -->\n    ${probeElements.join("\n    ")}`);
    }
  }

  // 6. Render ASME Y14.5 Feature Control Frame (FCF) Callouts
  if (showAnnotations && doc.characteristics.length > 0) {
    const fcfElements: string[] = [];
    // Offset directions to distribute callout badges cleanly around the 3D model
    const offsets: [number, number][] = [
      [80, -45],
      [-95, -55],
      [90, 40],
      [-100, 35],
      [0, -75],
    ];

    const datumByFeat = new Map<string, string>();
    for (const d of doc.datumDefinitions ?? []) {
      if (d.featureId) datumByFeat.set(d.featureId, d.label);
    }

    const renderedChars = doc.characteristics.slice(0, 4);
    renderedChars.forEach((char, cIdx) => {
      const featId = char.featureIds[0];
      const feat = doc.features.find((f) => f.id === featId);
      const featLoc: [number, number, number] = feat?.location ?? [0, 0, 10];
      const scFeat = projectScreen(featLoc);
      const off = offsets[cIdx % offsets.length]!;
      const badgeX = Math.max(16, Math.min(width - 150, scFeat[0] + off[0]));
      const badgeY = Math.max(20, Math.min(height - 40, scFeat[1] + off[1]));

      const symbol = getGdtSymbol(char.gdtType);
      const acts = actualsByChar.get(char.id) ?? [];
      const hasFail = acts.some((a) => a.status === "FAIL");
      const statusColor = hasFail ? "#ef4444" : "#38bdf8";

      // Leader line
      fcfElements.push(
        `<line x1="${scFeat[0]}" y1="${scFeat[1]}" x2="${badgeX + (off[0] < 0 ? 100 : 0)}" y2="${badgeY + 11}" stroke="${statusColor}" stroke-width="1.2" stroke-opacity="0.75"/>`,
        `<circle cx="${scFeat[0]}" cy="${scFeat[1]}" r="2.5" fill="${statusColor}"/>`,
      );

      // Feature Control Frame Box
      const symWidth = 22;
      const tolStr = `${char.isDiametrical ? "⌀" : ""}${char.toleranceZone.toFixed(3)}${getMaterialModifierSymbol(char.materialCondition)}`;
      const tolWidth = Math.max(38, tolStr.length * 7.5 + 8);
      const datums = char.datumReferences ?? [];
      const datumWidths = datums.map((d) => (d.datumLabel.length + (d.materialCondition ? 1 : 0)) * 8 + 10);
      const totalWidth = symWidth + tolWidth + datumWidths.reduce((a, b) => a + b, 0);
      const frameHeight = 22;

      let curX = badgeX;
      fcfElements.push(
        `<g transform="translate(${badgeX}, ${badgeY})">`,
        `<rect x="0" y="0" width="${totalWidth}" height="${frameHeight}" rx="2" fill="rgba(15, 23, 42, 0.94)" stroke="${statusColor}" stroke-width="1.4"/>`,
      );

      // Symbol
      fcfElements.push(
        `<rect x="0" y="0" width="${symWidth}" height="${frameHeight}" fill="rgba(56, 189, 248, 0.12)" stroke="${statusColor}" stroke-width="1"/>`,
        `<text x="${symWidth / 2}" y="15" fill="#38bdf8" font-size="12" font-weight="700" text-anchor="middle" font-family="'JetBrains Mono', monospace">${symbol}</text>`,
      );
      curX = symWidth;

      // Tolerance
      fcfElements.push(
        `<line x1="${curX}" y1="0" x2="${curX}" y2="${frameHeight}" stroke="${statusColor}" stroke-width="1"/>`,
        `<text x="${curX + tolWidth / 2}" y="15" fill="#f8fafc" font-size="10.5" font-weight="600" text-anchor="middle" font-family="'JetBrains Mono', monospace">${escapeXml(tolStr)}</text>`,
      );
      curX += tolWidth;

      // Datums
      datums.forEach((d, dIdx) => {
        const dw = datumWidths[dIdx]!;
        const modStr = getMaterialModifierSymbol(d.materialCondition);
        fcfElements.push(
          `<line x1="${curX}" y1="0" x2="${curX}" y2="${frameHeight}" stroke="${statusColor}" stroke-width="1"/>`,
          `<text x="${curX + dw / 2}" y="15" fill="#e2e8f0" font-size="10.5" font-weight="700" text-anchor="middle" font-family="'JetBrains Mono', monospace">${escapeXml(d.datumLabel)}${modStr}</text>`,
        );
        curX += dw;
      });

      fcfElements.push(`</g>`);
    });

    if (fcfElements.length > 0) {
      renderedElements.push(`<!-- ASME Y14.5 Feature Control Frames -->\n    ${fcfElements.join("\n    ")}`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" data-qif-3d="true" data-testid="qif-3d-svg">
  <defs>
    <radialGradient id="qifSphereShade" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.4"/>
    </radialGradient>
  </defs>
  <!-- 3D Projected CAD Solid, GD&T Tolerances & Metrology Scene -->
  <g>
    ${renderedElements.join("\n    ")}
  </g>
</svg>`;
}
