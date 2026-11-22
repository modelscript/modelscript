// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Specctra DSN (.dsn) Exporter & Session (.ses) Importer.
 *
 * Implements the industry-standard S-expression autorouter interchange format
 * supported by KiCad, Freerouting, Altium Designer, Cadence Allegro, and Eagle:
 *   - `exportToSpecctraDsn(layout)` -> `.dsn` design file for autorouting
 *   - `parseSpecctraSes(ses)` -> routed `TraceSegment[]` and `ViaDefinition[]`
 *   - `applySpecctraSesToLayout(layout, ses)` -> merges routed copper back into `PCBLayout`
 */

import type { PCBLayout, TraceSegment, ViaDefinition } from "./gerber.js";

export interface SpecctraDsnOptions {
  designName?: string;
  defaultTraceWidthMm?: number;
  defaultClearanceMm?: number;
  defaultViaDrillMm?: number;
  defaultViaOuterMm?: number;
}

export interface SpecctraSesResult {
  sessionName: string;
  traces: TraceSegment[];
  vias: ViaDefinition[];
  diagnostics: string[];
}

function quoteId(str: string): string {
  if (/^[A-Za-z0-9_.-]+$/.test(str)) return str;
  return `"${str.replace(/"/g, '\\"')}"`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Exports a canonical `PCBLayout` to a Specctra `.dsn` S-expression document
 * suitable for Freerouting or other Specctra-compatible autorouters.
 */
export function exportToSpecctraDsn(layout: PCBLayout, options?: SpecctraDsnOptions): string {
  const name = options?.designName ?? "modelscript_board";
  const traceWidth = options?.defaultTraceWidthMm ?? 0.25;
  const clearance = options?.defaultClearanceMm ?? 0.2;
  const viaDrill = options?.defaultViaDrillMm ?? 0.3;
  const viaOuter = options?.defaultViaOuterMm ?? 0.6;

  const lines: string[] = [];
  lines.push(`(pcb ${quoteId(name)}`);
  lines.push(`  (parser`);
  lines.push(`    (string_quote ")`);
  lines.push(`    (space_in_quoted_tokens on)`);
  lines.push(`    (host_cad "ModelScript")`);
  lines.push(`    (host_version "0.1.0")`);
  lines.push(`  )`);
  lines.push(`  (resolution mm 1000)`);
  lines.push(`  (unit mm)`);

  // Structure (layers, outline boundary, via padstack, default rules)
  lines.push(`  (structure`);
  const copperLayers = new Set<string>(["TopCopper", "BottomCopper"]);
  for (const t of layout.traces) copperLayers.add(t.layer);
  for (const p of layout.pads) copperLayers.add(p.layer);
  for (const layer of copperLayers) {
    lines.push(`    (layer ${quoteId(layer)} (type signal))`);
  }
  if (layout.outline && layout.outline.vertices.length >= 3) {
    const verts = [...layout.outline.vertices, layout.outline.vertices[0]!];
    const coords = verts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(" ");
    lines.push(`    (boundary (path pcb 0 ${coords}))`);
  }
  lines.push(`    (via "Via[0-1]_${fmt(viaOuter)}:${fmt(viaDrill)}_mm")`);
  lines.push(`    (rule (width ${fmt(traceWidth)}) (clearance ${fmt(clearance)}))`);
  lines.push(`  )`);

  // Placement
  lines.push(`  (placement`);
  const byPkg = new Map<string, typeof layout.netlist.components>();
  for (const comp of layout.netlist.components) {
    const pkg = comp.placement?.footprint ?? "SMD_DEFAULT";
    const list = byPkg.get(pkg) ?? [];
    list.push(comp);
    byPkg.set(pkg, list);
  }
  for (const [pkg, comps] of byPkg) {
    lines.push(`    (component ${quoteId(pkg)}`);
    for (const c of comps) {
      const pl = c.placement;
      const side = pl?.layer.toLowerCase().includes("bottom") ? "back" : "front";
      lines.push(
        `      (place ${quoteId(c.name)} ${fmt(pl?.x ?? 0)} ${fmt(pl?.y ?? 0)} ${side} ${fmt(pl?.angle ?? 0)})`,
      );
    }
    lines.push(`    )`);
  }
  lines.push(`  )`);

  // Library (images + padstacks)
  lines.push(`  (library`);
  for (const [pkg, comps] of byPkg) {
    const rep = comps[0]!;
    lines.push(`    (image ${quoteId(pkg)}`);
    const compPads = layout.pads.filter((p) => p.component === rep.name);
    const fx = rep.placement?.x ?? 0;
    const fy = rep.placement?.y ?? 0;
    for (let i = 0; i < compPads.length; i++) {
      const pad = compPads[i]!;
      const pinId = rep.pins[i] ?? String(i + 1);
      lines.push(
        `      (pin "Pad_${pad.shape}_${fmt(pad.width)}x${fmt(pad.height)}" ${quoteId(pinId)} ${fmt(pad.center[0] - fx)} ${fmt(pad.center[1] - fy)})`,
      );
    }
    lines.push(`    )`);
  }
  lines.push(`    (padstack "Via[0-1]_${fmt(viaOuter)}:${fmt(viaDrill)}_mm"`);
  lines.push(`      (shape (circle TopCopper ${fmt(viaOuter)}))`);
  lines.push(`      (shape (circle BottomCopper ${fmt(viaOuter)}))`);
  lines.push(`      (attach off)`);
  lines.push(`    )`);
  lines.push(`  )`);

  // Network
  lines.push(`  (network`);
  for (const net of layout.netlist.nets) {
    const pins = net.pins.map((p) => `${quoteId(p.component)}-${quoteId(p.localName)}`).join(" ");
    lines.push(`    (net ${quoteId(net.id)} (pins ${pins}))`);
  }
  if (layout.netlist.nets.length > 0) {
    const netNames = layout.netlist.nets.map((n) => quoteId(n.id)).join(" ");
    lines.push(
      `    (class default ${netNames} (circuit (use_via "Via[0-1]_${fmt(viaOuter)}:${fmt(viaDrill)}_mm")) (rule (width ${fmt(traceWidth)}) (clearance ${fmt(clearance)})))`,
    );
  }
  lines.push(`  )`);

  // Existing wiring
  lines.push(`  (wiring`);
  for (const t of layout.traces) {
    lines.push(
      `    (wire (path ${quoteId(t.layer)} ${fmt(t.width)} ${fmt(t.start[0])} ${fmt(t.start[1])} ${fmt(t.end[0])} ${fmt(t.end[1])}) (net ${quoteId(t.net)}) (type route))`,
    );
  }
  for (const v of layout.vias) {
    const outer = v.drill + 2 * v.annularRing;
    lines.push(
      `    (via "Via[0-1]_${fmt(outer)}:${fmt(v.drill)}_mm" ${fmt(v.center[0])} ${fmt(v.center[1])} (net ${quoteId(v.net)}))`,
    );
  }
  lines.push(`  )`);
  lines.push(`)`);
  return lines.join("\n");
}

// ── Specctra Session (.ses) S-Expression Parser ──

interface SesNode {
  head?: string;
  items: (SesNode | string)[];
}

function parseSExpr(src: string): SesNode | null {
  const stack: SesNode[] = [];
  let root: SesNode | null = null;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      i++;
      continue;
    }
    if (c === 40) {
      const node: SesNode = { items: [] };
      if (stack.length > 0) stack[stack.length - 1]!.items.push(node);
      else root = node;
      stack.push(node);
      i++;
      continue;
    }
    if (c === 41) {
      stack.pop();
      i++;
      continue;
    }
    let token = "";
    if (c === 34) {
      i++;
      while (i < n && src.charCodeAt(i) !== 34) {
        if (src.charCodeAt(i) === 92 && i + 1 < n) {
          token += src[i + 1]!;
          i += 2;
        } else {
          token += src[i]!;
          i++;
        }
      }
      if (i < n) i++;
    } else {
      const start = i;
      while (i < n) {
        const ch = src.charCodeAt(i);
        if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 40 || ch === 41) break;
        i++;
      }
      token = src.slice(start, i);
    }
    const top = stack[stack.length - 1];
    if (top) {
      if (top.head === undefined) top.head = token;
      else top.items.push(token);
    }
  }
  return root;
}

function sesChildren(node: SesNode | undefined, head?: string): SesNode[] {
  if (!node) return [];
  const out: SesNode[] = [];
  for (const item of node.items) {
    if (typeof item !== "string" && (head === undefined || item.head === head)) {
      out.push(item);
    }
  }
  return out;
}

function sesFind(node: SesNode | undefined, head: string): SesNode | undefined {
  return sesChildren(node, head)[0];
}

function sesAtom(node: SesNode | undefined, idx: number): string | undefined {
  const item = node?.items[idx];
  return typeof item === "string" ? item : undefined;
}

function resolutionToMmScale(unit: string | undefined, divisor: number): number {
  const u = (unit ?? "mm").toLowerCase();
  const unitMm = u === "um" ? 0.001 : u === "mil" ? 0.0254 : u === "inch" ? 25.4 : 1.0;
  return unitMm / (divisor > 0 ? divisor : 1);
}

/**
 * Parses a Specctra `.ses` autorouter session file into `TraceSegment[]` and
 * `ViaDefinition[]` normalized to millimeters.
 */
export function parseSpecctraSes(ses: string): SpecctraSesResult {
  const diagnostics: string[] = [];
  const root = parseSExpr(ses);
  if (!root || root.head !== "session") {
    return { sessionName: "", traces: [], vias: [], diagnostics: ["Missing top-level '(session ...)' S-expression."] };
  }

  const sessionName = sesAtom(root, 0) ?? "session";
  const routes = sesFind(root, "routes");
  if (!routes) {
    return { sessionName, traces: [], vias: [], diagnostics: ["No '(routes ...)' block found in Specctra session."] };
  }

  const resNode = sesFind(routes, "resolution");
  const resUnit = sesAtom(resNode, 0);
  const resDiv = Number.parseFloat(sesAtom(resNode, 1) ?? "1");
  const scale = resolutionToMmScale(resUnit, Number.isFinite(resDiv) ? resDiv : 1);

  const traces: TraceSegment[] = [];
  const vias: ViaDefinition[] = [];
  const netOut = sesFind(routes, "network_out");

  for (const netNode of sesChildren(netOut, "net")) {
    const netName = sesAtom(netNode, 0) ?? "";

    for (const wireNode of sesChildren(netNode, "wire")) {
      const pathNode = sesFind(wireNode, "path");
      if (!pathNode) continue;
      const layer = sesAtom(pathNode, 0) ?? "TopCopper";
      const width = Number.parseFloat(sesAtom(pathNode, 1) ?? "0.25") * scale;
      const coords: number[] = [];
      for (let i = 2; i < pathNode.items.length; i++) {
        const raw = pathNode.items[i];
        if (typeof raw === "string") {
          const val = Number.parseFloat(raw);
          if (Number.isFinite(val)) coords.push(val * scale);
        }
      }
      for (let i = 0; i + 3 < coords.length; i += 2) {
        traces.push({
          start: [coords[i]!, coords[i + 1]!],
          end: [coords[i + 2]!, coords[i + 3]!],
          width,
          layer,
          net: netName,
        });
      }
    }

    for (const viaNode of sesChildren(netNode, "via")) {
      const padstack = sesAtom(viaNode, 0) ?? "";
      const x = Number.parseFloat(sesAtom(viaNode, 1) ?? "0") * scale;
      const y = Number.parseFloat(sesAtom(viaNode, 2) ?? "0") * scale;
      // Extract outer:drill from standard padstack naming `Via[0-1]_0.6:0.3_mm` if present
      const dimMatch = /(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/.exec(padstack);
      const outer = dimMatch ? Number.parseFloat(dimMatch[1]!) : 0.6;
      const drill = dimMatch ? Number.parseFloat(dimMatch[2]!) : 0.3;
      vias.push({
        center: [x, y],
        drill,
        annularRing: Math.max(0.05, (outer - drill) / 2),
        net: netName,
      });
    }
  }

  return { sessionName, traces, vias, diagnostics };
}

/**
 * Applies autorouted traces and vias from a Specctra `.ses` session onto an
 * existing `PCBLayout`, returning a new routed `PCBLayout`.
 */
export function applySpecctraSesToLayout(layout: PCBLayout, ses: string): PCBLayout {
  const parsed = parseSpecctraSes(ses);
  return {
    ...layout,
    traces: parsed.traces,
    vias: parsed.vias,
  };
}
