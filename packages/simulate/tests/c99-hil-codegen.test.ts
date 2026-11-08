// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeIec61850GooseFrame,
  decodeIec61850SvFrame,
  encodeIec61850GooseFrame,
  encodeIec61850SvFrame,
  generateDeterministicHilC99,
} from "../src/jit/index.js";

console.log("=== Testing Phase 4: Real-Time HIL C99 & IEC 61850-9-2LE / GOOSE Codegen ===");

// Test 1: Deterministic Static C99 Codegen with Pre-Factored Switch-State G_INV_LUT
{
  console.log("Test 1: Deterministic HIL C99 Codegen & GCC Compilation Verification");
  const codegen = generateDeterministicHilC99({
    modelName: "half_bridge_hil",
    nNodes: 3,
    dt: 10e-6,
    branches: [
      { fromNode: 1, toNode: 2, r: 0.5, l: 2e-3, c: 0 },
      { fromNode: 2, toNode: -1, r: 10.0, l: 0, c: 50e-6 },
    ],
    switches: [
      { name: "S_upper", fromNode: 0, toNode: 1, rOn: 1e-3, rOff: 1e6 },
      { name: "S_lower", fromNode: 1, toNode: -1, rOn: 1e-3, rOff: 1e6 },
    ],
    sources: [{ node: 0, amplitude: 800.0, freqHz: 0.0, phaseRad: 0.0, rInternal: 0.01 }],
  });

  assert.strictEqual(codegen.numSwitchCombinations, 4, "2 switches -> 2^2 = 4 pre-factored G_INV_LUT entries");
  assert.strictEqual(codegen.gInvLut.length, 4);
  assert.ok(codegen.cSource.includes("static const double G_INV_LUT[4][3][3]"));
  assert.ok(codegen.cSource.includes("#pragma GCC poison malloc calloc realloc free"));

  // Ensure no heap allocation calls exist outside the pragma poison directive
  const linesWithoutPragma = codegen.cSource
    .split("\n")
    .filter((l) => !l.includes("#pragma GCC poison") && !l.includes("Memory Model"))
    .join("\n");
  assert.strictEqual(/\b(malloc|calloc|realloc|free)\b/.test(linesWithoutPragma), false);

  // Compile and execute the generated C99 code with gcc -std=c99 -O2 -Wall -Wextra -Werror
  const workDir = mkdtempSync(join(tmpdir(), "msx-hil-c99-"));
  try {
    const cPath = join(workDir, "half_bridge_hil_test.c");
    const binPath = join(workDir, "half_bridge_hil_test");
    const harness = `
${codegen.cSource}
#include <stdio.h>

int main(void) {
  half_bridge_hil_hil_state_t st;
  half_bridge_hil_hil_init(&st);
  for (uint32_t k = 0; k < 200; ++k) {
    uint32_t mask = (k % 20 < 10) ? 1u : 2u; /* 50% duty complementary switching */
    half_bridge_hil_hil_step(&st, mask, (const double *)0);
  }
  printf("V0=%.6f V1=%.6f V2=%.6f steps=%llu\\n",
    st.v_nodes[0], st.v_nodes[1], st.v_nodes[2], (unsigned long long)st.step_count);
  return (st.v_nodes[2] > 100.0 && st.v_nodes[2] < 800.0) ? 0 : 1;
}
`;
    writeFileSync(cPath, harness, "utf8");
    execFileSync("gcc", ["-std=c99", "-O2", "-Wall", "-Wextra", "-Werror", cPath, "-lm", "-o", binPath]);
    const out = execFileSync(binPath, { encoding: "utf8" }).trim();
    console.log(`   Compiled C99 HIL execution output: ${out}`);
    assert.ok(out.includes("steps=200"));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// Test 2: IEC 61850-9-2LE Sampled Values (SV) Frame Round-Trip
{
  console.log("Test 2: IEC 61850-9-2LE Sampled Values (0x88BA) Frame Encode/Decode Round-Trip");
  const frame = encodeIec61850SvFrame({
    appId: 0x4001,
    asdu: {
      svID: "BAY01_MU01",
      smpCnt: 1999,
      confRev: 1,
      smpSynch: 2,
      currentsAmp: [1245.678, -622.839, -622.839, 0.005],
      voltagesVolt: [115470.05, -57735.02, -57735.03, 0.12],
    },
  });

  const decoded = decodeIec61850SvFrame(frame);
  assert.strictEqual(decoded.etherType, 0x88ba);
  assert.strictEqual(decoded.appId, 0x4001);
  assert.strictEqual(decoded.svID, "BAY01_MU01");
  assert.strictEqual(decoded.smpCnt, 1999);
  assert.strictEqual(decoded.confRev, 1);
  assert.strictEqual(decoded.smpSynch, 2);
  assert.ok(Math.abs(decoded.currentsAmp[0] - 1245.678) < 1e-3);
  assert.ok(Math.abs(decoded.voltagesVolt[0] - 115470.05) < 1e-2);
  console.log(
    `   Decoded 9-2LE SV Frame (${frame.byteLength} bytes): svID=${decoded.svID}, smpCnt=${decoded.smpCnt}, Ia=${decoded.currentsAmp[0]} A, Va=${decoded.voltagesVolt[0]} V`,
  );
}

// Test 3: IEC 61850 GOOSE Trip Frame Round-Trip
{
  console.log("Test 3: IEC 61850 GOOSE Protection Trip (0x88B8) Frame Encode/Decode Round-Trip");
  const gooseFrame = encodeIec61850GooseFrame({
    appId: 0x0005,
    gocbRef: "IED1_PROT/LLN0$GO$gcbTrip",
    datSet: "IED1_PROT/LLN0$TripDataset",
    goID: "IED1_LINE_DIFF_TRIP",
    stNum: 4,
    sqNum: 1,
    timeAllowedToLiveMs: 1000,
    breakerTrips: [true, false, true],
  });

  const decodedGoose = decodeIec61850GooseFrame(gooseFrame);
  assert.strictEqual(decodedGoose.etherType, 0x88b8);
  assert.strictEqual(decodedGoose.appId, 0x0005);
  assert.strictEqual(decodedGoose.gocbRef, "IED1_PROT/LLN0$GO$gcbTrip");
  assert.strictEqual(decodedGoose.goID, "IED1_LINE_DIFF_TRIP");
  assert.strictEqual(decodedGoose.stNum, 4);
  assert.strictEqual(decodedGoose.sqNum, 1);
  assert.deepStrictEqual(decodedGoose.breakerTrips, [true, false, true]);
  console.log(
    `   Decoded GOOSE Frame (${gooseFrame.byteLength} bytes): goID=${decodedGoose.goID}, stNum=${decodedGoose.stNum}, trips=${JSON.stringify(decodedGoose.breakerTrips)}`,
  );
}

console.log("=== All Phase 4 Real-Time HIL C99 & IEC 61850 Tests Passed! ===");
