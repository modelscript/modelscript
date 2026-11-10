// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintPslfDyd, lintPslfEpc, parsePslfDyd, parsePslfEpc } from "../src/index.js";

test("PSLF Linter: detects missing slack bus (PSLF-E001)", () => {
  const epcNoSlack = `
case 'No Slack Case'
b 1 'BUS1' 230.0 1 1 1 1.0 0.0 1.1 0.9
b 2 'BUS2' 230.0 1 1 1 1.0 0.0 1.1 0.9
ln 1 2 '1' 1 0.01 0.1 0.0 100.0 100.0 100.0
`;
  const epc = parsePslfEpc(epcNoSlack);
  const diags = lintPslfEpc(epc);
  const slackDiag = diags.find((d) => d.code === "PSLF-E001");
  assert.ok(slackDiag, "Should flag missing slack bus");
  assert.equal(slackDiag.severity, "error");
});

test("PSLF Linter: detects dangling branch connections (PSLF-E002)", () => {
  const epcDangling = `
case 'Dangling Branch Case'
b 1 'BUS1' 230.0 3 1 1 1.0 0.0 1.1 0.9
ln 1 99 '1' 1 0.01 0.1 0.0 100.0 100.0 100.0
`;
  const epc = parsePslfEpc(epcDangling);
  const diags = lintPslfEpc(epc);
  const dangling = diags.find((d) => d.code === "PSLF-E002");
  assert.ok(dangling, "Should flag dangling branch connection");
  assert.equal(dangling.severity, "error");
});

test("PSLF Linter: detects inverted generator reactive limits (PSLF-E005)", () => {
  const epcInvertedQ = `
case 'Inverted Q Limits'
b 1 'BUS1' 230.0 3 1 1 1.0 0.0 1.1 0.9
b 2 'BUS2' 230.0 2 1 1 1.0 0.0 1.1 0.9
ln 1 2 '1' 1 0.01 0.1 0.0 100.0 100.0 100.0
g 2 '1' 1 100.0 50.0 -50.0 50.0 1.0 100.0 0.0 0.1 100.0 10.0
`;
  // Here in g: qminMvar is 50.0, qmaxMvar is -50.0 -> qmin > qmax
  const epc = parsePslfEpc(epcInvertedQ);
  const diags = lintPslfEpc(epc);
  const qDiag = diags.find((d) => d.code === "PSLF-E005");
  assert.ok(qDiag, "Should flag inverted Q limits");
  assert.equal(qDiag.severity, "error");
});

test("PSLF Linter: detects isolated buses (PSLF-W003)", () => {
  const epcIsolated = `
case 'Isolated Bus Case'
b 1 'BUS1' 230.0 3 1 1 1.0 0.0 1.1 0.9
b 2 'BUS2' 230.0 1 1 1 1.0 0.0 1.1 0.9
b 3 'ISOLATED' 115.0 1 1 1 1.0 0.0 1.1 0.9
ln 1 2 '1' 1 0.01 0.1 0.0 100.0 100.0 100.0
`;
  const epc = parsePslfEpc(epcIsolated);
  const diags = lintPslfEpc(epc);
  const isoDiag = diags.find((d) => d.code === "PSLF-W003");
  assert.ok(isoDiag, "Should flag isolated bus 3");
  assert.equal(isoDiag.element, "Bus 3");
});

test("PSLF DYD Linter: detects cross-referencing non-existent bus and non-positive inertia", () => {
  const epc = parsePslfEpc(`
case 'Valid Base'
b 1 'BUS1' 230.0 3 1 1 1.0 0.0 1.1 0.9
`);
  const dydBad = `
gencls 99 "1" 230.0 : 0.0 0.1
gencls 1 "1" 230.0 : -2.5 0.1
`;
  const dyd = parsePslfDyd(dydBad);
  const diags = lintPslfDyd(dyd, epc);

  const missingBus = diags.find((d) => d.code === "PSLF-E006");
  assert.ok(missingBus, "Should flag dynamic model referencing non-existent bus 99");

  const badH = diags.find((d) => d.code === "PSLF-E007");
  assert.ok(badH, "Should flag non-positive inertia H");
});
