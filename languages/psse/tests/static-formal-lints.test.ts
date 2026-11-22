// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  lintPsse,
  parseDyr,
  parseRaw,
  parseSeq,
  runPsseFastStaticLints,
  runPsseFormalVerificationLints,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PSSE_SUITE = path.resolve(__dirname, "../testsuite");

test("PSS/E Tier 1 fast static lints (P8011-P8015) catch N-1 bridges, DYR monotonicity, ungrounded zero-seq, HC4 infeasibility, and protection overlap", () => {
  const faultyRaw = `0, 100.00, 33, 0, 1, 60.00
FAULTY TEST
CASE
1, 'SLACK', 230.0000, 3, 1, 1, 1, 1.02000, 0.0000
2, 'RADIAL', 230.0000, 1, 1, 1, 1, 1.00000, -5.0000
3, 'ISO_Z0', 230.0000, 1, 1, 1, 1, 1.00000, -6.0000
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 2500.0, 500.0, 0.0, 0.0, 0.0, 0.0, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.0, 10.0, 100.0, -100.0, 1.020, 0, 100.0, 0.003, 0.18, 0, 0, 1, 1, 100, 200, 0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.25, 0.02, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
0 / END OF BRANCH DATA
2, 3, 0, '1 ', 1, 1, 0.0, 0.0, 2, 'T2_3', 1, 1, 1.0
0.005, 0.08, 100.0
1.0, 230.0, 0.0, 150.0, 150.0, 150.0, 0, 0, 1.1, 0.9, 1.1, 0.9, 33, 0, 0.0, 0.0, 0.0
1.0, 230.0
0 / END OF TRANSFORMER DATA
Q
`;
  const faultyDyr = `
1 'GENROU' 1 0.02 0.5 0.6 0.05 4.0 0.0 0.20 1.7 0.50 0.55 0.30 0.12 0.05 0.25 /
99 'GENCLS' 1 4.0 2.0 /
1 'FRQTPAT' 1 61.0 59.0 0.1 0.1 /
`;
  const faultySeq = {
    generators: [],
    branches: [],
    mutuals: [],
    transformers: [
      {
        i: 2,
        j: 3,
        k: 0,
        ckt: "1",
        cc: 4,
        r01: 0.005,
        x01: 0.08,
        rg1: 0,
        xg1: 0,
        r02: 0,
        x02: 0,
        rg2: 0,
        xg2: 0,
        r03: 0,
        x03: 0,
        rg3: 0,
        xg3: 0,
      },
    ],
    shunts: [],
  };

  const c = parseRaw(faultyRaw);
  const dyr = parseDyr(faultyDyr);
  const diags = runPsseFastStaticLints(c, { dyrCase: dyr, seqCase: faultySeq });
  const codes = new Set(diags.map((d) => d.code));

  assert.ok(codes.has("P8011"), `Expected P8011 N-1 bridge, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("P8012"), `Expected P8012 DYR mismatch/monotonicity, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("P8013"), `Expected P8013 ungrounded zero-seq island, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("P8014"), `Expected P8014 HC4 static transfer infeasibility, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("P8015"), `Expected P8015 protection overlap, got [${[...codes].join(", ")}]`);
});

test("PSS/E Tier 2 formal verification lints (P8016-P8019) catch PRC-024 violation, NLSAT collapse, low CCT, and emit proof manifest", () => {
  const stressedRaw = `0, 100.00, 33, 0, 1, 60.00
STRESSED FORMAL TEST
CASE
1, 'SLACK', 230.0000, 3, 1, 1, 1, 1.00000, 0.0000
2, 'HEAVY', 230.0000, 1, 1, 1, 1, 0.92000, -25.0000
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 180.0, 60.0, 0.0, 0.0, 0.0, 0.0, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 185.0, 60.0, 300.0, -300.0, 1.000, 0, 100.0, 0.003, 0.25, 0, 0, 1, 1, 100, 200, 0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.30, 0.02, 250, 250, 250, 0, 0, 0, 0, 1, 1, 10
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;
  const prcDyr = `
1 'GENCLS' 1 0.4 1.0 /
1 'FRQTPAT' 1 59.8 60.2 0.1 0.1 /
`;
  const c = parseRaw(stressedRaw);
  const dyr = parseDyr(prcDyr);
  const diags = runPsseFormalVerificationLints(c, { dyrCase: dyr, targetLoadMargin: 1.2, targetFaultClearSec: 0.15 });
  const codes = new Set(diags.map((d) => d.code));

  assert.ok(codes.has("P8016"), `Expected P8016 PRC-024 SMT violation, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("P8017"), `Expected P8017 NLSAT voltage collapse, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("P8018"), `Expected P8018 SOS CCT unsafe, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("P8019"), `Expected P8019 proof manifest summary, got [${[...codes].join(", ")}]`);
});

test("PSS/E fast static lints run in < 50 ms on real IEEE 118-Bus (.raw + .dyr + .seq)", () => {
  const c = parseRaw(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.raw"), "utf-8"));
  const dyr = parseDyr(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.dyr"), "utf-8"));
  const seq = parseSeq(fs.readFileSync(path.join(PSSE_SUITE, "ieee118.seq"), "utf-8"));

  const t0 = Date.now();
  const diags = runPsseFastStaticLints(c, { dyrCase: dyr, seqCase: seq });
  const elapsedMs = Date.now() - t0;

  assert.ok(elapsedMs < 50, `Expected IEEE 118 fast static lints < 50 ms, took ${elapsedMs} ms`);
  assert.equal(
    diags.filter((d) => d.code === "P8013").length,
    0,
    "IEEE 118-Bus should have no ungrounded zero-sequence islands",
  );
  // Also verify integrated lintPsse(..., { tier: "fast" }) executes cleanly
  const fastAll = lintPsse(c, { tier: "fast" });
  assert.ok(Array.isArray(fastAll));
});
