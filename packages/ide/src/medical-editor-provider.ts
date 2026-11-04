// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Radiology, Radiation Oncology & Computer-Assisted Surgery Visual Custom Editor Providers.
 *
 * Implements three domain-specific clinical engineering workbenches:
 *   1. `OpenSimEditorProvider` (`modelscript.opensimEditor`):
 *      - Musculoskeletal kinematic tree & joint coordinate inspector.
 *      - Hill-type muscle force-length/force-velocity curves & RK4 activation dynamics.
 *      - One-click projections to Modelica 3.x and ROS/Gazebo URDF.
 *   2. `DicomRtEditorProvider` (`modelscript.dicomRtEditor`):
 *      - Cumulative Dose-Volume Histogram (DVH), QUANTEC OAR constraints, BED & EQD2 studio.
 *      - Beam's Eye View (BEV) Multi-Leaf Collimator (MLC) aperture & jaw visualizer.
 *      - One-click projections to OpenSCAD 3D beam/ROI CSG and SysML v2 verification blocks.
 *   3. `IgtlEditorProvider` (`modelscript.igtlEditor`):
 *      - OpenIGTLink & PLUS Toolkit SE(3) coordinate frame topology & orthogonality auditor.
 *      - Least-squares stylus pivot calibration & Fitzpatrick Target Registration Error (TRE) analyzer.
 *      - One-click projections to ROS URDF and Modelica 3.x.
 */

import {
  dicomRtToScad,
  dicomRtToSysML2,
  evaluateDicomRtDosimetry,
  lintDicomRtDocument,
  parseDicomRt,
  type DicomRtDiagnostic,
  type DicomRtDocument,
  type DicomRtDosimetrySummary,
} from "@modelscript/dicom-rt";
import {
  igtlToModelica,
  igtlToUrdf,
  lintIgtlDocument,
  parseIgtl,
  solveTransformChainAndPivot,
  type IgtlDiagnostic,
  type IgtlDocument,
  type TransformChainAndPivotResult,
} from "@modelscript/igtl";
import {
  computeActiveForceLength,
  computePassiveForceLength,
  lintOpenSimDocument,
  openSimToModelica,
  openSimToUrdf,
  parseOpenSim,
  simulateMuscleDynamics,
  type OpenSimDiagnostic,
  type OpenSimDocument,
  type OpenSimSimulationResult,
} from "@modelscript/opensim";
import * as vscode from "vscode";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ============================================================================
// SVG Renderers for OpenSim, DICOM-RT, and OpenIGTLink/PLUS
// ============================================================================

export function renderOpenSimKinematicTreeSvg(doc: OpenSimDocument, sim: OpenSimSimulationResult): string {
  const width = 760;
  const height = Math.max(320, 110 + Math.max(doc.bodies.length + 1, doc.joints.length + 1) * 58);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">`,
    `<rect width="${width}" height="${height}" fill="#080c14" rx="8"/>`,
    `<text x="20" y="28" fill="#f8fafc" font-family="Inter, sans-serif" font-size="14" font-weight="700">OpenSim Kinematic Chain &amp; Muscle Action Lines (${escapeXml(doc.modelName)})</text>`,
    `<text x="20" y="46" fill="#94a3b8" font-family="Inter, sans-serif" font-size="11">Bodies: ${doc.bodies.length} | Joints: ${doc.joints.length} | Hill Muscles: ${doc.muscles.length} | Markers: ${doc.markers.length}</text>`,
  ];

  // Ground root node
  const nodePositions = new Map<string, { x: number; y: number }>();
  nodePositions.set("ground", { x: 90, y: 95 });
  parts.push(
    `<rect x="30" y="75" width="120" height="40" rx="6" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>`,
    `<text x="90" y="99" text-anchor="middle" fill="#38bdf8" font-family="monospace" font-size="12" font-weight="600">ground</text>`,
  );

  doc.bodies.forEach((body, idx) => {
    const col = (idx % 2) + 1;
    const row = Math.floor(idx / 2);
    const x = 100 + col * 220;
    const y = 95 + row * 72;
    nodePositions.set(body.name, { x, y });
    parts.push(
      `<rect x="${x - 75}" y="${y - 22}" width="150" height="44" rx="6" fill="#151d2f" stroke="#64748b" stroke-width="1.5"/>`,
      `<text x="${x}" y="${y - 4}" text-anchor="middle" fill="#f8fafc" font-family="Inter, sans-serif" font-size="12" font-weight="600">${escapeXml(body.name)}</text>`,
      `<text x="${x}" y="${y + 12}" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="10">${body.mass.toFixed(2)} kg</text>`,
    );
  });

  for (const joint of doc.joints) {
    const parentKey = joint.parentFrame.replace(/^\/?bodyset\//i, "").replace(/^\//, "");
    const childKey = joint.childFrame.replace(/^\/?bodyset\//i, "").replace(/^\//, "");
    const pPos = nodePositions.get(parentKey) ?? { x: 90, y: 95 };
    const cPos = nodePositions.get(childKey) ?? { x: 320, y: 165 };
    const midX = (pPos.x + cPos.x) / 2;
    const midY = (pPos.y + cPos.y) / 2;
    const coordNames = joint.coordinates.map((c) => c.name).join(", ") || joint.jointType;
    parts.push(
      `<line x1="${pPos.x}" y1="${pPos.y}" x2="${cPos.x}" y2="${cPos.y}" stroke="#38bdf8" stroke-width="2" stroke-dasharray="4 2"/>`,
      `<rect x="${midX - 55}" y="${midY - 11}" width="110" height="22" rx="4" fill="#0f172a" stroke="#0284c7" stroke-width="1"/>`,
      `<text x="${midX}" y="${midY + 4}" text-anchor="middle" fill="#7dd3fc" font-family="monospace" font-size="10">${escapeXml(coordNames)}</text>`,
    );
  }

  // Render muscles summary bar on the right
  doc.muscles.forEach((muscle, idx) => {
    const mState = sim.finalState.muscles[muscle.name];
    const act = mState?.activation ?? 0.5;
    const force = mState?.tendonForce ?? 0;
    const y = 85 + idx * 54;
    const barW = Math.max(8, Math.min(160, Math.round(act * 160)));
    parts.push(
      `<rect x="560" y="${y}" width="180" height="44" rx="6" fill="#151d2f" stroke="#ef4444" stroke-width="1.2"/>`,
      `<text x="570" y="${y + 16}" fill="#fca5a5" font-family="Inter, sans-serif" font-size="11" font-weight="600">${escapeXml(muscle.name)}</text>`,
      `<rect x="570" y="${y + 23}" width="${barW}" height="6" rx="3" fill="#ef4444"/>`,
      `<text x="570" y="${y + 39}" fill="#94a3b8" font-family="monospace" font-size="10">a=${act.toFixed(2)} | F_T=${force.toFixed(1)} N</text>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}

export function renderOpenSimHillMuscleSvg(doc: OpenSimDocument, sim: OpenSimSimulationResult): string {
  const width = 760;
  const height = 300;
  const plotLeft = 60;
  const plotTop = 55;
  const plotW = 300;
  const plotH = 200;

  // Sample normalized fiber length l_tilde in [0.4, 1.6]
  const activePts: string[] = [];
  const passivePts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const lTilde = 0.4 + (1.2 * i) / 40;
    const fAct = computeActiveForceLength(lTilde);
    const fPas = Math.min(1.5, computePassiveForceLength(lTilde));
    const px = plotLeft + ((lTilde - 0.4) / 1.2) * plotW;
    const pyAct = plotTop + plotH - (fAct / 1.5) * plotH;
    const pyPas = plotTop + plotH - (fPas / 1.5) * plotH;
    activePts.push(`${px.toFixed(1)},${pyAct.toFixed(1)}`);
    passivePts.push(`${px.toFixed(1)},${pyPas.toFixed(1)}`);
  }

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">`,
    `<rect width="${width}" height="${height}" fill="#080c14" rx="8"/>`,
    `<text x="20" y="28" fill="#f8fafc" font-family="Inter, sans-serif" font-size="14" font-weight="700">Hill-Type Force-Length Curve &amp; RK4 Tendon Force Trajectory</text>`,
    `<rect x="${plotLeft}" y="${plotTop}" width="${plotW}" height="${plotH}" fill="#0f172a" stroke="#334155"/>`,
    `<polyline fill="none" stroke="#38bdf8" stroke-width="2.2" points="${activePts.join(" ")}"/>`,
    `<polyline fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4 3" points="${passivePts.join(" ")}"/>`,
    `<text x="${plotLeft + plotW / 2}" y="${plotTop + plotH + 22}" text-anchor="middle" fill="#94a3b8" font-family="Inter, sans-serif" font-size="11">Normalized Fiber Length l~_M (Active: cyan, Passive: amber)</text>`,
  ];

  // Right panel: Time-series tendon force for primary muscle
  const tLeft = 420;
  const tW = 310;
  parts.push(`<rect x="${tLeft}" y="${plotTop}" width="${tW}" height="${plotH}" fill="#0f172a" stroke="#334155"/>`);

  const firstMuscle = doc.muscles[0];
  if (firstMuscle) {
    const traj = sim.muscles[firstMuscle.name];
    if (traj && traj.tendonForce.length > 0) {
      const maxF = Math.max(1, firstMuscle.maxIsometricForce, ...traj.tendonForce);
      const pts = traj.tendonForce.map((f, idx) => {
        const x = tLeft + (idx / Math.max(1, traj.tendonForce.length - 1)) * tW;
        const y = plotTop + plotH - Math.min(1, f / maxF) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      parts.push(
        `<polyline fill="none" stroke="#10b981" stroke-width="2.2" points="${pts.join(" ")}"/>`,
        `<text x="${tLeft + tW / 2}" y="${plotTop + plotH + 22}" text-anchor="middle" fill="#94a3b8" font-family="Inter, sans-serif" font-size="11">${escapeXml(firstMuscle.name)} Tendon Force F^T(t) [max ${maxF.toFixed(0)} N]</text>`,
      );
    }
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

export function renderDicomRtDvhSvg(doc: DicomRtDocument, dosimetry: DicomRtDosimetrySummary): string {
  const width = 760;
  const height = 320;
  const plotLeft = 60;
  const plotTop = 55;
  const plotW = 440;
  const plotH = 215;
  const maxDose = Math.max(10, doc.prescribedDoseGy * 1.15, ...dosimetry.roiReports.map((r) => r.maxDoseGy));

  const colors = ["#ef4444", "#10b981", "#38bdf8", "#f59e0b", "#a855f7", "#ec4899"];
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">`,
    `<rect width="${width}" height="${height}" fill="#080c14" rx="8"/>`,
    `<text x="20" y="28" fill="#f8fafc" font-family="Inter, sans-serif" font-size="14" font-weight="700">Cumulative Dose-Volume Histogram (DVH) &amp; Radiobiology (${escapeXml(doc.planLabel)})</text>`,
    `<text x="20" y="45" fill="#94a3b8" font-family="Inter, sans-serif" font-size="11">Rx: ${doc.prescribedDoseGy.toFixed(1)} Gy in ${doc.fractions} fx | BED: ${dosimetry.prescriptionBedGy.toFixed(2)} Gy | EQD2: ${dosimetry.prescriptionEqd2Gy.toFixed(2)} Gy | HI: ${dosimetry.homogeneityIndex.toFixed(3)} | CI: ${dosimetry.conformityIndex.toFixed(3)}</text>`,
    `<rect x="${plotLeft}" y="${plotTop}" width="${plotW}" height="${plotH}" fill="#0f172a" stroke="#334155"/>`,
  ];

  doc.dvhs.forEach((dvh, idx) => {
    const color = colors[idx % colors.length]!;
    const bins =
      dvh.bins.length >= 2
        ? dvh.bins
        : [
            { doseGy: 0, volumePercent: 100 },
            { doseGy: dvh.d98Gy, volumePercent: 98 },
            { doseGy: dvh.d95Gy, volumePercent: 95 },
            { doseGy: dvh.d50Gy, volumePercent: 50 },
            { doseGy: dvh.d2Gy, volumePercent: 2 },
            { doseGy: dvh.maxDoseGy, volumePercent: 0 },
          ];
    const pts = bins.map((b) => {
      const x = plotLeft + Math.min(1, Math.max(0, b.doseGy / maxDose)) * plotW;
      const y = plotTop + plotH - Math.min(1, Math.max(0, b.volumePercent / 100)) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    parts.push(`<polyline fill="none" stroke="${color}" stroke-width="2.2" points="${pts.join(" ")}"/>`);
  });

  // Legend & ROI summary table on right
  dosimetry.roiReports.forEach((rep, idx) => {
    const color = colors[idx % colors.length]!;
    const y = plotTop + 18 + idx * 42;
    const statusBadge = rep.withinConstraints ? "PASS" : "LIMIT";
    const statusColor = rep.withinConstraints ? "#10b981" : "#ef4444";
    parts.push(
      `<circle cx="525" cy="${y - 4}" r="5" fill="${color}"/>`,
      `<text x="536" y="${y}" fill="#f8fafc" font-family="Inter, sans-serif" font-size="12" font-weight="600">${escapeXml(rep.roiName)} (${rep.interpretedType})</text>`,
      `<text x="715" y="${y}" fill="${statusColor}" font-family="monospace" font-size="11" font-weight="700">${statusBadge}</text>`,
      `<text x="536" y="${y + 15}" fill="#94a3b8" font-family="monospace" font-size="10">D95=${rep.d95Gy.toFixed(1)}Gy | Mean=${rep.meanDoseGy.toFixed(1)}Gy | EQD2=${rep.eqd2Gy.toFixed(1)}Gy</text>`,
    );
  });

  parts.push(
    `<text x="${plotLeft + plotW / 2}" y="${plotTop + plotH + 22}" text-anchor="middle" fill="#94a3b8" font-family="Inter, sans-serif" font-size="11">Dose [Gy] (Max Scale: ${maxDose.toFixed(1)} Gy)</text>`,
    `</svg>`,
  );
  return parts.join("\n");
}

export function renderDicomRtBevMlcSvg(doc: DicomRtDocument): string {
  const width = 760;
  const height = 300;
  const beam = doc.beams[0];
  const cp = beam?.controlPoints[0];
  const leaves = cp?.mlcLeaves ?? [];

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">`,
    `<rect width="${width}" height="${height}" fill="#080c14" rx="8"/>`,
    `<text x="20" y="28" fill="#f8fafc" font-family="Inter, sans-serif" font-size="14" font-weight="700">Beam&apos;s Eye View (BEV) Multi-Leaf Collimator (MLC) Aperture</text>`,
    `<text x="20" y="46" fill="#94a3b8" font-family="Inter, sans-serif" font-size="11">Beam: ${escapeXml(beam?.name ?? "None")} (${beam?.modality ?? "PHOTON"}, ${beam?.energyMeV ?? 6} MeV) | Gantry: ${cp?.gantryAngleDeg ?? 0} deg | Couch: ${cp?.couchAngleDeg ?? 0} deg</text>`,
  ];

  const cx = 380;
  const cy = 170;
  const fieldW = 280;
  const fieldH = 190;
  parts.push(
    `<rect x="${cx - fieldW / 2}" y="${cy - fieldH / 2}" width="${fieldW}" height="${fieldH}" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>`,
    `<line x1="${cx - fieldW / 2}" y1="${cy}" x2="${cx + fieldW / 2}" y2="${cy}" stroke="#334155" stroke-dasharray="3 3"/>`,
    `<line x1="${cx}" y1="${cy - fieldH / 2}" x2="${cx}" y2="${cy + fieldH / 2}" stroke="#334155" stroke-dasharray="3 3"/>`,
  );

  const count = Math.max(1, leaves.length);
  const leafH = fieldH / count;
  leaves.forEach((leaf, idx) => {
    const y = cy - fieldH / 2 + idx * leafH;
    // Map [-100 mm, +100 mm] to [cx - fieldW/2, cx + fieldW/2]
    const normA = Math.max(-100, Math.min(100, leaf.bankA_mm));
    const normB = Math.max(-100, Math.min(100, leaf.bankB_mm));
    const xA = cx + (normA / 100) * (fieldW / 2);
    const xB = cx + (normB / 100) * (fieldW / 2);
    const leftEdge = cx - fieldW / 2;
    const rightEdge = cx + fieldW / 2;
    parts.push(
      `<rect x="${leftEdge}" y="${y + 1}" width="${Math.max(0, xA - leftEdge)}" height="${Math.max(2, leafH - 2)}" fill="#1e293b" stroke="#38bdf8" stroke-width="1"/>`,
      `<rect x="${xB}" y="${y + 1}" width="${Math.max(0, rightEdge - xB)}" height="${Math.max(2, leafH - 2)}" fill="#1e293b" stroke="#38bdf8" stroke-width="1"/>`,
      `<rect x="${Math.min(xA, xB)}" y="${y + 1}" width="${Math.max(2, Math.abs(xB - xA))}" height="${Math.max(2, leafH - 2)}" fill="#eab308" fill-opacity="0.22"/>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}

export function renderIgtlTransformGraphSvg(doc: IgtlDocument, nav: TransformChainAndPivotResult): string {
  const width = 760;
  const height = 300;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">`,
    `<rect width="${width}" height="${height}" fill="#080c14" rx="8"/>`,
    `<text x="20" y="28" fill="#f8fafc" font-family="Inter, sans-serif" font-size="14" font-weight="700">OpenIGTLink / PLUS SE(3) Surgical Coordinate Frame Chain</text>`,
    `<text x="20" y="46" fill="#94a3b8" font-family="Inter, sans-serif" font-size="11">Path: ${escapeXml(nav.framePath.join(" -> ") || `${nav.fromFrame} -> ${nav.toFrame}`)} | ||t|| = ${nav.translationNormMm.toFixed(2)} mm | det(R) = ${nav.rotationDeterminant.toFixed(4)} | ||R^T R - I||_F = ${nav.orthogonalityErrorFrobenius.toFixed(6)}</text>`,
  ];

  const frames = nav.framePath.length > 0 ? nav.framePath : [nav.fromFrame, nav.toFrame];
  const stepX = Math.min(180, Math.floor((width - 140) / Math.max(1, frames.length - 1)));
  frames.forEach((frame, idx) => {
    const x = 80 + idx * stepX;
    const y = 145;
    if (idx < frames.length - 1) {
      parts.push(
        `<line x1="${x + 55}" y1="${y}" x2="${x + stepX - 55}" y2="${y}" stroke="#38bdf8" stroke-width="2.2"/>`,
      );
    }
    parts.push(
      `<rect x="${x - 55}" y="${y - 24}" width="110" height="48" rx="6" fill="#151d2f" stroke="#38bdf8" stroke-width="1.5"/>`,
      `<text x="${x}" y="${y + 4}" text-anchor="middle" fill="#f8fafc" font-family="monospace" font-size="12" font-weight="600">${escapeXml(frame)}</text>`,
    );
  });

  // Render Transform definitions table at bottom
  doc.transforms.slice(0, 4).forEach((tf, idx) => {
    const y = 215 + idx * 18;
    parts.push(
      `<text x="30" y="${y}" fill="#94a3b8" font-family="monospace" font-size="11">${escapeXml(tf.from)} -&gt; ${escapeXml(tf.to)} : T=[${tf.matrix[3]?.toFixed(1)}, ${tf.matrix[7]?.toFixed(1)}, ${tf.matrix[11]?.toFixed(1)}] mm${tf.errorMm !== undefined ? ` (err=${tf.errorMm} mm)` : ""}</text>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}

export function renderIgtlPivotTreSvg(_doc: IgtlDocument, nav: TransformChainAndPivotResult): string {
  const width = 760;
  const height = 280;
  const piv = nav.pivotCalibration;
  const tre = nav.fitzpatrickTre;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">`,
    `<rect width="${width}" height="${height}" fill="#080c14" rx="8"/>`,
    `<text x="20" y="28" fill="#f8fafc" font-family="Inter, sans-serif" font-size="14" font-weight="700">Stylus Pivot Calibration &amp; Fitzpatrick Target Registration Error (TRE)</text>`,
    `<rect x="25" y="55" width="340" height="195" rx="6" fill="#0f172a" stroke="#334155"/>`,
    `<text x="45" y="82" fill="#38bdf8" font-family="Inter, sans-serif" font-size="13" font-weight="600">Least-Squares Stylus Pivot Calibration</text>`,
    `<text x="45" y="110" fill="#e2e8f0" font-family="monospace" font-size="12">Sampled Poses : ${piv?.poseCount ?? 0}</text>`,
    `<text x="45" y="132" fill="#e2e8f0" font-family="monospace" font-size="12">Stylus Length : ${(piv?.stylusLengthMm ?? 0).toFixed(2)} mm</text>`,
    `<text x="45" y="154" fill="#e2e8f0" font-family="monospace" font-size="12">Tip Offset    : [${(piv?.stylusTipOffsetMm[0] ?? 0).toFixed(1)}, ${(piv?.stylusTipOffsetMm[1] ?? 0).toFixed(1)}, ${(piv?.stylusTipOffsetMm[2] ?? 0).toFixed(1)}] mm</text>`,
    `<text x="45" y="176" fill="#10b981" font-family="monospace" font-size="12" font-weight="700">Pivot RMS Err : ${(piv?.rmsErrorMm ?? 0).toFixed(4)} mm</text>`,
    `<rect x="395" y="55" width="340" height="195" rx="6" fill="#0f172a" stroke="#334155"/>`,
    `<text x="415" y="82" fill="#a855f7" font-family="Inter, sans-serif" font-size="13" font-weight="600">Fitzpatrick (1998) Fiducial &amp; Target Error</text>`,
    `<text x="415" y="110" fill="#e2e8f0" font-family="monospace" font-size="12">Fiducials (N) : ${tre?.fiducialCount ?? 0}</text>`,
    `<text x="415" y="132" fill="#e2e8f0" font-family="monospace" font-size="12">Input FLE     : ${(tre?.fleMm ?? 0).toFixed(3)} mm</text>`,
    `<text x="415" y="154" fill="#e2e8f0" font-family="monospace" font-size="12">Expected FRE  : ${(tre?.expectedFreMm ?? 0).toFixed(3)} mm</text>`,
    `<text x="415" y="176" fill="#10b981" font-family="monospace" font-size="12" font-weight="700">Predicted TRE : ${(tre?.treMm ?? 0).toFixed(4)} mm</text>`,
    `</svg>`,
  ];
  return parts.join("\n");
}

// ============================================================================
// 1. OpenSim Musculoskeletal Custom Editor Provider
// ============================================================================

export class OpenSimEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.opensimEditor";

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlForWebview();

    const updateWebview = () => {
      if (disposed) return;
      try {
        const text = document.getText();
        const doc: OpenSimDocument = parseOpenSim(text, document.uri.toString());
        const diagnostics: OpenSimDiagnostic[] = lintOpenSimDocument(doc);
        const sim: OpenSimSimulationResult = simulateMuscleDynamics(doc, { duration: 0.5, dt: 0.01 });
        const kinematicTreeSvg: string = renderOpenSimKinematicTreeSvg(doc, sim);
        const muscleChartSvg: string = renderOpenSimHillMuscleSvg(doc, sim);
        const modelicaCode: string = openSimToModelica(doc);
        const urdfXml: string = openSimToUrdf(doc);

        webviewPanel.webview.postMessage({
          type: "update",
          modelName: doc.modelName,
          version: doc.version,
          bodyCount: doc.bodies.length,
          jointCount: doc.joints.length,
          muscleCount: doc.muscles.length,
          markerCount: doc.markers.length,
          kinematicTreeSvg,
          muscleChartSvg,
          diagnostics,
          sim,
          modelicaCode,
          urdfXml,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message: `Failed to parse OpenSim model: ${message}`,
        });
      }
    };

    updateWebview();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(async (msg: { type?: string }) => {
      switch (msg.type) {
        case "ready":
          updateWebview();
          break;
        case "exportModelica": {
          try {
            const doc = parseOpenSim(document.getText(), document.uri.toString());
            const mo = openSimToModelica(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "Modelica Files": ["mo"] },
              defaultUri: vscode.Uri.file(`${doc.modelName || "OpenSimModel"}.mo`),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(mo, "utf8"));
              void vscode.window.showInformationMessage(`Exported OpenSim Modelica model to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export Modelica: ${String(err)}`);
          }
          break;
        }
        case "exportUrdf": {
          try {
            const doc = parseOpenSim(document.getText(), document.uri.toString());
            const urdf = openSimToUrdf(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "URDF Files": ["urdf", "xml"] },
              defaultUri: vscode.Uri.file(`${doc.modelName || "opensim_robot"}.urdf`),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(urdf, "utf8"));
              void vscode.window.showInformationMessage(`Exported URDF to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export URDF: ${String(err)}`);
          }
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      changeSubscription.dispose();
      msgSubscription.dispose();
    });
  }

  private getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenSim Musculoskeletal Biomechanics Workbench</title>
  <style>
    :root { --bg: #0b0f19; --card: #151d2f; --border: #23314d; --accent: #38bdf8; --text: #f8fafc; --muted: #94a3b8; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; padding: 16px; height: 100vh; display: flex; flex-direction: column; }
    .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
    .badge { padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--card); border: 1px solid var(--border); color: var(--accent); margin-left: 8px; }
    .svg-box { flex: 1; background: #080c14; border: 1px solid var(--border); border-radius: 8px; overflow: auto; margin-bottom: 12px; }
    .code-box { flex: 1; background: #080c14; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; white-space: pre-wrap; overflow: auto; color: #e2e8f0; }
    button.action-btn { background: var(--card); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; margin-left: 6px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <strong id="modelTitle">OpenSim Biomechanics Workbench</strong>
      <span id="summaryBadge" class="badge">0 Bodies | 0 Muscles</span>
    </div>
    <div>
      <button class="action-btn" id="btnExportModelica">Export Modelica</button>
      <button class="action-btn" id="btnExportUrdf">Export URDF</button>
    </div>
  </div>
  <div id="kinematicBox" class="svg-box"></div>
  <div id="muscleBox" class="svg-box"></div>
  <div id="projectionsBox" class="code-box"></div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('btnExportModelica').addEventListener('click', () => vscode.postMessage({ type: 'exportModelica' }));
    document.getElementById('btnExportUrdf').addEventListener('click', () => vscode.postMessage({ type: 'exportUrdf' }));
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'update') {
        document.getElementById('modelTitle').textContent = 'OpenSim: ' + msg.modelName;
        document.getElementById('summaryBadge').textContent = msg.bodyCount + ' Bodies | ' + msg.jointCount + ' Joints | ' + msg.muscleCount + ' Muscles';
        document.getElementById('kinematicBox').innerHTML = msg.kinematicTreeSvg;
        document.getElementById('muscleBox').innerHTML = msg.muscleChartSvg;
        document.getElementById('projectionsBox').textContent = msg.modelicaCode + '\\n\\n' + msg.urdfXml;
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

// ============================================================================
// 2. DICOM-RT Radiation Oncology Custom Editor Provider
// ============================================================================

export class DicomRtEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.dicomRtEditor";

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlForWebview();

    const updateWebview = () => {
      if (disposed) return;
      try {
        const text = document.getText();
        const doc: DicomRtDocument = parseDicomRt(text, document.uri.toString());
        const diagnostics: DicomRtDiagnostic[] = lintDicomRtDocument(doc);
        const dosimetry: DicomRtDosimetrySummary = evaluateDicomRtDosimetry(doc);
        const dvhChartSvg: string = renderDicomRtDvhSvg(doc, dosimetry);
        const bevMlcSvg: string = renderDicomRtBevMlcSvg(doc);
        const scadCode: string = dicomRtToScad(doc);
        const sysml2Code: string = dicomRtToSysML2(doc);

        webviewPanel.webview.postMessage({
          type: "update",
          planId: doc.planId,
          planLabel: doc.planLabel,
          patientId: doc.patientId,
          prescribedDoseGy: doc.prescribedDoseGy,
          fractions: doc.fractions,
          structureCount: doc.structures.length,
          beamCount: doc.beams.length,
          dvhChartSvg,
          bevMlcSvg,
          diagnostics,
          dosimetry,
          scadCode,
          sysml2Code,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message: `Failed to parse DICOM-RT plan: ${message}`,
        });
      }
    };

    updateWebview();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(async (msg: { type?: string }) => {
      switch (msg.type) {
        case "ready":
          updateWebview();
          break;
        case "exportScad": {
          try {
            const doc = parseDicomRt(document.getText(), document.uri.toString());
            const scad = dicomRtToScad(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "OpenSCAD Files": ["scad"] },
              defaultUri: vscode.Uri.file(`${doc.planLabel || "dicom_rt_plan"}.scad`),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(scad, "utf8"));
              void vscode.window.showInformationMessage(`Exported DICOM-RT OpenSCAD geometry to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export OpenSCAD: ${String(err)}`);
          }
          break;
        }
        case "exportSysML2":
        case "exportSysml2": {
          try {
            const doc = parseDicomRt(document.getText(), document.uri.toString());
            const sysml = dicomRtToSysML2(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "SysML v2 Files": ["sysml"] },
              defaultUri: vscode.Uri.file(`${doc.planLabel || "dicom_rt_plan"}.sysml`),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(sysml, "utf8"));
              void vscode.window.showInformationMessage(`Exported DICOM-RT SysML v2 requirements to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export SysML v2: ${String(err)}`);
          }
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      changeSubscription.dispose();
      msgSubscription.dispose();
    });
  }

  private getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DICOM-RT Radiation Oncology &amp; Dosimetry Workbench</title>
  <style>
    :root { --bg: #0b0f19; --card: #151d2f; --border: #23314d; --accent: #38bdf8; --text: #f8fafc; --muted: #94a3b8; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; padding: 16px; height: 100vh; display: flex; flex-direction: column; }
    .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
    .badge { padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--card); border: 1px solid var(--border); color: var(--accent); margin-left: 8px; }
    .svg-box { flex: 1; background: #080c14; border: 1px solid var(--border); border-radius: 8px; overflow: auto; margin-bottom: 12px; }
    .code-box { flex: 1; background: #080c14; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; white-space: pre-wrap; overflow: auto; color: #e2e8f0; }
    button.action-btn { background: var(--card); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; margin-left: 6px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <strong id="planTitle">DICOM-RT Dosimetry &amp; MLC Inspector</strong>
      <span id="rxBadge" class="badge">Rx: 0 Gy</span>
    </div>
    <div>
      <button class="action-btn" id="btnExportScad">Export OpenSCAD</button>
      <button class="action-btn" id="btnExportSysML2">Export SysML v2</button>
    </div>
  </div>
  <div id="dvhBox" class="svg-box"></div>
  <div id="bevBox" class="svg-box"></div>
  <div id="projectionsBox" class="code-box"></div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('btnExportScad').addEventListener('click', () => vscode.postMessage({ type: 'exportScad' }));
    document.getElementById('btnExportSysML2').addEventListener('click', () => vscode.postMessage({ type: 'exportSysML2' }));
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'update') {
        document.getElementById('planTitle').textContent = 'DICOM-RT: ' + msg.planLabel;
        document.getElementById('rxBadge').textContent = msg.prescribedDoseGy + ' Gy / ' + msg.fractions + ' fx | BED: ' + msg.dosimetry.prescriptionBedGy.toFixed(1) + ' Gy';
        document.getElementById('dvhBox').innerHTML = msg.dvhChartSvg;
        document.getElementById('bevBox').innerHTML = msg.bevMlcSvg;
        document.getElementById('projectionsBox').textContent = msg.sysml2Code + '\\n\\n' + msg.scadCode;
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

// ============================================================================
// 3. OpenIGTLink & PLUS Surgical Navigation Custom Editor Provider
// ============================================================================

export class IgtlEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.igtlEditor";

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlForWebview();

    const updateWebview = () => {
      if (disposed) return;
      try {
        const text = document.getText();
        const doc: IgtlDocument = parseIgtl(text, document.uri.toString());
        const diagnostics: IgtlDiagnostic[] = lintIgtlDocument(doc);
        const navigation: TransformChainAndPivotResult = solveTransformChainAndPivot(doc);
        const transformGraphSvg: string = renderIgtlTransformGraphSvg(doc, navigation);
        const pivotTreSvg: string = renderIgtlPivotTreSvg(doc, navigation);
        const urdfXml: string = igtlToUrdf(doc);
        const modelicaCode: string = igtlToModelica(doc);

        webviewPanel.webview.postMessage({
          type: "update",
          version: doc.version,
          deviceCount: doc.devices.length,
          transformCount: doc.transforms.length,
          serverCount: doc.servers.length,
          transformGraphSvg,
          pivotTreSvg,
          diagnostics,
          navigation,
          urdfXml,
          modelicaCode,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message: `Failed to parse OpenIGTLink / PLUS configuration: ${message}`,
        });
      }
    };

    updateWebview();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(async (msg: { type?: string }) => {
      switch (msg.type) {
        case "ready":
          updateWebview();
          break;
        case "exportUrdf": {
          try {
            const doc = parseIgtl(document.getText(), document.uri.toString());
            const urdf = igtlToUrdf(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "URDF Files": ["urdf", "xml"] },
              defaultUri: vscode.Uri.file("SurgicalNavigationRobot.urdf"),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(urdf, "utf8"));
              void vscode.window.showInformationMessage(`Exported OpenIGTLink URDF to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export URDF: ${String(err)}`);
          }
          break;
        }
        case "exportModelica": {
          try {
            const doc = parseIgtl(document.getText(), document.uri.toString());
            const mo = igtlToModelica(doc);
            const uri = await vscode.window.showSaveDialog({
              filters: { "Modelica Files": ["mo"] },
              defaultUri: vscode.Uri.file("SurgicalNavigationModel.mo"),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(mo, "utf8"));
              void vscode.window.showInformationMessage(`Exported OpenIGTLink Modelica model to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export Modelica: ${String(err)}`);
          }
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      changeSubscription.dispose();
      msgSubscription.dispose();
    });
  }

  private getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenIGTLink &amp; PLUS Surgical Navigation Workbench</title>
  <style>
    :root { --bg: #0b0f19; --card: #151d2f; --border: #23314d; --accent: #38bdf8; --text: #f8fafc; --muted: #94a3b8; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; padding: 16px; height: 100vh; display: flex; flex-direction: column; }
    .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
    .badge { padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--card); border: 1px solid var(--border); color: var(--accent); margin-left: 8px; }
    .svg-box { flex: 1; background: #080c14; border: 1px solid var(--border); border-radius: 8px; overflow: auto; margin-bottom: 12px; }
    .code-box { flex: 1; background: #080c14; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; white-space: pre-wrap; overflow: auto; color: #e2e8f0; }
    button.action-btn { background: var(--card); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; margin-left: 6px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <strong>OpenIGTLink / PLUS Surgical Navigation Inspector</strong>
      <span id="navBadge" class="badge">SE(3) Chain</span>
    </div>
    <div>
      <button class="action-btn" id="btnExportUrdf">Export URDF</button>
      <button class="action-btn" id="btnExportModelica">Export Modelica</button>
    </div>
  </div>
  <div id="transformBox" class="svg-box"></div>
  <div id="pivotBox" class="svg-box"></div>
  <div id="projectionsBox" class="code-box"></div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('btnExportUrdf').addEventListener('click', () => vscode.postMessage({ type: 'exportUrdf' }));
    document.getElementById('btnExportModelica').addEventListener('click', () => vscode.postMessage({ type: 'exportModelica' }));
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'update') {
        document.getElementById('navBadge').textContent = msg.transformCount + ' Transforms | ||t|| = ' + msg.navigation.translationNormMm.toFixed(1) + ' mm';
        document.getElementById('transformBox').innerHTML = msg.transformGraphSvg;
        document.getElementById('pivotBox').innerHTML = msg.pivotTreSvg;
        document.getElementById('projectionsBox').textContent = msg.urdfXml + '\\n\\n' + msg.modelicaCode;
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
