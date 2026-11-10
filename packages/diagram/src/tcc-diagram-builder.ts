// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Time-Current Characteristic (TCC) Grading Diagram Builder.
 *
 * Generates standalone SVG log-log coordinate plots displaying:
 *   - Overcurrent relay IDMT curves (IEC / IEEE standard inverse, very inverse, extremely inverse).
 *   - Instantaneous ANSI 50 trip thresholds.
 *   - Coordination Time Interval (CTI) margin markers (e.g. Delta_t >= 0.30s at I_fault).
 *   - Equipment thermal damage curves (ANSI/IEEE C57.109 transformer through-fault, cable damage I^2*t = k).
 */

export interface TccCurveData {
  id: string;
  name: string;
  color: string;
  /** Points along the curve in [currentA, timeSec]. */
  points: Array<[number, number]>;
  isDamageCurve?: boolean | undefined;
}

export interface TccMarginMarker {
  currentA: number;
  timePrimarySec: number;
  timeBackupSec: number;
  ctiSec: number;
  label?: string | undefined;
}

export interface TccDiagramOptions {
  title?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  minCurrentA?: number | undefined; // default: 10 A
  maxCurrentA?: number | undefined; // default: 50,000 A
  minTimeSec?: number | undefined; // default: 0.01 s (10 ms)
  maxTimeSec?: number | undefined; // default: 1000 s
  curves: TccCurveData[];
  marginMarkers?: TccMarginMarker[] | undefined;
}

/**
 * Renders an interactive, dark-mode SVG Time-Current Characteristic (TCC) coordination chart.
 */
export function renderTccDiagramSvg(options: TccDiagramOptions): string {
  const width = options.width ?? 900;
  const height = options.height ?? 650;
  const margin = { top: 50, right: 60, bottom: 60, left: 80 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const minI = Math.log10(options.minCurrentA ?? 10.0);
  const maxI = Math.log10(options.maxCurrentA ?? 50000.0);
  const minT = Math.log10(options.minTimeSec ?? 0.01);
  const maxT = Math.log10(options.maxTimeSec ?? 1000.0);

  // Coordinate mapping
  const toX = (iAmp: number): number => {
    const logI = Math.log10(Math.max(Math.pow(10, minI), iAmp));
    return margin.left + ((logI - minI) / (maxI - minI)) * plotWidth;
  };

  const toY = (tSec: number): number => {
    const logT = Math.log10(Math.max(Math.pow(10, minT), tSec));
    // Invert y: larger time at top
    return margin.top + (1.0 - (logT - minT) / (maxT - minT)) * plotHeight;
  };

  const elements: string[] = [];

  // SVG Header & Background
  elements.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<defs>`,
    `  <style>`,
    `    .tcc-bg { fill: #121826; }`,
    `    .tcc-grid { stroke: #232d42; stroke-width: 0.75; stroke-dasharray: 2,2; }`,
    `    .tcc-major-grid { stroke: #334155; stroke-width: 1.2; }`,
    `    .tcc-axis { stroke: #64748b; stroke-width: 1.5; }`,
    `    .tcc-label { fill: #94a3b8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; }`,
    `    .tcc-title { fill: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; font-weight: 600; }`,
    `    .tcc-legend { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; font-weight: 500; }`,
    `  </style>`,
    `</defs>`,
    `<rect width="${width}" height="${height}" class="tcc-bg" />`,
  );

  // Title
  const title = options.title ?? "Time-Current Characteristic (TCC) Coordination Curve";
  elements.push(
    `<text x="${width / 2}" y="32" class="tcc-title" text-anchor="middle">${title}</text>`,
  );

  // Grid lines: Current decades & intermediate decades
  const iDecades = [10, 100, 1000, 10000, 100000];
  for (const dec of iDecades) {
    if (dec >= Math.pow(10, minI) && dec <= Math.pow(10, maxI)) {
      const x = toX(dec);
      elements.push(
        `<line x1="${x.toFixed(1)}" y1="${margin.top}" x2="${x.toFixed(1)}" y2="${margin.top + plotHeight}" class="tcc-major-grid" />`,
        `<text x="${x.toFixed(1)}" y="${margin.top + plotHeight + 20}" class="tcc-label" text-anchor="middle">${dec >= 1000 ? `${dec / 1000}k` : dec}A</text>`,
      );
    }
  }

  // Grid lines: Time decades
  const tDecades = [0.01, 0.1, 1, 10, 100, 1000];
  for (const dec of tDecades) {
    if (dec >= Math.pow(10, minT) && dec <= Math.pow(10, maxT)) {
      const y = toY(dec);
      elements.push(
        `<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${margin.left + plotWidth}" y2="${y.toFixed(1)}" class="tcc-major-grid" />`,
        `<text x="${margin.left - 10}" y="${(y + 4).toFixed(1)}" class="tcc-label" text-anchor="end">${dec}s</text>`,
      );
    }
  }

  // Plot Borders
  elements.push(
    `<rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="none" class="tcc-axis" />`,
  );

  // Render Curves
  for (const curve of options.curves) {
    if (curve.points.length < 2) continue;
    const pathD = curve.points
      .map(([iVal, tVal], idx) => {
        const x = toX(iVal);
        const y = toY(tVal);
        return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");

    const dash = curve.isDamageCurve ? `stroke-dasharray="4,4"` : "";
    const strokeWidth = curve.isDamageCurve ? "1.8" : "2.5";
    elements.push(
      `<path d="${pathD}" fill="none" stroke="${curve.color}" stroke-width="${strokeWidth}" ${dash} />`,
    );
  }

  // Render CTI Margin Markers
  if (options.marginMarkers) {
    for (const marker of options.marginMarkers) {
      const x = toX(marker.currentA);
      const y1 = toY(marker.timePrimarySec);
      const y2 = toY(marker.timeBackupSec);
      const midY = (y1 + y2) / 2;

      elements.push(
        `<line x1="${x.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#38bdf8" stroke-width="2.5" />`,
        `<circle cx="${x.toFixed(1)}" cy="${y1.toFixed(1)}" r="4" fill="#38bdf8" />`,
        `<circle cx="${x.toFixed(1)}" cy="${y2.toFixed(1)}" r="4" fill="#38bdf8" />`,
        `<rect x="${(x + 8).toFixed(1)}" y="${(midY - 10).toFixed(1)}" width="85" height="20" rx="3" fill="#0f172a" stroke="#38bdf8" stroke-width="1" />`,
        `<text x="${(x + 14).toFixed(1)}" y="${(midY + 4).toFixed(1)}" fill="#38bdf8" class="tcc-legend">CTI: ${marker.ctiSec.toFixed(2)}s</text>`,
      );
    }
  }

  // Legend
  let legendX = margin.left + 20;
  const legendY = margin.top + 25;
  for (const curve of options.curves) {
    elements.push(
      `<line x1="${legendX}" y1="${legendY}" x2="${legendX + 20}" y2="${legendY}" stroke="${curve.color}" stroke-width="3" />`,
      `<text x="${legendX + 26}" y="${legendY + 4}" fill="#f8fafc" class="tcc-legend">${curve.name}</text>`,
    );
    legendX += curve.name.length * 8 + 45;
  }

  elements.push(`</svg>`);
  return elements.join("\n");
}
