// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Verilog-A / Verilog-AMS Compact Device & Companion Branch Diagram Builder.
 *
 * Translates IEEE 1857 / Accellera Verilog-A (`.va`) and Verilog-AMS (`.vams`) compact semiconductor
 * and multiphysics behavioral models into:
 * 1. Interactive AntV X6 graph structures with discipline terminal ports (`electrical`, `thermal`,
 *    `magnetic`, `rotational`), internal nodes, constitutive branch contributions (`<+`), and parameter HUDs.
 * 2. Standalone IEEE/IEC-style vector SVG schematics showing external pinouts, internal equivalent
 *    companion networks (`ddt(Q)` dynamic charge branches, controlled current/potential branches,
 *    electro-thermal `Pwr(tj)` self-heating paths), and parameter tables.
 */

import {
  capacitorGlyph,
  currentSourceGlyph,
  groundGlyph,
  markupToSvg,
  resistorGlyph,
  voltageSourceGlyph,
} from "./glyphs.js";
import { computeSolderDots, type EdgePath } from "./solder-dots.js";

export interface VerilogAPortLike {
  name: string;
  direction?: "inout" | "input" | "output" | string | undefined;
  discipline?: string | undefined;
}

export interface VerilogADisciplineDeclLike {
  discipline: string;
  nodes: string[];
}

export interface VerilogAParameterRangeLike {
  min?: number | undefined;
  max?: number | undefined;
  minInclusive?: boolean | undefined;
  maxInclusive?: boolean | undefined;
}

export interface VerilogAParameterLike {
  name: string;
  type?: "real" | "integer" | "string" | string | undefined;
  defaultValue: number | string;
  rangeSpec?: VerilogAParameterRangeLike | undefined;
  description?: string | undefined;
}

export interface VerilogAVariableLike {
  name: string;
  type?: "real" | "integer" | string | undefined;
  initialValue?: number | undefined;
}

export interface VerilogABranchAccessLike {
  nature: string;
  node1: string;
  node2?: string | undefined;
}

export interface VerilogAExprLike {
  kind: string;
  value?: number | undefined;
  raw?: string | undefined;
  name?: string | undefined;
  nature?: string | undefined;
  node1?: string | undefined;
  node2?: string | undefined;
  op?: string | undefined;
  left?: VerilogAExprLike | undefined;
  right?: VerilogAExprLike | undefined;
  argument?: VerilogAExprLike | undefined;
  func?: string | undefined;
  args?: VerilogAExprLike[] | undefined;
}

export interface VerilogAStatementLike {
  kind: string;
  lhs?: VerilogABranchAccessLike | undefined;
  rhs?: VerilogAExprLike | undefined;
  variable?: string | undefined;
  condition?: VerilogAExprLike | undefined;
  thenBranch?: VerilogAStatementLike[] | undefined;
  elseBranch?: VerilogAStatementLike[] | undefined;
  statements?: VerilogAStatementLike[] | undefined;
}

export interface VerilogABranchSummary {
  id: string;
  nature: string;
  node1: string;
  node2: string;
  expression: string;
  category: "capacitive" | "resistive" | "current" | "potential" | "thermal" | "magnetic";
  hasDdt: boolean;
  hasIdt: boolean;
}

export interface VerilogAModuleLike {
  name: string;
  ports?: VerilogAPortLike[] | undefined;
  disciplines?: VerilogADisciplineDeclLike[] | undefined;
  parameters?: VerilogAParameterLike[] | undefined;
  variables?: VerilogAVariableLike[] | undefined;
  internalNodes?: string[] | undefined;
  analogBlock?: { statements: VerilogAStatementLike[] } | undefined;
  branches?: VerilogABranchSummary[] | undefined;
}

export interface VerilogADocumentLike {
  uri?: string | undefined;
  modules: VerilogAModuleLike[];
  includes?: string[] | undefined;
}

export interface VerilogADiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  target?: { cell: string; port?: string | undefined } | { x: number; y: number } | undefined;
  vertices?: { x: number; y: number }[] | undefined;
  attrs?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface VerilogADiagramGraph {
  title: string;
  cells: VerilogADiagramCell[];
  nodes: VerilogADiagramCell[];
  edges: VerilogADiagramCell[];
  metadata: {
    moduleName: string;
    portCount: number;
    internalNodeCount: number;
    branchCount: number;
    parameterCount: number;
    variableCount: number;
    disciplines: string[];
  };
}

export interface VerilogARenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
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
 * Formats a Verilog-A expression AST node into a concise mathematical string.
 */
export function formatVerilogAExpr(expr: VerilogAExprLike | undefined): string {
  if (!expr) return "";
  switch (expr.kind) {
    case "number":
      return expr.raw ?? String(expr.value ?? 0);
    case "identifier":
      return expr.name ?? "";
    case "branch_access": {
      const n2Part = expr.node2 ? `, ${expr.node2}` : "";
      return `${expr.nature ?? "V"}(${expr.node1 ?? ""}${n2Part})`;
    }
    case "unary":
      return `${expr.op ?? ""}${formatVerilogAExpr(expr.argument)}`;
    case "binary": {
      const l = formatVerilogAExpr(expr.left);
      const r = formatVerilogAExpr(expr.right);
      return `${l} ${expr.op ?? "+"} ${r}`;
    }
    case "call": {
      const args = (expr.args ?? []).map((a) => formatVerilogAExpr(a)).join(", ");
      return `${expr.func ?? "fn"}(${args})`;
    }
    default:
      return "";
  }
}

function exprContainsCall(expr: VerilogAExprLike | undefined, funcName: string): boolean {
  if (!expr) return false;
  if (expr.kind === "call" && expr.func?.toLowerCase() === funcName.toLowerCase()) {
    return true;
  }
  if (expr.kind === "unary") return exprContainsCall(expr.argument, funcName);
  if (expr.kind === "binary") {
    return exprContainsCall(expr.left, funcName) || exprContainsCall(expr.right, funcName);
  }
  if (expr.kind === "call" && expr.args) {
    return expr.args.some((a) => exprContainsCall(a, funcName));
  }
  return false;
}

function exprContainsBranchNature(expr: VerilogAExprLike | undefined, nature: string): boolean {
  if (!expr) return false;
  if (expr.kind === "branch_access" && expr.nature === nature) return true;
  if (expr.kind === "unary") return exprContainsBranchNature(expr.argument, nature);
  if (expr.kind === "binary") {
    return exprContainsBranchNature(expr.left, nature) || exprContainsBranchNature(expr.right, nature);
  }
  if (expr.kind === "call" && expr.args) {
    return expr.args.some((a) => exprContainsBranchNature(a, nature));
  }
  return false;
}

/**
 * Extracts all analog branch contributions (`<+`) recursively from a Verilog-A module.
 */
export function extractVerilogABranches(mod: VerilogAModuleLike): VerilogABranchSummary[] {
  if (mod.branches && mod.branches.length > 0) {
    return mod.branches;
  }

  const disciplineByNode = new Map<string, string>();
  for (const p of mod.ports ?? []) {
    if (p.discipline) disciplineByNode.set(p.name, p.discipline.toLowerCase());
  }
  for (const d of mod.disciplines ?? []) {
    for (const n of d.nodes) {
      disciplineByNode.set(n, d.discipline.toLowerCase());
    }
  }

  const results: VerilogABranchSummary[] = [];
  let branchIdx = 1;

  const visitStmts = (stmts: VerilogAStatementLike[] | undefined) => {
    if (!stmts) return;
    for (const s of stmts) {
      if (s.kind === "contribution" && s.lhs) {
        const nature = s.lhs.nature;
        const node1 = s.lhs.node1;
        const node2 = s.lhs.node2 ?? "gnd";
        const exprStr = formatVerilogAExpr(s.rhs);
        const hasDdt = exprContainsCall(s.rhs, "ddt");
        const hasIdt = exprContainsCall(s.rhs, "idt");
        const n1Disc = disciplineByNode.get(node1) ?? "electrical";

        let category: VerilogABranchSummary["category"] = "current";
        if (nature === "Pwr" || nature === "Temp" || n1Disc === "thermal") {
          category = "thermal";
        } else if (nature === "Phi" || nature === "MMF" || n1Disc === "magnetic") {
          category = "magnetic";
        } else if (hasDdt) {
          category = "capacitive";
        } else if (
          (nature === "V" || nature === "Potential") &&
          (exprContainsBranchNature(s.rhs, "I") || /(?:\bR|\br0|\bres)/i.test(exprStr))
        ) {
          category = "resistive";
        } else if (nature === "V" || nature === "Potential") {
          category = "potential";
        } else {
          category = "current";
        }

        results.push({
          id: `branch_${branchIdx++}_${node1}_${node2}`,
          nature,
          node1,
          node2,
          expression: exprStr,
          category,
          hasDdt,
          hasIdt,
        });
      } else if (s.kind === "if") {
        visitStmts(s.thenBranch);
        visitStmts(s.elseBranch);
      } else if (s.kind === "block") {
        visitStmts(s.statements);
      }
    }
  };

  visitStmts(mod.analogBlock?.statements);
  return results;
}

function getBranchStyle(category: VerilogABranchSummary["category"]): {
  badge: string;
  symbol: string;
  color: string;
} {
  switch (category) {
    case "capacitive":
      return { badge: "ddt(Q)", symbol: "─││─", color: "#818cf8" };
    case "resistive":
      return { badge: "OHMIC", symbol: "─╱╲╱╲─", color: "#38bdf8" };
    case "potential":
      return { badge: "V-BRANCH", symbol: "⊝ V ⊕", color: "#eab308" };
    case "thermal":
      return { badge: "THERMAL", symbol: "🔥 Pwr", color: "#f97316" };
    case "magnetic":
      return { badge: "MAGNETIC", symbol: "─ᴖᴖᴖ─", color: "#a855f7" };
    case "current":
    default:
      return { badge: "I-BRANCH", symbol: "─⟨I⟩→", color: "#10b981" };
  }
}

function getDisciplineColor(discipline: string): string {
  const lower = discipline.toLowerCase();
  if (lower.includes("therm")) return "#f97316";
  if (lower.includes("mag")) return "#a855f7";
  if (lower.includes("rot") || lower.includes("kin") || lower.includes("mech")) return "#10b981";
  return "#38bdf8";
}

function resolvePrimaryModule(docOrMod: VerilogADocumentLike | VerilogAModuleLike): VerilogAModuleLike {
  if ("modules" in docOrMod && Array.isArray(docOrMod.modules)) {
    return (
      docOrMod.modules[0] ?? {
        name: "verilog_a_device",
        ports: [],
        disciplines: [],
        parameters: [],
        variables: [],
        internalNodes: [],
      }
    );
  }
  return docOrMod as VerilogAModuleLike;
}

/**
 * Builds an interactive AntV X6 diagram graph for a Verilog-A / Verilog-AMS module.
 */
export function buildVerilogADiagram(docOrMod: VerilogADocumentLike | VerilogAModuleLike): VerilogADiagramGraph {
  const mod = resolvePrimaryModule(docOrMod);
  const title = mod.name?.trim() || "Verilog-A Compact Device";
  const cells: VerilogADiagramCell[] = [];

  const disciplineByNode = new Map<string, string>();
  const disciplineSet = new Set<string>();
  for (const d of mod.disciplines ?? []) {
    disciplineSet.add(d.discipline);
    for (const n of d.nodes) {
      disciplineByNode.set(n, d.discipline);
    }
  }

  const ports: VerilogAPortLike[] = (mod.ports ?? []).map((p) => {
    const disc = p.discipline ?? disciplineByNode.get(p.name) ?? "electrical";
    disciplineSet.add(disc);
    disciplineByNode.set(p.name, disc);
    return {
      name: p.name,
      direction: p.direction ?? "inout",
      discipline: disc,
    };
  });

  const portNames = new Set(ports.map((p) => p.name));
  const internalNodes: string[] = [];
  for (const n of mod.internalNodes ?? []) {
    if (!portNames.has(n) && !internalNodes.includes(n)) {
      internalNodes.push(n);
    }
  }
  for (const d of mod.disciplines ?? []) {
    for (const n of d.nodes) {
      if (!portNames.has(n) && !internalNodes.includes(n)) {
        internalNodes.push(n);
      }
    }
  }

  const branches = extractVerilogABranches(mod);
  const needsGnd = branches.some((b) => b.node2 === "gnd" || b.node1 === "gnd");

  // 1. Place External Terminal Port Nodes (Left & Right columns)
  const nodePositions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const leftPortCount = Math.ceil(ports.length / 2);

  ports.forEach((p, idx) => {
    const isLeft = idx < leftPortCount;
    const row = isLeft ? idx : idx - leftPortCount;
    const x = isLeft ? 70 : 680;
    const y = 100 + row * 125;
    const width = 120;
    const height = 54;
    const disc = p.discipline ?? "electrical";
    const color = getDisciplineColor(disc);

    nodePositions.set(p.name, { x, y, width, height });
    cells.push({
      id: `port_${p.name}`,
      shape: "rect",
      x,
      y,
      width,
      height,
      label: `${p.name}\n«${disc} ${p.direction ?? "inout"}»`,
      attrs: {
        body: {
          fill: "#0f172a",
          stroke: color,
          strokeWidth: 2,
          rx: 6,
          ry: 6,
        },
        label: {
          fill: "#f8fafc",
          fontSize: 11,
          fontFamily: "JetBrains Mono, Menlo, monospace",
        },
      },
      data: {
        kind: "terminal_port",
        name: p.name,
        discipline: disc,
        direction: p.direction ?? "inout",
        badge: disc.toUpperCase().slice(0, 4),
        color,
      },
    });
  });

  // 2. Place Internal Discipline Nodes (Top row inside device)
  internalNodes.forEach((nName, idx) => {
    const x = 260 + idx * 160;
    const y = 60;
    const width = 110;
    const height = 46;
    const disc = disciplineByNode.get(nName) ?? "electrical";
    const color = getDisciplineColor(disc);

    nodePositions.set(nName, { x, y, width, height });
    cells.push({
      id: `port_${nName}`,
      shape: "rect",
      x,
      y,
      width,
      height,
      label: `${nName}\n«internal ${disc}»`,
      attrs: {
        body: {
          fill: "#1e293b",
          stroke: color,
          strokeWidth: 1.5,
          strokeDasharray: "4,3",
          rx: 6,
          ry: 6,
        },
        label: {
          fill: "#e2e8f0",
          fontSize: 10,
          fontFamily: "JetBrains Mono, Menlo, monospace",
        },
      },
      data: {
        kind: "internal_node",
        name: nName,
        discipline: disc,
        badge: "INT",
        color,
      },
    });
  });

  // 3. Place Constitutive Analog Branch Elements (Center column)
  const maxBranchBottom = Math.max(260, 100 + branches.length * 105);
  branches.forEach((br, idx) => {
    const x = 325;
    const y = 100 + idx * 105;
    const width = 200;
    const height = 74;
    const { badge, symbol, color } = getBranchStyle(br.category);
    const lhsLabel = br.node2 === "gnd" ? `${br.nature}(${br.node1})` : `${br.nature}(${br.node1}, ${br.node2})`;
    const shortExpr = br.expression.length > 34 ? `${br.expression.slice(0, 31)}...` : br.expression;

    cells.push({
      id: br.id,
      shape: "rect",
      x,
      y,
      width,
      height,
      label: `${lhsLabel} <+\n${shortExpr}`,
      attrs: {
        body: {
          fill: "#111827",
          stroke: color,
          strokeWidth: 2,
          rx: 6,
          ry: 6,
        },
        label: {
          fill: "#f9fafb",
          fontSize: 10,
          fontFamily: "JetBrains Mono, Menlo, monospace",
        },
      },
      data: {
        kind: "analog_branch",
        name: lhsLabel,
        nature: br.nature,
        node1: br.node1,
        node2: br.node2,
        expression: br.expression,
        category: br.category,
        hasDdt: br.hasDdt,
        hasIdt: br.hasIdt,
        badge,
        symbol,
        color,
      },
    });
  });

  // 4. Optional Reference Ground Node (if single-ended branches exist)
  if (needsGnd && !nodePositions.has("gnd")) {
    const x = 680;
    const y = maxBranchBottom - 40;
    const width = 110;
    const height = 46;
    nodePositions.set("gnd", { x, y, width, height });
    cells.push({
      id: "port_gnd",
      shape: "rect",
      x,
      y,
      width,
      height,
      label: "gnd (0)\n«reference»",
      attrs: {
        body: {
          fill: "#0f172a",
          stroke: "#10b981",
          strokeWidth: 1.8,
          rx: 6,
          ry: 6,
        },
        label: {
          fill: "#a7f3d0",
          fontSize: 10,
          fontFamily: "JetBrains Mono, Menlo, monospace",
        },
      },
      data: {
        kind: "ground_node",
        name: "gnd",
        discipline: "reference",
        badge: "GND",
        color: "#10b981",
      },
    });
  }

  // 5. Connect Terminal/Internal Nodes to Analog Branches
  let wireIdx = 1;
  for (const br of branches) {
    const { color } = getBranchStyle(br.category);
    const n1Cell = `port_${br.node1}`;
    const n2Cell = `port_${br.node2}`;

    if (nodePositions.has(br.node1)) {
      cells.push({
        id: `wire_${wireIdx++}`,
        shape: "edge",
        source: { cell: n1Cell, port: "out" },
        target: { cell: br.id, port: "p" },
        label: `+ (${br.node1})`,
        attrs: {
          line: {
            stroke: color,
            strokeWidth: 1.8,
          },
        },
        data: {
          net: br.node1,
          polarity: "+",
          color,
        },
      });
    }

    if (nodePositions.has(br.node2)) {
      cells.push({
        id: `wire_${wireIdx++}`,
        shape: "edge",
        source: { cell: br.id, port: "n" },
        target: { cell: n2Cell, port: "in" },
        label: `- (${br.node2})`,
        attrs: {
          line: {
            stroke: br.node2 === "gnd" ? "#10b981" : "#64748b",
            strokeWidth: 1.6,
            strokeDasharray: br.node2 === "gnd" ? "4,3" : undefined,
          },
        },
        data: {
          net: br.node2,
          polarity: "-",
          isGround: br.node2 === "gnd",
        },
      });
    }
  }

  const nodes = cells.filter((c) => c.shape !== "edge");
  const edges = cells.filter((c) => c.shape === "edge");

  return {
    title,
    cells,
    nodes,
    edges,
    metadata: {
      moduleName: title,
      portCount: ports.length,
      internalNodeCount: internalNodes.length,
      branchCount: branches.length,
      parameterCount: (mod.parameters ?? []).length,
      variableCount: (mod.variables ?? []).length,
      disciplines: Array.from(disciplineSet),
    },
  };
}

/**
 * Renders a Verilog-A / Verilog-AMS module into a standalone vector SVG compact device schematic.
 */
export function renderVerilogASvg(
  docOrMod: VerilogADocumentLike | VerilogAModuleLike,
  options?: VerilogARenderOptions,
): string {
  const mod = resolvePrimaryModule(docOrMod);
  const diag = buildVerilogADiagram(mod);
  const isLight = options?.theme === "light";

  const bg = isLight ? "#f8fafc" : "#0b0f19";
  const panelBg = isLight ? "#ffffff" : "#111827";
  const cardBg = isLight ? "#f1f5f9" : "#0f172a";
  const fg = isLight ? "#0f172a" : "#f8fafc";
  const mutedFg = isLight ? "#475569" : "#94a3b8";
  const borderCol = isLight ? "#cbd5e1" : "#1e293b";

  let minX = 40;
  let minY = 40;
  let maxX = 840;
  let maxY = 380;

  for (const cell of diag.nodes) {
    if (cell.x !== undefined && cell.y !== undefined) {
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x + (cell.width ?? 120));
      maxY = Math.max(maxY, cell.y + (cell.height ?? 60));
    }
  }

  const params = mod.parameters ?? [];
  const vars = mod.variables ?? [];
  const hudRows = Math.min(8, Math.max(params.length, 1));
  const hudHeight = params.length > 0 || vars.length > 0 ? 52 + hudRows * 18 : 0;

  const padding = 48;
  const width = options?.width ?? Math.max(880, maxX - minX + padding * 2);
  const height = options?.height ?? Math.max(460, maxY - minY + padding * 2 + hudHeight + 24);
  const viewBox = `0 0 ${width} ${height}`;

  const nodeMap = new Map<string, VerilogADiagramCell>();
  for (const cell of diag.nodes) {
    nodeMap.set(cell.id, cell);
  }

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" style="background-color: ${bg}; font-family: 'JetBrains Mono', Menlo, ui-monospace, monospace;">\n`;
  svg += `  <defs>\n`;
  svg += `    <filter id="va-glow" x="-20%" y="-20%" width="140%" height="140%">\n`;
  svg += `      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#38bdf8" flood-opacity="0.18" />\n`;
  svg += `    </filter>\n`;
  svg += `  </defs>\n\n`;

  // Header Banner
  const discSummary = diag.metadata.disciplines.join(" · ") || "electrical";
  svg += `  <text x="48" y="34" fill="${fg}" font-size="15" font-weight="700">${escapeXml(diag.title)} — IEEE 1857 Verilog-A Compact Device Schematic</text>\n`;
  svg += `  <text x="48" y="52" fill="${mutedFg}" font-size="11">Disciplines: ${escapeXml(discSummary)} | Ports: ${diag.metadata.portCount} | Branches (&lt;+): ${diag.metadata.branchCount} | Parameters: ${diag.metadata.parameterCount}</text>\n\n`;

  // Module Semiconductor Package Boundary Box
  const pkgX = 215;
  const pkgY = 72;
  const pkgW = 420;
  const pkgH = Math.max(220, maxY - 45);
  svg += `  <rect x="${pkgX}" y="${pkgY}" width="${pkgW}" height="${pkgH}" rx="10" fill="${cardBg}" fill-opacity="0.55" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="6,4" />\n`;
  svg += `  <text x="${pkgX + 14}" y="${pkgY + 20}" fill="#38bdf8" font-size="10" font-weight="700">analog begin ... end (${escapeXml(diag.title)})</text>\n\n`;

  // Collect port attachment points for solder-dot calculation
  const portPoints: { x: number; y: number }[] = [];
  for (const cell of diag.nodes) {
    if (cell.x !== undefined && cell.y !== undefined) {
      const w = cell.width ?? 120;
      const h = cell.height ?? 54;
      portPoints.push({ x: cell.x, y: cell.y + h / 2 });
      portPoints.push({ x: cell.x + w, y: cell.y + h / 2 });
    }
  }

  // Build Orthogonal Net Wires
  const edgePaths: EdgePath[] = [];
  const edgeRenderData: { id: string; pathD: string; stroke: string; dashed: boolean }[] = [];

  for (const edge of diag.edges) {
    const srcId = typeof edge.source === "object" && edge.source && "cell" in edge.source ? edge.source.cell : null;
    const tgtId = typeof edge.target === "object" && edge.target && "cell" in edge.target ? edge.target.cell : null;
    if (!srcId || !tgtId) continue;

    const srcNode = nodeMap.get(srcId);
    const tgtNode = nodeMap.get(tgtId);
    if (!srcNode || !tgtNode) continue;

    const srcW = srcNode.width ?? 120;
    const srcH = srcNode.height ?? 54;
    const tgtW = tgtNode.width ?? 120;
    const tgtH = tgtNode.height ?? 54;

    const srcCx = (srcNode.x ?? 0) + srcW / 2;
    const tgtCx = (tgtNode.x ?? 0) + tgtW / 2;

    const x1 = srcCx <= tgtCx ? (srcNode.x ?? 0) + srcW : (srcNode.x ?? 0);
    const y1 = (srcNode.y ?? 0) + srcH / 2;
    const x2 = srcCx <= tgtCx ? (tgtNode.x ?? 0) : (tgtNode.x ?? 0) + tgtW;
    const y2 = (tgtNode.y ?? 0) + tgtH / 2;

    const midX = Math.round((x1 + x2) / 2);
    const pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
    const stroke = (edge.data?.["color"] as string | undefined) ?? (edge.data?.["isGround"] ? "#10b981" : "#64748b");
    const dashed = Boolean(edge.data?.["isGround"]);

    edgeRenderData.push({ id: edge.id, pathD, stroke, dashed });
    edgePaths.push({
      id: edge.id,
      points: [
        { x: x1, y: y1 },
        { x: midX, y: y1 },
        { x: midX, y: y2 },
        { x: x2, y: y2 },
      ],
      color: stroke,
      netId: (edge.data?.["net"] as string | undefined) ?? undefined,
    });
  }

  svg += `  <g id="va-wires-layer">\n`;
  for (const e of edgeRenderData) {
    const dashAttr = e.dashed ? ` stroke-dasharray="4,3"` : "";
    svg += `    <path id="${escapeXml(e.id)}" d="${e.pathD}" fill="none" stroke="${e.stroke}" stroke-width="1.8"${dashAttr} opacity="0.88" />\n`;
  }
  const solderDots = computeSolderDots(edgePaths, { portPoints, cellSize: 20, tolerance: 3 });
  for (const dot of solderDots) {
    svg += `    <circle cx="${dot.x}" cy="${dot.y}" r="3" fill="${dot.color}" />\n`;
  }
  svg += `  </g>\n\n`;

  // Render Terminal Ports, Internal Nodes, and Branch Elements
  svg += `  <g id="va-nodes-layer">\n`;
  for (const cell of diag.nodes) {
    const x = cell.x ?? 0;
    const y = cell.y ?? 0;
    const w = cell.width ?? 120;
    const h = cell.height ?? 54;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const kind = (cell.data?.["kind"] as string | undefined) ?? "terminal_port";
    const name = (cell.data?.["name"] as string | undefined) ?? cell.id;
    const badge = (cell.data?.["badge"] as string | undefined) ?? "PORT";
    const color = (cell.data?.["color"] as string | undefined) ?? "#38bdf8";

    if (kind === "analog_branch") {
      const category = (cell.data?.["category"] as VerilogABranchSummary["category"] | undefined) ?? "current";
      const expr = (cell.data?.["expression"] as string | undefined) ?? "";
      const shortExpr = expr.length > 28 ? `${expr.slice(0, 25)}...` : expr;

      let glyphSvg = "";
      if (category === "capacitive") {
        glyphSvg = markupToSvg(capacitorGlyph({ stroke: color }));
      } else if (category === "resistive") {
        glyphSvg = markupToSvg(resistorGlyph({ stroke: color }));
      } else if (category === "potential") {
        glyphSvg = markupToSvg(voltageSourceGlyph({ stroke: color }));
      } else {
        glyphSvg = markupToSvg(currentSourceGlyph({ stroke: color }));
      }

      svg += `    <g id="${escapeXml(cell.id)}" filter="url(#va-glow)">\n`;
      svg += `      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${panelBg}" stroke="${color}" stroke-width="1.8" />\n`;
      svg += `      <rect x="${x + 6}" y="${y + 6}" width="48" height="14" rx="3" fill="${color}" fill-opacity="0.2" />\n`;
      svg += `      <text x="${x + 30}" y="${y + 16}" fill="${color}" font-size="8.5" font-weight="700" text-anchor="middle">${escapeXml(badge)}</text>\n`;
      svg += `      <text x="${cx + 16}" y="${y + 17}" fill="${fg}" font-size="10.5" font-weight="700" text-anchor="middle">${escapeXml(name)} &lt;+</text>\n`;
      if (glyphSvg) {
        svg += `      <g transform="translate(${x + 28}, ${cy - 18}) scale(0.48)">\n        ${glyphSvg}\n      </g>\n`;
      }
      svg += `      <text x="${cx + 12}" y="${y + h - 12}" fill="${mutedFg}" font-size="9.5" text-anchor="middle">${escapeXml(shortExpr)}</text>\n`;
      svg += `      <circle cx="${x}" cy="${cy}" r="3" fill="${color}" />\n`;
      svg += `      <circle cx="${x + w}" cy="${cy}" r="3" fill="${color}" />\n`;
      svg += `    </g>\n`;
    } else {
      const disc = (cell.data?.["discipline"] as string | undefined) ?? "electrical";
      const dir = (cell.data?.["direction"] as string | undefined) ?? "";
      const isGnd = kind === "ground_node";
      const gndGlyph = isGnd ? markupToSvg(groundGlyph({ stroke: color })) : "";

      svg += `    <g id="${escapeXml(cell.id)}" filter="url(#va-glow)">\n`;
      svg += `      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${panelBg}" stroke="${color}" stroke-width="1.8" />\n`;
      svg += `      <rect x="${x + 6}" y="${y + 6}" width="34" height="13" rx="2.5" fill="${color}" fill-opacity="0.2" />\n`;
      svg += `      <text x="${x + 23}" y="${y + 15.5}" fill="${color}" font-size="8" font-weight="700" text-anchor="middle">${escapeXml(badge)}</text>\n`;
      svg += `      <text x="${cx + 10}" y="${y + 20}" fill="${fg}" font-size="11.5" font-weight="700" text-anchor="middle">${escapeXml(name)}</text>\n`;
      svg += `      <text x="${cx}" y="${y + h - 9}" fill="${mutedFg}" font-size="9" text-anchor="middle">«${escapeXml(disc)}${dir ? ` ${escapeXml(dir)}` : ""}»</text>\n`;
      if (gndGlyph) {
        svg += `      <g transform="translate(${x + 18}, ${cy - 12}) scale(0.4)">\n        ${gndGlyph}\n      </g>\n`;
      }
      svg += `      <circle cx="${x}" cy="${cy}" r="3" fill="${color}" />\n`;
      svg += `      <circle cx="${x + w}" cy="${cy}" r="3" fill="${color}" />\n`;
      svg += `    </g>\n`;
    }
  }
  svg += `  </g>\n\n`;

  // Parameter & Internal Variable HUD Table at bottom
  if (params.length > 0 || vars.length > 0) {
    const hudY = pkgY + pkgH + 22;
    const hudW = width - 96;
    svg += `  <g id="va-parameters-hud">\n`;
    svg += `    <rect x="48" y="${hudY}" width="${hudW}" height="${hudHeight}" rx="7" fill="${panelBg}" stroke="${borderCol}" stroke-width="1.4" />\n`;
    svg += `    <text x="64" y="${hudY + 20}" fill="#38bdf8" font-size="10.5" font-weight="700">COMPACT MODEL PARAMETERS &amp; ANALOG VARIABLES</text>\n`;

    const displayParams = params.slice(0, 8);
    displayParams.forEach((p, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const px = 64 + col * Math.floor(hudW / 2);
      const py = hudY + 40 + row * 18;
      const rangeStr = p.rangeSpec
        ? ` from ${p.rangeSpec.minInclusive ? "[" : "("}${p.rangeSpec.min ?? "-inf"}:${p.rangeSpec.max ?? "inf"}${p.rangeSpec.maxInclusive ? "]" : ")"}`
        : "";
      svg += `    <text x="${px}" y="${py}" fill="${fg}" font-size="9.5">${escapeXml(p.name)} = <tspan fill="#38bdf8" font-weight="600">${escapeXml(String(p.defaultValue))}</tspan><tspan fill="${mutedFg}">${escapeXml(rangeStr)}</tspan></text>\n`;
    });

    if (vars.length > 0) {
      const varNames = vars.map((v) => v.name).join(", ");
      svg += `    <text x="64" y="${hudY + hudHeight - 10}" fill="${mutedFg}" font-size="9">Analog variables: ${escapeXml(varNames)}</text>\n`;
    }
    svg += `  </g>\n`;
  }

  svg += `</svg>\n`;
  return svg;
}
