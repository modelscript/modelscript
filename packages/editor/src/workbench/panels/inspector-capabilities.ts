// SPDX-License-Identifier: AGPL-3.0-or-later

export type InspectorSubtabId = "domain" | "thread" | "calibrate" | "rtm" | "uq" | "repl" | "studio";

export interface InspectorSubtabDescriptor {
  id: InspectorSubtabId;
  label: string;
}

const DIALECT_ALIAS_MAP: Record<string, string> = {
  mo: "modelica",
  msx: "modelica",
  modelscript: "modelica",
  reqifz: "reqif",
  aml: "automationml",
  dss: "opendss",
  raw: "psse",
  dyr: "psse",
  sysml: "sysml2",
  kerml: "sysml2",
  owl: "owl2",
  ttl: "owl2",
  cff: "comtrade",
  cfg: "comtrade",
  stp: "step",
  inp: "epanet",
  cir: "spice",
  sp: "spice",
};

/**
 * Normalizes dialect aliases (e.g., `mo`/`msx` -> `modelica`, `raw` -> `psse`)
 * so panel routing and capability gating never split-brain on file-extension aliases.
 */
export function normalizeInspectorDialect(dialect?: string | null): string {
  const raw = (dialect ?? "modelica").trim().toLowerCase();
  if (!raw) return "modelica";
  return DIALECT_ALIAS_MAP[raw] ?? raw;
}

/**
 * Computes the genuinely supported Inspector subtabs for the current dialect and workspace.
 * Prevents exposing Modelica/SysML2-only tools (Calibration, RTM & Contracts, Opt/UQ, REPL)
 * on unrelated dialects like PSS/E, STL, or OpenSCAD where they would fail or mislead.
 */
export function getAvailableInspectorSubtabs(
  dialect: string | undefined,
  projectFiles: Record<string, string> | undefined,
): InspectorSubtabDescriptor[] {
  const canonical = normalizeInspectorDialect(dialect);
  const fileNames = projectFiles ? Object.keys(projectFiles) : [];
  const hasMultiFile = fileNames.length >= 2;
  const hasModelicaFile = canonical === "modelica" || fileNames.some((f) => /\.mo$/i.test(f));
  const hasRtmArtifact =
    canonical === "sysml2" ||
    canonical === "reqif" ||
    canonical === "oscal" ||
    canonical === "owl2" ||
    canonical === "modelica" ||
    fileNames.some((f) => /\.(sysml|kerml|reqif|reqifz|oscal|owl|ttl)$/i.test(f));

  const tabs: InspectorSubtabDescriptor[] = [{ id: "domain", label: "Domain Inspector" }];

  if (hasMultiFile) {
    tabs.push({ id: "thread", label: "Digital Thread" });
  }
  if (hasModelicaFile) {
    tabs.push({ id: "calibrate", label: "Calibration" });
  }
  if (hasRtmArtifact) {
    tabs.push({ id: "rtm", label: "RTM & Contracts" });
  }
  if (canonical === "modelica") {
    tabs.push({ id: "uq", label: "Opt / UQ" });
    tabs.push({ id: "repl", label: "REPL" });
  }

  return tabs;
}
