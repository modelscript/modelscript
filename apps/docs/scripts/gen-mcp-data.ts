// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generates docs/.vitepress/theme/data/mcp-tools.generated.json from packages/mcp/src/tools.ts.
// Run with `npm run gen:mcp`; `--check` fails if the file is stale.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsSourcePath = path.resolve(here, "../../../packages/mcp/src/tools.ts");
const outFile = path.resolve(here, "../docs/.vitepress/theme/data/mcp-tools.generated.json");

export interface McpToolEntry {
  name: string;
  description: string;
  category: string;
}

function inferCategory(name: string): string {
  if (name.startsWith("modelica_") || name === "hybrid_simulate") return "Modelica & DAE Simulation";
  if (name.startsWith("sysml2_") || name.startsWith("oscal_") || name.startsWith("aml_")) {
    return "SysML v2, AutomationML & Compliance (OSCAL)";
  }
  if (name.startsWith("tgg_") || name.startsWith("rtm_") || name === "validate_system_consistency") {
    return "Digital Thread (TGG & RTM)";
  }
  if (name.startsWith("modelscript_")) return "Closed-Loop Synthesis & Workspace";
  if (name.startsWith("pscad_") || name.startsWith("opendss_")) {
    return "Power Systems, EMT & Distribution (PSCAD / OpenDSS)";
  }
  if (name.startsWith("epanet_") || name.startsWith("water_audit_") || name.startsWith("swmm_")) {
    return "Municipal Water, Stormwater & Leak Localization (EPANET / SWMM)";
  }
  if (
    name.startsWith("optical_") ||
    name.startsWith("ran_") ||
    name.startsWith("fiber_") ||
    name.startsWith("telecom_")
  ) {
    return "Telecom, DWDM Optical, 5G RAN & Outside-Plant Fiber";
  }
  if (name.startsWith("ecad_") || name.startsWith("supply_chain_")) {
    return "ECAD, PCB Signal Integrity & Supply-Chain BOM";
  }
  if (name.startsWith("gensys_") || name.startsWith("simpack_")) return "Multibody & Rail (GENSYS / SIMPACK)";
  if (name.startsWith("olga_")) return "Multiphase Flow Assurance (OLGA)";
  if (
    name.startsWith("opensim_") ||
    name.startsWith("dicom_rt_") ||
    name.startsWith("cellml_") ||
    name.startsWith("igtl_") ||
    name.startsWith("three_mf_")
  ) {
    return "Medical Physics, Biomechanics & Surgical Navigation";
  }
  if (name.startsWith("social_")) return "Collaborative Engineering";
  if (
    name.startsWith("cad_") ||
    name.startsWith("qif_") ||
    name.startsWith("polyglot_") ||
    name.startsWith("ssp_") ||
    name.startsWith("formal_") ||
    name.startsWith("twin_")
  ) {
    return "Cross-Domain Certification & Digital Twin";
  }
  return "OWL2 Ontology & Fault Diagnostics";
}

const source = fs.readFileSync(toolsSourcePath, "utf8");
const toolRegex = /server\.tool\(\s*"([^"]+)",\s*(?:"([^"]+)"|`([^`]+)`)/g;

const tools: McpToolEntry[] = [];
let match: RegExpExecArray | null;
while ((match = toolRegex.exec(source)) !== null) {
  const name = match[1]!;
  const description = (match[2] ?? match[3] ?? "").trim();
  tools.push({
    name,
    description,
    category: inferCategory(name),
  });
}

const payload = {
  toolCount: tools.length,
  tools,
};

const json = `${JSON.stringify(payload, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  if (current !== json) {
    console.error("✖ mcp-tools.generated.json is out of date. Run `npm run gen:mcp --workspace=@modelscript/docs`.");
    process.exit(1);
  }
  console.log(`✓ mcp-tools.generated.json is up to date (${tools.length} tools).`);
} else {
  fs.writeFileSync(outFile, json);
  console.log(`✓ wrote ${path.relative(process.cwd(), outFile)} (${tools.length} tools).`);
}
process.exit(0);
