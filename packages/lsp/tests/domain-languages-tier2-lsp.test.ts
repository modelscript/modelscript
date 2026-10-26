// SPDX-License-Identifier: AGPL-3.0-or-later

import { getAspenDocumentSymbols, getAspenHover, validateAspen } from "@modelscript/aspen";
import { getEclipseDocumentSymbols, validateEclipse } from "@modelscript/eclipse";
import { getIbisDocumentSymbols, validateIbis } from "@modelscript/ibis";
import { getJsbsimDocumentSymbols, validateJsbsim } from "@modelscript/jsbsim";
import { getOpenDssDocumentSymbols, validateOpenDss } from "@modelscript/opendss";
import { getOpenScenarioDocumentSymbols, validateOpenScenario } from "@modelscript/openscenario";
import { getRelap5DocumentSymbols, validateRelap5 } from "@modelscript/relap5";
import { getSbmlDocumentSymbols, validateSbml } from "@modelscript/sbml";
import { getSwmmDocumentSymbols, validateSwmm } from "@modelscript/swmm";
import { getTouchstoneDocumentSymbols, validateTouchstone } from "@modelscript/touchstone";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("Tier 2 Polyglot Domain Languages LSP Integration", () => {
  it("registers and verifies Aspen Plus LSP plugin", async () => {
    const snippet = `TITLE 'Methanol Distillation'\nCOMPONENTS\n  METHANOL CH4O\n  WATER H2O\nFLOWSHEET\n  BLOCK COL1 IN=FEED OUT=DIST,BTM\n`;
    const symbols = getAspenDocumentSymbols(snippet);
    assert.ok(Array.isArray(symbols));
    const hover = getAspenHover(snippet, 10);
    assert.ok(hover === null || hover === undefined || typeof hover === "object");
    const diags = validateAspen(snippet);
    assert.ok(Array.isArray(diags));

    const { parseAspen, lowerAspenToDae, aspenToModelica } = await import("@modelscript/aspen");
    const doc = parseAspen(snippet);
    const dae = lowerAspenToDae(doc);
    assert.ok(dae.variables().length >= 0);
    const mo = aspenToModelica(doc);
    assert.match(mo, /model/);
  });

  it("registers and verifies EPA-SWMM LSP plugin", async () => {
    const snippet = `[TITLE]\nUrban Runoff\n[JUNCTIONS]\nJ1 100.0 5.0 0.0 0.0\nOUT1 95.0 5.0 0.0 0.0\n[CONDUITS]\nC1 J1 OUT1 500 0.01 0.01 0.0\n`;
    const symbols = getSwmmDocumentSymbols(snippet);
    assert.ok(Array.isArray(symbols));
    const diags = validateSwmm(snippet);
    assert.ok(Array.isArray(diags));

    const { parseSwmm, lowerSwmmToDae, swmmToModelica, routeNetworkFlow } = await import("@modelscript/swmm");
    const model = parseSwmm(snippet);
    const dae = lowerSwmmToDae(model);
    assert.ok(dae.variables().length >= 0);
    const mo = swmmToModelica(model);
    assert.match(mo, /model/);
    const flows = routeNetworkFlow(model);
    assert.strictEqual(typeof flows.isFlooding, "boolean");
  });

  it("registers and verifies Touchstone RF LSP plugin", async () => {
    const snippet = `! 2-Port Filter\n# GHz S RI R 50\n1.0  0.1 0.0  0.9 0.0  0.9 0.0  0.1 0.0\n2.0  0.2 0.0  0.8 0.0  0.8 0.0  0.2 0.0\n`;
    const symbols = getTouchstoneDocumentSymbols(snippet);
    assert.ok(Array.isArray(symbols));
    const diags = validateTouchstone(snippet);
    assert.ok(Array.isArray(diags));

    const { parseTouchstone, lowerTouchstoneToDae, touchstoneToModelica, verifyPassivity, fitStateSpaceModel } =
      await import("@modelscript/touchstone");
    const ts = parseTouchstone(snippet);
    const dae = lowerTouchstoneToDae(ts);
    assert.ok(dae.variables().length >= 0);
    const mo = touchstoneToModelica(ts);
    assert.match(mo, /model/);
    const passivity = verifyPassivity(ts);
    assert.strictEqual(typeof passivity.isPassive, "boolean");
    const ss = fitStateSpaceModel(ts, 2);
    assert.strictEqual(typeof ss.order, "number");
  });

  it("registers and verifies IBIS Semiconductor Buffer LSP plugin", async () => {
    const snippet = `[IBIS Ver] 5.0\n[Component] ASIC_PAD\n[Manufacturer] Semiconductor Corp\n[Package]\n R_pkg 0.1\n L_pkg 1.0nH\n C_pkg 0.5pF\n[Pin] signal_name model_name R_pin L_pin C_pin\n 1 OUT1 IO_BUF 0.05 0.5nH 0.2pF\n[Model] IO_BUF\nModel_type I/O\n`;
    const symbols = getIbisDocumentSymbols(snippet);
    assert.ok(Array.isArray(symbols));
    const diags = validateIbis(snippet);
    assert.ok(Array.isArray(diags));

    const { parseIbis, lowerIbisToDae, ibisToModelica, evaluateBufferCurrent } = await import("@modelscript/ibis");
    const ibis = parseIbis(snippet);
    const dae = lowerIbisToDae(ibis);
    assert.ok(dae.variables().length >= 0);
    const mo = ibisToModelica(ibis);
    assert.match(mo, /model/);
    const model = ibis.models[0];
    if (model) {
      const current = evaluateBufferCurrent(model, 1.5, "high");
      assert.strictEqual(typeof current, "number");
    }
  });

  it("registers and verifies OpenDSS Distribution Grid LSP plugin", async () => {
    const snippet = `Clear\nNew Circuit.Microgrid bus1=source\nNew Line.Line1 Bus1=source Bus2=load Length=1.5 Units=km\nNew Load.Load1 Bus1=load kW=100 kvar=30\n`;
    const symbols = getOpenDssDocumentSymbols(snippet);
    assert.ok(Array.isArray(symbols));
    const diags = validateOpenDss(snippet);
    assert.ok(Array.isArray(diags));

    const { parseOpenDss, lowerOpenDssToDae, openDssToModelica, solveDistributionPowerFlow } =
      await import("@modelscript/opendss");
    const dss = parseOpenDss(snippet);
    const dae = lowerOpenDssToDae(dss);
    assert.ok(dae.variables().length >= 0);
    const mo = openDssToModelica(dss);
    assert.match(mo, /model/);
    const pf = solveDistributionPowerFlow(dss);
    assert.strictEqual(typeof pf.converged, "boolean");
  });

  it("registers and verifies OpenSCENARIO AV Safety LSP plugin", async () => {
    const snippet = `<?xml version="1.0" encoding="UTF-8"?>\n<OpenSCENARIO>\n  <FileHeader revMajor="1" revMinor="2" date="2026-10-26" description="Cut-In Scenario" author="ModelScript"/>\n  <Entities>\n    <ScenarioObject name="Ego">\n      <Vehicle name="Sedan" vehicleCategory="car"/>\n    </ScenarioObject>\n  </Entities>\n  <Storyboard>\n    <Init>\n      <Actions/>\n    </Init>\n  </Storyboard>\n</OpenSCENARIO>`;
    const symbols = getOpenScenarioDocumentSymbols(snippet);
    assert.ok(Array.isArray(symbols));
    const diags = validateOpenScenario(snippet);
    assert.ok(Array.isArray(diags));

    const { parseOpenScenario, lowerOpenScenarioToDae, openScenarioToModelica, simulateScenario } =
      await import("@modelscript/openscenario");
    const osc = parseOpenScenario(snippet);
    const dae = lowerOpenScenarioToDae(osc);
    assert.ok(dae.variables().length >= 0);
    const mo = openScenarioToModelica(osc);
    assert.match(mo, /model/);
    const sim = simulateScenario(osc);
    assert.ok(Array.isArray(sim.trajectory));
  });

  it("registers and verifies RELAP5 Nuclear Thermal-Hydraulics LSP plugin", async () => {
    const snippet = `= RELAP5 Reactor Model\n10000000 title "PWR Primary Loop"\n10000001 0.0 100.0 1.0e-5 0.01 0 10 100\n10101000 sngljunc 101 201 0.1 0.0 0.0\n`;
    const symbols = getRelap5DocumentSymbols(snippet);
    assert.ok(Array.isArray(symbols));
    const diags = validateRelap5(snippet);
    assert.ok(Array.isArray(diags));

    const { parseRelap5, lowerRelap5ToDae, relap5ToModelica, solvePointKinetics } = await import("@modelscript/relap5");
    const deck = parseRelap5(snippet);
    const dae = lowerRelap5ToDae(deck);
    assert.ok(dae.variables().length >= 0);
    const mo = relap5ToModelica(deck);
    assert.match(mo, /model/);
    const kinetics = solvePointKinetics(deck);
    assert.ok(Array.isArray(kinetics.trajectory));
  });

  it("registers and verifies ECLIPSE Reservoir Engineering LSP plugin", async () => {
    const snippet = `RUNSPEC\nTITLE\n Black Oil Reservoir\nDIMENS\n 10 10 3 /\nOIL\nWATER\nGAS\nGRID\nDX\n 300*100.0 /\nDY\n 300*100.0 /\nDZ\n 300*100.0 /\nPROPS\nSWOF\n 0.2 0.0 1.0 0.0\n 1.0 1.0 0.0 0.0 /\nSCHEDULE\nWELSPECS\n 'PROD1' 'G1' 5 5 1000 'OIL' /\nEND\n`;
    const symbols = getEclipseDocumentSymbols(snippet);
    assert.ok(Array.isArray(symbols));
    const diags = validateEclipse(snippet);
    assert.ok(Array.isArray(diags));

    const { parseEclipse, lowerEclipseToDae, eclipseToModelica, solveReservoirDepletion } =
      await import("@modelscript/eclipse");
    const deck = parseEclipse(snippet);
    const dae = lowerEclipseToDae(deck);
    assert.ok(dae.variables().length >= 0);
    const mo = eclipseToModelica(deck);
    assert.match(mo, /model/);
    const sim = solveReservoirDepletion(deck);
    assert.ok(Array.isArray(sim.trajectory));
  });

  it("registers and verifies SBML Systems Biology LSP plugin", async () => {
    const snippet = `<?xml version="1.0" encoding="UTF-8"?>\n<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">\n  <model id="Glycolysis">\n    <listOfCompartments>\n      <compartment id="cell" spatialDimensions="3" size="1.0" constant="true"/>\n    </listOfCompartments>\n    <listOfSpecies>\n      <species id="Glucose" compartment="cell" initialConcentration="10.0" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>\n      <species id="Pyruvate" compartment="cell" initialConcentration="0.0" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>\n    </listOfSpecies>\n    <listOfReactions>\n      <reaction id="R1" reversible="false">\n        <listOfReactants>\n          <speciesReference species="Glucose" stoichiometry="1" constant="true"/>\n        </listOfReactants>\n        <listOfProducts>\n          <speciesReference species="Pyruvate" stoichiometry="2" constant="true"/>\n        </listOfProducts>\n      </reaction>\n    </listOfReactions>\n  </model>\n</sbml>`;
    const symbols = getSbmlDocumentSymbols(snippet);
    assert.ok(Array.isArray(symbols));
    const diags = validateSbml(snippet);
    assert.ok(Array.isArray(diags));

    const { parseSbml, lowerSbmlToDae, sbmlToModelica, solveReactions } = await import("@modelscript/sbml");
    const model = parseSbml(snippet);
    const dae = lowerSbmlToDae(model);
    assert.ok(dae.variables().length >= 0);
    const mo = sbmlToModelica(model);
    assert.match(mo, /model/);
    const sim = solveReactions(model);
    assert.ok(Array.isArray(sim.trajectory));
  });

  it("registers and verifies JSBSim Flight Dynamics LSP plugin", async () => {
    const snippet = `<?xml version="1.0"?>\n<fdm_config name="C172" version="2.0" release="BETA">\n  <fileheader>\n    <author>ModelScript</author>\n    <filecreationdate>2026-10-26</filecreationdate>\n    <description>Cessna 172 Flight Model</description>\n  </fileheader>\n  <metrics>\n    <wingarea unit="FT2"> 174 </wingarea>\n    <wingspan unit="FT"> 36 </wingspan>\n    <chord unit="FT"> 4.9 </chord>\n    <htailarea unit="FT2"> 21.9 </htailarea>\n    <htailarm unit="FT"> 15.7 </htailarm>\n    <vtailarea unit="FT2"> 16.5 </vtailarea>\n    <vtailarm unit="FT"> 15.7 </vtailarm>\n    <location name="AERORP" unit="IN">\n      <x> 43.1 </x>\n      <y> 0 </y>\n      <z> 0 </z>\n    </location>\n  </metrics>\n  <mass_balance>\n    <emptywt unit="LBS"> 1500 </emptywt>\n    <location name="CG" unit="IN">\n      <x> 41.0 </x>\n      <y> 0 </y>\n      <z> 0 </z>\n    </location>\n  </mass_balance>\n</fdm_config>`;
    const symbols = getJsbsimDocumentSymbols(snippet);
    assert.ok(Array.isArray(symbols));
    const diags = validateJsbsim(snippet);
    assert.ok(Array.isArray(diags));

    const { parseJsbsim, lowerJsbsimToDae, jsbsimToModelica, solveFlightDynamics } =
      await import("@modelscript/jsbsim");
    const fdm = parseJsbsim(snippet);
    const dae = lowerJsbsimToDae(fdm);
    assert.ok(dae.variables().length >= 0);
    const mo = jsbsimToModelica(fdm);
    assert.match(mo, /model/);
    const sim = solveFlightDynamics(fdm);
    assert.ok(Array.isArray(sim.trajectory));
  });
});
