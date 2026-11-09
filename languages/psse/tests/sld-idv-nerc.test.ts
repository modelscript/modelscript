// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  applySldLayoutToCase,
  parsePsseSld,
  renderSldSvg,
  serializePsseSld,
  sldToDiagramGraph,
} from "@modelscript/diagram/psse-sld-parser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditNercCompliance, executeIdv, parseDyr, parseIdv, parseRaw } from "../src/index.js";

const SAMPLE_IEEE9_RAW = `0, 100.0, 33, 0, 0, 60.0 / IEEE 9-Bus Test Case
1, 'BUS 1', 16.5, 3, 1, 1, 1, 1.0400, 0.0000, 1.100, 0.900, 1.100, 0.900 /
2, 'BUS 2', 18.0, 2, 1, 1, 1, 1.0250, 9.2800, 1.100, 0.900, 1.100, 0.900 /
3, 'BUS 3', 13.8, 2, 1, 1, 1, 1.0250, 4.6600, 1.100, 0.900, 1.100, 0.900 /
4, 'BUS 4', 230.0, 1, 1, 1, 1, 1.0258, -2.2200, 1.100, 0.900, 1.100, 0.900 /
5, 'BUS 5', 230.0, 1, 1, 1, 1, 0.9956, -3.9900, 1.100, 0.900, 1.100, 0.900 /
6, 'BUS 6', 230.0, 1, 1, 1, 1, 1.0044, -3.6900, 1.100, 0.900, 1.100, 0.900 /
7, 'BUS 7', 230.0, 1, 1, 1, 1, 1.0258, 3.7200, 1.100, 0.900, 1.100, 0.900 /
8, 'BUS 8', 230.0, 1, 1, 1, 1, 1.0159, 0.7300, 1.100, 0.900, 1.100, 0.900 /
9, 'BUS 9', 230.0, 1, 1, 1, 1, 1.0324, 1.9700, 1.100, 0.900, 1.100, 0.900 /
0 / END OF BUS DATA, BEGIN LOAD DATA
5, '1', 1, 1, 1, 125.0, 50.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0 /
6, '1', 1, 1, 1, 90.0, 30.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0 /
8, '1', 1, 1, 1, 100.0, 35.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0 /
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1', 71.6, 27.0, 300.0, -300.0, 1.040, 0, 100.0, 0.0, 0.04, 0.0, 0.0, 1.0, 1, 100.0, 250.0, 10.0 /
2, '1', 163.0, 6.7, 300.0, -300.0, 1.025, 0, 100.0, 0.0, 0.04, 0.0, 0.0, 1.0, 1, 100.0, 300.0, 10.0 /
3, '1', 85.0, -10.9, 300.0, -300.0, 1.025, 0, 100.0, 0.0, 0.04, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 10.0 /
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
4, 5, '1', 0.0100, 0.0850, 0.1760, 400.0, 450.0, 500.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0 /
5, 6, '1', 0.0170, 0.0920, 0.1580, 400.0, 450.0, 500.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0 /
6, 7, '1', 0.0390, 0.1700, 0.3580, 400.0, 450.0, 500.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0 /
7, 8, '1', 0.0085, 0.0720, 0.1490, 400.0, 450.0, 500.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0 /
8, 9, '1', 0.0119, 0.1008, 0.2090, 400.0, 450.0, 500.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0 /
9, 4, '1', 0.0085, 0.0720, 0.1490, 400.0, 450.0, 500.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0 /
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
1, 4, 0, '1', 1, 1, 1, 0.0, 0.0, 2, 'T1', 1, 1, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 /
0.0000, 0.0576, 100.0 /
1.0000, 16.5, 0.0, 0.0, 0.0, 0.0, 0, 0, 0.0, 0.0, 0.0, 0.0 /
1.0000, 230.0 /
2, 7, 0, '1', 1, 1, 1, 0.0, 0.0, 2, 'T2', 1, 1, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 /
0.0000, 0.0625, 100.0 /
1.0000, 18.0, 0.0, 0.0, 0.0, 0.0, 0, 0, 0.0, 0.0, 0.0, 0.0 /
1.0000, 230.0 /
3, 9, 0, '1', 1, 1, 1, 0.0, 0.0, 2, 'T3', 1, 1, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 /
0.0000, 0.0586, 100.0 /
1.0000, 13.8, 0.0, 0.0, 0.0, 0.0, 0, 0, 0.0, 0.0, 0.0, 0.0 /
1.0000, 230.0 /
0 / END OF TRANSFORMER DATA
Q
`;

const SAMPLE_IEEE9_DYR = `1 'GENROU' '1' 8.96 0.05 0.60 0.05 5.0 0.0 1.56 1.06 0.296 0.296 0.177 0.13 0.10 0.30 /
1 'EXST1' '1' 0.0 5.0 -5.0 0.0 0.0 100.0 0.05 4.0 -4.0 0.0 0.0 0.0 /
1 'TGOV1' '1' 0.04 0.1 1.05 0.0 0.0 0.0 0.0 /
2 'GENROU' '1' 6.00 0.05 0.53 0.05 4.0 0.0 1.22 1.16 0.174 0.174 0.134 0.09 0.08 0.28 /
2 'EXST1' '1' 0.0 5.0 -5.0 0.0 0.0 80.0 0.05 4.0 -4.0 0.0 0.0 0.0 /
2 'TGOV1' '1' 0.05 0.1 1.05 0.0 0.0 0.0 0.0 /
3 'GENROU' '1' 5.89 0.05 0.60 0.05 3.0 0.0 1.30 1.25 0.185 0.185 0.140 0.10 0.10 0.32 /
3 'EXST1' '1' 0.0 5.0 -5.0 0.0 0.0 120.0 0.05 4.0 -4.0 0.0 0.0 0.0 /
3 'TGOV1' '1' 0.045 0.1 1.05 0.0 0.0 0.0 0.0 /
`;

const SAMPLE_SLD_TEXT = `// PSS/E Single Line Diagram Drawing File
SHEET, 2400, 1600, "IEEE 9-Bus One-Line Schematic", 33 /

// Substation Busbars
BUS, 1, 200.0, 200.0, 120.0, 14.0, 0, "GEN 1 BUS", 16.5 /
BUS, 2, 800.0, 200.0, 120.0, 14.0, 0, "GEN 2 BUS", 18.0 /
BUS, 3, 1400.0, 200.0, 120.0, 14.0, 0, "GEN 3 BUS", 13.8 /
BUS, 4, 300.0, 500.0, 140.0, 14.0, 0, "BUS 4 (230kV)", 230.0 /
BUS, 5, 600.0, 700.0, 140.0, 14.0, 0, "BUS 5 (230kV)", 230.0 /
BUS, 6, 900.0, 700.0, 140.0, 14.0, 0, "BUS 6 (230kV)", 230.0 /
BUS, 7, 1200.0, 500.0, 140.0, 14.0, 0, "BUS 7 (230kV)", 230.0 /
BUS, 8, 900.0, 900.0, 140.0, 14.0, 0, "BUS 8 (230kV)", 230.0 /
BUS, 9, 600.0, 900.0, 140.0, 14.0, 0, "BUS 9 (230kV)", 230.0 /

// Transmission Lines with intermediate polyline vertices
BRANCH, 4, 5, "1", 2, 450.0, 500.0, 450.0, 700.0 /
BRANCH, 5, 6, "1", 1, 750.0, 700.0 /
BRANCH, 6, 7, "1", 2, 1050.0, 700.0, 1050.0, 500.0 /
BRANCH, 7, 8, "1", 2, 1200.0, 700.0, 1050.0, 900.0 /
BRANCH, 8, 9, "1", 1, 750.0, 900.0 /
BRANCH, 9, 4, "1", 2, 450.0, 900.0, 300.0, 700.0 /

// Equipment Glyphs
GEN, 1, "1", 200.0, 140.0, 0 /
GEN, 2, "1", 800.0, 140.0, 0 /
GEN, 3, "1", 1400.0, 140.0, 0 /
LOAD, 5, "1", 600.0, 780.0, 0 /
LOAD, 6, "1", 900.0, 780.0, 0 /
LOAD, 8, "1", 900.0, 980.0, 0 /
TRANSFORMER, 1, 4, "1", 250.0, 350.0, 0 /
TRANSFORMER, 2, 7, "1", 1000.0, 350.0, 0 /
TRANSFORMER, 3, 9, "1", 1000.0, 550.0, 0 /

// Annotations
TEXT, 50.0, 80.0, 16, "IEEE 9-BUS 230kV / 16.5kV BULK TRANSMISSION SYSTEM" /
`;

const SAMPLE_XML_SLD = `<?xml version="1.0" encoding="UTF-8"?>
<Drawing title="Substation One-Line XML" width="1800" height="1200">
  <Bus number="101" name="WEST_BUS" x="300.0" y="250.0" width="120" height="12" basekv="230.0" />
  <Bus number="102" name="EAST_BUS" x="900.0" y="250.0" width="120" height="12" basekv="230.0" />
  <Branch from="101" to="102" ckt="1">
    <Point x="600.0" y="250.0" />
  </Branch>
  <Generator bus="101" id="1" x="250.0" y="200.0" />
  <Load bus="102" id="1" x="950.0" y="300.0" />
  <Text x="100.0" y="100.0" size="14">XML Single-Line Diagram</Text>
</Drawing>
`;

describe("Sprint 4: PSS/E .sld/.drw Importer, .idv Macro Interpreter & NERC Auditor", () => {
  describe("1. PSS/E .sld / .drw Importer & SVG Renderer", () => {
    it("parses comma-delimited PSS/E .sld drawing records accurately", () => {
      const drawing = parsePsseSld(SAMPLE_SLD_TEXT);
      assert.equal(drawing.title, "IEEE 9-Bus One-Line Schematic");
      assert.equal(drawing.buses.size, 9);
      assert.equal(drawing.branches.length, 6);
      assert.equal(drawing.components.length, 9); // 3 gens + 3 loads + 3 xfrs
      assert.equal(drawing.annotations.length, 1);

      // Verify specific bus position
      const bus1 = drawing.buses.get(1)!;
      assert.equal(bus1.x, 200.0);
      assert.equal(bus1.y, 200.0);
      assert.equal(bus1.baseKv, 16.5);
      assert.equal(bus1.label, "GEN 1 BUS");

      const bus4 = drawing.buses.get(4)!;
      assert.equal(bus4.baseKv, 230.0);

      // Verify polyline branch vertices
      const br4_5 = drawing.branches.find((b) => b.fromBus === 4 && b.toBus === 5)!;
      assert.equal(br4_5.vertices.length, 2);
      assert.deepEqual(br4_5.vertices[0], { x: 450.0, y: 500.0 });
    });

    it("parses XML-based PSS/E .sld diagrams correctly", () => {
      const drawing = parsePsseSld(SAMPLE_XML_SLD);
      assert.equal(drawing.title, "Substation One-Line XML");
      assert.equal(drawing.buses.size, 2);
      assert.equal(drawing.branches.length, 1);
      assert.equal(drawing.components.length, 2); // 1 gen + 1 load
      assert.equal(drawing.buses.get(101)!.label, "WEST_BUS");
      assert.equal(drawing.branches[0]!.vertices.length, 1);
    });

    it("round-trips .sld drawings via serializePsseSld", () => {
      const drawing = parsePsseSld(SAMPLE_SLD_TEXT);
      const serialized = serializePsseSld(drawing);
      const reparsed = parsePsseSld(serialized);

      assert.equal(reparsed.title, drawing.title);
      assert.equal(reparsed.buses.size, drawing.buses.size);
      assert.equal(reparsed.branches.length, drawing.branches.length);
      assert.equal(reparsed.components.length, drawing.components.length);
    });

    it("attaches explicit .sld coordinates to PsseCase buses", () => {
      const rawCase = parseRaw(SAMPLE_IEEE9_RAW);
      const drawing = parsePsseSld(SAMPLE_SLD_TEXT);

      applySldLayoutToCase(rawCase, drawing);

      const b1 = rawCase.buses.get(1)!;
      assert.ok(b1.position);
      assert.equal(b1.position.x, 200.0);
      assert.equal(b1.position.y, 200.0);

      const b4 = rawCase.buses.get(4)!;
      assert.ok(b4.position);
      assert.equal(b4.position.x, 300.0);
      assert.equal(b4.position.y, 500.0);
    });

    it("renders valid standalone SVG diagram markup with polylines and glyphs", () => {
      const drawing = parsePsseSld(SAMPLE_SLD_TEXT);
      const svg = renderSldSvg(drawing);

      assert.ok(svg.startsWith("<?xml"));
      assert.ok(svg.includes("<svg"));
      assert.ok(svg.includes("IEEE 9-Bus One-Line Schematic"));
      assert.ok(svg.includes('class="line-wire"'));
      assert.ok(svg.includes('class="gen-node"'));
      assert.ok(svg.includes('class="load-node"'));
      assert.ok(svg.includes("</svg>"));
    });

    it("transforms .sld into AntV X6 diagram graph cells", () => {
      const drawing = parsePsseSld(SAMPLE_SLD_TEXT);
      const graph = sldToDiagramGraph(drawing);

      assert.equal(graph.title, "IEEE 9-Bus One-Line Schematic");
      assert.ok(graph.cells.length > 20);

      const busCell = graph.cells.find((c) => c.id === "bus_1")!;
      assert.equal(busCell.x, 200.0);
      assert.equal(busCell.y, 200.0);

      const edgeCell = graph.cells.find((c) => c.id === "edge_4_5_1")!;
      assert.ok(edgeCell.vertices && edgeCell.vertices.length === 2);
    });
  });

  describe("2. PSS/E .idv Macro Command File Interpreter", () => {
    it("tokenizes and parses .idv statements cleanly", () => {
      const idvScript = `
@! PSS/E Macro Automation Batch File
CASE, 'ieee9.sav' /
OPEN BRANCH 4 TO 5 CKT 1
CHNG, BUS, 1, VM, 1.05 /
CHNG, LOAD, 5, '1', PL, 130.0, QL, 55.0 /
BAT_FNSL
BAT_RUN, 2.5
`;
      const cmds = parseIdv(idvScript);
      assert.equal(cmds.length, 6);
      assert.equal(cmds[0]!.command, "CASE");
      assert.equal(cmds[1]!.command, "OPEN");
      assert.equal(cmds[2]!.command, "CHNG");
      assert.equal(cmds[3]!.command, "CHNG");
      assert.equal(cmds[4]!.command, "FNSL");
      assert.equal(cmds[5]!.command, "RUN");
    });

    it("executes network switching, modifications, and power flow sequentially", () => {
      const rawCase = parseRaw(SAMPLE_IEEE9_RAW);
      const idvScript = `
@! Initial solve
FNSL

@! Disconnect line 5->6
OPEN, 5, 6, '1'

@! Change Bus 1 scheduled voltage and Load 5 active demand
CHNG, BUS, 1, VM, 1.05 /
CHNG, LOAD, 5, '1', PL, 150.0, QL, 60.0 /

@! Resolve power flow under post-contingency modified state
FNSL

@! Restore line 5->6
CLOS, 5, 6, '1'
FNSL

@! Scale all system loads by 10%
SCALE, LOAD, 1.10
FNSL
`;
      const result = executeIdv(idvScript, undefined, { initialCase: rawCase });

      assert.equal(result.success, true);
      assert.equal(result.errors.length, 0);
      assert.ok(result.commandsExecuted >= 7);
      assert.ok(result.lastPowerFlow);
      assert.equal(result.lastPowerFlow?.converged, true);

      // Verify that Load 5 was scaled
      const load5 = rawCase.loads.find((l) => l.i === 5)!;
      assert.equal(Math.round(load5.pl), 165); // 150 * 1.10 = 165 MW
      assert.equal(Math.round(load5.ql), 66); // 60 * 1.10 = 66 Mvar

      // Verify Bus 1 voltage modification was preserved
      const bus1 = rawCase.buses.get(1)!;
      assert.equal(bus1.vm, 1.05);
    });

    it("executes short-circuit and dynamic simulation commands", () => {
      const rawCase = parseRaw(SAMPLE_IEEE9_RAW);
      rawCase.dyr = parseDyr(SAMPLE_IEEE9_DYR);

      const idvScript = `
FNSL
DCSC
STRT, 'test_output.out'
DIST_BUS_FAULT, 7
RUN, 0.1
DIST_CLEAR_FAULT
RUN, 0.5
`;
      const result = executeIdv(idvScript, undefined, { initialCase: rawCase });

      assert.equal(result.success, true);
      assert.equal(result.errors.length, 0);
      assert.ok(result.lastShortCircuit);
      assert.ok(result.lastTransient);
      assert.ok(result.lastTransient.t.length > 10);
    });
  });

  describe("3. Automated NERC Reliability Standards Compliance Auditor", () => {
    it("audits compliant IEEE 9-bus benchmark (MOD-025, MOD-026, MOD-027, TPL-001)", () => {
      const rawCase = parseRaw(SAMPLE_IEEE9_RAW);
      rawCase.dyr = parseDyr(SAMPLE_IEEE9_DYR);

      const audit = auditNercCompliance(rawCase, {
        caseTitle: "IEEE 9-Bus Bulk Power System",
        includeContingencies: true,
      });

      // MOD-025: All 3 generators operating within limits with positive reactive span
      assert.equal(audit.mod025.generators.length, 3);
      assert.equal(audit.mod025.severity, "pass");

      // MOD-026: Exciters present (EXST1) with valid gains KA = 80-120
      assert.equal(audit.mod026.exciters.length, 3);
      assert.equal(audit.mod026.severity, "pass");

      // MOD-027: Governors present (TGOV1) with droops 4.0%, 5.0%, 4.5% (all in 3-5% standard)
      assert.equal(audit.mod027.governors.length, 3);
      assert.equal(audit.mod027.severity, "pass");

      // TPL-001: P0 normal system solved without violations
      assert.equal(audit.tpl001.p0Converged, true);
      assert.equal(audit.tpl001.p0VoltageViolations, 0);
      assert.equal(audit.tpl001.p0ThermalOverloads, 0);

      // Overall status
      assert.equal(audit.overallStatus, "COMPLIANT");
      assert.ok(audit.markdownReport.includes("✅ **COMPLIANT**"));
      assert.ok(audit.markdownReport.includes("MOD-025-2"));
      assert.ok(audit.markdownReport.includes("MOD-026-1"));
      assert.ok(audit.markdownReport.includes("MOD-027-1"));
      assert.ok(audit.markdownReport.includes("TPL-001-4"));
    });

    it("detects MOD-025 generator active and reactive capability violations", () => {
      const rawCase = parseRaw(SAMPLE_IEEE9_RAW);
      rawCase.dyr = parseDyr(SAMPLE_IEEE9_DYR);

      // Force Gen 2 to exceed its Pmax
      const gen2 = rawCase.generators.find((g) => g.i === 2)!;
      gen2.pg = 350.0; // Pmax is 300.0

      // Invert Gen 3 reactive capability limits (Qmax < Qmin)
      const gen3 = rawCase.generators.find((g) => g.i === 3)!;
      gen3.qt = -100.0;
      gen3.qb = 100.0;

      const audit = auditNercCompliance(rawCase, { includeContingencies: false });

      assert.equal(audit.mod025.severity, "violation");
      assert.equal(audit.overallStatus, "NON-COMPLIANT");

      const pmaxFinding = audit.findings.find((f) => f.rule === "active-power-limit");
      assert.ok(pmaxFinding);
      assert.equal(pmaxFinding.standard, "MOD-025-2");
      assert.equal(pmaxFinding.severity, "violation");

      const qSpanFinding = audit.findings.find((f) => f.rule === "reactive-capability-envelope");
      assert.ok(qSpanFinding);
      assert.equal(qSpanFinding.standard, "MOD-025-2");
      assert.equal(qSpanFinding.severity, "violation");
    });

    it("detects MOD-026 excitation system anomalies and missing AVR models", () => {
      const rawCase = parseRaw(SAMPLE_IEEE9_RAW);
      // Omit exciter for Gen 1, and set negative gain KA for Gen 2
      const badDyr = `1 'GENROU' '1' 8.96 0.05 0.60 0.05 5.0 0.0 1.56 1.06 0.296 0.296 0.177 0.13 0.10 0.30 /
1 'TGOV1' '1' 0.04 0.1 1.05 0.0 0.0 0.0 0.0 /
2 'GENROU' '1' 6.00 0.05 0.53 0.05 4.0 0.0 1.22 1.16 0.174 0.174 0.134 0.09 0.08 0.28 /
2 'EXST1' '1' 0.0 5.0 -5.0 0.0 0.0 -50.0 0.05 4.0 -4.0 0.0 0.0 0.0 /
2 'TGOV1' '1' 0.05 0.1 1.05 0.0 0.0 0.0 0.0 /
`;
      rawCase.dyr = parseDyr(badDyr);

      const audit = auditNercCompliance(rawCase, { includeContingencies: false });

      assert.equal(audit.mod026.severity, "violation");
      const missingAvr = audit.findings.find((f) => f.rule === "missing-excitation-model");
      assert.ok(missingAvr);

      const badGain = audit.findings.find((f) => f.rule === "regulator-gain-bounds");
      assert.ok(badGain);
      assert.equal(badGain.observedValue, -50.0);
    });

    it("detects MOD-027 governor droop violations and excessive deadbands", () => {
      const rawCase = parseRaw(SAMPLE_IEEE9_RAW);
      // Invert Gen 1 droop (negative droop) and set excessive droop on Gen 2
      const badDyr = `1 'GENROU' '1' 8.96 0.05 0.60 0.05 5.0 0.0 1.56 1.06 0.296 0.296 0.177 0.13 0.10 0.30 /
1 'EXST1' '1' 0.0 5.0 -5.0 0.0 0.0 100.0 0.05 4.0 -4.0 0.0 0.0 0.0 /
1 'TGOV1' '1' -0.02 0.1 1.05 0.0 0.0 0.0 0.0 /
2 'GENROU' '1' 6.00 0.05 0.53 0.05 4.0 0.0 1.22 1.16 0.174 0.174 0.134 0.09 0.08 0.28 /
2 'EXST1' '1' 0.0 5.0 -5.0 0.0 0.0 80.0 0.05 4.0 -4.0 0.0 0.0 0.0 /
2 'TGOV1' '1' 0.25 0.1 1.05 0.0 0.0 0.0 0.0 /
`;
      rawCase.dyr = parseDyr(badDyr);

      const audit = auditNercCompliance(rawCase, { includeContingencies: false });

      assert.equal(audit.mod027.severity, "violation");
      const droopFindings = audit.findings.filter((f) => f.rule === "droop-setting-range");
      assert.equal(droopFindings.length, 2);
    });

    it("detects TPL-001 P0 voltage violations and thermal overloads", () => {
      const rawCase = parseRaw(SAMPLE_IEEE9_RAW);
      rawCase.dyr = parseDyr(SAMPLE_IEEE9_DYR);

      // Artificially restrict bus normal voltage range to force a P0 violation
      const bus5 = rawCase.buses.get(5)!;
      bus5.nvlo = 1.02; // Solved voltage is ~0.9956 pu

      // Restrict line rating to force thermal overload
      const br4_5 = rawCase.branches.find((b) => b.i === 4 && b.j === 5)!;
      br4_5.rateA = 10.0; // Normal flow is ~40 MVA

      const audit = auditNercCompliance(rawCase, { includeContingencies: false });

      assert.equal(audit.tpl001.severity, "violation");
      assert.ok(audit.tpl001.p0VoltageViolations > 0);
      assert.ok(audit.tpl001.p0ThermalOverloads > 0);

      const voltFinding = audit.findings.find((f) => f.rule === "p0-voltage-range");
      assert.ok(voltFinding);

      const thermFinding = audit.findings.find((f) => f.rule === "p0-thermal-rating");
      assert.ok(thermFinding);
    });
  });
});
