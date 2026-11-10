// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DIgSILENT PowerFactory Single-Line Diagram (SLD) Builder.
 *
 * Translates PowerFactory network models, substation layouts, and graphic records
 * into publication-quality standalone SVGs with voltage-level color coding,
 * interactive circuit breaker toggles, and power flow telemetry badges.
 */

export interface PowerFactoryDiagramOptions {
  title?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  theme?: "dark" | "light" | undefined;
  showTelemetry?: boolean | undefined;
  interactiveBreakers?: boolean | undefined;
}

export function getPowerFactoryVoltageColor(kv: number): string {
  if (kv >= 380) return "#ef4444"; // Red (380kV - 765kV)
  if (kv >= 220) return "#10b981"; // Emerald Green (220kV - 345kV)
  if (kv >= 110) return "#3b82f6"; // Blue (110kV - 161kV)
  if (kv >= 20) return "#f59e0b";  // Amber (20kV - 69kV)
  return "#8b5cf6";                 // Purple (LV / Distribution)
}

/**
 * Minimal structural interface for PowerFactory model elements needed by the diagram builder.
 */
export interface DiagramTerm {
  id: string;
  loc_name: string;
  uknom: number;
  x?: number | undefined;
  y?: number | undefined;
}

export interface DiagramLine {
  id: string;
  loc_name: string;
  bus1Id: string;
  bus2Id: string;
  dline: number;
  loadingPercent?: number | undefined;
  pMw?: number | undefined;
}

export interface DiagramTrafo {
  id: string;
  loc_name: string;
  bushvId: string;
  buslvId: string;
  strn?: number | undefined;
}

export interface DiagramGen {
  id: string;
  loc_name: string;
  bus1Id: string;
  pgini: number;
  qgini: number;
}

export interface DiagramLoad {
  id: string;
  loc_name: string;
  bus1Id: string;
  plini: number;
  qlini: number;
}

export interface DiagramSwitch {
  id: string;
  loc_name: string;
  bus1Id: string;
  bus2Id: string;
  on_off: number; // 0 = open, 1 = closed
  isBreaker?: boolean | undefined;
}

export interface PowerFactoryDiagramModel {
  name: string;
  terminals: Map<string, DiagramTerm>;
  lines: Map<string, DiagramLine>;
  transformers2w: Map<string, DiagramTrafo>;
  generators: Map<string, DiagramGen>;
  loads: Map<string, DiagramLoad>;
  switches: Map<string, DiagramSwitch>;
}

/**
 * Renders an interactive PowerFactory Single-Line Diagram SVG.
 */
export function renderPowerFactorySvg(
  model: PowerFactoryDiagramModel,
  options: PowerFactoryDiagramOptions = {},
): string {
  const width = options.width ?? 900;
  const height = options.height ?? 600;
  const isDark = (options.theme ?? "dark") === "dark";

  const bgColor = isDark ? "#0f172a" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";
  const gridColor = isDark ? "#1e293b" : "#e2e8f0";

  const pad = 80;
  const terms = Array.from(model.terminals.values());
  const nTerms = Math.max(1, terms.length);

  // Layout coordinates: use existing x, y or arrange along a horizontal grid
  const termPos = new Map<string, { x: number; y: number }>();
  for (let idx = 0; idx < terms.length; idx++) {
    const t = terms[idx]!;
    if (t.x !== undefined && t.y !== undefined && t.x > 0 && t.y > 0) {
      termPos.set(t.id, { x: t.x, y: t.y });
    } else {
      // Auto grid layout
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      const x = pad + col * ((width - pad * 2) / Math.min(4, nTerms));
      const y = pad + 80 + row * 180;
      termPos.set(t.id, { x, y });
    }
  }

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:${bgColor};font-family:Inter,system-ui,sans-serif;">\n`;
  svg += `  <defs>\n`;
  svg += `    <filter id="pf-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="blur"/><feComposite in="SourceGraphic" in2="blur" operator="over"/></filter>\n`;
  svg += `    <marker id="flow-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 2 L 8 5 L 0 8 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `  </defs>\n\n`;

  // Header Title
  const title = options.title ?? `PowerFactory Grid: ${model.name}`;
  svg += `  <text x="${pad}" y="42" fill="${textColor}" font-size="18" font-weight="700">${title}</text>\n`;
  svg += `  <text x="${pad}" y="62" fill="${subTextColor}" font-size="11">DIgSILENT PowerFactory Single-Line Diagram (Interactive)</text>\n\n`;

  // 1. Render Transmission Lines
  svg += `  <!-- Transmission Lines -->\n`;
  for (const [, line] of model.lines) {
    const p1 = termPos.get(line.bus1Id);
    const p2 = termPos.get(line.bus2Id);
    if (!p1 || !p2) continue;

    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;

    svg += `  <g class="pf-line" data-line-id="${line.id}">\n`;
    svg += `    <line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#64748b" stroke-width="2.5" />\n`;
    svg += `    <text x="${midX}" y="${midY - 8}" fill="${subTextColor}" font-size="10" text-anchor="middle">${line.loc_name} (${line.dline} km)</text>\n`;

    if (options.showTelemetry && line.loadingPercent !== undefined) {
      const loadColor = line.loadingPercent > 90 ? "#ef4444" : line.loadingPercent > 75 ? "#f59e0b" : "#10b981";
      svg += `    <rect x="${midX - 25}" y="${midY + 2}" width="50" height="16" rx="4" fill="${bgColor}" stroke="${loadColor}" stroke-width="1.5"/>\n`;
      svg += `    <text x="${midX}" y="${midY + 14}" fill="${loadColor}" font-size="10" font-weight="600" text-anchor="middle">${line.loadingPercent.toFixed(0)}%</text>\n`;
    }
    svg += `  </g>\n`;
  }

  // 2. Render Transformers (2-Winding)
  svg += `  <!-- Two-Winding Transformers -->\n`;
  for (const [, tr] of model.transformers2w) {
    const p1 = termPos.get(tr.bushvId);
    const p2 = termPos.get(tr.buslvId);
    if (!p1 || !p2) continue;

    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;

    svg += `  <g class="pf-trafo" data-trafo-id="${tr.id}">\n`;
    svg += `    <line x1="${p1.x}" y1="${p1.y}" x2="${midX}" y2="${midY - 10}" stroke="#64748b" stroke-width="2" />\n`;
    svg += `    <line x1="${p2.x}" y1="${p2.y}" x2="${midX}" y2="${midY + 10}" stroke="#64748b" stroke-width="2" />\n`;
    svg += `    <circle cx="${midX}" cy="${midY - 6}" r="12" fill="none" stroke="#f59e0b" stroke-width="2.5" />\n`;
    svg += `    <circle cx="${midX}" cy="${midY + 6}" r="12" fill="none" stroke="#f59e0b" stroke-width="2.5" />\n`;
    svg += `    <text x="${midX + 20}" y="${midY + 4}" fill="${textColor}" font-size="10" font-weight="600">${tr.loc_name}</text>\n`;
    svg += `  </g>\n`;
  }

  // 3. Render Switches & Breakers
  svg += `  <!-- Circuit Breakers & Switches -->\n`;
  for (const [, sw] of model.switches) {
    const p1 = termPos.get(sw.bus1Id);
    const p2 = termPos.get(sw.bus2Id);
    if (!p1 || !p2) continue;

    const sx = (p1.x + p2.x) / 2;
    const sy = (p1.y + p2.y) / 2;
    const isClosed = sw.on_off !== 0;
    const statusColor = isClosed ? "#10b981" : "#ef4444";

    svg += `  <g class="pf-switch breaker-toggle" data-switch-id="${sw.id}" style="cursor:pointer;" onclick="toggleBreaker('${sw.id}')">\n`;
    svg += `    <rect x="${sx - 9}" y="${sy - 9}" width="18" height="18" rx="3" fill="${isClosed ? statusColor : bgColor}" stroke="${statusColor}" stroke-width="2" />\n`;
    if (!isClosed) {
      svg += `    <line x1="${sx - 6}" y1="${sy + 6}" x2="${sx + 6}" y2="${sy - 6}" stroke="${statusColor}" stroke-width="2" />\n`;
    }
    svg += `    <text x="${sx}" y="${sy + 20}" fill="${statusColor}" font-size="9" font-weight="600" text-anchor="middle">${sw.loc_name} (${isClosed ? "CLOSED" : "OPEN"})</text>\n`;
    svg += `  </g>\n`;
  }

  // 4. Render Busbars (Terminals)
  svg += `  <!-- Substation Busbars (ElmTerm) -->\n`;
  for (const t of terms) {
    const p = termPos.get(t.id);
    if (!p) continue;
    const color = getPowerFactoryVoltageColor(t.uknom);
    const busWidth = 100;

    svg += `  <g class="pf-bus" data-bus-id="${t.id}">\n`;
    svg += `    <rect x="${p.x - busWidth / 2}" y="${p.y - 4}" width="${busWidth}" height="8" rx="2" fill="${color}" stroke="${color}" />\n`;
    svg += `    <text x="${p.x}" y="${p.y - 12}" fill="${textColor}" font-size="12" font-weight="700" text-anchor="middle">${t.loc_name}</text>\n`;
    svg += `    <text x="${p.x}" y="${p.y + 20}" fill="${color}" font-size="10" font-weight="600" text-anchor="middle">${t.uknom} kV</text>\n`;
    svg += `  </g>\n`;
  }

  // 5. Render Generators
  svg += `  <!-- Synchronous Generators -->\n`;
  for (const [, gen] of model.generators) {
    const p = termPos.get(gen.bus1Id);
    if (!p) continue;
    const gx = p.x - 30;
    const gy = p.y - 40;

    svg += `  <g class="pf-gen" data-gen-id="${gen.id}">\n`;
    svg += `    <line x1="${gx}" y1="${gy + 14}" x2="${gx}" y2="${p.y - 4}" stroke="#64748b" stroke-width="2" />\n`;
    svg += `    <circle cx="${gx}" cy="${gy}" r="14" fill="${bgColor}" stroke="#3b82f6" stroke-width="2" />\n`;
    svg += `    <path d="M ${gx - 7} ${gy} Q ${gx - 3.5} ${gy - 6} ${gx} ${gy} T ${gx + 7} ${gy}" fill="none" stroke="#3b82f6" stroke-width="2" />\n`;
    svg += `    <text x="${gx}" y="${gy - 18}" fill="${textColor}" font-size="10" font-weight="600" text-anchor="middle">${gen.loc_name}</text>\n`;
    svg += `    <text x="${gx}" y="${gy - 6}" fill="#3b82f6" font-size="8" text-anchor="middle">${gen.pgini.toFixed(0)} MW</text>\n`;
    svg += `  </g>\n`;
  }

  // 6. Render Loads
  svg += `  <!-- Electrical Loads -->\n`;
  for (const [, lod] of model.loads) {
    const p = termPos.get(lod.bus1Id);
    if (!p) continue;
    const lx = p.x + 30;
    const ly = p.y + 40;

    svg += `  <g class="pf-load" data-load-id="${lod.id}">\n`;
    svg += `    <line x1="${lx}" y1="${p.y + 4}" x2="${lx}" y2="${ly}" stroke="#64748b" stroke-width="2" marker-end="url(#flow-arrow)" />\n`;
    svg += `    <text x="${lx}" y="${ly + 16}" fill="${textColor}" font-size="10" font-weight="600" text-anchor="middle">${lod.loc_name}</text>\n`;
    svg += `    <text x="${lx}" y="${ly + 28}" fill="${subTextColor}" font-size="9" text-anchor="middle">${lod.plini.toFixed(0)} MW</text>\n`;
    svg += `  </g>\n`;
  }

  // Voltage Legend
  svg += `  <!-- Voltage Legend -->\n`;
  svg += `  <g transform="translate(${width - 160}, 25)">\n`;
  svg += `    <rect width="140" height="95" rx="6" fill="${bgColor}" fill-opacity="0.9" stroke="${gridColor}" stroke-width="1" />\n`;
  svg += `    <rect x="10" y="12" width="12" height="6" fill="#ef4444" rx="1" /><text x="28" y="18" fill="${textColor}" font-size="9">≥ 380 kV</text>\n`;
  svg += `    <rect x="10" y="28" width="12" height="6" fill="#10b981" rx="1" /><text x="28" y="34" fill="${textColor}" font-size="9">220 kV</text>\n`;
  svg += `    <rect x="10" y="44" width="12" height="6" fill="#3b82f6" rx="1" /><text x="28" y="50" fill="${textColor}" font-size="9">110 kV</text>\n`;
  svg += `    <rect x="10" y="60" width="12" height="6" fill="#f59e0b" rx="1" /><text x="28" y="66" fill="${textColor}" font-size="9">20 kV</text>\n`;
  svg += `    <rect x="10" y="76" width="12" height="6" fill="#8b5cf6" rx="1" /><text x="28" y="82" fill="${textColor}" font-size="9">&lt; 20 kV</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
