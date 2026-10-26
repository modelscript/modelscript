// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  executeOpenDssAction,
  getOpenDssDocumentSymbols,
  getOpenDssHover,
  LspSymbolKind,
  validateOpenDss,
} from "../src/index.js";

const VALID_OPENDSS = `! Valid IEEE 4-Bus Feeder
Clear
New Circuit.IEEE4Bus basekv=115.0 pu=1.05 phases=3 bus1=SourceBus
New Transformer.SubXfmr phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[10000, 10000]
New Line.Line1 bus1=SubBus bus2=LoadBus phases=3 length=2.0 r1=0.1 x1=0.4
New Load.Load1 bus1=LoadBus phases=3 kv=12.47 kw=1500 kvar=500
`;

const FLAWED_OPENDSS = `! Flawed OpenDSS Circuit
Clear
New Circuit.TestGrid basekv=115.0 pu=1.0 bus1=SourceBus
New Line.BadLine bus1=SourceBus bus2=KnownBus phases=3 length=-5.0 linecode=MISSING_CODE
New Load.BadLoad bus1=UNCONNECTED_BUS phases=3 kv=12.47 kw=-100 kvar=20
`;

test("OpenDSS LSP: validateOpenDss returns 0 diagnostics on clean circuit", () => {
  const diags = validateOpenDss(VALID_OPENDSS);
  assert.strictEqual(diags.length, 0);
});

test("OpenDSS LSP: validateOpenDss returns diagnostics on flawed circuit", () => {
  const diags = validateOpenDss(FLAWED_OPENDSS);
  assert(diags.length >= 3, `Expected at least 3 diagnostics, got ${diags.length}`);
  const lenDiag = diags.find((d) => d.code === "M8407");
  const busDiag = diags.find((d) => d.code === "M8401");
  assert(lenDiag !== undefined);
  assert(busDiag !== undefined);
});

test("OpenDSS LSP: getOpenDssDocumentSymbols returns document symbols hierarchy", () => {
  const symbols = getOpenDssDocumentSymbols(VALID_OPENDSS);
  assert.strictEqual(symbols.length, 1);
  const root = symbols[0]!;
  assert.strictEqual(root.kind, LspSymbolKind.Package);
  assert(root.name.includes("IEEE4Bus"));
  assert(root.children !== undefined && root.children.length >= 3);
});

test("OpenDSS LSP: getOpenDssHover returns markdown hover info", () => {
  // Line 3 (0-indexed: line 2 is New Circuit.IEEE4Bus)
  const circuitHover = getOpenDssHover(VALID_OPENDSS, { line: 2, character: 2 });
  assert(circuitHover !== undefined);
  assert(circuitHover.contents.value.includes("IEEE4Bus"));
  assert(circuitHover.contents.value.includes("115 kV"));

  // Line 5 (0-indexed: line 4 is New Line.Line1)
  const lineHover = getOpenDssHover(VALID_OPENDSS, { line: 4, character: 2 });
  assert(lineHover !== undefined);
  assert(lineHover.contents.value.includes("Line1"));
  assert(lineHover.contents.value.includes("SubBus"));
  assert(lineHover.contents.value.includes("LoadBus"));
});

test("OpenDSS LSP: executeOpenDssAction executes registered actions", async () => {
  const lintRes = await executeOpenDssAction("opendss_lint", VALID_OPENDSS);
  assert(Array.isArray(lintRes));

  const pfRes = await executeOpenDssAction("opendss_powerflow", VALID_OPENDSS);
  assert.strictEqual(pfRes.converged, true);
  assert(pfRes.totalLoadKw === 1500);

  const daeRes = await executeOpenDssAction("opendss_to_dae", VALID_OPENDSS);
  assert.strictEqual(daeRes.modelName, "IEEE4Bus");
  assert(daeRes.variableCount >= 8);

  const moRes = await executeOpenDssAction("opendss_to_modelica", VALID_OPENDSS);
  assert(typeof moRes === "string");
  assert(moRes.includes("model IEEE4Bus"));
});
