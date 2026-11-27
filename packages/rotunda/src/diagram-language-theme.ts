// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ExtrudedWaferStyle } from "./svg-extruder.js";

export interface DiagramLanguageTheme {
  readonly languageId: string;
  /** Short prominent badge shown on the VR Diagram Stage, Podium, and File Carousel (e.g. "MODELICA", "SysML v2"). */
  readonly badgeLabel: string;
  /** Descriptive engineering diagram paradigm label (e.g. "Acausal Physical Schematic", "SysML v2 Architecture"). */
  readonly diagramKindLabel: string;
  /** Primary accent hex color used for stage trim, badges, and active highlights. */
  readonly accentColor: string;
  /** Secondary complementary accent hex color. */
  readonly secondaryColor: string;
  /** Stage floor/grid tint matching the engineering discipline. */
  readonly gridTint: string;
  /** Header pill background color. */
  readonly headerBg: string;
  /** Subtle tint applied to the 3D Diagram Stage frame & badges. */
  readonly stageGlow: string;
  /** Recommended wafer presentation style for this diagram type. */
  readonly recommendedWaferStyle: ExtrudedWaferStyle;
}

const LANGUAGE_THEME_MAP: Record<string, Omit<DiagramLanguageTheme, "languageId">> = {
  modelica: {
    badgeLabel: "MODELICA",
    diagramKindLabel: "Acausal Multi-Domain Physical Schematic",
    accentColor: "#2563eb",
    secondaryColor: "#38bdf8",
    gridTint: "#3b82f6",
    headerBg: "#0c1d3d",
    stageGlow: "#2563eb",
    recommendedWaferStyle: "tactile-tile",
  },
  modelscript: {
    badgeLabel: "MODELSCRIPT",
    diagramKindLabel: "Polyglot Systems & Physics Schematic",
    accentColor: "#0284c7",
    secondaryColor: "#22d3ee",
    gridTint: "#0ea5e9",
    headerBg: "#082032",
    stageGlow: "#0284c7",
    recommendedWaferStyle: "tactile-tile",
  },
  sysml2: {
    badgeLabel: "SysML v2",
    diagramKindLabel: "Systems Architecture (BDD / IBD)",
    accentColor: "#7c3aed",
    secondaryColor: "#c084fc",
    gridTint: "#8b5cf6",
    headerBg: "#1e103c",
    stageGlow: "#7c3aed",
    recommendedWaferStyle: "tactile-tile",
  },
  spice: {
    badgeLabel: "SPICE",
    diagramKindLabel: "Analog & Mixed-Signal Circuit Netlist",
    accentColor: "#059669",
    secondaryColor: "#34d399",
    gridTint: "#10b981",
    headerBg: "#062c22",
    stageGlow: "#059669",
    recommendedWaferStyle: "pure-relief",
  },
  pscad: {
    badgeLabel: "PSCAD",
    diagramKindLabel: "Electromagnetic Transients (EMT) Grid",
    accentColor: "#d97706",
    secondaryColor: "#fbbf24",
    gridTint: "#f59e0b",
    headerBg: "#2e1a05",
    stageGlow: "#d97706",
    recommendedWaferStyle: "tactile-tile",
  },
  psse: {
    badgeLabel: "PSS/E",
    diagramKindLabel: "Transmission Power-Flow One-Line",
    accentColor: "#ea580c",
    secondaryColor: "#fb923c",
    gridTint: "#f97316",
    headerBg: "#2c1205",
    stageGlow: "#ea580c",
    recommendedWaferStyle: "tactile-tile",
  },
  simulink: {
    badgeLabel: "SIMULINK",
    diagramKindLabel: "Causal Signal-Flow Block Diagram",
    accentColor: "#4f46e5",
    secondaryColor: "#818cf8",
    gridTint: "#6366f1",
    headerBg: "#17143b",
    stageGlow: "#4f46e5",
    recommendedWaferStyle: "tactile-tile",
  },
  scad: {
    badgeLabel: "OpenSCAD",
    diagramKindLabel: "Parametric Constructive Solid Geometry",
    accentColor: "#10b981",
    secondaryColor: "#6ee7b7",
    gridTint: "#10b981",
    headerBg: "#06291e",
    stageGlow: "#10b981",
    recommendedWaferStyle: "tactile-tile",
  },
  urdf: {
    badgeLabel: "URDF",
    diagramKindLabel: "Kinematic Robot Joint & Link Tree",
    accentColor: "#0891b2",
    secondaryColor: "#22d3ee",
    gridTint: "#06b6d4",
    headerBg: "#082834",
    stageGlow: "#0891b2",
    recommendedWaferStyle: "tactile-tile",
  },
  cantera: {
    badgeLabel: "CANTERA",
    diagramKindLabel: "Chemical Kinetics & Reactor Network",
    accentColor: "#e11d48",
    secondaryColor: "#fb7185",
    gridTint: "#f43f5e",
    headerBg: "#310a17",
    stageGlow: "#e11d48",
    recommendedWaferStyle: "tactile-tile",
  },
  sbml: {
    badgeLabel: "SBML",
    diagramKindLabel: "Systems Biology Reaction Network",
    accentColor: "#db2777",
    secondaryColor: "#f472b6",
    gridTint: "#ec4899",
    headerBg: "#2e0b1f",
    stageGlow: "#db2777",
    recommendedWaferStyle: "tactile-tile",
  },
  ampl: {
    badgeLabel: "AMPL",
    diagramKindLabel: "Mathematical Optimization Model",
    accentColor: "#0d9488",
    secondaryColor: "#2dd4bf",
    gridTint: "#14b8a6",
    headerBg: "#072826",
    stageGlow: "#0d9488",
    recommendedWaferStyle: "tactile-tile",
  },
};

const DIAGRAM_TYPE_LABELS: Record<string, string> = {
  bdd: "Block Definition Diagram (BDD)",
  ibd: "Internal Block Diagram (IBD)",
  req: "Requirements Diagram",
  stm: "State Machine Diagram",
  act: "Activity / Flow Diagram",
  seq: "Sequence Diagram",
  oneline: "Power System One-Line Diagram",
  schematic: "Circuit Schematic",
  flowchart: "Process Flowsheet",
};

/**
 * Resolves a cohesive visual theme & paradigm badge for the active engineering
 * language (`modelica`, `sysml2`, `spice`, `pscad`, etc.) and optional diagram subtype.
 */
export function resolveDiagramLanguageTheme(
  languageId?: string | null,
  diagramType?: string | null,
): DiagramLanguageTheme {
  const normLang = (languageId ?? "modelica").trim().toLowerCase() || "modelica";
  const base = LANGUAGE_THEME_MAP[normLang] ?? {
    badgeLabel: normLang.toUpperCase(),
    diagramKindLabel: "Engineering System Diagram",
    accentColor: "#0284c7",
    secondaryColor: "#38bdf8",
    gridTint: "#0ea5e9",
    headerBg: "#0f172a",
    stageGlow: "#0284c7",
    recommendedWaferStyle: "tactile-tile" as ExtrudedWaferStyle,
  };

  const normDiagType = (diagramType ?? "").trim().toLowerCase();
  const specificKind = normDiagType && DIAGRAM_TYPE_LABELS[normDiagType];

  return {
    languageId: normLang,
    ...base,
    diagramKindLabel: specificKind ? `${base.badgeLabel} · ${specificKind}` : base.diagramKindLabel,
  };
}
