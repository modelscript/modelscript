// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";

const languageIconCache = new Map<string, string>();

interface FallbackSpec {
  name: string;
  short: string;
  color: string;
}

const FALLBACK_LANGS: Record<string, FallbackSpec> = {
  pscad: { name: "PSCAD", short: "EMT", color: "#dc2626" },
  simulink: { name: "Simulink", short: "SLX", color: "#0284c7" },
  spice: { name: "SPICE", short: "CKT", color: "#ea580c" },
  urdf: { name: "URDF", short: "BOT", color: "#7c3aed" },
  sbml: { name: "SBML", short: "BIO", color: "#16a34a" },
  reqif: { name: "ReqIF", short: "REQ", color: "#0d9488" },
  autosar: { name: "AUTOSAR", short: "AUT", color: "#4f46e5" },
  plcopen: { name: "PLCopen", short: "PLC", color: "#0369a1" },
  "verilog-a": { name: "Verilog-A", short: "VAMS", color: "#b45309" },
  fortran: { name: "Fortran", short: "F90", color: "#6d28d9" },
  gensys: { name: "GENSYS", short: "RAIL", color: "#15803d" },
  simpack: { name: "SIMPACK", short: "SIM", color: "#1e40af" },
  gtsuite: { name: "GT-SUITE", short: "GTS", color: "#9a3412" },
  easy5: { name: "EASY5", short: "EZ5", color: "#1d4ed8" },
  relap5: { name: "RELAP5", short: "NUC", color: "#991b1b" },
  aspen: { name: "Aspen", short: "ASP", color: "#047857" },
  energyplus: { name: "EnergyPlus", short: "E+", color: "#15803d" },
  qif: { name: "QIF 3.0", short: "QIF", color: "#0284c7" },
  oscal: { name: "NIST OSCAL", short: "OSC", color: "#7c3aed" },
  automationml: { name: "AutomationML", short: "AML", color: "#0d9488" },
  epanet: { name: "EPANET", short: "EPA", color: "#0284c7" },
  opendss: { name: "OpenDSS", short: "DSS", color: "#059669" },
  psse: { name: "PSS/E", short: "PSSE", color: "#b45309" },
  swmm: { name: "SWMM", short: "SWMM", color: "#0891b2" },
  "hec-ras": { name: "HEC-RAS", short: "RAS", color: "#0284c7" },
  modflow: { name: "MODFLOW", short: "FLOW", color: "#0d9488" },
  landgem: { name: "LandGEM", short: "LGEM", color: "#15803d" },
  gtfs: { name: "GTFS", short: "GTFS", color: "#e11d48" },
  openadr: { name: "OpenADR", short: "ADR", color: "#d97706" },
  cantera: { name: "Cantera", short: "CT", color: "#dc2626" },
  smiles: { name: "SMILES", short: "SMI", color: "#059669" },
  sbol: { name: "SBOL", short: "SBOL", color: "#16a34a" },
  bngl: { name: "BNGL", short: "BNG", color: "#0d9488" },
  sedml: { name: "SED-ML", short: "SED", color: "#4f46e5" },
  antimony: { name: "Antimony", short: "SB", color: "#16a34a" },
  ampl: { name: "AMPL", short: "AMPL", color: "#ea580c" },
};

/**
 * Return an SVG with the official language icon (adapting light/dark mode)
 * for a given language or package domain.
 */
export function getLanguageIconSvg(languageOrPkgName: string): string | null {
  const norm = languageOrPkgName.toLowerCase().replace(/[^a-z0-9]/g, "");
  let lang = "modelica";

  if (norm.includes("sysml") || norm.includes("kerml")) lang = "sysml2";
  else if (norm.includes("step") || norm.includes("cad") || norm.includes("iso10303")) lang = "step";
  else if (norm.includes("scad") || norm.includes("openscad")) lang = "scad";
  else if (norm.includes("ssp") || norm.includes("fmu") || norm.includes("fmi")) lang = "ssp";
  else if (norm.includes("cfd") || norm.includes("su2")) lang = "cfd";
  else if (norm.includes("fea") || norm.includes("nastran")) lang = "fea";
  else if (norm.includes("owl") || norm.includes("rdf") || norm.includes("ontology")) lang = "owl2";
  else if (norm.includes("csv") || norm.includes("dataset")) lang = "csv";
  else if (norm === "c" || norm.startsWith("clang") || norm.includes("embeddedc")) lang = "c";
  else if (norm.includes("robot") || norm.includes("urdf") || norm.includes("kinematic")) lang = "urdf";
  else if (norm.includes("epanet") || norm.includes("waterflow") || norm.includes("hydraulic")) lang = "epanet";
  else if (norm.includes("opendss") || norm.includes("feeder")) lang = "opendss";
  else if (norm.includes("psse") || norm.includes("raw") || norm.includes("dyr")) lang = "psse";
  else if (norm.includes("swmm") || norm.includes("stormwater") || norm.includes("runoff")) lang = "swmm";
  else if (norm.includes("hecras") || norm.includes("river")) lang = "hec-ras";
  else if (norm.includes("modflow") || norm.includes("aquifer") || norm.includes("groundwater")) lang = "modflow";
  else if (norm.includes("landgem") || norm.includes("biogas")) lang = "landgem";
  else if (norm.includes("gtfs") || norm.includes("transit")) lang = "gtfs";
  else if (norm.includes("openadr") || norm.includes("flexalert") || norm.includes("demandresponse")) lang = "openadr";
  else if (norm.includes("biomodel") || norm.includes("sbml")) lang = "sbml";
  else if (norm.includes("modelscript") || norm.includes("msx")) lang = "modelscript";
  else if (norm.includes("modelica") || norm.includes("msl")) lang = "modelica";
  else {
    // Check known polyglot fallbacks
    for (const [key] of Object.entries(FALLBACK_LANGS)) {
      if (norm.includes(key.replace(/[^a-z0-9]/g, ""))) {
        lang = key;
        break;
      }
    }
  }

  if (languageIconCache.has(lang)) return languageIconCache.get(lang)!;

  const repoRoot = path.resolve(process.cwd());
  const lightPath = path.resolve(repoRoot, `languages/${lang}/assets/icon-light.png`);
  const darkPath = path.resolve(repoRoot, `languages/${lang}/assets/icon-dark.png`);

  if (fs.existsSync(lightPath)) {
    const b64Light = fs.readFileSync(lightPath).toString("base64");
    const b64Dark = fs.existsSync(darkPath) ? fs.readFileSync(darkPath).toString("base64") : b64Light;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 228 150" width="100%" height="100%">
  <style>
    .ms-icon-dark { display: none; }
    @media (prefers-color-scheme: dark) {
      .ms-icon-light { display: none; }
      .ms-icon-dark { display: inline; }
    }
    :root[data-color-mode="dark"] .ms-icon-light { display: none; }
    :root[data-color-mode="dark"] .ms-icon-dark { display: inline; }
    html.dark .ms-icon-light { display: none; }
    html.dark .ms-icon-dark { display: inline; }
  </style>
  <image class="ms-icon-light" href="data:image/png;base64,${b64Light}" width="228" height="150"/>
  <image class="ms-icon-dark" href="data:image/png;base64,${b64Dark}" width="228" height="150"/>
</svg>`;

    languageIconCache.set(lang, svg);
    return svg;
  }

  // Fallback branded vector badge for polyglot languages without PNG assets
  const spec = FALLBACK_LANGS[lang] ?? {
    name: languageOrPkgName,
    short: lang.slice(0, 4).toUpperCase(),
    color: "#0284c7",
  };
  const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  <rect width="100" height="100" rx="20" fill="${spec.color}"/>
  <text x="50" y="58" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="28" fill="#ffffff" letter-spacing="1">${spec.short}</text>
</svg>`;

  languageIconCache.set(lang, badgeSvg);
  return badgeSvg;
}
