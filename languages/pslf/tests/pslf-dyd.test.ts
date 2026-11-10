// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintPslfDyd, parsePslfDyd, writePslfDyd } from "../src/index.js";

const WECC_DYD_TEXT = `# =========================================================================
# WECC Benchmark Dynamic Models (.dyd)
# =========================================================================

# Classical generator model on Bus 1
gencls 1 "1" 16.50 : #9 0.0 5.0 0.0 0.20 0.0 0.0 0.0 0.0

# Two-axis detailed generator on Bus 2
gentpf 2 "1" 18.00 : #14 6.0 0.05 1.50 0.40 0.20 0.08 0.15 0.25 0.10 0.20 0.0 0.0 0.0 0.0

# Static Exciter on Bus 2
exst1  2 "1" 18.00 : #12 0.0 0.0 200.0 0.05 5.0 -5.0 0.0 0.0 0.0 0.0 0.0 0.0

# Turbine Governor on Bus 2
ieeego 2 "1" 18.00 : #8 0.05 0.5 1.0 0.0 0.2 0.5 0.0 0.0

# WECC Second-Generation Renewable Models (REGCAU1 + REECAU1)
regca1 3 "1" 0.69  : #9 0.02 0.90 1.10 1.20 0.0 0.0 0.0 0.0 0.0
reeca1 3 "1" 0.69  : #12 0.0 0.05 1.10 0.90 0.40 1.10 0.0 0.0 0.0 0.0 0.0 0.0
`;

test("PSLF DYD Parser: parses synchronous and renewable dynamic models", () => {
  const dyd = parsePslfDyd(WECC_DYD_TEXT);

  assert.equal(dyd.models.length, 6, "Should parse 6 dynamic model records");

  const gen1 = dyd.models.find((m) => m.modelType === "gencls");
  assert.ok(gen1);
  assert.equal(gen1.busNumber, 1);
  assert.equal(gen1.id, "1");
  assert.equal(gen1.params.length, 8);
  assert.equal(gen1.params[1], 5.0, "Inertia H should be 5.0");

  const regca = dyd.models.find((m) => m.modelType === "regca1");
  assert.ok(regca, "Should parse regca1 renewable inverter model");
  assert.equal(regca.busNumber, 3);
  assert.equal(regca.baseKv, 0.69);

  const reeca = dyd.models.find((m) => m.modelType === "reeca1");
  assert.ok(reeca, "Should parse reeca1 renewable electrical controller");
});

test("PSLF DYD Serializer: serializes cleanly to .dyd format", () => {
  const dyd1 = parsePslfDyd(WECC_DYD_TEXT);
  const text = writePslfDyd(dyd1);

  assert.ok(text.includes('gencls   1 "1" 16.50 : #8'));
  assert.ok(text.includes('gentpf   2 "1" 18.00 : #14'));
  assert.ok(text.includes('regca1   3 "1" 0.69 : #9'));

  const dyd2 = parsePslfDyd(text);
  assert.equal(dyd2.models.length, dyd1.models.length);
  assert.equal(dyd2.models[0]!.modelType, "gencls");
  assert.equal(dyd2.models[0]!.params[1], 5.0);
});

test("PSLF DYD Linter: detects invalid inertia and dangling bus references", () => {
  const badDydText = `
gencls 999 "1" 13.80 : #2 -1.0 0.0
`;
  const badDyd = parsePslfDyd(badDydText);
  const diags = lintPslfDyd(badDyd);

  const errorCodes = diags.map((d) => d.code);
  assert.ok(errorCodes.includes("PSLF-E007"), "Should detect non-positive inertia H");
});
