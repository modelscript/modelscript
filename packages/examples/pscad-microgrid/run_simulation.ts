// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * End-to-End PSCAD Simulation, Diagram, and Polyglot Projection Pipeline.
 *
 * Programmatically loads the PSCAD case study, performs EMT numerical simulation,
 * produces IEEE C37.111 COMTRADE records, synthesizes the Single-Line Diagram SVG,
 * and projects the netlist into Modelica and SSP SystemStructure.
 */

import { renderPscadSvg } from "@modelscript/diagram/pscad-diagram-builder";
import {
  extractEmtNetlist,
  parsePscx,
  pscadToModelica,
  pscadToSsd,
  runPscadSimulationPipeline,
} from "@modelscript/pscad";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pscxPath = path.join(__dirname, "Microgrid_IBR.pscx");

console.log("=== Step 1: Parsing PSCAD Case Study ===");
const xml = fs.readFileSync(pscxPath, "utf-8");
const project = parsePscx(xml);
console.log(`✓ Parsed project '${project.name}' (Version: ${project.version}, Type: ${project.projectType})`);
console.log(`  Components: ${project.rootModule.components.length}`);
console.log(`  Buses: ${project.rootModule.buses.length}`);
console.log(`  Wires: ${project.rootModule.wires.length}`);

console.log("\n=== Step 2: Extracting Dommel/Bergeron EMT Netlist ===");
const netlist = extractEmtNetlist(project);
console.log(`✓ Extracted netlist:`);
console.log(`  - 3-Phase Sources: ${netlist.sources.length}`);
console.log(`  - Transformers: ${netlist.transformers.length}`);
console.log(`  - Transmission Lines: ${netlist.transmissionLines.length} (Bergeron delay model)`);
console.log(`  - Circuit Breakers: ${netlist.branches.filter((b) => b.kind === "switch").length}`);
console.log(`  - IBR Inverter FMUs: ${netlist.fmuInstances.length}`);
console.log(`  - CSMF Control Blocks: ${netlist.controlBlocks?.length ?? 0}`);

console.log("\n=== Step 3: Running Turnkey EMT Simulation & COMTRADE Generation ===");
const pipelineResult = runPscadSimulationPipeline({
  documentText: xml,
  runSimulation: true,
  exportComtrade: true,
  verifyIeee2800: true,
  faultSpec: { evaluateExtendedClauses: true },
});

if (pipelineResult.comtrade) {
  const cfgPath = path.join(__dirname, "Microgrid_IBR.cfg");
  const datPath = path.join(__dirname, "Microgrid_IBR.dat");
  fs.writeFileSync(cfgPath, pipelineResult.comtrade.cfg, "utf-8");
  fs.writeFileSync(datPath, pipelineResult.comtrade.dat, "utf-8");
  console.log(
    `✓ Exported IEEE C37.111 COMTRADE configuration: ${cfgPath} (${pipelineResult.comtrade.cfg.length} bytes)`,
  );
  console.log(
    `✓ Exported IEEE C37.111 COMTRADE data records: ${datPath} (${pipelineResult.comtrade.dat.length} bytes)`,
  );
}

console.log("\n=== Step 4: Generating Single-Line Diagram (SLD) SVG ===");
const svg = renderPscadSvg(project);
const svgPath = path.join(__dirname, "Microgrid_IBR.svg");
fs.writeFileSync(svgPath, svg, "utf-8");
console.log(`✓ Rendered Single-Line Diagram SVG: ${svgPath} (${svg.length} bytes)`);

console.log("\n=== Step 5: Exporting Polyglot Projections (Modelica & SSP) ===");
const modelicaCode = pscadToModelica(project);
const moPath = path.join(__dirname, "Microgrid_IBR.mo");
fs.writeFileSync(moPath, modelicaCode, "utf-8");
console.log(`✓ Projected to Modelica.Electrical.Analog: ${moPath} (${modelicaCode.length} bytes)`);

const ssdXml = pscadToSsd(project);
const ssdPath = path.join(__dirname, "SystemStructure.ssd");
fs.writeFileSync(ssdPath, ssdXml, "utf-8");
console.log(`✓ Projected to SSP SystemStructure.ssd: ${ssdPath} (${ssdXml.length} bytes)`);

console.log("\n✓ All PSCAD pipeline artifacts successfully generated!");
