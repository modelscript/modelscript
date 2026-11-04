// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — DICOM-RT Clinical Beam's Eye View (BEV) & Cumulative DVH SVG Diagram Builder.
 *
 * Provides dark-mode vector visualizations for radiation oncology & medical physics workflows:
 *   1. Clinical Beam's Eye View (BEV) showing IEC 61217 X/Y collimator jaws, opposing Bank A / Bank B
 *      multileaf collimator (MLC) leaf pair apertures, gantry/collimator/couch angle HUD, and
 *      projected target (PTV / CTV) & ORGAN contours.
 *   2. Cumulative Dose-Volume Histogram (DVH) SVG chart (0–100% volume vs. Dose in Gy) with
 *      color-coded ROI curves, D95% prescription crosshairs, and QUANTEC dose limit markers.
 */

export type RoiInterpretedTypeLike =
  | "PTV"
  | "CTV"
  | "GTV"
  | "ORGAN"
  | "EXTERNAL"
  | "AVOIDANCE"
  | "BOLUS"
  | "MARKER"
  | string;

export interface RtContourSliceLike {
  z: number;
  geometricType?: "CLOSED_PLANAR" | "POINT" | "OPEN_PLANAR" | string | undefined;
  points: [number, number, number][];
}

export interface RtRoiStructureLike {
  roiNumber: number;
  name: string;
  interpretedType: RoiInterpretedTypeLike;
  color?: [number, number, number] | undefined;
  volumeCc: number;
  contours?: RtContourSliceLike[] | undefined;
  maxDoseLimitGy?: number | undefined;
  meanDoseLimitGy?: number | undefined;
}

export interface MlcLeafPairLike {
  pairIndex: number;
  bankA_mm: number;
  bankB_mm: number;
}

export interface RtControlPointLike {
  index: number;
  cumulativeMetersetWeight: number;
  gantryAngleDeg: number;
  collimatorAngleDeg: number;
  couchAngleDeg: number;
  jawX_mm: [number, number];
  jawY_mm: [number, number];
  mlcLeaves: MlcLeafPairLike[];
}

export interface RtBeamLike {
  beamNumber: number;
  name: string;
  modality: "PHOTON" | "PROTON" | "ELECTRON" | "CARBON_ION" | string;
  treatmentDeliveryType?: "TREATMENT" | "SETUP" | string | undefined;
  energyMeV: number;
  metersetMu: number;
  doseRateMuPerMin?: number | undefined;
  controlPoints: RtControlPointLike[];
}

export interface RtDoseBinLike {
  doseGy: number;
  volumePercent: number;
}

export interface RtRoiDvhLike {
  roiNumber: number;
  roiName: string;
  d98Gy: number;
  d95Gy: number;
  d50Gy: number;
  d2Gy: number;
  meanDoseGy: number;
  maxDoseGy: number;
  minDoseGy?: number | undefined;
  v20GyPercent?: number | undefined;
  bins: RtDoseBinLike[];
}

export interface DicomRtDocumentLike {
  planId: string;
  planLabel?: string | undefined;
  patientId?: string | undefined;
  frameOfReferenceUid?: string | undefined;
  prescribedDoseGy: number;
  fractions: number;
  structures: RtRoiStructureLike[];
  beams: RtBeamLike[];
  dvhs: RtRoiDvhLike[];
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function roiColor(struct?: RtRoiStructureLike, fallbackIdx = 0): string {
  if (struct?.color && struct.color.length === 3) {
    const [r, g, b] = struct.color;
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }
  const type = struct?.interpretedType?.toUpperCase() ?? "";
  if (type === "PTV") return "#ef4444";
  if (type === "CTV" || type === "GTV") return "#f97316";
  if (type === "ORGAN") {
    const oarPalette = ["#38bdf8", "#22c55e", "#a855f7", "#eab308", "#14b8a6"];
    return oarPalette[fallbackIdx % oarPalette.length]!;
  }
  const defaultPalette = ["#38bdf8", "#f59e0b", "#a855f7", "#22c55e", "#ec4899"];
  return defaultPalette[fallbackIdx % defaultPalette.length]!;
}

/**
 * Renders a clinical Beam's Eye View (BEV) showing X/Y collimator jaws, opposing Bank A / Bank B
 * multileaf collimator (MLC) leaf pair apertures, gantry/collimator/couch angle HUD, and
 * projected target (PTV) / ORGAN contours.
 */
export function renderDicomRtBevSvg(doc: DicomRtDocumentLike, beamIndex = 0, controlPointIndex = 0): string {
  const width = 940;
  const height = 520;
  const parts: string[] = [];

  const beams = doc.beams ?? [];
  const beam = beams[Math.max(0, Math.min(beams.length - 1, beamIndex))] ?? {
    beamNumber: 1,
    name: "Beam_1",
    modality: "PHOTON",
    energyMeV: 6,
    metersetMu: 200,
    doseRateMuPerMin: 600,
    controlPoints: [
      {
        index: 0,
        cumulativeMetersetWeight: 0,
        gantryAngleDeg: 0,
        collimatorAngleDeg: 0,
        couchAngleDeg: 0,
        jawX_mm: [-50, 50],
        jawY_mm: [-50, 50],
        mlcLeaves: [],
      },
    ],
  };

  const cps = beam.controlPoints ?? [];
  const cp = cps[Math.max(0, Math.min(cps.length - 1, controlPointIndex))] ?? {
    index: 0,
    cumulativeMetersetWeight: 0,
    gantryAngleDeg: 0,
    collimatorAngleDeg: 0,
    couchAngleDeg: 0,
    jawX_mm: [-50, 50] as [number, number],
    jawY_mm: [-50, 50] as [number, number],
    mlcLeaves: [],
  };

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );

  // Header
  parts.push(`<rect x="0" y="0" width="${width}" height="42" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="26" fill="#f8fafc" font-size="13" font-weight="600">DICOM-RT Clinical Beam&apos;s Eye View (BEV) — MLC Leaf Bank Aperture &amp; Target Projection</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="26" fill="#38bdf8" font-size="11.5" font-weight="600" text-anchor="end">Plan: ${escapeXml(doc.planLabel ?? doc.planId)} | Rx: ${doc.prescribedDoseGy.toFixed(1)} Gy / ${doc.fractions} fx</text>`,
  );

  // BEV Viewport (420x420 square centered at isocenter (0,0) mm covering [-120, +120] mm)
  const bevX = 36;
  const bevY = 60;
  const bevSize = 420;
  const isoCx = bevX + bevSize / 2;
  const isoCy = bevY + bevSize / 2;
  const fieldHalfRangeMm = 120;
  const mmToPx = bevSize / (2 * fieldHalfRangeMm);

  const mapX = (xMm: number) => isoCx + xMm * mmToPx;
  const mapY = (yMm: number) => isoCy - yMm * mmToPx;

  parts.push(
    `<rect x="${bevX}" y="${bevY}" width="${bevSize}" height="${bevSize}" rx="6" fill="#020617" stroke="#334155" stroke-width="1.8"/>`,
  );

  // Field coordinate grid every 40 mm
  for (let g = -80; g <= 80; g += 40) {
    const gx = mapX(g);
    const gy = mapY(g);
    parts.push(
      `<line x1="${gx.toFixed(1)}" y1="${bevY}" x2="${gx.toFixed(1)}" y2="${bevY + bevSize}" stroke="#1e293b" stroke-width="1"/>`,
    );
    parts.push(
      `<line x1="${bevX}" y1="${gy.toFixed(1)}" x2="${bevX + bevSize}" y2="${gy.toFixed(1)}" stroke="#1e293b" stroke-width="1"/>`,
    );
  }

  // Projected anatomical ROI contours (PTV, CTV, ORGAN) rotated by gantry angle into BEV plane
  const gantryRad = (cp.gantryAngleDeg * Math.PI) / 180;
  const cosG = Math.cos(gantryRad);
  const sinG = Math.sin(gantryRad);

  (doc.structures ?? []).forEach((roi, rIdx) => {
    const col = roiColor(roi, rIdx);
    const isTarget = roi.interpretedType === "PTV" || roi.interpretedType === "CTV" || roi.interpretedType === "GTV";
    const slices = roi.contours ?? [];

    if (slices.length > 0) {
      slices.forEach((slice, sIdx) => {
        if (slice.points.length < 3) return;
        const polyPts = slice.points
          .map(([px, py, pz]) => {
            const u = px * cosG + py * sinG;
            const v = pz;
            return `${mapX(u).toFixed(1)},${mapY(v).toFixed(1)}`;
          })
          .join(" ");
        parts.push(
          `<polygon points="${polyPts}" fill="${col}" fill-opacity="${isTarget ? 0.22 : 0.14}" stroke="${col}" stroke-width="${isTarget ? 2.2 : 1.5}" stroke-dasharray="${isTarget ? "none" : "4,2"}"/>`,
        );
        if (sIdx === 0) {
          const [p0x, p0y, p0z] = slice.points[0]!;
          const u0 = p0x * cosG + p0y * sinG;
          parts.push(
            `<text x="${mapX(u0).toFixed(1)}" y="${(mapY(p0z) - 6).toFixed(1)}" fill="${col}" font-size="9.5" font-weight="700">${escapeXml(roi.name)} (${escapeXml(roi.interpretedType)})</text>`,
          );
        }
      });
    } else {
      // Fallback projected ellipse from ROI volume
      const eqRadiusMm = Math.max(12, Math.min(48, Math.cbrt((roi.volumeCc * 1000 * 3) / (4 * Math.PI))));
      const offsetX = isTarget ? 0 : (rIdx % 2 === 0 ? 1 : -1) * 28;
      const offsetY = isTarget ? 0 : (rIdx - 1) * 18;
      parts.push(
        `<ellipse cx="${mapX(offsetX).toFixed(1)}" cy="${mapY(offsetY).toFixed(1)}" rx="${(eqRadiusMm * mmToPx).toFixed(1)}" ry="${(eqRadiusMm * 0.85 * mmToPx).toFixed(1)}" fill="${col}" fill-opacity="${isTarget ? 0.22 : 0.14}" stroke="${col}" stroke-width="${isTarget ? 2.2 : 1.5}"/>`,
      );
      parts.push(
        `<text x="${mapX(offsetX).toFixed(1)}" y="${mapY(offsetY).toFixed(1)}" fill="${col}" font-size="9.5" font-weight="700" text-anchor="middle">${escapeXml(roi.name)} (${escapeXml(roi.interpretedType)})</text>`,
      );
    }
  });

  // Render Opposing Bank A / Bank B MLC Leaf Pairs inside Jaw Y bounds
  const [jawX1, jawX2] = cp.jawX_mm;
  const [jawY1, jawY2] = cp.jawY_mm;
  const leaves = cp.mlcLeaves ?? [];
  const leafCount = Math.max(1, leaves.length);
  const ySpanMm = Math.max(20, jawY2 - jawY1);
  const leafWidthMm = ySpanMm / leafCount;

  leaves.forEach((leaf, idx) => {
    const yBottomMm = jawY1 + idx * leafWidthMm;
    const yTopMm = yBottomMm + leafWidthMm;
    const syTop = mapY(yTopMm);
    const syHeight = Math.max(2, leafWidthMm * mmToPx);

    // Bank A leaf extending from left field edge (-fieldHalfRangeMm) to bankA_mm
    const bankAX = mapX(Math.max(-fieldHalfRangeMm, Math.min(fieldHalfRangeMm, leaf.bankA_mm)));
    const bankAW = Math.max(0, bankAX - bevX);
    parts.push(
      `<rect x="${bevX}" y="${syTop.toFixed(1)}" width="${bankAW.toFixed(1)}" height="${syHeight.toFixed(1)}" fill="#1e293b" fill-opacity="0.82" stroke="#38bdf8" stroke-width="1"/>`,
    );

    // Bank B leaf extending from bankB_mm to right field edge (+fieldHalfRangeMm)
    const bankBX = mapX(Math.max(-fieldHalfRangeMm, Math.min(fieldHalfRangeMm, leaf.bankB_mm)));
    const bankBW = Math.max(0, bevX + bevSize - bankBX);
    parts.push(
      `<rect x="${bankBX.toFixed(1)}" y="${syTop.toFixed(1)}" width="${bankBW.toFixed(1)}" height="${syHeight.toFixed(1)}" fill="#1e293b" fill-opacity="0.82" stroke="#f59e0b" stroke-width="1"/>`,
    );

    // Highlight open MLC aperture slot
    if (leaf.bankB_mm > leaf.bankA_mm) {
      parts.push(
        `<rect x="${bankAX.toFixed(1)}" y="${syTop.toFixed(1)}" width="${Math.max(0, bankBX - bankAX).toFixed(1)}" height="${syHeight.toFixed(1)}" fill="#facc15" fill-opacity="0.09" stroke="#facc15" stroke-opacity="0.35" stroke-width="0.6"/>`,
      );
    }
  });

  // Render X/Y Collimator Jaw Aperture Rectangle
  const jx = mapX(jawX1);
  const jy = mapY(jawY2);
  const jw = Math.max(4, (jawX2 - jawX1) * mmToPx);
  const jh = Math.max(4, (jawY2 - jawY1) * mmToPx);
  parts.push(
    `<rect x="${jx.toFixed(1)}" y="${jy.toFixed(1)}" width="${jw.toFixed(1)}" height="${jh.toFixed(1)}" fill="none" stroke="#22c55e" stroke-width="2.2" stroke-dasharray="6,3"/>`,
  );

  // Isocenter Crosshair + Reticle
  parts.push(
    `<line x1="${isoCx - 14}" y1="${isoCy}" x2="${isoCx + 14}" y2="${isoCy}" stroke="#f8fafc" stroke-width="1.5"/>`,
  );
  parts.push(
    `<line x1="${isoCx}" y1="${isoCy - 14}" x2="${isoCx}" y2="${isoCy + 14}" stroke="#f8fafc" stroke-width="1.5"/>`,
  );
  parts.push(`<circle cx="${isoCx}" cy="${isoCy}" r="5" fill="none" stroke="#f8fafc" stroke-width="1.4"/>`);

  // Right Panel: Linac Gantry / Collimator / Couch HUD & MLC Leaf Bank Telemetry
  const hudX = 484;
  const hudW = 428;

  // Card 1: Beam & Linac Mechanical Gantry/Collimator/Couch HUD
  parts.push(
    `<rect x="${hudX}" y="60" width="${hudW}" height="150" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>`,
  );
  parts.push(
    `<text x="${hudX + 14}" y="84" fill="#f8fafc" font-size="12.5" font-weight="700">Beam #${beam.beamNumber}: ${escapeXml(beam.name)} (${escapeXml(beam.modality)} ${beam.energyMeV} MV)</text>`,
  );
  parts.push(
    `<text x="${hudX + hudW - 14}" y="84" fill="#22c55e" font-size="11" font-weight="700" text-anchor="end">${beam.metersetMu.toFixed(1)} MU @ ${beam.doseRateMuPerMin ?? 600} MU/min</text>`,
  );

  const angles = [
    { label: "Gantry Angle", val: `${cp.gantryAngleDeg.toFixed(1)}°`, col: "#38bdf8" },
    { label: "Collimator Angle", val: `${cp.collimatorAngleDeg.toFixed(1)}°`, col: "#a855f7" },
    { label: "Couch (IEC) Angle", val: `${cp.couchAngleDeg.toFixed(1)}°`, col: "#f59e0b" },
  ];
  angles.forEach((ang, i) => {
    const bx = hudX + 14 + i * 136;
    parts.push(
      `<rect x="${bx}" y="98" width="126" height="52" rx="5" fill="#0f172a" stroke="${ang.col}" stroke-width="1.3"/>`,
    );
    parts.push(`<text x="${bx + 63}" y="116" fill="#94a3b8" font-size="9.5" text-anchor="middle">${ang.label}</text>`);
    parts.push(
      `<text x="${bx + 63}" y="138" fill="${ang.col}" font-size="15" font-weight="700" text-anchor="middle">${ang.val}</text>`,
    );
  });

  parts.push(
    `<text x="${hudX + 14}" y="172" fill="#cbd5e1" font-size="10.5">Jaw X: [${jawX1.toFixed(1)}, ${jawX2.toFixed(1)}] mm | Jaw Y: [${jawY1.toFixed(1)}, ${jawY2.toFixed(1)}] mm</text>`,
  );
  parts.push(
    `<text x="${hudX + 14}" y="192" fill="#94a3b8" font-size="10">Control Point ${cp.index} / ${Math.max(1, cps.length)} (Cumulative Weight: ${cp.cumulativeMetersetWeight.toFixed(3)})</text>`,
  );

  // Card 2: Opposing MLC Leaf Pair Positions Table
  parts.push(
    `<rect x="${hudX}" y="226" width="${hudW}" height="254" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>`,
  );
  parts.push(
    `<text x="${hudX + 14}" y="250" fill="#f8fafc" font-size="12" font-weight="700">Multileaf Collimator (MLC) Bank A / Bank B Leaf Pair Apertures</text>`,
  );

  leaves.slice(0, 8).forEach((leaf, i) => {
    const ry = 272 + i * 24;
    const gapMm = leaf.bankB_mm - leaf.bankA_mm;
    const statusCol = gapMm >= 0 ? "#22c55e" : "#ef4444";
    parts.push(
      `<text x="${hudX + 16}" y="${ry}" fill="#e2e8f0" font-size="10" font-weight="600">Pair #${leaf.pairIndex}</text>`,
    );
    parts.push(
      `<text x="${hudX + 95}" y="${ry}" fill="#38bdf8" font-size="10">Bank A: ${leaf.bankA_mm.toFixed(1)} mm</text>`,
    );
    parts.push(
      `<text x="${hudX + 215}" y="${ry}" fill="#f59e0b" font-size="10">Bank B: ${leaf.bankB_mm.toFixed(1)} mm</text>`,
    );
    parts.push(
      `<text x="${hudX + hudW - 16}" y="${ry}" fill="${statusCol}" font-size="10" font-weight="700" text-anchor="end">Gap: ${gapMm.toFixed(1)} mm</text>`,
    );
  });

  // Footer Legend
  parts.push(
    `<rect x="36" y="${height - 32}" width="${width - 64}" height="24" rx="4" fill="#1e293b" stroke="#334155"/>`,
  );
  parts.push(
    `<rect x="48" y="${height - 25}" width="12" height="10" fill="none" stroke="#22c55e" stroke-width="2"/><text x="66" y="${height - 16}" fill="#cbd5e1" font-size="10">X/Y Collimator Jaws</text>`,
  );
  parts.push(
    `<rect x="190" y="${height - 25}" width="12" height="10" fill="#1e293b" stroke="#38bdf8"/><text x="208" y="${height - 16}" fill="#cbd5e1" font-size="10">MLC Bank A (Left)</text>`,
  );
  parts.push(
    `<rect x="330" y="${height - 25}" width="12" height="10" fill="#1e293b" stroke="#f59e0b"/><text x="348" y="${height - 16}" fill="#cbd5e1" font-size="10">MLC Bank B (Right)</text>`,
  );
  parts.push(
    `<circle cx="485" cy="${height - 20}" r="5" fill="#ef4444"/><text x="496" y="${height - 16}" fill="#cbd5e1" font-size="10">PTV Target</text>`,
  );
  parts.push(
    `<circle cx="585" cy="${height - 20}" r="5" fill="#38bdf8"/><text x="596" y="${height - 16}" fill="#cbd5e1" font-size="10">ORGAN (OAR)</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * Renders an interactive Cumulative Dose-Volume Histogram (DVH) SVG chart (0–100% volume vs. Dose in Gy)
 * with color-coded ROI curves (PTV, CTV, ORGAN), D95% prescription crosshairs, and QUANTEC dose limit markers.
 */
export function renderDicomRtDvhSvg(doc: DicomRtDocumentLike): string {
  const width = 940;
  const height = 480;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );

  // Header
  parts.push(`<rect x="0" y="0" width="${width}" height="42" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="26" fill="#f8fafc" font-size="13" font-weight="600">DICOM-RT Cumulative Dose-Volume Histogram (DVH) &amp; QUANTEC Clinical Constraints</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="26" fill="#38bdf8" font-size="11.5" font-weight="600" text-anchor="end">Plan: ${escapeXml(doc.planLabel ?? doc.planId)} | Prescribed Dose: ${doc.prescribedDoseGy.toFixed(1)} Gy (${doc.fractions} fx)</text>`,
  );

  const chartX = 64;
  const chartY = 66;
  const chartW = 520;
  const chartH = 340;

  // Determine maximum dose scale across all DVHs and prescription
  let maxDoseAxis = Math.max(10, doc.prescribedDoseGy * 1.15);
  for (const dvh of doc.dvhs ?? []) {
    if (dvh.maxDoseGy * 1.05 > maxDoseAxis) maxDoseAxis = dvh.maxDoseGy * 1.05;
    for (const b of dvh.bins ?? []) {
      if (b.doseGy * 1.05 > maxDoseAxis) maxDoseAxis = b.doseGy * 1.05;
    }
  }
  maxDoseAxis = Math.ceil(maxDoseAxis / 10) * 10;

  const mapDoseX = (doseGy: number) => chartX + (Math.max(0, Math.min(maxDoseAxis, doseGy)) / maxDoseAxis) * chartW;
  const mapVolY = (volPct: number) => chartY + chartH - (Math.max(0, Math.min(100, volPct)) / 100) * chartH;

  parts.push(
    `<rect x="${chartX}" y="${chartY}" width="${chartW}" height="${chartH}" fill="#1e293b" fill-opacity="0.4" stroke="#334155" stroke-width="1.4"/>`,
  );

  // Horizontal Volume Grid (0% .. 100%)
  for (const vTick of [0, 20, 40, 60, 80, 95, 100]) {
    const gy = mapVolY(vTick);
    const is95 = vTick === 95;
    parts.push(
      `<line x1="${chartX}" y1="${gy.toFixed(1)}" x2="${chartX + chartW}" y2="${gy.toFixed(1)}" stroke="${is95 ? "#facc15" : "#1e293b"}" stroke-width="${is95 ? 1.3 : 1}" stroke-dasharray="${is95 ? "4,4" : "none"}"/>`,
    );
    parts.push(
      `<text x="${chartX - 8}" y="${(gy + 4).toFixed(1)}" fill="${is95 ? "#facc15" : "#94a3b8"}" font-size="10" text-anchor="end">${vTick}%</text>`,
    );
  }

  // Vertical Dose Grid (0 .. maxDoseAxis Gy)
  const doseStep = maxDoseAxis <= 40 ? 5 : maxDoseAxis <= 80 ? 10 : 15;
  for (let dTick = 0; dTick <= maxDoseAxis; dTick += doseStep) {
    const gx = mapDoseX(dTick);
    parts.push(
      `<line x1="${gx.toFixed(1)}" y1="${chartY}" x2="${gx.toFixed(1)}" y2="${chartY + chartH}" stroke="#1e293b" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${gx.toFixed(1)}" y="${chartY + chartH + 16}" fill="#94a3b8" font-size="10" text-anchor="middle">${dTick}</text>`,
    );
  }

  parts.push(
    `<text x="${chartX + chartW / 2}" y="${chartY + chartH + 36}" fill="#cbd5e1" font-size="11" font-weight="600" text-anchor="middle">Dose (Gy)</text>`,
  );
  parts.push(
    `<text x="18" y="${chartY + chartH / 2}" fill="#cbd5e1" font-size="11" font-weight="600" text-anchor="middle" transform="rotate(-90 18 ${chartY + chartH / 2})">Relative Volume (%)</text>`,
  );

  // D95% Prescription Crosshairs at (prescribedDoseGy, 95%)
  const rxX = mapDoseX(doc.prescribedDoseGy);
  const rxY = mapVolY(95);
  parts.push(
    `<line x1="${rxX.toFixed(1)}" y1="${chartY}" x2="${rxX.toFixed(1)}" y2="${chartY + chartH}" stroke="#facc15" stroke-width="1.5" stroke-dasharray="5,4"/>`,
  );
  parts.push(
    `<circle cx="${rxX.toFixed(1)}" cy="${rxY.toFixed(1)}" r="5" fill="#facc15" stroke="#0f172a" stroke-width="1.5"/>`,
  );
  parts.push(
    `<text x="${(rxX + 6).toFixed(1)}" y="${(rxY - 6).toFixed(1)}" fill="#facc15" font-size="10" font-weight="700">Rx D95% (${doc.prescribedDoseGy.toFixed(1)} Gy)</text>`,
  );

  const structByNum = new Map<number, RtRoiStructureLike>();
  const structByName = new Map<string, RtRoiStructureLike>();
  for (const s of doc.structures ?? []) {
    structByNum.set(s.roiNumber, s);
    structByName.set(s.name, s);
  }

  // Plot Cumulative DVH Curves & QUANTEC Limit Markers
  const dvhs = doc.dvhs ?? [];
  dvhs.forEach((dvh, idx) => {
    const struct = structByNum.get(dvh.roiNumber) ?? structByName.get(dvh.roiName);
    const col = roiColor(struct, idx);

    const bins = dvh.bins ?? [];
    if (bins.length >= 2) {
      const pts = bins.map((b) => `${mapDoseX(b.doseGy).toFixed(1)},${mapVolY(b.volumePercent).toFixed(1)}`).join(" ");
      parts.push(`<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.5"/>`);
    }

    // QUANTEC Max Dose Limit vertical marker if defined on structure
    if (struct?.maxDoseLimitGy !== undefined && struct.maxDoseLimitGy > 0) {
      const limX = mapDoseX(struct.maxDoseLimitGy);
      parts.push(
        `<line x1="${limX.toFixed(1)}" y1="${chartY}" x2="${limX.toFixed(1)}" y2="${chartY + chartH}" stroke="${col}" stroke-width="1.4" stroke-dasharray="2,3"/>`,
      );
      parts.push(
        `<text x="${(limX - 4).toFixed(1)}" y="${chartY + 14 + idx * 14}" fill="${col}" font-size="9" font-weight="600" text-anchor="end">QUANTEC Max ${struct.maxDoseLimitGy}Gy</text>`,
      );
    }
  });

  // Right Panel: ROI Dosimetry & QUANTEC Scorecard
  const panelX = 608;
  const panelW = 312;

  dvhs.slice(0, 5).forEach((dvh, idx) => {
    const struct = structByNum.get(dvh.roiNumber) ?? structByName.get(dvh.roiName);
    const col = roiColor(struct, idx);
    const type = struct?.interpretedType ?? "ROI";
    const cardY = 66 + idx * 76;
    const cardH = 66;

    const maxOk = struct?.maxDoseLimitGy === undefined || dvh.maxDoseGy <= struct.maxDoseLimitGy;
    const meanOk = struct?.meanDoseLimitGy === undefined || dvh.meanDoseGy <= struct.meanDoseLimitGy;
    const isTarget = type === "PTV" || type === "CTV" || type === "GTV";
    const rxOk = !isTarget || dvh.d95Gy >= doc.prescribedDoseGy * 0.95;
    const pass = maxOk && meanOk && rxOk;
    const badgeCol = pass ? "#22c55e" : "#ef4444";

    parts.push(
      `<rect x="${panelX}" y="${cardY}" width="${panelW}" height="${cardH}" rx="5" fill="#1e293b" stroke="${col}" stroke-width="1.6"/>`,
    );
    parts.push(
      `<text x="${panelX + 10}" y="${cardY + 18}" fill="#f8fafc" font-size="11.5" font-weight="700">${escapeXml(dvh.roiName)} (${escapeXml(type)})</text>`,
    );
    parts.push(
      `<rect x="${panelX + panelW - 64}" y="${cardY + 5}" width="54" height="17" rx="8" fill="${badgeCol}" fill-opacity="0.2" stroke="${badgeCol}"/>`,
    );
    parts.push(
      `<text x="${panelX + panelW - 37}" y="${cardY + 17}" fill="${badgeCol}" font-size="9.5" font-weight="700" text-anchor="middle">${pass ? "PASS" : "LIMIT"}</text>`,
    );

    parts.push(
      `<text x="${panelX + 10}" y="${cardY + 37}" fill="#cbd5e1" font-size="10">D95%: ${dvh.d95Gy.toFixed(1)} Gy | D50%: ${dvh.d50Gy.toFixed(1)} Gy | D2%: ${dvh.d2Gy.toFixed(1)} Gy</text>`,
    );
    parts.push(
      `<text x="${panelX + 10}" y="${cardY + 54}" fill="#94a3b8" font-size="9.5">Mean: ${dvh.meanDoseGy.toFixed(1)} Gy | Max: ${dvh.maxDoseGy.toFixed(1)} Gy${dvh.v20GyPercent !== undefined ? ` | V20Gy: ${dvh.v20GyPercent.toFixed(1)}%` : ""}</text>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}
