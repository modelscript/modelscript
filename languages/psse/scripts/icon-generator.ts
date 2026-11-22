// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DaeArchetypeId } from "../src/schema/index.js";
import type { PsseDyrCategory } from "../src/types.js";

export interface GeneratedPortSpec {
  name: string;
  kind: "electrical" | "signal" | "mechanical";
  side: "left" | "right" | "top" | "bottom";
  dx: number;
  dy: number;
}

export interface GeneratedIconDiagram {
  width: number;
  height: number;
  ports: GeneratedPortSpec[];
  svg: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function distributePorts(
  leftNames: Array<{ name: string; kind: "electrical" | "signal" | "mechanical" }>,
  rightNames: Array<{ name: string; kind: "electrical" | "signal" | "mechanical" }>,
  width: number,
  height: number,
): GeneratedPortSpec[] {
  const ports: GeneratedPortSpec[] = [];
  const halfW = width / 2;

  const placeSide = (
    items: Array<{ name: string; kind: "electrical" | "signal" | "mechanical" }>,
    side: "left" | "right",
  ) => {
    const n = items.length;
    if (n === 0) return;
    const dx = side === "left" ? -halfW : halfW;
    if (n === 1) {
      ports.push({ name: items[0]!.name, kind: items[0]!.kind, side, dx, dy: 0 });
      return;
    }
    const span = Math.max(16, height - 16);
    for (let i = 0; i < n; i++) {
      const dy = Math.round(-span / 2 + (span * i) / (n - 1));
      ports.push({ name: items[i]!.name, kind: items[i]!.kind, side, dx, dy });
    }
  };

  placeSide(leftNames, "left");
  placeSide(rightNames, "right");
  return ports;
}

function domainAccent(cat: PsseDyrCategory, sub?: string): string {
  if (sub?.startsWith("ibr_")) return "#10b981"; // emerald for IBR / renewables
  switch (cat) {
    case "generator":
      return "#2563eb"; // royal blue
    case "exciter":
      return "#7c3aed"; // violet
    case "governor":
      return "#d97706"; // amber
    case "stabilizer":
      return "#0891b2"; // cyan
    case "load":
      return "#dc2626"; // crimson
    case "facts":
      return "#0d9488"; // teal
    case "hvdc":
      return "#4f46e5"; // indigo
    case "relay":
      return "#e11d48"; // rose
    default:
      return "#64748b"; // slate
  }
}

function badgeLabel(modelName: string): string {
  return modelName.length > 9 ? modelName.slice(0, 9) : modelName;
}

/**
 * Emits the inner cleanroom IEEE/IEC/control-block vector glyph centered inside `[0..W, 0..H]`.
 */
function glyphForArchetype(archetype: DaeArchetypeId, accent: string): string {
  switch (archetype) {
    // === Generators & Rotating Machines ===
    case "sync_classical_2o":
    case "sync_transient_3o":
      return (
        `<circle cx="40" cy="21" r="13" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.6"/>` +
        `<path d="M32 21 Q36 14 40 21 T48 21" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`
      );
    case "sync_subtrans_round_6o":
      return (
        `<circle cx="40" cy="21" r="13" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.6"/>` +
        `<circle cx="40" cy="21" r="9.5" fill="none" stroke="${accent}" stroke-width="1" stroke-dasharray="2.5 2"/>` +
        `<path d="M33 21 Q36.5 15 40 21 T47 21" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`
      );
    case "sync_subtrans_salient_5o":
      return (
        `<circle cx="40" cy="21" r="13" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.6"/>` +
        `<rect x="37" y="10" width="6" height="22" rx="1.5" fill="none" stroke="${accent}" stroke-width="1.1"/>` +
        `<path d="M33 21 Q36.5 15 40 21 T47 21" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`
      );
    case "sync_gentpj_6o":
      return (
        `<circle cx="36" cy="21" r="12" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.6"/>` +
        `<path d="M29 21 Q32.5 15 36 21 T43 21" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
        `<path d="M51 29 Q54 29 57 22 T64 13" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>` +
        `<line x1="51" y1="29" x2="64" y2="29" stroke="currentColor" stroke-width="0.9"/>`
      );
    case "induction_machine_4o":
      return (
        `<circle cx="40" cy="21" r="13" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.6"/>` +
        `<text x="40" y="25" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" font-weight="700" fill="currentColor">IM</text>`
      );
    case "wind_ind_gen_4o":
    case "wind_type3_dfag":
      return (
        `<circle cx="33" cy="20" r="2.2" fill="currentColor"/>` +
        `<path d="M33 18 L31 8 L35 12 Z M35 21 L44 26 L38 25 Z M31 21 L22 26 L27 20 Z" fill="${accent}" stroke="currentColor" stroke-width="1"/>` +
        `<rect x="48" y="12" width="16" height="16" rx="2" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.3"/>` +
        `<path d="M51 20 Q53.5 15 56 20 T61 20" fill="none" stroke="currentColor" stroke-width="1.3"/>`
      );

    // === Exciters, Limiters & Compensators ===
    case "exc_sexs":
    case "exc_scrx":
      return (
        `<circle cx="20" cy="21" r="5" fill="none" stroke="currentColor" stroke-width="1.3"/>` +
        `<path d="M18 21 H22 M20 19 V23" stroke="currentColor" stroke-width="1.1"/>` +
        `<line x1="25" y1="21" x2="31" y2="21" stroke="currentColor" stroke-width="1.3"/>` +
        `<rect x="31" y="11" width="32" height="20" rx="2" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.4"/>` +
        `<path d="M36 27 L41 27 L53 15 L58 15" fill="none" stroke="${accent}" stroke-width="1.5"/>`
      );
    case "exc_ieee_dc":
    case "exc_ieee_ac":
      return (
        `<rect x="14" y="11" width="22" height="18" rx="2" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.3"/>` +
        `<text x="25" y="23" text-anchor="middle" font-family="ui-monospace,monospace" font-size="8.5" font-weight="700" fill="currentColor">KA</text>` +
        `<line x1="36" y1="20" x2="43" y2="20" stroke="currentColor" stroke-width="1.3"/>` +
        `<polygon points="43,12 58,20 43,28" fill="${accent}" fill-opacity="0.15" stroke="currentColor" stroke-width="1.3"/>` +
        `<line x1="58" y1="12" x2="58" y2="28" stroke="${accent}" stroke-width="1.6"/>`
      );
    case "exc_ieee_st":
    case "exc_st4b_pi":
    case "exc_pid":
      return (
        `<rect x="14" y="11" width="22" height="18" rx="2" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.3"/>` +
        `<text x="25" y="23" text-anchor="middle" font-family="ui-monospace,monospace" font-size="8.5" font-weight="700" fill="currentColor">PI</text>` +
        `<line x1="36" y1="20" x2="42" y2="20" stroke="currentColor" stroke-width="1.3"/>` +
        `<rect x="42" y="11" width="24" height="18" rx="2" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.3"/>` +
        `<path d="M46 25 L50 25 L58 15 L62 15" fill="none" stroke="${accent}" stroke-width="1.5"/>`
      );
    case "lim_oel":
    case "lim_uel":
    case "lim_vhz":
      return (
        `<rect x="20" y="9" width="40" height="24" rx="2" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.4"/>` +
        `<path d="M25 28 H32 L48 14 H55" fill="none" stroke="${accent}" stroke-width="1.8" stroke-linecap="round"/>` +
        `<line x1="40" y1="11" x2="40" y2="31" stroke="currentColor" stroke-width="0.7" stroke-dasharray="2 2"/>`
      );
    case "comp_rc_xc":
      return (
        `<path d="M16 21 H24 L27 15 L31 27 L35 15 L39 27 L42 21 H46" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>` +
        `<path d="M46 21 Q49 13 52 21 Q55 13 58 21 Q61 13 64 21" fill="none" stroke="${accent}" stroke-width="1.5"/>`
      );

    // === Governors & Wind Aero/Pitch ===
    case "gov_steam_simple":
    case "gov_steam_reheat":
    case "gov_lcfb":
      return (
        `<path d="M16 14 L26 20 L16 26 Z M36 14 L26 20 L36 26 Z" fill="${accent}" fill-opacity="0.15" stroke="currentColor" stroke-width="1.3"/>` +
        `<line x1="26" y1="11" x2="26" y2="20" stroke="currentColor" stroke-width="1.3"/>` +
        `<line x1="21" y1="11" x2="31" y2="11" stroke="currentColor" stroke-width="1.4"/>` +
        `<polygon points="42,12 64,16 64,24 42,28" fill="${accent}" fill-opacity="0.15" stroke="currentColor" stroke-width="1.4"/>`
      );
    case "gov_gast":
    case "gov_ggov1_temp":
    case "gov_degov":
      return (
        `<polygon points="16,13 38,17 38,23 16,27" fill="${accent}" fill-opacity="0.14" stroke="currentColor" stroke-width="1.3"/>` +
        `<line x1="38" y1="20" x2="44" y2="20" stroke="currentColor" stroke-width="1.3"/>` +
        `<path d="M48 27 Q54 11 60 27 Q54 22 48 27 Z" fill="${accent}" fill-opacity="0.3" stroke="${accent}" stroke-width="1.3"/>`
      );
    case "gov_hydro_penstock":
    case "gov_hydro_pid":
      return (
        `<path d="M16 14 H34 L46 26 H64" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>` +
        `<path d="M16 20 H31 L43 32 H64" fill="none" stroke="currentColor" stroke-width="1.3"/>` +
        `<circle cx="52" cy="17" r="6" fill="${accent}" fill-opacity="0.15" stroke="currentColor" stroke-width="1.3"/>`
      );
    case "wind_drivetrain_2mass":
      return (
        `<rect x="16" y="13" width="14" height="16" rx="2" fill="${accent}" fill-opacity="0.16" stroke="currentColor" stroke-width="1.4"/>` +
        `<path d="M30 21 L34 15 L38 27 L42 15 L46 27 L50 21" fill="none" stroke="${accent}" stroke-width="1.5"/>` +
        `<rect x="50" y="13" width="14" height="16" rx="2" fill="${accent}" fill-opacity="0.16" stroke="currentColor" stroke-width="1.4"/>`
      );
    case "wind_pitch_torque":
      return (
        `<path d="M22 28 L40 12 L48 16 L28 30 Z" fill="${accent}" fill-opacity="0.18" stroke="currentColor" stroke-width="1.3"/>` +
        `<path d="M52 13 A10 10 0 0 1 60 25" fill="none" stroke="${accent}" stroke-width="1.6" stroke-linecap="round"/>` +
        `<polygon points="60,26 56,22 62,21" fill="${accent}"/>`
      );

    // === Power System Stabilizers ===
    case "pss_single_leadlag":
    case "pss_dual_ramptrack":
      return (
        `<rect x="14" y="11" width="22" height="18" rx="2" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.3"/>` +
        `<path d="M18 25 Q24 14 32 16" fill="none" stroke="${accent}" stroke-width="1.5"/>` +
        `<line x1="36" y1="20" x2="43" y2="20" stroke="currentColor" stroke-width="1.3"/>` +
        `<rect x="43" y="11" width="23" height="18" rx="2" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.3"/>` +
        `<text x="54.5" y="23" text-anchor="middle" font-family="ui-monospace,monospace" font-size="8" font-weight="700" fill="currentColor">LL</text>`
      );
    case "pss_multiband_4b":
      return (
        `<rect x="18" y="8" width="44" height="6" rx="1.5" fill="${accent}" fill-opacity="0.18" stroke="currentColor" stroke-width="1.1"/>` +
        `<rect x="18" y="17" width="44" height="6" rx="1.5" fill="${accent}" fill-opacity="0.18" stroke="currentColor" stroke-width="1.1"/>` +
        `<rect x="18" y="26" width="44" height="6" rx="1.5" fill="${accent}" fill-opacity="0.18" stroke="currentColor" stroke-width="1.1"/>` +
        `<text x="40" y="22.5" text-anchor="middle" font-family="ui-monospace,monospace" font-size="6.5" font-weight="700" fill="currentColor">LF/IF/HF</text>`
      );

    // === IBRs & Renewables ===
    case "ibr_regc_converter":
    case "ibr_iec_generic":
      return (
        `<rect x="22" y="9" width="36" height="24" rx="2" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.4"/>` +
        `<line x1="22" y1="33" x2="58" y2="9" stroke="currentColor" stroke-width="1.2"/>` +
        `<line x1="26" y1="15" x2="35" y2="15" stroke="${accent}" stroke-width="1.6"/>` +
        `<line x1="26" y1="19" x2="35" y2="19" stroke="${accent}" stroke-width="1.2" stroke-dasharray="2 1.5"/>` +
        `<path d="M43 26 Q46.5 21 50 26 T56 26" fill="none" stroke="currentColor" stroke-width="1.4"/>`
      );
    case "ibr_reec_control":
    case "ibr_repc_plant":
    case "ibr_dera_aggregate":
      return (
        `<rect x="18" y="9" width="44" height="24" rx="2" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.4"/>` +
        `<path d="M24 27 L32 15 L44 25 L56 13" fill="none" stroke="${accent}" stroke-width="1.6" stroke-linejoin="round"/>` +
        `<circle cx="32" cy="15" r="2" fill="currentColor"/>` +
        `<circle cx="44" cy="25" r="2" fill="currentColor"/>`
      );
    case "ibr_regfm_vsm":
      return (
        `<circle cx="40" cy="21" r="12" fill="${accent}" fill-opacity="0.12" stroke="${accent}" stroke-width="1.6" stroke-dasharray="3 2"/>` +
        `<path d="M32 21 Q36 14 40 21 T48 21" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
        `<text x="40" y="31" text-anchor="middle" font-family="ui-monospace,monospace" font-size="6.5" font-weight="700" fill="${accent}">GFM</text>`
      );

    // === Dynamic & Composite Loads ===
    case "load_static_zipf":
      return (
        `<polygon points="28,11 52,11 40,31" fill="${accent}" fill-opacity="0.15" stroke="currentColor" stroke-width="1.5"/>` +
        `<text x="40" y="21" text-anchor="middle" font-family="ui-monospace,monospace" font-size="8" font-weight="700" fill="currentColor">ZIP</text>`
      );
    case "load_ind_motor":
    case "load_1ph_stall":
      return (
        `<circle cx="40" cy="21" r="12" fill="${accent}" fill-opacity="0.14" stroke="currentColor" stroke-width="1.5"/>` +
        `<text x="40" y="25" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" font-weight="700" fill="currentColor">M</text>`
      );
    case "load_complex_clod":
    case "load_composite_cmpldw":
      return (
        `<circle cx="28" cy="20" r="9" fill="${accent}" fill-opacity="0.14" stroke="currentColor" stroke-width="1.3"/>` +
        `<text x="28" y="23.5" text-anchor="middle" font-family="ui-monospace,monospace" font-size="8.5" font-weight="700" fill="currentColor">M</text>` +
        `<line x1="37" y1="20" x2="45" y2="20" stroke="currentColor" stroke-width="1.3"/>` +
        `<polygon points="45,12 61,12 53,28" fill="${accent}" fill-opacity="0.14" stroke="currentColor" stroke-width="1.3"/>`
      );

    // === FACTS & HVDC ===
    case "facts_svc":
    case "facts_tcsc":
      return (
        `<line x1="22" y1="15" x2="22" y2="27" stroke="currentColor" stroke-width="1.6"/>` +
        `<line x1="28" y1="15" x2="28" y2="27" stroke="currentColor" stroke-width="1.6"/>` +
        `<line x1="28" y1="21" x2="38" y2="21" stroke="currentColor" stroke-width="1.3"/>` +
        `<polygon points="38,14 48,21 38,28" fill="${accent}" fill-opacity="0.2" stroke="currentColor" stroke-width="1.3"/>` +
        `<polygon points="58,14 48,21 58,28" fill="${accent}" fill-opacity="0.2" stroke="currentColor" stroke-width="1.3"/>`
      );
    case "facts_statcom":
    case "hvdc_lcc_2t":
    case "hvdc_vsc_2t":
      return (
        `<rect x="16" y="10" width="18" height="22" rx="2" fill="${accent}" fill-opacity="0.14" stroke="currentColor" stroke-width="1.3"/>` +
        `<line x1="16" y1="32" x2="34" y2="10" stroke="currentColor" stroke-width="1.1"/>` +
        `<line x1="34" y1="16" x2="46" y2="16" stroke="${accent}" stroke-width="1.8"/>` +
        `<line x1="34" y1="26" x2="46" y2="26" stroke="${accent}" stroke-width="1.8"/>` +
        `<rect x="46" y="10" width="18" height="22" rx="2" fill="${accent}" fill-opacity="0.14" stroke="currentColor" stroke-width="1.3"/>` +
        `<line x1="46" y1="32" x2="64" y2="10" stroke="currentColor" stroke-width="1.1"/>`
      );

    // === Relays & Measurements ===
    case "relay_branch_dist":
      return (
        `<line x1="24" y1="29" x2="56" y2="29" stroke="currentColor" stroke-width="1"/>` +
        `<line x1="34" y1="9" x2="34" y2="33" stroke="currentColor" stroke-width="1"/>` +
        `<circle cx="43" cy="20" r="10" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-width="1.5"/>` +
        `<text x="53" y="16" font-family="ui-monospace,monospace" font-size="7.5" font-weight="700" fill="currentColor">21</text>`
      );
    case "relay_load_shed":
    case "relay_gen_trip":
      return (
        `<rect x="20" y="9" width="40" height="24" rx="3" fill="${accent}" fill-opacity="0.14" stroke="currentColor" stroke-width="1.4"/>` +
        `<text x="40" y="24" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9.5" font-weight="700" fill="${accent}">81/27</text>`
      );
    case "meas_bus_freq":
      return (
        `<circle cx="40" cy="21" r="12" fill="${accent}" fill-opacity="0.12" stroke="currentColor" stroke-width="1.4"/>` +
        `<text x="40" y="24.5" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" font-weight="700" fill="currentColor">Hz</text>`
      );
  }
}

/**
 * Generates cleanroom schematic SVG icon and multi-port geometry for any PSS/E DYR model.
 */
export function generateCleanroomDyrIcon(
  modelName: string,
  archetype: DaeArchetypeId,
  category: PsseDyrCategory,
  subCategory?: string,
): GeneratedIconDiagram {
  let left: Array<{ name: string; kind: "electrical" | "signal" | "mechanical" }>;
  let right: Array<{ name: string; kind: "electrical" | "signal" | "mechanical" }>;

  if (archetype === "ibr_regc_converter" || archetype === "ibr_regfm_vsm" || archetype === "ibr_iec_generic") {
    left = [
      { name: "Ipcmd", kind: "signal" },
      { name: "Iqcmd", kind: "signal" },
    ];
    right = [
      { name: "Vterm", kind: "electrical" },
      { name: "Ip", kind: "electrical" },
      { name: "Iq", kind: "electrical" },
    ];
  } else if (archetype === "ibr_reec_control" || archetype === "ibr_repc_plant" || archetype === "ibr_dera_aggregate") {
    left = [
      { name: "Vterm", kind: "signal" },
      { name: "Pref", kind: "signal" },
    ];
    right = [
      { name: "Ipcmd", kind: "signal" },
      { name: "Iqcmd", kind: "signal" },
    ];
  } else if (archetype === "pss_dual_ramptrack" || archetype === "pss_multiband_4b") {
    left = [
      { name: "dOmega", kind: "signal" },
      { name: "Pe", kind: "signal" },
    ];
    right = [{ name: "Vs", kind: "signal" }];
  } else {
    switch (category) {
      case "generator":
        left = [
          { name: "Efd", kind: "signal" },
          { name: "Pmech", kind: "mechanical" },
        ];
        right = [
          { name: "Pe", kind: "electrical" },
          { name: "omega", kind: "signal" },
        ];
        break;
      case "exciter":
        left = [
          { name: "Vterm", kind: "signal" },
          { name: "Vs", kind: "signal" },
        ];
        right = [{ name: "Efd", kind: "signal" }];
        break;
      case "governor":
        left = [
          { name: "dOmega", kind: "signal" },
          { name: "Pref", kind: "signal" },
        ];
        right = [{ name: "Pmech", kind: "mechanical" }];
        break;
      case "stabilizer":
        left = [{ name: "dOmega", kind: "signal" }];
        right = [{ name: "Vs", kind: "signal" }];
        break;
      case "load":
        left = [{ name: "Vterm", kind: "electrical" }];
        right = [
          { name: "Pload", kind: "signal" },
          { name: "Qload", kind: "signal" },
        ];
        break;
      case "facts":
        left = [{ name: "Vterm", kind: "electrical" }];
        right = [{ name: "Qinj", kind: "electrical" }];
        break;
      case "hvdc":
        left = [{ name: "Vac_r", kind: "electrical" }];
        right = [
          { name: "Pdc", kind: "electrical" },
          { name: "Qdc", kind: "electrical" },
        ];
        break;
      case "relay":
        left = [
          { name: "Vterm", kind: "signal" },
          { name: "Freq", kind: "signal" },
        ];
        right = [{ name: "Trip", kind: "signal" }];
        break;
      default:
        left = [{ name: "In", kind: "signal" }];
        right = [{ name: "Out", kind: "signal" }];
        break;
    }
  }

  const maxSide = Math.max(left.length, right.length);
  const width = 80;
  const height = maxSide >= 3 ? 56 : 48;
  const ports = distributePorts(left, right, width, height);
  const accent = domainAccent(category, subCategory);
  const glyph = glyphForArchetype(archetype, accent);
  const label = escapeXml(badgeLabel(modelName));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="5" fill="none" stroke="${accent}" stroke-width="1.4"/>` +
    glyph +
    `<text x="${width / 2}" y="${height - 4.5}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="7.5" font-weight="600" fill="currentColor">${label}</text>` +
    `</svg>`;

  return { width, height, ports, svg };
}
