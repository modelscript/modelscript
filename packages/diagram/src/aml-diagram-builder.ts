// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — AutomationML (IEC 62714 / CAEX) Plant Topology & 3D Workcell Diagram Builder.
 *
 * Provides vector visualizations for NIST Smart Manufacturing & Virtual Commissioning workflows:
 *   1. Mechatronic Plant Topology & PPR (Product-Process-Resource) Schematic with directed ports & InternalLinks.
 *   2. Isometric 3D Spatial Workcell 6-DOF Frame & Kinematic Envelope Viewer.
 */

export interface AmlInterfaceLike {
  id: string;
  name: string;
  direction?: "In" | "Out" | "InOut" | string | undefined;
  category?: "Signal" | "PLCopenXML" | "COLLADA" | "FMU" | "Order" | "Energy" | string | undefined;
  refUri?: string | undefined;
}

export interface AmlInternalLinkLike {
  name: string;
  refPartnerSideA: string;
  refPartnerSideB: string;
}

export interface AmlInternalElementLike {
  id: string;
  name: string;
  refBaseSystemUnitPath?: string | undefined;
  pprCategory?: "Product" | "Process" | "Resource" | "Structure" | string | undefined;
  frame?: { x: number; y: number; z: number; rx: number; ry: number; rz: number } | undefined;
  interfaces?: AmlExternalInterfaceLike[] | undefined;
  internalLinks?: AmlInternalLinkLike[] | undefined;
  children?: AmlInternalElementLike[] | undefined;
}

export type AmlExternalInterfaceLike = AmlInterfaceLike;

export interface AmlDocumentLike {
  fileName?: string | undefined;
  schemaVersion?: string | undefined;
  instanceHierarchies: {
    name: string;
    elements: AmlInternalElementLike[];
  }[];
}

export interface AmlCommissioningStateLike {
  cycles: number;
  dtMs: number;
  activeSignals?: Record<string, number | boolean | string> | undefined;
  interlocksOk?: boolean | undefined;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function flattenElements(elements: AmlInternalElementLike[]): AmlInternalElementLike[] {
  const result: AmlInternalElementLike[] = [];
  const visit = (el: AmlInternalElementLike) => {
    result.push(el);
    for (const c of el.children ?? []) visit(c);
  };
  for (const e of elements) visit(e);
  return result;
}

function collectLinks(elements: AmlInternalElementLike[]): AmlInternalLinkLike[] {
  const links: AmlInternalLinkLike[] = [];
  const visit = (el: AmlInternalElementLike) => {
    for (const l of el.internalLinks ?? []) links.push(l);
    for (const c of el.children ?? []) visit(c);
  };
  for (const e of elements) visit(e);
  return links;
}

function pprColor(cat?: string): string {
  switch (cat) {
    case "Product":
      return "#f59e0b";
    case "Process":
      return "#a855f7";
    case "Resource":
      return "#38bdf8";
    default:
      return "#10b981";
  }
}

/**
 * Renders the IEC 62714 AutomationML Plant Topology, PPR Roles, ExternalInterfaces, and InternalLinks.
 */
export function renderAmlTopologySvg(doc: AmlDocumentLike, simState?: AmlCommissioningStateLike): string {
  const width = 920;
  const height = 500;
  const parts: string[] = [];

  const rootElements = doc.instanceHierarchies.flatMap((h) => h.elements);
  const allElements = flattenElements(rootElements);
  const allLinks = collectLinks(rootElements);

  // Choose leaf/workcell elements to render as primary schematic blocks
  const displayElements = allElements
    .filter((e) => (e.interfaces?.length ?? 0) > 0 || (e.children?.length ?? 0) === 0)
    .slice(0, 8);
  const nodesToRender = displayElements.length > 0 ? displayElements : allElements.slice(0, 6);

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );
  parts.push(`<defs>
    <marker id="amlSignalArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path d="M0,1 L7,4 L0,7 Z" fill="#38bdf8"/>
    </marker>
  </defs>`);

  // Header
  parts.push(`<rect x="0" y="0" width="${width}" height="40" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="25" fill="#f8fafc" font-size="13" font-weight="600">IEC 62714 AutomationML Plant Topology &amp; PPR Virtual Commissioning Schematic</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="25" fill="#38bdf8" font-size="11.5" font-weight="600" text-anchor="end">CAEX ${escapeXml(doc.schemaVersion ?? "3.0")} | Links: ${allLinks.length}</text>`,
  );

  const nodePositions = new Map<string, { x: number; y: number; w: number; h: number }>();
  const cols = Math.min(4, Math.max(2, Math.ceil(nodesToRender.length / 2)));

  nodesToRender.forEach((el, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = 44 + col * 218;
    const y = 72 + row * 195;
    const w = 186;
    const h = 136;
    nodePositions.set(el.id, { x, y, w, h });
    nodePositions.set(el.name, { x, y, w, h });
  });

  // Render InternalLink wires first
  allLinks.forEach((link, idx) => {
    const sideA = link.refPartnerSideA.split(":")[0] ?? "";
    const sideB = link.refPartnerSideB.split(":")[0] ?? "";
    const posA = nodePositions.get(sideA);
    const posB = nodePositions.get(sideB);
    if (posA && posB) {
      const x1 = posA.x + posA.w;
      const y1 = posA.y + 52 + (idx % 3) * 18;
      const x2 = posB.x;
      const y2 = posB.y + 52 + (idx % 3) * 18;
      const midX = Math.round((x1 + x2) / 2);

      parts.push(
        `<path d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="#38bdf8" stroke-width="1.8" marker-end="url(#amlSignalArrow)"/>`,
      );
      parts.push(
        `<text x="${midX}" y="${Math.round((y1 + y2) / 2) - 5}" fill="#7dd3fc" font-size="9.5" font-weight="600" text-anchor="middle">${escapeXml(link.name)}</text>`,
      );
    }
  });

  // Render InternalElement Blocks
  nodesToRender.forEach((el) => {
    const pos = nodePositions.get(el.id)!;
    const roleCol = pprColor(el.pprCategory);

    parts.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}" rx="6" fill="#1e293b" stroke="${roleCol}" stroke-width="1.8"/>`,
    );
    parts.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${pos.w}" height="28" rx="6" fill="${roleCol}" fill-opacity="0.22"/>`,
    );
    parts.push(
      `<text x="${pos.x + 10}" y="${pos.y + 18}" fill="#f8fafc" font-size="11.5" font-weight="700">${escapeXml(el.name.slice(0, 18))}</text>`,
    );
    parts.push(
      `<text x="${pos.x + pos.w - 8}" y="${pos.y + 18}" fill="${roleCol}" font-size="9.5" font-weight="700" text-anchor="end">${escapeXml(el.pprCategory ?? "Resource")}</text>`,
    );

    if (el.frame) {
      parts.push(
        `<text x="${pos.x + 10}" y="${pos.y + 43}" fill="#94a3b8" font-size="9.5">Frame: (${el.frame.x}, ${el.frame.y}, ${el.frame.z}) mm</text>`,
      );
    }

    const ifaces = el.interfaces ?? [];
    ifaces.slice(0, 4).forEach((iface, i) => {
      const iy = pos.y + 58 + i * 18;
      const isOut = iface.direction === "Out";
      const portX = isOut ? pos.x + pos.w - 5 : pos.x - 5;
      const portCol =
        iface.category === "PLCopenXML" ? "#f59e0b" : iface.category === "COLLADA" ? "#a855f7" : "#38bdf8";

      parts.push(`<rect x="${portX}" y="${iy - 4}" width="10" height="8" rx="2" fill="${portCol}"/>`);
      parts.push(
        `<text x="${isOut ? pos.x + pos.w - 12 : pos.x + 12}" y="${iy + 3}" fill="#cbd5e1" font-size="9.5" text-anchor="${isOut ? "end" : "start"}">${escapeXml(iface.name)} (${escapeXml(iface.direction ?? "InOut")})</text>`,
      );
    });
  });

  // Footer PPR Legend & Virtual Commissioning status
  parts.push(
    `<rect x="16" y="${height - 40}" width="${width - 32}" height="28" rx="4" fill="#1e293b" stroke="#334155"/>`,
  );
  parts.push(
    `<circle cx="32" cy="${height - 26}" r="5" fill="#38bdf8"/><text x="42" y="${height - 22}" fill="#cbd5e1" font-size="11">Resource (Robot/PLC)</text>`,
  );
  parts.push(
    `<circle cx="185" cy="${height - 26}" r="5" fill="#a855f7"/><text x="195" y="${height - 22}" fill="#cbd5e1" font-size="11">Process (Operation)</text>`,
  );
  parts.push(
    `<circle cx="335" cy="${height - 26}" r="5" fill="#f59e0b"/><text x="345" y="${height - 22}" fill="#cbd5e1" font-size="11">Product (Workpiece)</text>`,
  );
  if (simState) {
    const statusCol = simState.interlocksOk !== false ? "#22c55e" : "#ef4444";
    parts.push(
      `<text x="${width - 28}" y="${height - 22}" fill="${statusCol}" font-size="11" font-weight="700" text-anchor="end">Virtual Commissioning: ${simState.cycles} cycles @ ${simState.dtMs}ms — ${simState.interlocksOk !== false ? "INTERLOCKS OK" : "FAULT"}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * Renders an isometric 3D spatial coordinate frame diagram of the AutomationML workcell.
 */
export function renderAmlWorkcell3dSvg(doc: AmlDocumentLike): string {
  const width = 880;
  const height = 340;
  const cx = 440;
  const cy = 205;
  const scale = 0.14;

  const projectIso = (x: number, y: number, z: number) => {
    const cos30 = 0.8660254;
    const sin30 = 0.5;
    return {
      sx: Math.round((cx + (x - y) * cos30 * scale) * 10) / 10,
      sy: Math.round((cy - z * scale + (x + y) * sin30 * scale * 0.65) * 10) / 10,
    };
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="36" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="23" fill="#f8fafc" font-size="13" font-weight="600">AutomationML 3D Workcell Spatial Frame Hierarchy (6-DOF Kinematics)</text>`,
  );

  // Floor Grid (-1200..1200 mm)
  for (let g = -1200; g <= 1200; g += 400) {
    const p1 = projectIso(g, -1200, 0);
    const p2 = projectIso(g, 1200, 0);
    const p3 = projectIso(-1200, g, 0);
    const p4 = projectIso(1200, g, 0);
    parts.push(`<line x1="${p1.sx}" y1="${p1.sy}" x2="${p2.sx}" y2="${p2.sy}" stroke="#1e293b" stroke-width="1"/>`);
    parts.push(`<line x1="${p3.sx}" y1="${p3.sy}" x2="${p4.sx}" y2="${p4.sy}" stroke="#1e293b" stroke-width="1"/>`);
  }

  const allElements = flattenElements(doc.instanceHierarchies.flatMap((h) => h.elements));
  allElements.forEach((el, idx) => {
    const f = el.frame ?? { x: (idx - 2) * 450, y: (idx % 2) * 350, z: 120, rx: 0, ry: 0, rz: 0 };
    const pt = projectIso(f.x, f.y, f.z);
    const px = projectIso(f.x + 220, f.y, f.z);
    const py = projectIso(f.x, f.y + 220, f.z);
    const pz = projectIso(f.x, f.y, f.z + 220);
    const col = pprColor(el.pprCategory);

    // 3D triad at element frame
    parts.push(`<line x1="${pt.sx}" y1="${pt.sy}" x2="${px.sx}" y2="${px.sy}" stroke="#ef4444" stroke-width="2"/>`);
    parts.push(`<line x1="${pt.sx}" y1="${pt.sy}" x2="${py.sx}" y2="${py.sy}" stroke="#22c55e" stroke-width="2"/>`);
    parts.push(`<line x1="${pt.sx}" y1="${pt.sy}" x2="${pz.sx}" y2="${pz.sy}" stroke="#3b82f6" stroke-width="2"/>`);
    parts.push(`<circle cx="${pt.sx}" cy="${pt.sy}" r="6" fill="${col}" stroke="#0f172a" stroke-width="1.5"/>`);
    parts.push(
      `<text x="${pt.sx}" y="${pt.sy + 18}" fill="#f8fafc" font-size="10.5" font-weight="600" text-anchor="middle">${escapeXml(el.name)}</text>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}
