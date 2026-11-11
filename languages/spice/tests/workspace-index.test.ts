// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { findSpiceReferencesTo, findSpiceSymbols, resolveSpiceQualified, spiceLanguage } from "../src/index.js";

const FILE_LIB = `* Operational Amplifier Library (.lib)
.SUBCKT OPAMP_IDEAL in_pos in_neg out_pin
  E1 out_pin 0 in_pos in_neg 100000
.ENDS OPAMP_IDEAL

.MODEL DIODE_FAST D (IS=1e-12 RS=1 N=1.2)
.END
`;

const FILE_MAIN = `* Main Inverting Amplifier Circuit (.cir)
.INCLUDE opamp.lib
V1 in 0 SINE(0 1 1k)
R_in in inv 10k
R_fb inv out 100k
X1 0 inv out OPAMP_IDEAL
D1 out 0 DIODE_FAST
.END
`;

describe("SPICE Multi-File UnifiedWorkspace Indexer (@modelscript/spice)", () => {
  it("should index subcircuits, models, and components across multiple files", () => {
    const ws = new UnifiedWorkspace(spiceLanguage);
    ws.setDocument("file:///workspace/opamp.lib", FILE_LIB);
    ws.setDocument("file:///workspace/main.cir", FILE_MAIN);

    assert.strictEqual(ws.fileCount, 2);

    // 1. Symbol Search
    const opampSyms = findSpiceSymbols(ws, "OPAMP_IDEAL");
    assert.ok(opampSyms.length >= 1, "Should find OPAMP_IDEAL symbol");
    assert.strictEqual(opampSyms[0]?.kind, "Class");
    assert.strictEqual(opampSyms[0]?.ruleName, "spice_subcircuit");

    const diodeSyms = findSpiceSymbols(ws, "DIODE_FAST");
    assert.ok(diodeSyms.length >= 1, "Should find DIODE_FAST model symbol");
    assert.strictEqual(diodeSyms[0]?.ruleName, "spice_model");

    // 2. Qualified Resolution
    const resolvedOpAmp = resolveSpiceQualified(ws, "OPAMP_IDEAL", "file:///workspace/main.cir");
    assert.ok(resolvedOpAmp);
    assert.strictEqual(resolvedOpAmp.name, "OPAMP_IDEAL");

    // 3. Cross-file references
    if (opampSyms[0]) {
      const refs = findSpiceReferencesTo(ws, opampSyms[0].id);
      // X1 in main.cir references OPAMP_IDEAL
      assert.ok(refs.length >= 1, "Should find references from X1 to OPAMP_IDEAL");
      assert.strictEqual(refs[0]?.uri, "file:///workspace/main.cir");
    }
  });
});
