// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerPsseToDae } from "../src/dae/index.js";
import {
  applyPsseDiagramWriteback,
  executePsseAction,
  formatPsseDocument,
  getPsseCodeActions,
  getPsseCompletions,
  getPsseDefinition,
  getPsseDocumentSymbols,
  getPsseHover,
  getPsseInlayHints,
  getPsseReferences,
  getPsseRenameEdits,
  validatePsse,
} from "../src/lsp.js";
import { parseDyr } from "../src/parser/dyr-parser.js";
import { parseRaw } from "../src/parser/raw-parser.js";

const IEEE_14_RAW = `0, 100.00, 33, 0, 0, 60.00 / PSS/E-33.0 IEEE 14 BUS TEST CASE
IEEE 14 BUS TEST CASE
TRANSMISSION PLANNING MODEL
1, 'BUS 1       ', 0.6900, 3, 1, 1, 1, 1.0600, 0.0000
2, 'BUS 2       ', 0.6900, 2, 1, 1, 1, 1.0450, -4.9800
3, 'BUS 3       ', 0.6900, 2, 1, 1, 1, 1.0100, -12.7200
4, 'BUS 4       ', 0.6900, 1, 1, 1, 1, 1.0190, -10.3300
5, 'BUS 5       ', 0.6900, 1, 1, 1, 1, 1.0200, -8.7800
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 21.700, 12.700, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
3, '1 ', 1, 1, 1, 94.200, 19.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
4, '1 ', 1, 1, 1, 47.800, -3.900, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
5, '1 ', 1, 1, 1, 7.600, 1.600, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 232.400, -16.900, 10.000, -9999.000, 1.0600, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
2, '1 ', 40.000, 42.400, 50.000, -40.000, 1.0450, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
3, '1 ', 0.000, 23.400, 40.000, 0.000, 1.0100, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01938, 0.05917, 0.05280, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
1, 5, '1 ', 0.05403, 0.22304, 0.04920, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 3, '1 ', 0.04699, 0.19797, 0.04380, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 4, '1 ', 0.05811, 0.17632, 0.03400, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 5, '1 ', 0.05695, 0.17388, 0.03460, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
3, 4, '1 ', 0.06701, 0.17103, 0.01280, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
4, 5, '1 ', 0.01335, 0.04211, 0.00000, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
`;

const SAMPLE_DYR = `// Dynamic data
1 'GENROU' '1' 6.50 0.05 0.50 0.06 5.14 2.00 1.80 1.70 0.60 0.80 0.20 0.13 0.09 0.35 /
1 'EXST1'  '1' 0.02 1.15 -1.15 1.00 10.0 200.0 0.05 5.00 -5.00 0.10 0.03 0.0 /
`;

describe("PSS/E LSP Services & DAE Lowering (@modelscript/psse)", () => {
  it("validates RAW case and produces 0 error diagnostics for valid model", () => {
    const diags = validatePsse(IEEE_14_RAW);
    assert.ok(Array.isArray(diags));
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0);
  });

  it("extracts document symbols hierarchy for buses, generators, and branches with accurate line ranges", () => {
    const symbols = getPsseDocumentSymbols(IEEE_14_RAW);
    assert.ok(symbols.length > 0);
    assert.ok(symbols[0]?.name.includes("IEEE 14 BUS TEST CASE"));
    const bus1Sym = symbols[0]?.children?.find((c) => c.name.includes("Bus 1"));
    assert.ok(bus1Sym);
    assert.equal(bus1Sym.range.start.line, 3);
    assert.ok(symbols[0]?.children?.some((c) => c.name.includes("Gen Bus 1")));
    assert.ok(symbols[0]?.children?.some((c) => c.name.includes("Line 1 -> 2")));
  });

  it("provides contextual hover information for bus, generator, and branch records", () => {
    const hoverBus = getPsseHover(IEEE_14_RAW, { line: 3, character: 10 });
    assert.ok(hoverBus);
    assert.ok(hoverBus?.contents.value.includes("BUS 1"));
    assert.ok(hoverBus?.contents.value.includes("Swing / Slack"));

    const hoverGen = getPsseHover(IEEE_14_RAW, { line: 15, character: 12 });
    assert.ok(hoverGen);
    assert.ok(hoverGen?.contents.value.includes("Synchronous Generator"));

    const hoverBr = getPsseHover(IEEE_14_RAW, { line: 19, character: 18 });
    assert.ok(hoverBr);
    assert.ok(hoverBr?.contents.value.includes("AC Transmission Branch"));
  });

  it("supports Go-to-Definition, Find References, Completions, and .dyr LSP features", () => {
    const uri = "file:///workspace/ieee14.raw";
    // Line 19 is branch "1, 2, '1 ', ..." -> clicking on bus 2 (character 3) jumps to Bus 2 declaration on line 4
    const def = getPsseDefinition(IEEE_14_RAW, { line: 19, character: 3 }, uri);
    assert.ok(def);
    assert.equal(def.range.start.line, 4);

    // References to Bus 2 (declared on line 4, load on line 9, gen on line 16, branches on lines 19, 21, 22, 23)
    const refs = getPsseReferences(IEEE_14_RAW, { line: 4, character: 0 }, uri);
    assert.ok(refs.length >= 6);

    // Completions
    const completions = getPsseCompletions(IEEE_14_RAW, { line: 3, character: 0 });
    assert.ok(completions.length > 5);
    assert.ok(completions.some((c) => c.label.includes("END OF BUS DATA")));

    // .dyr symbols, hover, and validation
    const dyrSyms = getPsseDocumentSymbols(SAMPLE_DYR);
    assert.equal(dyrSyms.length, 1);
    assert.equal(dyrSyms[0]?.children?.length, 2);
    const dyrHover = getPsseHover(SAMPLE_DYR, { line: 1, character: 5 });
    assert.ok(dyrHover?.contents.value.includes("GENROU"));
    const dyrDiags = validatePsse(SAMPLE_DYR);
    assert.equal(dyrDiags.filter((d) => d.severity === 1).length, 0);
  });

  it("lowers PSS/E case into a coupled, square linear-memory DAE arena", () => {
    const psseCase = parseRaw(IEEE_14_RAW);
    const dae = lowerPsseToDae(psseCase);
    assert.ok(dae.varCount >= 20);
    assert.equal(dae.varCount, dae.eqCount, "Expected square DAE system (varCount === eqCount)");
  });

  it("executes domain actions: lint, extract_netlist, to_modelica, to_pscad, to_dae, solve_powerflow, simulate_transient, analyze_n1_contingencies", async () => {
    const lintRes = await executePsseAction("lint", { content: IEEE_14_RAW });
    assert.ok(Array.isArray(lintRes));

    const netlistRes = (await executePsseAction("extract_netlist", { content: IEEE_14_RAW })) as {
      nBuses: number;
      ybusNonZeros: number;
      reportText: string;
    };
    assert.equal(netlistRes.nBuses, 5);
    assert.ok(netlistRes.ybusNonZeros > 0);
    assert.ok(netlistRes.reportText.includes("SPARSE NODAL ADMITTANCE MATRIX"));

    const moRes = await executePsseAction("to_modelica", { content: IEEE_14_RAW });
    assert.ok(typeof moRes === "string" && moRes.includes("model"));

    const pscadRes = await executePsseAction("to_pscad", { content: IEEE_14_RAW });
    assert.ok(pscadRes);

    const daeRes = (await executePsseAction("to_dae", { content: IEEE_14_RAW })) as {
      varCount: number;
      eqCount: number;
    };
    assert.ok(daeRes.varCount > 0);
    assert.equal(daeRes.varCount, daeRes.eqCount);

    const pfRes = (await executePsseAction("solve_powerflow", { content: IEEE_14_RAW })) as {
      converged: boolean;
      reportText: string;
    };
    assert.ok(pfRes.converged);
    assert.ok(pfRes.reportText.includes("AC POWER FLOW SOLUTION REPORT"));

    const n1Res = (await executePsseAction("analyze_n1_contingencies", { content: IEEE_14_RAW })) as {
      totalContingencies: number;
      reportText: string;
    };
    assert.equal(n1Res.totalContingencies, 9);
    assert.ok(n1Res.reportText.includes("N-1 CONTINGENCY SECURITY SCREENING REPORT"));

    const scRes = (await executePsseAction("solve_short_circuit", { content: IEEE_14_RAW })) as {
      buses: unknown[];
      maxFaultCurrentKa: number;
      reportText: string;
    };
    assert.equal(scRes.buses.length, 5);
    assert.ok(scRes.maxFaultCurrentKa > 0);
    assert.ok(scRes.reportText.includes("SHORT-CIRCUIT FAULT DUTY REPORT"));

    const simRes = (await executePsseAction("simulate_transient", {
      content: IEEE_14_RAW,
      stopTime: 1.0,
    })) as {
      t: number[];
      states: string[];
      y: number[][];
      summary: { stable: boolean; convergedPowerFlow: boolean };
    };
    assert.ok(simRes.t.length > 10);
    assert.ok(simRes.states.length >= 6);
    assert.equal(simRes.y.length, simRes.states.length);
    assert.equal(simRes.summary.convergedPowerFlow, true);
    assert.equal(simRes.summary.stable, true);
  });

  it("pairs companion .raw and .dyr files in UnifiedWorkspace and enables cross-file hover and Go-to-Definition", async () => {
    const { UnifiedWorkspace } = await import("@modelscript/runtime");
    const { psseLanguage, findCompanionPsseDyr, findCompanionPsseRaw, getMergedPsseCase } =
      await import("../src/index.js");
    const ws = new UnifiedWorkspace(psseLanguage);
    const rawUri = "file:///workspace/ieee14.raw";
    const dyrUri = "file:///workspace/ieee14.dyr";
    ws.setDocument(rawUri, IEEE_14_RAW);
    ws.setDocument(dyrUri, SAMPLE_DYR);

    assert.equal(findCompanionPsseDyr(ws, rawUri)?.uri, dyrUri);
    assert.equal(findCompanionPsseRaw(ws, dyrUri)?.uri, rawUri);
    const merged = getMergedPsseCase(ws, rawUri);
    assert.ok(merged?.dyr);
    assert.equal(merged?.dyr?.records.length, 2);

    // Hovering Generator 1 in ieee14.raw (line 15) shows attached GENROU + EXST1 from ieee14.dyr
    const genHover = getPsseHover(IEEE_14_RAW, { line: 15, character: 5 }, rawUri, ws);
    assert.ok(genHover?.contents.value.includes("Dynamic Stack"));
    assert.ok(genHover?.contents.value.includes("GENROU"));
    assert.ok(genHover?.contents.value.includes("EXST1"));

    // Hovering GENROU in ieee14.dyr (line 1) shows connected Bus 1 from ieee14.raw
    const dyrHover = getPsseHover(SAMPLE_DYR, { line: 1, character: 5 }, dyrUri, ws);
    assert.ok(dyrHover?.contents.value.includes("Connected `.raw` Bus"));
    assert.ok(dyrHover?.contents.value.includes("BUS 1"));

    // Go-to-Definition from ieee14.dyr record (line 1) jumps to Bus 1 in ieee14.raw
    const defToRaw = getPsseDefinition(SAMPLE_DYR, { line: 1, character: 0 }, dyrUri, ws);
    assert.equal(defToRaw?.uri, rawUri);
    assert.equal(defToRaw?.range.start.line, 3);

    // Cross-file Find References on Bus 1 in ieee14.raw includes companion .dyr records
    const crossRefs = getPsseReferences(IEEE_14_RAW, { line: 3, character: 0 }, rawUri, ws);
    assert.ok(crossRefs.some((r) => r.uri === dyrUri));
  });

  it("supports Inlay Hints, Atomic Bus Rename (F2), Quick Fix Code Actions, Writeback (branch_/shunt_), and WECC IBR .dyr models", async () => {
    const rawHints = getPsseInlayHints(IEEE_14_RAW, "ieee14.raw");
    assert.ok(rawHints.length >= 10);
    assert.ok(rawHints.some((h) => h.label.includes("Slack")));

    const dyrHints = getPsseInlayHints(SAMPLE_DYR, "ieee14.dyr");
    assert.equal(dyrHints.length, 2);
    assert.ok(dyrHints[0]?.label.includes("Td0p=6.5"));

    // Atomic Bus Rename: renumber Bus 1 -> Bus 101 across .raw and companion .dyr
    const { UnifiedWorkspace } = await import("@modelscript/runtime");
    const { psseLanguage } = await import("../src/index.js");
    const ws = new UnifiedWorkspace(psseLanguage);
    const rawUri = "file:///workspace/ieee14.raw";
    const dyrUri = "file:///workspace/ieee14.dyr";
    ws.setDocument(rawUri, IEEE_14_RAW);
    ws.setDocument(dyrUri, SAMPLE_DYR);

    const renameEdit = getPsseRenameEdits(IEEE_14_RAW, { line: 3, character: 0 }, "101", rawUri, ws);
    assert.ok(renameEdit);
    assert.ok(renameEdit.changes[rawUri]);
    assert.ok(renameEdit.changes[dyrUri]);
    const renumberedCase = parseRaw(renameEdit.changes[rawUri]![0]!.newText);
    assert.ok(renumberedCase.buses.has(101));
    assert.ok(!renumberedCase.buses.has(1));

    // Diagram writeback for branch_1_2_1 (used by buildPsseDiagram)
    const afterBranchEdit = applyPsseDiagramWriteback(IEEE_14_RAW, "branch_1_2_1", { x: 0.0888, st: 0 });
    const editedCase = parseRaw(afterBranchEdit);
    const br12 = editedCase.branches.find((b) => b.i === 1 && b.j === 2);
    assert.ok(br12);
    assert.equal(br12.x, 0.0888);
    assert.equal(br12.st, 0);

    // Quick Fix Code Action for P3001 (inverted Qmin/Qmax)
    const badGenRaw = applyPsseDiagramWriteback(IEEE_14_RAW, "gen_2_1", { qb: 100.0, qt: -50.0 });
    const diags = validatePsse(badGenRaw, rawUri);
    const p3001 = diags.find((d) => d.code === "P3001");
    assert.ok(p3001);
    const actions = getPsseCodeActions(badGenRaw, p3001.range, [p3001], rawUri);
    assert.equal(actions.length, 1);
    const fixedCase = parseRaw(actions[0]!.edit.changes[rawUri]![0]!.newText);
    const gen2 = fixedCase.generators.find((g) => g.i === 2)!;
    assert.ok(gen2.qb <= gen2.qt);

    // WECC 2nd-gen Renewable IBR dynamic models (REGC_A, REEC_A, REPC_A)
    const ibrDyrText = `
1 'REGC_A' '1' 0.02 10.0 0.9 0.4 1.22 1.2 0.8 0.4 -1.3 0.01 0.7 999.0 -999.0 0.7 /
1 'REEC_A' '1' 0.85 1.15 0.01 -0.05 0.05 2.0 1.05 -1.05 1.0 0.0 0.0 0.0 0.05 0.436 -0.436 1.1 0.9 0.0 0.1 0.0 40.0 0.02 99.0 -99.0 1.0 0.0 1.3 0.02 /
`;
    const ibrDyr = parseDyr(ibrDyrText);
    assert.equal(ibrDyr.records.length, 2);
    assert.equal(ibrDyr.records[0]?.model, "REGC_A");
    assert.equal(ibrDyr.records[0]?.namedParams["Tg"], 0.02);
    const ibrCase = parseRaw(IEEE_14_RAW);
    ibrCase.dyr = ibrDyr;
    const ibrDae = lowerPsseToDae(ibrCase);
    assert.equal(ibrDae.varCount, ibrDae.eqCount);

    // Formatting
    const formattedDyr = formatPsseDocument(ibrDyrText, "ibr.dyr");
    assert.ok(formattedDyr.includes("@! IBUS"));
    assert.ok(formattedDyr.includes("'REGC_A'"));
  });
});
