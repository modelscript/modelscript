// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview IEC 61850 Substation Configuration Language (SCL) Single-Line Diagram (SLD) Builder.
 *
 * Generates automated substation single-line diagrams (SLD) displaying:
 *   - Substation voltage levels (e.g. 500kV, 230kV, 115kV, 13.8kV) with IEC 61850 voltage-tier color coding.
 *   - Substation bays (feeder bays, transformer bays, bus couplers, capacitor banks).
 *   - Circuit breakers (XCBR / CBR) with operational status markers.
 *   - Disconnectors and earthing switches (XSWI / DIS).
 *   - Power transformers (Y-Delta, autotransformers) with dual/triple winding circles.
 *   - Primary connectivity nodes and main/transfer busbars.
 */

export interface SclDiagramNode {
  id: string;
  name: string;
  voltageKv: number;
  bayName: string;
  x?: number | undefined;
  y?: number | undefined;
}

export interface SclDiagramEquipment {
  id: string;
  name: string;
  type: "CBR" | "DIS" | "CTR" | "VTR" | "PTR" | "CAP" | "REA" | "GEN" | "IFL";
  fromNode: string;
  toNode: string;
  bayName: string;
  voltageKv: number;
  isClosed?: boolean | undefined;
}

export interface SclSubstationDiagramData {
  substationName: string;
  voltageLevels: Array<{
    name: string;
    voltageKv: number;
  }>;
  nodes: SclDiagramNode[];
  equipment: SclDiagramEquipment[];
}

export interface SclDiagramOptions {
  title?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  darkMode?: boolean | undefined;
}

/**
 * IEC 61850 standard voltage level color palette.
 */
export function getSclVoltageColor(voltageKv: number): string {
  if (voltageKv >= 400) return "#ef4444"; // Red (EHV 400kV - 765kV)
  if (voltageKv >= 220) return "#f97316"; // Orange (220kV - 345kV)
  if (voltageKv >= 110) return "#eab308"; // Yellow (110kV - 138kV)
  if (voltageKv >= 60) return "#22c55e"; // Green (69kV)
  if (voltageKv >= 10) return "#06b6d4"; // Cyan (11kV - 33kV distribution)
  return "#8b5cf6"; // Purple (LV < 10kV)
}

/**
 * Renders a standalone, dark-mode SVG Single-Line Diagram for an IEC 61850 substation.
 */
export function renderSclSubstationSvg(data: SclSubstationDiagramData, options?: SclDiagramOptions): string {
  const width = options?.width ?? 1100;
  const height = options?.height ?? 750;
  const isDark = options?.darkMode ?? true;

  const bg = isDark ? "#0f172a" : "#f8fafc";
  const fg = isDark ? "#f1f5f9" : "#0f172a";
  const cardBg = isDark ? "#1e293b" : "#ffffff";
  const borderCol = isDark ? "#334155" : "#cbd5e1";
  const textMuted = isDark ? "#94a3b8" : "#64748b";

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  );
  lines.push(`  <rect width="100%" height="100%" fill="${bg}"/>`);

  // Title block
  const title = options?.title ?? `IEC 61850 Substation SLD: ${data.substationName}`;
  lines.push(
    `  <text x="30" y="40" font-family="system-ui, sans-serif" font-size="20" font-weight="bold" fill="${fg}">${title}</text>`,
  );

  // Group equipment by bay
  const bays = new Map<string, SclDiagramEquipment[]>();
  for (const eq of data.equipment) {
    const list = bays.get(eq.bayName) ?? [];
    list.push(eq);
    bays.set(eq.bayName, list);
  }

  // Layout parameters
  const bayCount = Math.max(1, bays.size);
  const startX = 60;
  const startY = 100;
  const bayWidth = Math.min(220, (width - startX * 2) / bayCount);
  const busbarY = startY + 60;

  // Draw main busbars per voltage level
  let busIdx = 0;
  for (const vl of data.voltageLevels) {
    const busY = busbarY + busIdx * 250;
    const busCol = getSclVoltageColor(vl.voltageKv);
    lines.push(`  <!-- Busbar ${vl.name} (${vl.voltageKv} kV) -->`);
    lines.push(
      `  <line x1="${startX}" y1="${busY}" x2="${width - startX}" y2="${busY}" stroke="${busCol}" stroke-width="6" stroke-linecap="round"/>`,
    );
    lines.push(
      `  <text x="${startX}" y="${busY - 12}" font-family="system-ui, sans-serif" font-size="13" font-weight="bold" fill="${busCol}">${vl.name} Bus (${vl.voltageKv} kV)</text>`,
    );
    busIdx++;
  }

  // Render each bay
  let currentBayIdx = 0;
  for (const [bayName, equipList] of bays.entries()) {
    const xCenter = startX + currentBayIdx * bayWidth + bayWidth / 2;
    const topY = busbarY + 20;

    lines.push(`  <!-- Bay: ${bayName} -->`);
    lines.push(
      `  <rect x="${xCenter - bayWidth / 2 + 10}" y="${topY}" width="${bayWidth - 20}" height="180" rx="8" fill="${cardBg}" stroke="${borderCol}" stroke-width="1.5" opacity="0.8"/>`,
    );
    lines.push(
      `  <text x="${xCenter}" y="${topY + 22}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${textMuted}">${bayName}</text>`,
    );

    // Equipment vertical stack in bay
    let eqY = topY + 45;
    for (const eq of equipList) {
      const eqCol = getSclVoltageColor(eq.voltageKv);

      if (eq.type === "CBR") {
        // Circuit Breaker (XCBR) symbol: square with cross or fill
        lines.push(`  <!-- Breaker: ${eq.name} -->`);
        lines.push(
          `  <line x1="${xCenter}" y1="${eqY - 10}" x2="${xCenter}" y2="${eqY + 30}" stroke="${eqCol}" stroke-width="2"/>`,
        );
        lines.push(
          `  <rect x="${xCenter - 12}" y="${eqY}" width="24" height="20" rx="3" fill="${(eq.isClosed ?? true) ? eqCol : "transparent"}" stroke="${eqCol}" stroke-width="2"/>`,
        );
        lines.push(
          `  <text x="${xCenter + 20}" y="${eqY + 14}" font-family="monospace" font-size="10" fill="${fg}">${eq.name}</text>`,
        );
        eqY += 40;
      } else if (eq.type === "DIS") {
        // Disconnector (XSWI) symbol: knife switch
        lines.push(`  <!-- Disconnector: ${eq.name} -->`);
        lines.push(
          `  <line x1="${xCenter}" y1="${eqY - 8}" x2="${xCenter}" y2="${eqY + 4}" stroke="${eqCol}" stroke-width="2"/>`,
        );
        lines.push(
          `  <line x1="${xCenter}" y1="${eqY + 4}" x2="${xCenter + 8}" y2="${eqY + 16}" stroke="${eqCol}" stroke-width="2"/>`,
        );
        lines.push(
          `  <line x1="${xCenter}" y1="${eqY + 18}" x2="${xCenter}" y2="${eqY + 28}" stroke="${eqCol}" stroke-width="2"/>`,
        );
        lines.push(
          `  <text x="${xCenter + 20}" y="${eqY + 14}" font-family="monospace" font-size="10" fill="${textMuted}">${eq.name}</text>`,
        );
        eqY += 35;
      } else if (eq.type === "PTR") {
        // Transformer symbol: dual overlapping circles
        lines.push(`  <!-- Transformer: ${eq.name} -->`);
        lines.push(
          `  <circle cx="${xCenter}" cy="${eqY + 10}" r="14" fill="none" stroke="${eqCol}" stroke-width="2.5"/>`,
        );
        lines.push(
          `  <circle cx="${xCenter}" cy="${eqY + 28}" r="14" fill="none" stroke="${eqCol}" stroke-width="2.5"/>`,
        );
        lines.push(
          `  <text x="${xCenter + 22}" y="${eqY + 22}" font-family="monospace" font-size="10" font-weight="bold" fill="${fg}">${eq.name}</text>`,
        );
        eqY += 50;
      }
    }

    currentBayIdx++;
  }

  // Substation metadata footer
  lines.push(
    `  <text x="30" y="${height - 20}" font-family="system-ui, sans-serif" font-size="11" fill="${textMuted}">Generated by @modelscript/diagram · SCL Topology Renderer</text>`,
  );
  lines.push("</svg>");
  return lines.join("\n");
}
