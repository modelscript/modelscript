// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseRaw, solvePowerFlow, writeRaw, type PsseCase } from "@modelscript/psse";
import assert from "node:assert/strict";
import test from "node:test";
import { cgmesToModelica, cgmesToPsse, exportCgmesArchive, parseCgmesFiles, psseToCgmes } from "../src/index.js";

const samplePsseRaw = `0, 100.00, 33, 0, 0, 60.00 / PSS/E RAW Data File
IEEE 14-BUS BENCHMARK TEST CASE
CGMES GATEWAY VERIFICATION
1, 'BUS_1       ', 230.000, 3, 1, 1, 1, 1.0600, 0.0000
2, 'BUS_2       ', 230.000, 2, 1, 1, 1, 1.0450, -4.9800
3, 'BUS_3       ', 230.000, 2, 1, 1, 1, 1.0100, -12.7200
4, 'BUS_4       ', 230.000, 1, 1, 1, 1, 1.0190, -10.3300
5, 'BUS_5       ', 230.000, 1, 1, 1, 1, 1.0200, -8.7800
0 / END OF BUS DATA
1, '1 ', 1, 1, 1, 0.000, 0.000, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
2, '1 ', 1, 1, 1, 21.700, 12.700, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
3, '1 ', 1, 1, 1, 94.200, 19.000, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
4, '1 ', 1, 1, 1, 47.800, -3.900, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
0 / END OF LOAD DATA
3, '1 ', 1, 0.000, 19.000
0 / END OF FIXED SHUNT DATA
1, '1 ', 232.400, -16.900, 10.000, -40.000, 1.06000, 0, 100.00, 0.00000, 0.20000, 0.00000, 0.00000, 1.00000, 1, 100.0, 332.400, 0.000
2, '1 ', 40.000, 42.400, 50.000, -40.000, 1.04500, 0, 100.00, 0.00000, 0.20000, 0.00000, 0.00000, 1.00000, 1, 100.0, 140.000, 0.000
3, '1 ', 0.000, 23.400, 40.000, 0.000, 1.01000, 0, 100.00, 0.00000, 0.20000, 0.00000, 0.00000, 1.00000, 1, 100.0, 100.000, 0.000
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01938, 0.05917, 0.05280, 150.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 1.00
1, 5, '1 ', 0.05403, 0.22304, 0.04920, 100.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 1.00
2, 3, '1 ', 0.04699, 0.19797, 0.04380, 100.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 1.00
2, 4, '1 ', 0.05811, 0.17632, 0.03400, 100.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 1.00
2, 5, '1 ', 0.05695, 0.17388, 0.03460, 100.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 1.00
3, 4, '1 ', 0.06701, 0.17103, 0.01280, 100.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 1.00
4, 5, '1 ', 0.01335, 0.04211, 0.00000, 100.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 1.00
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
0 / END OF GNE DATA
0 / END OF INDUCTION MACHINE DATA
`;

test("psseToCgmes: converts PSS/E base case to CGMES model", () => {
  const psCase: PsseCase = parseRaw(samplePsseRaw);
  assert.strictEqual(psCase.buses.size, 5);
  assert.strictEqual(psCase.generators.length, 3);
  assert.strictEqual(psCase.loads.length, 4);
  assert.strictEqual(psCase.branches.length, 7);

  const { model, busNumToNodeId } = psseToCgmes(psCase);

  // Check TopologicalNodes
  assert.strictEqual(model.nodes.size, 5);
  assert.strictEqual(busNumToNodeId.get(1), "_node_1");
  assert.strictEqual(model.nodes.get("_node_1")?.baseVoltageKv, 230.0);

  // Check SynchronousMachines
  assert.strictEqual(model.generators.size, 3);
  const gen1 = model.generators.get("_gen_1_1");
  assert.ok(gen1);
  assert.strictEqual(gen1.pMw, 232.4);
  assert.strictEqual(gen1.qMvar, -16.9);

  // Check EnergyConsumers (Loads)
  assert.strictEqual(model.loads.size, 4);
  const load3 = model.loads.get("_load_3_1");
  assert.ok(load3);
  assert.strictEqual(load3.pMw, 94.2);
  assert.strictEqual(load3.qMvar, 19.0);

  // Check ACLineSegments
  assert.strictEqual(model.lines.size, 7);
  const line12 = model.lines.get("_line_1_2_1");
  assert.ok(line12);
  assert.strictEqual(line12.r, 0.01938);
  assert.strictEqual(line12.x, 0.05917);
  assert.strictEqual(line12.bch, 0.0528);

  // Check Terminals (each line has 2, each gen has 1, each load has 1, each shunt has 1)
  // 7*2 + 3 + 4 + 1 = 22 terminals
  assert.strictEqual(model.terminals.size, 22);

  // Check SV Voltages
  assert.strictEqual(model.svVoltages.size, 5);
  assert.strictEqual(model.svVoltages.get("_sv_v_1")?.vPu, 1.06);
});

test("serializeCgmesXml & exportCgmesArchive: produces valid CIM RDF/XML for EQ, TP, SSH, SV", () => {
  const psCase: PsseCase = parseRaw(samplePsseRaw);
  const { model } = psseToCgmes(psCase);
  const archive = exportCgmesArchive(model);

  // Check EQ XML
  assert.ok(archive.eqXml.includes(`<rdf:RDF`));
  assert.ok(archive.eqXml.includes(`xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#"`));
  assert.ok(archive.eqXml.includes(`<cim:ACLineSegment rdf:ID="_line_1_2_1">`));
  assert.ok(archive.eqXml.includes(`<cim:SynchronousMachine rdf:ID="_gen_1_1">`));
  assert.ok(archive.eqXml.includes(`<cim:EnergyConsumer rdf:ID="_load_3_1">`));
  assert.ok(archive.eqXml.includes(`<cim:LinearShuntCompensator rdf:ID="_shunt_3_1">`));

  // Check TP XML
  assert.ok(archive.tpXml.includes(`<cim:TopologicalNode rdf:ID="_node_1">`));
  assert.ok(archive.tpXml.includes(`<cim:Terminal rdf:about="#_term_line_1_2_1_1">`));
  assert.ok(archive.tpXml.includes(`<cim:Terminal.TopologicalNode rdf:resource="#_node_1"/>`));

  // Check SSH XML
  assert.ok(archive.sshXml.includes(`<cim:SynchronousMachine rdf:about="#_gen_1_1">`));
  assert.ok(archive.sshXml.includes(`<cim:SynchronousMachine.p>232.400</cim:SynchronousMachine.p>`));
  assert.ok(archive.sshXml.includes(`<cim:EnergyConsumer rdf:about="#_load_3_1">`));

  // Check SV XML
  assert.ok(archive.svXml.includes(`<cim:SvVoltage rdf:ID="_sv_v_1">`));
  assert.ok(archive.svXml.includes(`<cim:SvVoltage.v>1.06000</cim:SvVoltage.v>`));
});

test("parseCgmesFiles: parses exported RDF/XML back into lossless CgmesModel", () => {
  const psCase: PsseCase = parseRaw(samplePsseRaw);
  const { model: origModel } = psseToCgmes(psCase);
  const archive = exportCgmesArchive(origModel);

  // Parse all 4 profiles back
  const parsedModel = parseCgmesFiles([archive.eqXml, archive.tpXml, archive.sshXml, archive.svXml]);

  assert.strictEqual(parsedModel.nodes.size, origModel.nodes.size);
  assert.strictEqual(parsedModel.lines.size, origModel.lines.size);
  assert.strictEqual(parsedModel.generators.size, origModel.generators.size);
  assert.strictEqual(parsedModel.loads.size, origModel.loads.size);
  assert.strictEqual(parsedModel.shunts.size, origModel.shunts.size);
  assert.strictEqual(parsedModel.svVoltages.size, origModel.svVoltages.size);

  // Numerical precision checks
  const parsedLine = parsedModel.lines.get("_line_1_2_1");
  assert.ok(parsedLine);
  assert.ok(Math.abs(parsedLine.r - 0.01938) < 1e-4);
  assert.ok(Math.abs(parsedLine.x - 0.05917) < 1e-4);
  assert.ok(Math.abs(parsedLine.bch - 0.0528) < 1e-4);

  const parsedGen = parsedModel.generators.get("_gen_1_1");
  assert.ok(parsedGen);
  assert.ok(Math.abs(parsedGen.pMw - 232.4) < 1e-2);

  const parsedSv = parsedModel.svVoltages.get("_sv_v_1");
  assert.ok(parsedSv);
  assert.ok(Math.abs(parsedSv.vPu - 1.06) < 1e-4);
});

test("Bidirectional Gateway Roundtrip: PSS/E -> CGMES -> PSS/E power flow parity", () => {
  const origCase: PsseCase = parseRaw(samplePsseRaw);
  const origPf = solvePowerFlow(origCase);
  assert.strictEqual(origPf.converged, true);

  // 1. Convert to CGMES
  const { model } = psseToCgmes(origCase);
  const archive = exportCgmesArchive(model);

  // 2. Parse from XML
  const reparsedModel = parseCgmesFiles([archive.eqXml, archive.tpXml, archive.sshXml, archive.svXml]);

  // 3. Project back to PSS/E
  const { psseCase: roundtripCase } = cgmesToPsse(reparsedModel);

  // 4. Solve AC Power Flow on roundtrip case
  const roundtripPf = solvePowerFlow(roundtripCase);
  assert.strictEqual(roundtripPf.converged, true);

  // Compare active and reactive losses / powers
  assert.ok(
    Math.abs(origPf.totalLossMw - roundtripPf.totalLossMw) < 1e-3,
    `Active losses mismatch: ${origPf.totalLossMw} vs ${roundtripPf.totalLossMw}`,
  );
  assert.ok(
    Math.abs(origPf.totalLossMvar - roundtripPf.totalLossMvar) < 1e-3,
    `Reactive losses mismatch: ${origPf.totalLossMvar} vs ${roundtripPf.totalLossMvar}`,
  );
  assert.ok(
    Math.abs(origPf.totalGenMw - roundtripPf.totalGenMw) < 1e-3,
    `Total Gen MW mismatch: ${origPf.totalGenMw} vs ${roundtripPf.totalGenMw}`,
  );

  // Format back to RAW text
  const rawText = writeRaw(roundtripCase);
  assert.ok(rawText.includes("PSS/E RAW Data File"));
  assert.ok(rawText.includes("END OF BUS DATA"));
  assert.ok(rawText.includes("END OF BRANCH DATA"));
});

test("cgmesToModelica: projects converted CGMES model into valid OpenIPSL Modelica", () => {
  const psCase: PsseCase = parseRaw(samplePsseRaw);
  const { model } = psseToCgmes(psCase);

  const moCode = cgmesToModelica(model, { modelName: "CgmesIeee14Grid" });
  assert.ok(moCode.includes("model CgmesIeee14Grid"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Buses.Bus"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Branches.Line"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Machines.PSSE.GENSAL"));
  assert.ok(moCode.includes("connect("));
  assert.ok(moCode.includes("end CgmesIeee14Grid;"));
});
