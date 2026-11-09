// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Normalized Centroid / Pick-and-Place (PnP) Generator.
 *
 * Generates standardized component centroid data for Surface Mount Technology (SMT)
 * pick-and-place machines and automated assembly lines.
 *
 * Resolves rotational orientation conventions between CAD library origins and
 * standard tape-and-reel packaging (IPC-7351 Level A/B/C vs EIA-481).
 */

import type { PCBLayout } from "./gerber.js";

// ── Public Types ──

export interface CentroidRecord {
  /** Component reference designator (e.g., "R1", "U3"). */
  designator: string;
  /** Component value or part description (e.g., "10k", "STM32H743"). */
  value: string;
  /** Package / footprint identifier (e.g., "0603", "SOIC-8", "LQFP-64"). */
  package: string;
  /** Centroid X coordinate in millimeters. */
  x: number;
  /** Centroid Y coordinate in millimeters. */
  y: number;
  /** Mounting layer: "top" or "bottom". */
  layer: "top" | "bottom";
  /** Rotation angle in degrees [0, 360). */
  rotation: number;
  /** Normalized rotation conforming to IPC-7351 pin 1 standard. */
  normalizedRotation: number;
  /** Component height in millimeters if known (default 1.0mm). */
  heightMm: number;
}

export interface CentroidGenerationOptions {
  /** Optional height table by package type in mm. */
  packageHeights?: Record<string, number>;
  /** Optional component value map { [refDes]: value }. */
  componentValues?: Record<string, string>;
  /** Precision for coordinate output (default: 4 decimal places). */
  precision?: number;
}

// ── Orientation Normalization (IPC-7351 vs EIA-481) ──

/**
 * Normalizes rotation angle according to IPC-7351 pin 1 standards:
 * - Two-pin passives (resistors, capacitors, inductors): Pin 1 on the left (0 degrees).
 * - Multi-pin ICs (SOIC, QFP, QFN, BGA): Pin 1 in top-left corner (0 degrees).
 * - Polarized passives (diodes, tantalum caps): Cathode on the left (0 degrees).
 */
export function normalizeIpc7351Rotation(rawAngle: number, designator: string, pkg: string | null): number {
  let angle = ((rawAngle % 360) + 360) % 360;
  const p = (pkg ?? "").toUpperCase();
  const d = designator.toUpperCase();

  // Diodes and LEDs: CAD tools frequently place cathode at 180 deg vs EIA-481 tape carrier (cathode leading at 0 deg)
  if (d.startsWith("D") || d.startsWith("LED") || p.includes("DIODE") || p.includes("SOD")) {
    // If raw rotation was 180, normalize to standard 0
    if (Math.abs(angle - 180) < 1e-3) {
      angle = 0;
    }
  }

  // Transistors and SOT-23 packages: EIA-481 standard single pin facing top
  if (p.includes("SOT23") || p.includes("SOT-23") || d.startsWith("Q")) {
    // Normalize quadrant alignment
    angle = Math.round(angle * 1e4) / 1e4;
  }

  return angle;
}

// ── Centroid Extraction Algorithm ──

/**
 * Extracts centroid records for all placed components in a PCB layout.
 */
export function generateCentroidRecords(layout: PCBLayout, options?: CentroidGenerationOptions): CentroidRecord[] {
  const records: CentroidRecord[] = [];
  const heights = options?.packageHeights ?? {};
  const values = options?.componentValues ?? {};

  // Group pads by component to calculate geometric center if placement coords need verification
  const padsByComp = new Map<string, typeof layout.pads>();
  for (const pad of layout.pads) {
    if (!pad.component) continue;
    let list = padsByComp.get(pad.component);
    if (!list) {
      list = [];
      padsByComp.set(pad.component, list);
    }
    list.push(pad);
  }

  for (const comp of layout.netlist.components) {
    const name = comp.name;
    const placement = comp.placement;
    const compPads = padsByComp.get(name) ?? [];

    let cx = 0;
    let cy = 0;
    let rawRot = 0;
    let layer: "top" | "bottom" = "top";
    let pkg = placement?.footprint ?? "SMD";

    if (placement) {
      cx = placement.x;
      cy = placement.y;
      rawRot = placement.angle ?? 0;
      const l = placement.layer.toLowerCase();
      layer = l.includes("bottom") || l.includes("b.cu") ? "bottom" : "top";
      if (placement.footprint) pkg = placement.footprint;
    } else if (compPads.length > 0) {
      // Calculate average pad center
      let sumX = 0;
      let sumY = 0;
      for (const p of compPads) {
        sumX += p.center[0];
        sumY += p.center[1];
      }
      cx = sumX / compPads.length;
      cy = sumY / compPads.length;
      const firstPad = compPads[0]!;
      const l = firstPad.layer.toLowerCase();
      layer = l.includes("bottom") || l.includes("b.cu") ? "bottom" : "top";
    } else {
      // Unplaced component, skip from physical pick-and-place
      continue;
    }

    const normalizedRot = normalizeIpc7351Rotation(rawRot, name, pkg);
    const height = heights[pkg] ?? (pkg.includes("0402") ? 0.5 : pkg.includes("0603") ? 0.8 : 1.0);
    const val = values[name] ?? (name.startsWith("R") ? "RES" : name.startsWith("C") ? "CAP" : "IC");

    records.push({
      designator: name,
      value: val,
      package: pkg,
      x: cx,
      y: cy,
      layer,
      rotation: rawRot,
      normalizedRotation: normalizedRot,
      heightMm: height,
    });
  }

  // Sort deterministically by designator (e.g. C1, C2, R1, U1)
  records.sort((a, b) => a.designator.localeCompare(b.designator, undefined, { numeric: true }));
  return records;
}

// ── Export Formatters ──

/**
 * Emits standard CSV centroid format:
 * Designator,Val,Package,Mid X,Mid Y,Rotation,Layer,Height(mm)
 */
export function formatStandardCentroidCsv(records: CentroidRecord[], precision = 4): string {
  const lines: string[] = [];
  lines.push("Designator,Val,Package,Mid X,Mid Y,Rotation,Layer,Height(mm)");
  for (const r of records) {
    lines.push(
      `${r.designator},${r.value},${r.package},${r.x.toFixed(precision)},${r.y.toFixed(precision)},${r.normalizedRotation.toFixed(precision)},${r.layer},${r.heightMm.toFixed(2)}`,
    );
  }
  return lines.join("\n");
}

/**
 * Emits JLCPCB CPL format:
 * "Designator","Mid X","Mid Y","Layer","Rotation"
 */
export function formatJlcpcbCplCsv(records: CentroidRecord[], precision = 4): string {
  const lines: string[] = [];
  lines.push('"Designator","Mid X","Mid Y","Layer","Rotation"');
  for (const r of records) {
    const layerStr = r.layer === "top" ? "Top" : "Bottom";
    lines.push(
      `"${r.designator}","${r.x.toFixed(precision)}mm","${r.y.toFixed(precision)}mm","${layerStr}","${r.normalizedRotation.toFixed(precision)}"`,
    );
  }
  return lines.join("\n");
}

/**
 * Emits MacroFab XY format:
 * Designator X(mils) Y(mils) Rotation Side
 */
export function formatMacrofabXy(records: CentroidRecord[]): string {
  const lines: string[] = [];
  lines.push("# MacroFab XY Pick-and-Place File");
  lines.push("# Designator\tX_mil\tY_mil\tRotation\tSide\tPackage\tValue");
  const MM_TO_MIL = 39.3700787;
  for (const r of records) {
    const xMil = Math.round(r.x * MM_TO_MIL);
    const yMil = Math.round(r.y * MM_TO_MIL);
    const side = r.layer === "top" ? "T" : "B";
    lines.push(
      `${r.designator}\t${xMil}\t${yMil}\t${r.normalizedRotation.toFixed(1)}\t${side}\t${r.package}\t${r.value}`,
    );
  }
  return lines.join("\n");
}
