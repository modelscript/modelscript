// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GtModel } from "../types.js";

export interface AntvNode {
  id: string;
  shape: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface AntvEdge {
  id: string;
  source: { cell: string; port?: string | undefined };
  target: { cell: string; port?: string | undefined };
  labels?: { attrs: { text: { text: string } } }[] | undefined;
}

export interface AntvGraphData {
  nodes: AntvNode[];
  edges: AntvEdge[];
}

export function buildGtSuiteDiagramData(model: GtModel): AntvGraphData {
  const nodes: AntvNode[] = [];
  const edges: AntvEdge[] = [];

  let autoX = 80;
  let autoY = 80;

  for (const comp of model.components) {
    const x = comp.x && comp.x > 0 ? comp.x : autoX;
    const y = comp.y && comp.y > 0 ? comp.y : autoY;

    if (!comp.x || comp.x === 0) {
      autoX += 170;
      if (autoX > 850) {
        autoX = 80;
        autoY += 150;
      }
    }

    nodes.push({
      id: comp.id,
      shape: comp.kind === "cylinder" ? "cylinder-shape" : "rect",
      x,
      y,
      width: comp.kind === "cylinder" ? 130 : 110,
      height: comp.kind === "cylinder" ? 80 : 60,
      label: `${comp.id}\n(${comp.kind})`,
      data: {
        kind: comp.kind,
        title: comp.title,
      },
    });
  }

  let edgeIdx = 1;
  for (const conn of model.connections) {
    edges.push({
      id: `edge_${edgeIdx++}`,
      source: { cell: conn.fromComponent, port: conn.fromPort },
      target: { cell: conn.toComponent, port: conn.toPort },
      labels: [{ attrs: { text: { text: `${conn.fromPort}->${conn.toPort}` } } }],
    });
  }

  return { nodes, edges };
}

/**
 * Headless SVG vector schematic drawing of the GT-SUITE engine model.
 */
export function renderGtSuiteSchematicSvg(model: GtModel, options?: { view?: "schematic" | "pv" }): string {
  if (options?.view === "pv") {
    return renderPvIndicatorSvg(model);
  }

  const svgParts: string[] = [];
  svgParts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 650" width="100%" height="100%">');
  svgParts.push("  <defs>");
  svgParts.push(
    '    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
  );
  svgParts.push('      <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />');
  svgParts.push("    </marker>");
  svgParts.push('    <linearGradient id="cylGrad" x1="0%" y1="0%" x2="0%" y2="100%">');
  svgParts.push('      <stop offset="0%" stop-color="#1e293b" />');
  svgParts.push('      <stop offset="100%" stop-color="#0f172a" />');
  svgParts.push("    </linearGradient>");
  svgParts.push('    <linearGradient id="intakeGrad" x1="0%" y1="0%" x2="100%" y2="0%">');
  svgParts.push('      <stop offset="0%" stop-color="#0284c7" />');
  svgParts.push('      <stop offset="100%" stop-color="#38bdf8" />');
  svgParts.push("    </linearGradient>");
  svgParts.push('    <linearGradient id="exhGrad" x1="0%" y1="0%" x2="100%" y2="0%">');
  svgParts.push('      <stop offset="0%" stop-color="#ea580c" />');
  svgParts.push('      <stop offset="100%" stop-color="#f97316" />');
  svgParts.push("    </linearGradient>");
  svgParts.push("  </defs>");

  // Background
  svgParts.push('  <rect width="1000" height="650" fill="#0b0f19" />');

  // Title Banner
  svgParts.push(
    `  <text x="500" y="40" font-family="system-ui, sans-serif" font-size="20" font-weight="bold" fill="#f8fafc" text-anchor="middle">GT-SUITE / GT-POWER Engine Schematic: ${model.name}</text>`,
  );
  svgParts.push(
    `  <text x="500" y="65" font-family="system-ui, sans-serif" font-size="13" fill="#94a3b8" text-anchor="middle">Rated Speed: ${model.simulationSettings.engineSpeedRpm} RPM | Air-Fuel Lambda: ${model.simulationSettings.airFuelRatioLambda}</text>`,
  );

  // Diagram Layout:
  // Air Inlet (x=60, y=200) -> Compressor (x=180, y=200) -> Intercooler (x=300, y=200) -> Intake Plenum (x=450, y=200)
  // Runners down to Cylinders (x=450, y=340)
  // Exhaust Plenum (x=450, y=470) -> Turbine (x=700, y=470) -> Exhaust Outlet (x=850, y=470)

  // 1. Air Intake Path
  svgParts.push("  <!-- Air Intake Path -->");
  svgParts.push(
    '  <rect x="50" y="170" width="70" height="60" rx="6" fill="#1e293b" stroke="#38bdf8" stroke-width="2" />',
  );
  svgParts.push(
    '  <text x="85" y="205" font-family="sans-serif" font-size="11" fill="#e2e8f0" text-anchor="middle">Air Inlet</text>',
  );

  svgParts.push(
    '  <line x1="120" y1="200" x2="170" y2="200" stroke="#38bdf8" stroke-width="4" marker-end="url(#arrow)" />',
  );

  // Compressor
  svgParts.push(
    '  <polygon points="170,165 240,180 240,220 170,235" fill="#0369a1" stroke="#38bdf8" stroke-width="2" />',
  );
  svgParts.push(
    '  <text x="205" y="205" font-family="sans-serif" font-size="10" font-weight="bold" fill="#ffffff" text-anchor="middle">COMP</text>',
  );

  svgParts.push(
    '  <line x1="240" y1="200" x2="290" y2="200" stroke="#38bdf8" stroke-width="4" marker-end="url(#arrow)" />',
  );

  // Intercooler
  svgParts.push(
    '  <rect x="290" y="165" width="80" height="70" rx="6" fill="#0f172a" stroke="#0ea5e9" stroke-width="2" />',
  );
  svgParts.push(
    '  <text x="330" y="198" font-family="sans-serif" font-size="10" font-weight="bold" fill="#38bdf8" text-anchor="middle">Intercooler</text>',
  );
  svgParts.push(
    '  <text x="330" y="215" font-family="sans-serif" font-size="9" fill="#94a3b8" text-anchor="middle">ε = 0.85</text>',
  );

  svgParts.push(
    '  <line x1="370" y1="200" x2="430" y2="200" stroke="#38bdf8" stroke-width="4" marker-end="url(#arrow)" />',
  );

  // Intake Plenum
  svgParts.push(
    '  <rect x="430" y="175" width="220" height="50" rx="10" fill="url(#intakeGrad)" stroke="#0284c7" stroke-width="2" />',
  );
  svgParts.push(
    '  <text x="540" y="205" font-family="sans-serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">Intake Manifold Plenum</text>',
  );

  // 4 Cylinders (or count)
  const cylCount = Math.max(1, Math.min(8, model.components.filter((c) => c.kind === "cylinder").length || 4));
  const startCylX = 420;
  const cylSpacing = 65;

  for (let i = 0; i < cylCount; i++) {
    const cx = startCylX + i * cylSpacing;
    // Intake runner
    svgParts.push(
      `  <line x1="${cx + 25}" y1="225" x2="${cx + 25}" y2="290" stroke="#38bdf8" stroke-width="3" marker-end="url(#arrow)" />`,
    );

    // Cylinder block
    svgParts.push(
      `  <rect x="${cx}" y="290" width="50" height="100" rx="6" fill="url(#cylGrad)" stroke="#64748b" stroke-width="2" />`,
    );
    // Piston
    svgParts.push(
      `  <rect x="${cx + 4}" y="340" width="42" height="25" rx="3" fill="#475569" stroke="#94a3b8" stroke-width="1" />`,
    );
    // Connecting rod
    svgParts.push(`  <line x1="${cx + 25}" y1="365" x2="${cx + 25}" y2="385" stroke="#cbd5e1" stroke-width="3" />`);
    svgParts.push(
      `  <text x="${cx + 25}" y="325" font-family="sans-serif" font-size="10" font-weight="bold" fill="#f8fafc" text-anchor="middle">C${i + 1}</text>`,
    );

    // Exhaust runner
    svgParts.push(
      `  <line x1="${cx + 25}" y1="390" x2="${cx + 25}" y2="455" stroke="#f97316" stroke-width="3" marker-end="url(#arrow)" />`,
    );
  }

  // Exhaust Plenum
  svgParts.push(
    '  <rect x="430" y="455" width="220" height="50" rx="10" fill="url(#exhGrad)" stroke="#c2410c" stroke-width="2" />',
  );
  svgParts.push(
    '  <text x="540" y="485" font-family="sans-serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="middle">Exhaust Manifold Plenum</text>',
  );

  svgParts.push(
    '  <line x1="650" y1="480" x2="710" y2="480" stroke="#f97316" stroke-width="4" marker-end="url(#arrow)" />',
  );

  // Turbine
  svgParts.push(
    '  <polygon points="710,460 780,445 780,515 710,500" fill="#c2410c" stroke="#f97316" stroke-width="2" />',
  );
  svgParts.push(
    '  <text x="745" y="485" font-family="sans-serif" font-size="10" font-weight="bold" fill="#ffffff" text-anchor="middle">TURB</text>',
  );

  // Turbocharger shaft link (dotted line between turb and comp)
  svgParts.push(
    '  <path d="M 745 445 L 745 280 L 205 280 L 205 235" fill="none" stroke="#e2e8f0" stroke-width="2" stroke-dasharray="5,5" />',
  );
  svgParts.push(
    '  <text x="475" y="272" font-family="sans-serif" font-size="10" fill="#cbd5e1" text-anchor="middle">Turbocharger Shaft (J = 8e-5 kg m²)</text>',
  );

  // Exhaust Tailpipe
  svgParts.push(
    '  <line x1="780" y1="480" x2="840" y2="480" stroke="#f97316" stroke-width="4" marker-end="url(#arrow)" />',
  );
  svgParts.push(
    '  <rect x="840" y="455" width="80" height="50" rx="6" fill="#1e293b" stroke="#f97316" stroke-width="2" />',
  );
  svgParts.push(
    '  <text x="880" y="485" font-family="sans-serif" font-size="11" fill="#e2e8f0" text-anchor="middle">Tailpipe</text>',
  );

  svgParts.push("</svg>");
  return svgParts.join("\n");
}

function renderPvIndicatorSvg(model: GtModel): string {
  const svg: string[] = [];
  svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" width="100%" height="100%">');
  svg.push('  <rect width="600" height="450" fill="#0b0f19" />');
  svg.push(
    `  <text x="300" y="30" font-family="sans-serif" font-size="16" font-weight="bold" fill="#f8fafc" text-anchor="middle">P-V Indicator Diagram: ${model.name}</text>`,
  );
  // Axes
  svg.push('  <line x1="80" y1="380" x2="520" y2="380" stroke="#64748b" stroke-width="2" />');
  svg.push('  <line x1="80" y1="380" x2="80" y2="60" stroke="#64748b" stroke-width="2" />');
  svg.push(
    '  <text x="520" y="405" font-family="sans-serif" font-size="12" fill="#94a3b8" text-anchor="end">Cylinder Volume V (m³)</text>',
  );
  svg.push(
    '  <text x="70" y="60" font-family="sans-serif" font-size="12" fill="#94a3b8" text-anchor="end">Pressure P (bar)</text>',
  );

  // Closed cycle curve path
  svg.push(
    '  <path d="M 480 340 C 350 330 200 300 120 230 C 115 150 125 100 140 80 C 220 160 380 280 480 340 Z" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="3" />',
  );
  svg.push('  <circle cx="140" cy="80" r="4" fill="#ef4444" />');
  svg.push('  <text x="155" y="80" font-family="sans-serif" font-size="11" fill="#ef4444">Peak P: ~85 bar</text>');

  svg.push("</svg>");
  return svg.join("\n");
}
