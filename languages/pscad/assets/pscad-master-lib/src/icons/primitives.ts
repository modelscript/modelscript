// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom IEEE Std 315 / IEC 60617 SVG icon generator for `@modelscript/pscad-master-lib`.
 *
 * Every icon is authored from scratch on PSCAD's 18px schematic grid using pure geometric
 * vector primitives — zero vendor `<graphics>` or `<Gfx>` XML is copied or referenced.
 */

export interface CleanroomPortSpec {
  name: string;
  kind: "electrical" | "signal";
  side: "left" | "right" | "top" | "bottom";
  dx: number;
  dy: number;
}

export interface CleanroomIconInput {
  name: string;
  label: string;
  category: string;
  domain: "electrical" | "control" | "meter" | "bus";
  group?: string | undefined;
  isModule?: boolean | undefined;
  width: number;
  height: number;
  ports: CleanroomPortSpec[];
}

const DOMAIN_COLORS = {
  electrical: { stroke: "#0284c7", fill: "#f0f9ff", accent: "#0369a1" },
  control: { stroke: "#16a34a", fill: "#f0fdf4", accent: "#15803d" },
  meter: { stroke: "#d97706", fill: "#fffbeb", accent: "#b45309" },
  pe: { stroke: "#7c3aed", fill: "#f5f3ff", accent: "#6d28d9" },
  protection: { stroke: "#dc2626", fill: "#fef2f2", accent: "#b91c1c" },
  module: { stroke: "#475569", fill: "#f8fafc", accent: "#334155" },
} as const;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortBadge(name: string): string {
  const clean = name.replace(/^master:/i, "").replace(/[_-]+/g, " ").trim();
  if (clean.length <= 7) return clean.toUpperCase();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return parts
      .map((p) => p.slice(0, 3))
      .join("")
      .slice(0, 7)
      .toUpperCase();
  }
  return clean.slice(0, 7).toUpperCase();
}

function renderPortLeads(ports: CleanroomPortSpec[], stroke: string): string {
  const lines: string[] = [];
  for (const p of ports.slice(0, 12)) {
    const r = p.kind === "electrical" ? 2.5 : 2;
    const fill = p.kind === "electrical" ? stroke : "#16a34a";
    const lx = Math.max(-24, Math.min(24, p.dx));
    const ly = Math.max(-24, Math.min(24, p.dy));
    const ix = Math.round(lx * 0.55);
    const iy = Math.round(ly * 0.55);
    lines.push(
      `<line x1="${ix}" y1="${iy}" x2="${lx}" y2="${ly}" stroke="${fill}" stroke-width="1.5"/>`,
      `<circle cx="${lx}" cy="${ly}" r="${r}" fill="${fill}"/>`,
    );
  }
  return lines.join("");
}

function wrapSvg(body: string, width: number, height: number, ports: CleanroomPortSpec[], stroke: string): string {
  const w = Math.max(48, Math.min(120, Math.round(width)));
  const h = Math.max(36, Math.min(120, Math.round(height)));
  const hw = Math.round(w / 2);
  const hh = Math.round(h / 2);
  const leads = renderPortLeads(ports, stroke);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-hw} ${-hh} ${w} ${h}" width="${w}" height="${h}">${leads}${body}</svg>`;
}

function boxIcon(
  badge: string,
  sub: string,
  palette: { stroke: string; fill: string; accent: string },
  w = 56,
  h = 40,
  extra = "",
): string {
  const rx = Math.round(w / 2) - 6;
  const ry = Math.round(h / 2) - 4;
  return (
    `<rect x="${-rx}" y="${-ry}" width="${rx * 2}" height="${ry * 2}" rx="4" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.75"/>` +
    extra +
    `<text x="0" y="${sub ? -2 : 3}" text-anchor="middle" font-family="monospace" font-size="9" font-weight="700" fill="${palette.accent}">${esc(badge)}</text>` +
    (sub
      ? `<text x="0" y="9" text-anchor="middle" font-family="sans-serif" font-size="7" fill="${palette.stroke}">${esc(sub)}</text>`
      : "")
  );
}

/**
 * Generates a cleanroom IEEE 315 / IEC 60617 SVG icon for any PSCAD Master Library definition.
 */
export function generateCleanroomSvgIcon(input: CleanroomIconInput): string {
  const n = input.name.toLowerCase().replace(/^master:/, "");
  const grp = (input.group ?? "").toLowerCase();
  const w = input.width || 60;
  const h = input.height || 48;

  // 1. Hierarchical sub-modules / library pages / station / row
  if (input.isModule || n === "station" || n === "main" || n.startsWith("row")) {
    const pal = DOMAIN_COLORS.module;
    const body =
      `<path d="M -24 -14 L -8 -14 L -4 -18 L 24 -18 L 24 16 L -24 16 Z" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<line x1="-24" y1="-10" x2="24" y2="-10" stroke="${pal.stroke}" stroke-width="1"/>` +
      `<text x="0" y="5" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="700" fill="${pal.accent}">${esc(shortBadge(n))}</text>`;
    return wrapSvg(body, Math.max(w, 64), Math.max(h, 48), input.ports, pal.stroke);
  }

  // 2. Ground
  if (n === "ground" || n === "gnd" || n.endsWith("_gnd")) {
    const pal = DOMAIN_COLORS.electrical;
    const body =
      `<line x1="0" y1="-14" x2="0" y2="0" stroke="${pal.stroke}" stroke-width="2"/>` +
      `<line x1="-12" y1="0" x2="12" y2="0" stroke="${pal.stroke}" stroke-width="2"/>` +
      `<line x1="-8" y1="5" x2="8" y2="5" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<line x1="-4" y1="10" x2="4" y2="10" stroke="${pal.stroke}" stroke-width="1.5"/>`;
    return wrapSvg(body, 48, 36, input.ports, pal.stroke);
  }

  // 3. Transformers (2W, 3W, 4W, NW, UMEC, auto, saturable)
  if (n.includes("xfmr") || n.includes("transformer") || n.includes("umec")) {
    const pal = DOMAIN_COLORS.electrical;
    const is3w = n.includes("3w") || n.includes("4w") || n.includes("6w") || n.includes("nw");
    const isUmec = n.includes("umec");
    const body =
      `<circle cx="-9" cy="0" r="11" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<circle cx="9" cy="0" r="11" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      (is3w ? `<circle cx="0" cy="10" r="9" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.5"/>` : "") +
      `<line x1="-2" y1="-12" x2="-2" y2="12" stroke="${pal.accent}" stroke-width="1.2"/>` +
      `<line x1="2" y1="-12" x2="2" y2="12" stroke="${pal.accent}" stroke-width="1.2"/>` +
      (isUmec
        ? `<text x="0" y="-14" text-anchor="middle" font-family="monospace" font-size="7" font-weight="700" fill="${pal.accent}">UMEC</text>`
        : "");
    return wrapSvg(body, Math.max(w, 64), Math.max(h, 52), input.ports, pal.stroke);
  }

  // 4. Transmission lines, cables & PI sections
  if (n.includes("tline") || n.includes("cable") || n.includes("tower") || n.includes("pi") && grp.includes("pi")) {
    const pal = DOMAIN_COLORS.electrical;
    if (n.includes("cable")) {
      const body =
        `<circle cx="0" cy="0" r="15" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
        `<circle cx="0" cy="0" r="9" fill="none" stroke="${pal.stroke}" stroke-width="1.2" stroke-dasharray="3 2"/>` +
        `<circle cx="-3" cy="-2" r="2.5" fill="${pal.accent}"/>` +
        `<circle cx="3" cy="-2" r="2.5" fill="${pal.accent}"/>` +
        `<circle cx="0" cy="4" r="2.5" fill="${pal.accent}"/>`;
      return wrapSvg(body, Math.max(w, 60), Math.max(h, 48), input.ports, pal.stroke);
    }
    if (n.includes("newpi") || n.includes("pi_")) {
      const body =
        `<line x1="-22" y1="-6" x2="22" y2="-6" stroke="${pal.stroke}" stroke-width="2"/>` +
        `<rect x="-10" y="-11" width="20" height="10" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.5"/>` +
        `<line x1="-16" y1="-6" x2="-16" y2="6" stroke="${pal.stroke}" stroke-width="1.5"/>` +
        `<line x1="-20" y1="6" x2="-12" y2="6" stroke="${pal.stroke}" stroke-width="1.75"/>` +
        `<line x1="-20" y1="10" x2="-12" y2="10" stroke="${pal.stroke}" stroke-width="1.75"/>` +
        `<line x1="16" y1="-6" x2="16" y2="6" stroke="${pal.stroke}" stroke-width="1.5"/>` +
        `<line x1="12" y1="6" x2="20" y2="6" stroke="${pal.stroke}" stroke-width="1.75"/>` +
        `<line x1="12" y1="10" x2="20" y2="10" stroke="${pal.stroke}" stroke-width="1.75"/>`;
      return wrapSvg(body, Math.max(w, 64), Math.max(h, 48), input.ports, pal.stroke);
    }
    const body =
      `<line x1="-24" y1="-8" x2="24" y2="-8" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<line x1="-24" y1="0" x2="24" y2="0" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<line x1="-24" y1="8" x2="24" y2="8" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<path d="M -8 -14 L 0 14 L 8 -14 M -12 -6 L 12 -6" fill="none" stroke="${pal.accent}" stroke-width="1.3"/>`;
    return wrapSvg(body, Math.max(w, 68), Math.max(h, 48), input.ports, pal.stroke);
  }

  // 5. Passive elements (R, L, C, RLC, filters, arrester, spark gap, saturable reactor, load)
  if (n === "resistor" || n === "res") {
    const pal = DOMAIN_COLORS.electrical;
    const body = `<path d="M -22 0 L -14 0 L -11 -7 L -5 7 L 1 -7 L 7 7 L 11 -7 L 14 0 L 22 0" fill="none" stroke="${pal.stroke}" stroke-width="2" stroke-linejoin="round"/>`;
    return wrapSvg(body, 60, 36, input.ports, pal.stroke);
  }
  if (n === "inductor" || n === "ind" || n === "sat_reac") {
    const pal = DOMAIN_COLORS.electrical;
    const satBar = n === "sat_reac" ? `<path d="M -14 -10 L -6 -10 L 6 -14 L 14 -14" fill="none" stroke="${pal.accent}" stroke-width="1.4"/>` : "";
    const body =
      `<path d="M -22 0 L -16 0 A 4 4 0 0 1 -8 0 A 4 4 0 0 1 0 0 A 4 4 0 0 1 8 0 A 4 4 0 0 1 16 0 L 22 0" fill="none" stroke="${pal.stroke}" stroke-width="2"/>` +
      satBar;
    return wrapSvg(body, 60, 40, input.ports, pal.stroke);
  }
  if (n === "capacitor" || n === "cap") {
    const pal = DOMAIN_COLORS.electrical;
    const body =
      `<line x1="-22" y1="0" x2="-4" y2="0" stroke="${pal.stroke}" stroke-width="2"/>` +
      `<line x1="-4" y1="-11" x2="-4" y2="11" stroke="${pal.stroke}" stroke-width="2.2"/>` +
      `<line x1="4" y1="-11" x2="4" y2="11" stroke="${pal.stroke}" stroke-width="2.2"/>` +
      `<line x1="4" y1="0" x2="22" y2="0" stroke="${pal.stroke}" stroke-width="2"/>`;
    return wrapSvg(body, 60, 36, input.ports, pal.stroke);
  }
  if (n.includes("arrester") || n === "mov") {
    const pal = DOMAIN_COLORS.protection;
    const body =
      `<rect x="-12" y="-14" width="24" height="28" rx="2" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<path d="M -7 8 L -3 8 L 3 -8 L 7 -8" fill="none" stroke="${pal.accent}" stroke-width="2"/>`;
    return wrapSvg(body, 52, 48, input.ports, pal.stroke);
  }
  if (n.includes("spark_gap")) {
    const pal = DOMAIN_COLORS.protection;
    const body =
      `<line x1="-20" y1="0" x2="-5" y2="0" stroke="${pal.stroke}" stroke-width="2"/>` +
      `<polygon points="-5,-5 0,0 -5,5" fill="${pal.stroke}"/>` +
      `<polygon points="5,-5 0,0 5,5" fill="${pal.stroke}"/>` +
      `<line x1="5" y1="0" x2="20" y2="0" stroke="${pal.stroke}" stroke-width="2"/>`;
    return wrapSvg(body, 56, 36, input.ports, pal.stroke);
  }
  if (n.includes("filter") || n.includes("cfilter")) {
    const pal = DOMAIN_COLORS.electrical;
    const body = boxIcon("FLT", shortBadge(n), pal, 58, 42, `<path d="M -16 11 Q -8 2 0 11 T 16 11" fill="none" stroke="${pal.stroke}" stroke-width="1.2" opacity="0.7"/>`);
    return wrapSvg(body, 60, 44, input.ports, pal.stroke);
  }
  if (n.includes("fixed_load") || n.includes("load")) {
    const pal = DOMAIN_COLORS.electrical;
    const body = `<polygon points="0,14 -14,-10 14,-10" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>`;
    return wrapSvg(body, 52, 44, input.ports, pal.stroke);
  }
  if (n.includes("varrlc") || n.includes("var_impedance") || n.includes("rlc")) {
    const pal = DOMAIN_COLORS.electrical;
    const body =
      `<rect x="-18" y="-10" width="36" height="20" rx="2" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<text x="0" y="4" text-anchor="middle" font-family="monospace" font-size="9" font-weight="700" fill="${pal.accent}">RLC</text>` +
      (n.includes("var") ? `<line x1="-14" y1="14" x2="14" y2="-14" stroke="${pal.accent}" stroke-width="1.5"/>` : "");
    return wrapSvg(body, 60, 44, input.ports, pal.stroke);
  }

  // 6. Sources & Battery
  if (n.includes("battery")) {
    const pal = DOMAIN_COLORS.pe;
    const body =
      `<line x1="-20" y1="0" x2="-8" y2="0" stroke="${pal.stroke}" stroke-width="2"/>` +
      `<line x1="-8" y1="-12" x2="-8" y2="12" stroke="${pal.stroke}" stroke-width="2.2"/>` +
      `<line x1="-2" y1="-6" x2="-2" y2="6" stroke="${pal.stroke}" stroke-width="3"/>` +
      `<line x1="4" y1="-12" x2="4" y2="12" stroke="${pal.stroke}" stroke-width="2.2"/>` +
      `<line x1="10" y1="-6" x2="10" y2="6" stroke="${pal.stroke}" stroke-width="3"/>` +
      `<line x1="10" y1="0" x2="20" y2="0" stroke="${pal.stroke}" stroke-width="2"/>`;
    return wrapSvg(body, 60, 44, input.ports, pal.stroke);
  }
  if (n.includes("source") || n.includes("src_") || n.includes("surge") || n.includes("harm")) {
    const pal = DOMAIN_COLORS.electrical;
    const isDependent = n.includes("dependent");
    const isCurrent = n.includes("ccin") || n.includes("current");
    const shell = isDependent
      ? `<polygon points="0,-16 16,0 0,16 -16,0" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>`
      : `<circle cx="0" cy="0" r="15" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>`;
    const inner = isCurrent
      ? `<line x1="-8" y1="0" x2="8" y2="0" stroke="${pal.accent}" stroke-width="2"/><polygon points="8,0 2,-4 2,4" fill="${pal.accent}"/>`
      : `<path d="M -9 0 Q -4.5 -9 0 0 T 9 0" fill="none" stroke="${pal.accent}" stroke-width="1.8"/>`;
    return wrapSvg(shell + inner, 56, 48, input.ports, pal.stroke);
  }

  // 7. Rotating Machines, Exciters, Governors, Turbines, Wind
  if (
    n.includes("sync_machine") ||
    n.includes("ind_machine") ||
    n.includes("wound_rotor") ||
    n.includes("sqc") ||
    n.includes("spim") ||
    n.includes("dcmach") ||
    n.includes("pm_mach")
  ) {
    const pal = DOMAIN_COLORS.electrical;
    const tag = n.includes("sync") ? "SM" : n.includes("wound") ? "WRIM" : n.includes("dc") ? "DC" : "IM";
    const body =
      `<circle cx="0" cy="0" r="16" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="2"/>` +
      `<text x="0" y="3" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="700" fill="${pal.accent}">${tag}</text>` +
      `<path d="M -8 9 Q -4 5 0 9 T 8 9" fill="none" stroke="${pal.stroke}" stroke-width="1.2"/>`;
    return wrapSvg(body, Math.max(w, 60), Math.max(h, 52), input.ports, pal.stroke);
  }
  if (n.includes("wind_turbine") || n.includes("wind_source")) {
    const pal = DOMAIN_COLORS.electrical;
    const body =
      `<circle cx="0" cy="0" r="3" fill="${pal.accent}"/>` +
      `<path d="M 0 -3 L -3 -16 L 3 -14 Z M 2 2 L 15 8 L 11 12 Z M -2 2 L -14 9 L -11 4 Z" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.5" stroke-linejoin="round"/>`;
    return wrapSvg(body, 56, 48, input.ports, pal.stroke);
  }
  if (n.includes("th_tur") || n.includes("hydro_tur") || n.includes("turbine")) {
    const pal = DOMAIN_COLORS.control;
    const body =
      `<polygon points="-18,-13 18,-8 18,8 -18,13" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<text x="0" y="3" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="700" fill="${pal.accent}">TURB</text>`;
    return wrapSvg(body, 60, 44, input.ports, pal.stroke);
  }
  if (n.includes("wind") || n.includes("th_gov") || n.includes("exc") || n.includes("pss") || n.includes("gov") || grp.includes("machine")) {
    const pal = DOMAIN_COLORS.control;
    const sub = n.includes("wind") ? "WIND" : n.includes("pss") ? "PSS" : n.includes("exc") ? "EXC" : n.includes("gov") ? "GOV" : "MACH";
    const curve = `<path d="M -14 12 L -6 12 Q -2 2 6 6 L 14 6" fill="none" stroke="${pal.stroke}" stroke-width="1.1" opacity="0.7"/>`;
    return wrapSvg(boxIcon(shortBadge(n), sub, pal, 58, 42, curve), Math.max(w, 60), Math.max(h, 44), input.ports, pal.stroke);
  }

  // 8. Power Electronics, HVDC & FACTS
  if (n === "diode" || n === "thyristor" || n === "gto" || n === "igbt" || n === "peswitch") {
    const pal = DOMAIN_COLORS.pe;
    const gate = n !== "diode" ? `<line x1="6" y1="6" x2="14" y2="14" stroke="${pal.accent}" stroke-width="1.75"/>` : "";
    const body =
      `<line x1="-20" y1="0" x2="-8" y2="0" stroke="${pal.stroke}" stroke-width="2"/>` +
      `<polygon points="-8,-10 8,0 -8,10" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<line x1="8" y1="-10" x2="8" y2="10" stroke="${pal.stroke}" stroke-width="2.2"/>` +
      `<line x1="8" y1="0" x2="20" y2="0" stroke="${pal.stroke}" stroke-width="2"/>` +
      gate;
    return wrapSvg(body, 56, 44, input.ports, pal.stroke);
  }
  if (n.includes("vsc") || n.includes("lcc") || n.includes("mmc") || n.includes("svc") || n.includes("vg6p") || n.includes("svm") || n.includes("fmu_ibr") || grp.includes("hvdc")) {
    const pal = DOMAIN_COLORS.pe;
    const body =
      `<rect x="-20" y="-15" width="40" height="30" rx="3" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<line x1="-20" y1="15" x2="20" y2="-15" stroke="${pal.stroke}" stroke-width="1.2" opacity="0.6"/>` +
      `<text x="-9" y="-3" text-anchor="middle" font-family="monospace" font-size="9" font-weight="700" fill="${pal.accent}">~</text>` +
      `<text x="9" y="9" text-anchor="middle" font-family="monospace" font-size="9" font-weight="700" fill="${pal.accent}">=</text>`;
    return wrapSvg(body, Math.max(w, 64), Math.max(h, 48), input.ports, pal.stroke);
  }

  // 9. Breakers, Faults & Protection Relays
  if (n.includes("breaker") || n.includes("tbreak")) {
    const pal = DOMAIN_COLORS.protection;
    const body =
      `<line x1="-22" y1="0" x2="-10" y2="0" stroke="${pal.stroke}" stroke-width="2"/>` +
      `<rect x="-10" y="-8" width="20" height="16" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<line x1="-7" y1="0" x2="7" y2="-5" stroke="${pal.accent}" stroke-width="2"/>` +
      `<line x1="10" y1="0" x2="22" y2="0" stroke="${pal.stroke}" stroke-width="2"/>`;
    return wrapSvg(body, 60, 40, input.ports, pal.stroke);
  }
  if (n.includes("flt") || n.includes("fault")) {
    const pal = DOMAIN_COLORS.protection;
    const body = `<path d="M -4 -14 L -10 2 L 0 2 L -4 15 L 10 -2 L 0 -2 L 4 -14 Z" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75" stroke-linejoin="round"/>`;
    return wrapSvg(body, 52, 44, input.ports, pal.stroke);
  }
  if (n.includes("polygon") || n.includes("mho") || n.includes("dist")) {
    const pal = DOMAIN_COLORS.protection;
    const zone = n.includes("polygon")
      ? `<polygon points="-4,8 10,8 12,-10 -6,-6" fill="${pal.fill}" stroke="${pal.accent}" stroke-width="1.5"/>`
      : `<circle cx="3" cy="-3" r="9" fill="${pal.fill}" stroke="${pal.accent}" stroke-width="1.5"/>`;
    const body =
      `<rect x="-20" y="-16" width="40" height="32" rx="3" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.5"/>` +
      `<line x1="-16" y1="8" x2="16" y2="8" stroke="${pal.stroke}" stroke-width="1" opacity="0.6"/>` +
      `<line x1="-6" y1="-13" x2="-6" y2="13" stroke="${pal.stroke}" stroke-width="1" opacity="0.6"/>` +
      zone;
    return wrapSvg(body, 58, 46, input.ports, pal.stroke);
  }
  if (n.includes("trv")) {
    const pal = DOMAIN_COLORS.protection;
    const body =
      `<rect x="-20" y="-15" width="40" height="30" rx="3" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.6"/>` +
      `<path d="M -15 9 L -6 -9 L 15 -9 M -15 9 Q -8 -10 -2 0 T 14 -3" fill="none" stroke="${pal.accent}" stroke-width="1.5"/>`;
    return wrapSvg(body, 58, 44, input.ports, pal.stroke);
  }
  if (n.includes("seq_filter")) {
    const pal = DOMAIN_COLORS.protection;
    const body =
      `<circle cx="0" cy="0" r="15" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<line x1="0" y1="0" x2="0" y2="-11" stroke="${pal.accent}" stroke-width="1.75"/>` +
      `<line x1="0" y1="0" x2="10" y2="6" stroke="${pal.accent}" stroke-width="1.75"/>` +
      `<line x1="0" y1="0" x2="-10" y2="6" stroke="${pal.accent}" stroke-width="1.75"/>`;
    return wrapSvg(body, 52, 44, input.ports, pal.stroke);
  }
  if (grp.includes("protection") || n.includes("relay")) {
    const pal = DOMAIN_COLORS.protection;
    const curve = `<path d="M -14 -10 Q -12 8 14 10" fill="none" stroke="${pal.stroke}" stroke-width="1.4" opacity="0.8"/>`;
    const body = boxIcon(shortBadge(n), "50/51", pal, 58, 42, curve);
    return wrapSvg(body, 60, 44, input.ports, pal.stroke);
  }

  // 10. Meters, Probes & Interactive I/O
  if (n === "pgb") {
    const pal = DOMAIN_COLORS.meter;
    const body =
      `<rect x="-20" y="-14" width="40" height="28" rx="3" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<path d="M -16 4 Q -10 -10 -4 4 T 8 4 T 16 -4" fill="none" stroke="${pal.accent}" stroke-width="1.8"/>`;
    return wrapSvg(body, 56, 42, input.ports, pal.stroke);
  }
  if (n.includes("slider") || n.includes("dial") || n.includes("pushbutton")) {
    const pal = DOMAIN_COLORS.meter;
    const body = n.includes("dial")
      ? `<circle cx="0" cy="0" r="14" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/><line x1="0" y1="0" x2="8" y2="-8" stroke="${pal.accent}" stroke-width="2.2"/>`
      : `<rect x="-20" y="-12" width="40" height="24" rx="4" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/><line x1="-13" y1="0" x2="13" y2="0" stroke="${pal.stroke}" stroke-width="2"/><circle cx="3" cy="0" r="5" fill="${pal.accent}"/>`;
    return wrapSvg(body, 56, 40, input.ports, pal.stroke);
  }
  if (n.includes("radiolink") || n.includes("datalabel") || n.includes("datatap") || n.includes("datamerge") || n.includes("breakout")) {
    const pal = DOMAIN_COLORS.meter;
    const body =
      `<polygon points="-18,-10 10,-10 20,0 10,10 -18,10" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.6"/>` +
      `<text x="-2" y="3" text-anchor="middle" font-family="monospace" font-size="8" font-weight="700" fill="${pal.accent}">${esc(shortBadge(n))}</text>`;
    return wrapSvg(body, 56, 36, input.ports, pal.stroke);
  }
  if (grp.includes("meter") || n.includes("meter") || n.includes("rms") || n.includes("freq")) {
    const pal = DOMAIN_COLORS.meter;
    const sym = n.includes("volt") ? "V" : n.includes("amm") ? "A" : n.includes("rms") ? "RMS" : "M";
    const body =
      `<circle cx="0" cy="0" r="14" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<text x="0" y="4" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="700" fill="${pal.accent}">${sym}</text>`;
    return wrapSvg(body, 52, 44, input.ports, pal.stroke);
  }

  // 11. Z-Domain & Logical (IEC Gate / Bistable Symbols)
  if (n.startsWith("z") && (grp.includes("zdomain") || n.includes("zdelay") || n.includes("zreal") || n.includes("zint") || n.includes("zpi") || n.includes("zdiff") || n.includes("zlead") || n.includes("ztrans"))) {
    const pal = DOMAIN_COLORS.control;
    const labelZ = n.includes("delay") ? "z⁻¹" : n.includes("int") ? "T/(z-1)" : "H(z)";
    return wrapSvg(boxIcon(labelZ, shortBadge(n), pal, 58, 42), 60, 42, input.ports, pal.stroke);
  }
  if (grp.includes("logical") || n.includes("logic") || n.includes("ff") || n.includes("shiftreg") || n.includes("mux") || n.includes("gate")) {
    const pal = DOMAIN_COLORS.control;
    if (n.includes("mux") || n.includes("select")) {
      const body =
        `<polygon points="-16,-15 16,-9 16,9 -16,15" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
        `<text x="0" y="3" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="700" fill="${pal.accent}">MUX</text>`;
      return wrapSvg(body, 56, 44, input.ports, pal.stroke);
    }
    if (n.includes("ff") || n.includes("flip")) {
      const body =
        `<rect x="-18" y="-15" width="36" height="30" rx="2" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
        `<text x="-11" y="-5" font-family="monospace" font-size="8" font-weight="700" fill="${pal.accent}">S</text>` +
        `<text x="-11" y="10" font-family="monospace" font-size="8" font-weight="700" fill="${pal.accent}">R</text>` +
        `<text x="11" y="3" text-anchor="middle" font-family="monospace" font-size="9" font-weight="700" fill="${pal.accent}">Q</text>`;
      return wrapSvg(body, 56, 44, input.ports, pal.stroke);
    }
    const body =
      `<path d="M -16 -13 L 0 -13 A 13 13 0 0 1 0 13 L -16 13 Z" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.75"/>` +
      `<text x="-4" y="3" text-anchor="middle" font-family="monospace" font-size="8" font-weight="700" fill="${pal.accent}">&amp;/≥1</text>`;
    return wrapSvg(body, 56, 42, input.ports, pal.stroke);
  }

  // 12. CSMF Control Blocks (specific math symbols)
  const csmfMath: Record<string, [string, string]> = {
    realpole: ["K/(1+sT)", "POLE"],
    leadlag: ["1+sT1", "1+sT2"],
    diffpole: ["sT", "1+sT"],
    integral: ["1 / s", "INT"],
    pi_ctlr: ["PI", "Kp+Ki/s"],
    gain: ["× K", "GAIN"],
    sumjct: ["Σ", "SUM"],
    sum: ["Σ", "SUM"],
    mult: ["×", "MUL"],
    div: ["÷", "DIV"],
    abs: ["|u|", "ABS"],
    sqrt: ["√u", "SQRT"],
    square: ["u²", "SQR"],
    inv: ["1/u", "INV"],
    hardlimit: ["[min,max]", "LIM"],
    ratelimit: ["du/dt", "RATE"],
    tdelay: ["e^-sT", "DELAY"],
    abcdq0: ["abc⇄dq0", "PARK"],
    xy_table: ["f(x)", "TABLE"],
    pll: ["PLL", "θ, ω"],
    fft: ["FFT", "HARM"],
    pwm: ["PWM", "GATE"],
  };
  const mathMatch = csmfMath[n];
  if (mathMatch) {
    const pal = DOMAIN_COLORS.control;
    return wrapSvg(boxIcon(mathMatch[0], mathMatch[1], pal), 60, 42, input.ports, pal.stroke);
  }

  // 13. Default cleanroom domain badge (zero generic unstyled rectangles)
  const pal =
    input.domain === "electrical"
      ? DOMAIN_COLORS.electrical
      : input.domain === "meter"
        ? DOMAIN_COLORS.meter
        : DOMAIN_COLORS.control;
  const sub = grp ? grp.split(",")[0]!.slice(0, 8).toUpperCase() : input.domain.toUpperCase();
  return wrapSvg(boxIcon(shortBadge(n), sub, pal), Math.max(w, 58), Math.max(h, 42), input.ports, pal.stroke);
}
