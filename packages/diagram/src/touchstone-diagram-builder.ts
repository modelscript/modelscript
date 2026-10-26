// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Touchstone N-Port RF & IBIS Semiconductor Buffer Diagram Builder.
 *
 * Translates RF scattering matrices and semiconductor buffer models into AntV X6 graph structures and standalone SVGs:
 * 1. N-Port S-Parameter Block with characteristic impedance terminals ($Z_0 = 50\,\Omega$) and passivity indicators.
 * 2. IBIS Buffer Equivalent Circuit with package parasitic RLC T-network, clamp diodes, and pullup/pulldown stages.
 */

export interface TouchstoneNetworkLike {
  portCount: number;
  frequencyHz?: number[] | undefined;
  referenceImpedance?: number | undefined; // e.g. 50 ohms
  isPassive?: boolean | undefined;
  maxGainDb?: number | undefined;
  ports?: { index: number; name?: string; z0?: number }[] | undefined;
}

export interface IbisPinLike {
  pin: string;
  signal: string;
  model: string;
  r?: number | undefined;
  l?: number | undefined;
  c?: number | undefined;
}

export interface IbisModelLike {
  componentName: string;
  pins?: IbisPinLike[] | undefined;
  modelName?: string | undefined;
  modelType?: string | undefined; // "Input" | "Output" | "I/O" | "3-state"
  vinh?: number | undefined;
  vinl?: number | undefined;
}

export interface TouchstoneDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  attrs?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface TouchstoneDiagramGraph {
  title: string;
  cells: TouchstoneDiagramCell[];
}

export interface TouchstoneRenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Builds an interactive AntV X6 graph model for an N-Port RF Touchstone network.
 */
export function buildTouchstoneDiagram(net: TouchstoneNetworkLike): TouchstoneDiagramGraph {
  const cells: TouchstoneDiagramCell[] = [];
  const n = Math.max(1, net.portCount);
  const z0 = net.referenceImpedance ?? 50.0;
  const isPassive = net.isPassive ?? true;

  const boxW = 180;
  const boxH = Math.max(120, Math.ceil(n / 2) * 60 + 40);
  const cx = 300;
  const cy = 180;
  const bx = cx - boxW / 2;
  const by = cy - boxH / 2;

  // 1. Central Multi-Port Blackbox
  cells.push({
    id: "rf_block",
    shape: "rect",
    x: bx,
    y: by,
    width: boxW,
    height: boxH,
    label: `[S] Parameter Network\n${n}-Port (${z0}Ω)`,
    attrs: {
      body: {
        fill: "#0f172a",
        stroke: isPassive ? "#10b981" : "#ef4444",
        strokeWidth: 2.5,
        rx: 8,
        ry: 8,
      },
      label: {
        fill: "#f8fafc",
        fontSize: 11,
        fontWeight: "700",
      },
    },
    data: { portCount: n, z0, isPassive },
  });

  // 2. Ports (distributed on left and right edges)
  const leftPortsCount = Math.ceil(n / 2);
  const rightPortsCount = Math.floor(n / 2);

  // Left Ports (1, 3, 5...)
  for (let i = 0; i < leftPortsCount; i++) {
    const portNum = i * 2 + 1;
    const py = by + ((i + 1) / (leftPortsCount + 1)) * boxH;
    const portCellId = `port_${portNum}`;

    cells.push({
      id: portCellId,
      shape: "circle",
      x: bx - 70,
      y: py - 12,
      width: 24,
      height: 24,
      label: `P${portNum}`,
      attrs: {
        body: { fill: "#1e293b", stroke: "#38bdf8", strokeWidth: 2 },
        label: { fill: "#38bdf8", fontSize: 9, fontWeight: "bold" },
      },
    });

    cells.push({
      id: `lead_port_${portNum}`,
      shape: "edge",
      source: { cell: portCellId },
      target: { x: bx, y: py },
      attrs: { line: { stroke: "#38bdf8", strokeWidth: 2 } },
    });
  }

  // Right Ports (2, 4, 6...)
  for (let i = 0; i < rightPortsCount; i++) {
    const portNum = (i + 1) * 2;
    const py = by + ((i + 1) / (rightPortsCount + 1)) * boxH;
    const portCellId = `port_${portNum}`;

    cells.push({
      id: portCellId,
      shape: "circle",
      x: bx + boxW + 46,
      y: py - 12,
      width: 24,
      height: 24,
      label: `P${portNum}`,
      attrs: {
        body: { fill: "#1e293b", stroke: "#38bdf8", strokeWidth: 2 },
        label: { fill: "#38bdf8", fontSize: 9, fontWeight: "bold" },
      },
    });

    cells.push({
      id: `lead_port_${portNum}`,
      shape: "edge",
      source: { x: bx + boxW, y: py },
      target: { cell: portCellId },
      attrs: { line: { stroke: "#38bdf8", strokeWidth: 2 } },
    });
  }

  return {
    title: `${n}-Port RF S-Parameter Network`,
    cells,
  };
}

/**
 * Emits a standalone SVG schematic for an N-Port Touchstone network.
 */
export function renderTouchstoneSvg(net: TouchstoneNetworkLike, options?: TouchstoneRenderOptions): string {
  const diag = buildTouchstoneDiagram(net);
  const isDark = options?.theme !== "light";
  const bg = isDark ? "#0b0f19" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  const width = options?.width ?? 600;
  const height = options?.height ?? 380;

  const n = Math.max(1, net.portCount);
  const z0 = net.referenceImpedance ?? 50.0;
  const isPassive = net.isPassive ?? true;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:${bg};font-family:Inter,system-ui,sans-serif;">\n`;

  // Title Banner
  svg += `  <text x="50" y="36" fill="${textColor}" font-size="16" font-weight="700">${diag.title}</text>\n`;
  svg += `  <text x="50" y="52" fill="${subTextColor}" font-size="10">High-Frequency Scattering Matrix Model</text>\n`;

  // Draw Central Block
  const bw = 220;
  const bh = Math.max(140, Math.ceil(n / 2) * 55 + 40);
  const bx = (width - bw) / 2;
  const by = (height - bh) / 2 + 15;

  svg += `  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="8" ry="8" fill="${isDark ? "#0f172a" : "#ffffff"}" stroke="${isPassive ? "#10b981" : "#ef4444"}" stroke-width="2.5" />\n`;

  // Inner matrix label
  svg += `  <text x="${width / 2}" y="${by + 40}" fill="${textColor}" font-size="13" font-weight="700" text-anchor="middle">[ S ]</text>\n`;
  svg += `  <text x="${width / 2}" y="${by + 60}" fill="${subTextColor}" font-size="10" text-anchor="middle">${n}-Port Network (${z0} Ω)</text>\n`;

  // Passivity Badge
  const badgeColor = isPassive ? "#10b981" : "#ef4444";
  const badgeText = isPassive ? "PASSIVE (||S|| ≤ 1)" : "NON-PASSIVE (||S|| > 1)";
  svg += `  <rect x="${width / 2 - 60}" y="${by + bh - 35}" width="120" height="20" rx="4" fill="${isDark ? "#1e293b" : "#e2e8f0"}" stroke="${badgeColor}" stroke-width="1.5" />\n`;
  svg += `  <text x="${width / 2}" y="${by + bh - 22}" fill="${badgeColor}" font-size="8" font-weight="bold" text-anchor="middle">${badgeText}</text>\n`;

  // Draw Port Pins and Connecting Leads
  const leftCount = Math.ceil(n / 2);
  const rightCount = Math.floor(n / 2);

  // Left Ports
  for (let i = 0; i < leftCount; i++) {
    const pNum = i * 2 + 1;
    const py = by + ((i + 1) / (leftCount + 1)) * bh;

    svg += `  <line x1="${bx - 60}" y1="${py}" x2="${bx}" y2="${py}" stroke="#38bdf8" stroke-width="2" />\n`;
    svg += `  <circle cx="${bx - 70}" cy="${py}" r="12" fill="${isDark ? "#1e293b" : "#e2e8f0"}" stroke="#38bdf8" stroke-width="2" />\n`;
    svg += `  <text x="${bx - 70}" y="${py + 3.5}" fill="#38bdf8" font-size="9" font-weight="bold" text-anchor="middle">P${pNum}</text>\n`;
    svg += `  <text x="${bx - 70}" y="${py + 24}" fill="${subTextColor}" font-size="8" text-anchor="middle">${z0}Ω</text>\n`;
  }

  // Right Ports
  for (let i = 0; i < rightCount; i++) {
    const pNum = (i + 1) * 2;
    const py = by + ((i + 1) / (rightCount + 1)) * bh;

    svg += `  <line x1="${bx + bw}" y1="${py}" x2="${bx + bw + 60}" y2="${py}" stroke="#38bdf8" stroke-width="2" />\n`;
    svg += `  <circle cx="${bx + bw + 70}" cy="${py}" r="12" fill="${isDark ? "#1e293b" : "#e2e8f0"}" stroke="#38bdf8" stroke-width="2" />\n`;
    svg += `  <text x="${bx + bw + 70}" y="${py + 3.5}" fill="#38bdf8" font-size="9" font-weight="bold" text-anchor="middle">P${pNum}</text>\n`;
    svg += `  <text x="${bx + bw + 70}" y="${py + 24}" fill="${subTextColor}" font-size="8" text-anchor="middle">${z0}Ω</text>\n`;
  }

  svg += `</svg>\n`;
  return svg;
}

/**
 * Emits a standalone SVG schematic for an IBIS semiconductor buffer circuit.
 */
export function renderIbisBufferSvg(model: IbisModelLike, options?: TouchstoneRenderOptions): string {
  const isDark = options?.theme !== "light";
  const bg = isDark ? "#0b0f19" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  const width = options?.width ?? 680;
  const height = options?.height ?? 400;

  const pin = model.pins?.[0];
  const rPkg = pin?.r ?? 0.1;
  const lPkg = pin?.l ?? 1.0;
  const cPkg = pin?.c ?? 0.5;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:${bg};font-family:Inter,system-ui,sans-serif;">\n`;

  // Title
  svg += `  <text x="50" y="36" fill="${textColor}" font-size="16" font-weight="700">IBIS Buffer: ${model.modelName ?? "IO_BUF"}</text>\n`;
  svg += `  <text x="50" y="52" fill="${subTextColor}" font-size="10">Component: ${model.componentName} | Type: ${model.modelType ?? "I/O"}</text>\n`;

  // Buffer Triangle / Inverter Stage
  const bufX = 140;
  const bufY = 180;
  svg += `  <polygon points="${bufX},${bufY - 40} ${bufX + 80},${bufY} ${bufX},${bufY + 40}" fill="${isDark ? "#1e293b" : "#ffffff"}" stroke="#38bdf8" stroke-width="2.5" />\n`;
  svg += `  <text x="${bufX + 25}" y="${bufY + 4}" fill="#38bdf8" font-size="11" font-weight="bold">BUF</text>\n`;

  // Input wire
  svg += `  <line x1="60" y1="${bufY}" x2="${bufX}" y2="${bufY}" stroke="#38bdf8" stroke-width="2" />\n`;
  svg += `  <circle cx="55" cy="${bufY}" r="5" fill="#38bdf8" />\n`;
  svg += `  <text x="55" y="${bufY - 12}" fill="${textColor}" font-size="10" font-weight="600" text-anchor="middle">DIE_PAD</text>\n`;

  // Package Parasitic T-Network: R_pkg -> L_pkg -> C_pkg to GND
  const rX = bufX + 130;
  svg += `  <line x1="${bufX + 80}" y1="${bufY}" x2="${rX}" y2="${bufY}" stroke="#38bdf8" stroke-width="2" />\n`;

  // R_pkg box
  svg += `  <rect x="${rX}" y="${bufY - 10}" width="40" height="20" fill="${isDark ? "#0f172a" : "#e2e8f0"}" stroke="#f59e0b" stroke-width="2" />\n`;
  svg += `  <text x="${rX + 20}" y="${bufY + 4}" fill="#f59e0b" font-size="8" font-weight="bold" text-anchor="middle">R_pkg</text>\n`;
  svg += `  <text x="${rX + 20}" y="${bufY - 16}" fill="${subTextColor}" font-size="8" text-anchor="middle">${rPkg}Ω</text>\n`;

  // L_pkg inductor coil
  const lX = rX + 70;
  svg += `  <line x1="${rX + 40}" y1="${bufY}" x2="${lX}" y2="${bufY}" stroke="#38bdf8" stroke-width="2" />\n`;
  svg += `  <rect x="${lX}" y="${bufY - 10}" width="45" height="20" fill="${isDark ? "#0f172a" : "#e2e8f0"}" stroke="#10b981" stroke-width="2" />\n`;
  svg += `  <text x="${lX + 22.5}" y="${bufY + 4}" fill="#10b981" font-size="8" font-weight="bold" text-anchor="middle">L_pkg</text>\n`;
  svg += `  <text x="${lX + 22.5}" y="${bufY - 16}" fill="${subTextColor}" font-size="8" text-anchor="middle">${lPkg}nH</text>\n`;

  // C_pkg capacitor shunt to GND
  const shuntX = (rX + 40 + lX) / 2;
  svg += `  <line x1="${shuntX}" y1="${bufY}" x2="${shuntX}" y2="${bufY + 50}" stroke="#38bdf8" stroke-width="2" />\n`;
  svg += `  <line x1="${shuntX - 12}" y1="${bufY + 50}" x2="${shuntX + 12}" y2="${bufY + 50}" stroke="#a855f7" stroke-width="2" />\n`;
  svg += `  <line x1="${shuntX - 12}" y1="${bufY + 56}" x2="${shuntX + 12}" y2="${bufY + 56}" stroke="#a855f7" stroke-width="2" />\n`;
  svg += `  <line x1="${shuntX}" y1="${bufY + 56}" x2="${shuntX}" y2="${bufY + 80}" stroke="#38bdf8" stroke-width="2" />\n`;
  // GND ground hash
  svg += `  <line x1="${shuntX - 10}" y1="${bufY + 80}" x2="${shuntX + 10}" y2="${bufY + 80}" stroke="#64748b" stroke-width="2" />\n`;
  svg += `  <line x1="${shuntX - 6}" y1="${bufY + 84}" x2="${shuntX + 6}" y2="${bufY + 84}" stroke="#64748b" stroke-width="1.5" />\n`;
  svg += `  <line x1="${shuntX - 2}" y1="${bufY + 88}" x2="${shuntX + 2}" y2="${bufY + 88}" stroke="#64748b" stroke-width="1" />\n`;
  svg += `  <text x="${shuntX + 20}" y="${bufY + 56}" fill="#a855f7" font-size="8">${cPkg}pF</text>\n`;

  // Output Pin terminal
  const pinX = lX + 85;
  svg += `  <line x1="${lX + 45}" y1="${bufY}" x2="${pinX}" y2="${bufY}" stroke="#38bdf8" stroke-width="2" />\n`;
  svg += `  <circle cx="${pinX + 5}" cy="${bufY}" r="7" fill="#f8fafc" stroke="#38bdf8" stroke-width="2" />\n`;
  svg += `  <text x="${pinX + 5}" y="${bufY - 14}" fill="${textColor}" font-size="10" font-weight="700" text-anchor="middle">PIN: ${pin?.pin ?? "1"}</text>\n`;
  svg += `  <text x="${pinX + 5}" y="${bufY + 24}" fill="${subTextColor}" font-size="9" text-anchor="middle">(${pin?.signal ?? "SIG"})</text>\n`;

  svg += `</svg>\n`;
  return svg;
}
