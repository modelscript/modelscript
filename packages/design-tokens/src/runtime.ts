// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ModelScript & Ansatz Design Tokens — Runtime Color & Theme Resolver
 *
 * Provides resolved hex / rgba values for non-DOM visualization engines
 * (Three.js WebGL / WebGPU, Canvas 2D, Monaco Editor, Vega-Lite, SVG exporters)
 * where CSS custom properties cannot be directly evaluated.
 */

export type ThemeMode = "dark" | "light";

export type DomainClusterId = "core" | "power" | "fluid" | "mechanics" | "aero" | "cad" | "bio" | "med";

export interface ResolvedStatusTokens {
  fg: string;
  bg: string;
  border: string;
}

export interface ResolvedDomainTokens {
  color: string;
  bg: string;
  border: string;
}

export interface ResolvedThemeTokens {
  mode: ThemeMode;
  bg: string;
  bgAlt: string;
  bgElevated: string;
  bgInset: string;
  surfaceHover: string;
  surfaceSelected: string;
  border: string;
  borderStrong: string;
  divider: string;
  gridLine: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textHeading: string;
  link: string;
  linkHover: string;
  brand: string;
  brandHover: string;
  brandActive: string;
  brandSoft: string;
  brandContrast: string;
  status: {
    pass: ResolvedStatusTokens;
    warn: ResolvedStatusTokens;
    fail: ResolvedStatusTokens;
    info: ResolvedStatusTokens;
  };
  domains: Record<DomainClusterId, ResolvedDomainTokens>;
}

export const LIGHT_TOKENS: ResolvedThemeTokens = {
  mode: "light",
  bg: "#ffffff",
  bgAlt: "#f6f8fa",
  bgElevated: "#ffffff",
  bgInset: "#f8fafc",
  surfaceHover: "rgba(15, 23, 42, 0.045)",
  surfaceSelected: "rgba(8, 145, 178, 0.1)",
  border: "rgba(15, 23, 42, 0.12)",
  borderStrong: "rgba(15, 23, 42, 0.18)",
  divider: "rgba(15, 23, 42, 0.08)",
  gridLine: "rgba(15, 23, 42, 0.045)",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#64748b",
  textHeading: "#020617",
  link: "#0e7490",
  linkHover: "#155e75",
  brand: "#0e7490",
  brandHover: "#0891b2",
  brandActive: "#155e75",
  brandSoft: "rgba(8, 145, 178, 0.12)",
  brandContrast: "#ffffff",
  status: {
    pass: {
      fg: "#047857",
      bg: "rgba(5, 150, 105, 0.12)",
      border: "rgba(5, 150, 105, 0.32)",
    },
    warn: {
      fg: "#92400e",
      bg: "rgba(217, 119, 6, 0.12)",
      border: "rgba(217, 119, 6, 0.32)",
    },
    fail: {
      fg: "#be123c",
      bg: "rgba(225, 29, 72, 0.12)",
      border: "rgba(225, 29, 72, 0.32)",
    },
    info: {
      fg: "#0369a1",
      bg: "rgba(8, 145, 178, 0.12)",
      border: "rgba(8, 145, 178, 0.32)",
    },
  },
  domains: {
    core: { color: "#0e7490", bg: "rgba(14, 116, 144, 0.12)", border: "rgba(14, 116, 144, 0.32)" },
    power: { color: "#b45309", bg: "rgba(180, 83, 9, 0.12)", border: "rgba(180, 83, 9, 0.32)" },
    fluid: { color: "#0369a1", bg: "rgba(3, 105, 161, 0.12)", border: "rgba(3, 105, 161, 0.32)" },
    mechanics: { color: "#047857", bg: "rgba(4, 120, 87, 0.12)", border: "rgba(4, 120, 87, 0.32)" },
    aero: { color: "#4338ca", bg: "rgba(67, 56, 202, 0.12)", border: "rgba(67, 56, 202, 0.32)" },
    cad: { color: "#7e22ce", bg: "rgba(126, 34, 206, 0.12)", border: "rgba(126, 34, 206, 0.32)" },
    bio: { color: "#be123c", bg: "rgba(190, 18, 60, 0.12)", border: "rgba(190, 18, 60, 0.32)" },
    med: { color: "#c2410c", bg: "rgba(194, 65, 12, 0.12)", border: "rgba(194, 65, 12, 0.32)" },
  },
};

export const DARK_TOKENS: ResolvedThemeTokens = {
  mode: "dark",
  bg: "#0a0f1c",
  bgAlt: "#070b15",
  bgElevated: "#0f1626",
  bgInset: "#050811",
  surfaceHover: "rgba(148, 163, 184, 0.08)",
  surfaceSelected: "rgba(34, 211, 238, 0.1)",
  border: "rgba(148, 163, 184, 0.2)",
  borderStrong: "rgba(148, 163, 184, 0.3)",
  divider: "rgba(148, 163, 184, 0.14)",
  gridLine: "rgba(148, 163, 184, 0.055)",
  textPrimary: "#e2e8f0",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",
  textHeading: "#f8fafc",
  link: "#22d3ee",
  linkHover: "#67e8f9",
  brand: "#0891b2",
  brandHover: "#06b6d4",
  brandActive: "#0e7490",
  brandSoft: "rgba(34, 211, 238, 0.14)",
  brandContrast: "#ffffff",
  status: {
    pass: {
      fg: "#34d399",
      bg: "rgba(52, 211, 153, 0.15)",
      border: "rgba(52, 211, 153, 0.38)",
    },
    warn: {
      fg: "#fbbf24",
      bg: "rgba(251, 191, 36, 0.15)",
      border: "rgba(251, 191, 36, 0.38)",
    },
    fail: {
      fg: "#fb7185",
      bg: "rgba(251, 113, 133, 0.15)",
      border: "rgba(251, 113, 133, 0.38)",
    },
    info: {
      fg: "#38bdf8",
      bg: "rgba(56, 189, 248, 0.15)",
      border: "rgba(56, 189, 248, 0.38)",
    },
  },
  domains: {
    core: { color: "#22d3ee", bg: "rgba(34, 211, 238, 0.14)", border: "rgba(34, 211, 238, 0.36)" },
    power: { color: "#fbbf24", bg: "rgba(251, 191, 36, 0.14)", border: "rgba(251, 191, 36, 0.36)" },
    fluid: { color: "#38bdf8", bg: "rgba(56, 189, 248, 0.14)", border: "rgba(56, 189, 248, 0.36)" },
    mechanics: { color: "#34d399", bg: "rgba(52, 211, 153, 0.14)", border: "rgba(52, 211, 153, 0.36)" },
    aero: { color: "#818cf8", bg: "rgba(129, 140, 248, 0.14)", border: "rgba(129, 140, 248, 0.36)" },
    cad: { color: "#c084fc", bg: "rgba(192, 132, 252, 0.14)", border: "rgba(192, 132, 252, 0.36)" },
    bio: { color: "#fb7185", bg: "rgba(251, 113, 133, 0.14)", border: "rgba(251, 113, 133, 0.36)" },
    med: { color: "#fb923c", bg: "rgba(251, 146, 60, 0.14)", border: "rgba(251, 146, 60, 0.36)" },
  },
};

export function getResolvedTheme(mode: ThemeMode = "dark"): ResolvedThemeTokens {
  return mode === "light" ? LIGHT_TOKENS : DARK_TOKENS;
}

/**
 * Maps a polyglot language ID to its canonical domain cluster ID.
 */
export function getDomainClusterForLanguage(langId: string): DomainClusterId {
  const l = (langId || "").toLowerCase();
  if (["modelscript", "modelica", "sysml2", "sysml", "kerml", "ssp", "reqif", "owl2", "csv"].includes(l)) {
    return "core";
  }
  if (["pscad", "spice", "verilog-a", "opendss", "psse", "ibis", "touchstone"].includes(l)) {
    return "power";
  }
  if (["olga", "lps", "aspen", "eclipse", "epanet", "swmm", "relap5", "energyplus"].includes(l)) {
    return "fluid";
  }
  if (["simpack", "gensys", "urdf", "adams", "gtsuite", "sima", "opendrive", "openscenario", "autosar"].includes(l)) {
    return "mechanics";
  }
  if (["simulink", "easy5", "jsbsim", "rocets", "ccsds", "plcopen", "automationml"].includes(l)) {
    return "aero";
  }
  if (["step", "scad", "qif", "fea", "cfd"].includes(l)) {
    return "cad";
  }
  if (
    [
      "cantera",
      "sbml",
      "smiles",
      "antimony",
      "sbol",
      "bngl",
      "sedml",
      "pdb",
      "genbank",
      "gproms",
      "phreeqc",
      "c",
      "fortran",
    ].includes(l)
  ) {
    return "bio";
  }
  if (["opensim", "dicom-rt", "cellml", "febio", "nifti", "topas", "three-mf", "igtl"].includes(l)) {
    return "med";
  }
  return "core";
}
