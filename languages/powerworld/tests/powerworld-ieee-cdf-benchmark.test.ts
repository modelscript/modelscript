// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerPowerWorldToDae } from "../src/dae/powerworld-to-dae.js";
import { parseIeeeCdf, projectToIeeeCdf } from "../src/parser/ieee-cdf-parser.js";
import { projectPowerWorldToPsseRaw } from "../src/projections/aux-to-psse.js";

const IEEE_5BUS_CDF = `
 08/17/26 IEEE 5-BUS TEST CASE                100.0  2026 S
BUS DATA FOLLOWS                    5 ITEMS
1 Bus_1 1 1 3 1.0600 0.00 0.00 0.00 131.00 90.00 138.00
2 Bus_2 1 1 2 1.0000 0.00 20.00 10.00 40.00 30.00 138.00
3 Bus_3 1 1 0 1.0000 0.00 45.00 15.00 0.00 0.00 138.00
4 Bus_4 1 1 0 1.0000 0.00 40.00 5.00 0.00 0.00 138.00
5 Bus_5 1 1 0 1.0000 0.00 60.00 10.00 0.00 0.00 138.00
-999
BRANCH DATA FOLLOWS                 7 ITEMS
1 2 1 1 1 0 0.0200 0.0600 0.0600 250.0 250.0 250.0 0 0 1.0000 0.00
1 3 1 1 1 0 0.0800 0.2400 0.0500 250.0 250.0 250.0 0 0 1.0000 0.00
2 3 1 1 1 0 0.0600 0.1800 0.0400 250.0 250.0 250.0 0 0 1.0000 0.00
2 4 1 1 1 0 0.0600 0.1800 0.0400 250.0 250.0 250.0 0 0 1.0000 0.00
2 5 1 1 1 0 0.0400 0.1200 0.0300 250.0 250.0 250.0 0 0 1.0000 0.00
3 4 1 1 1 0 0.0100 0.0300 0.0200 250.0 250.0 250.0 0 0 1.0000 0.00
4 5 1 1 1 0 0.0800 0.2400 0.0500 250.0 250.0 250.0 0 0 1.0000 0.00
-999
END OF DATA
`;

describe("IEEE Common Data Format (.cdf) Benchmark", () => {
  it("parses IEEE 5-bus CDF, roundtrips to CDF/PSSE, and lowers to DAEBuilder", () => {
    const model = parseIeeeCdf(IEEE_5BUS_CDF);
    assert.equal(model.buses.length, 5);
    assert.equal(model.busByNum.get(1)?.isSlack, true);
    assert.equal(model.generators.length, 2);
    assert.equal(model.loads.length, 4);
    assert.equal(model.branches.length, 7);

    const exportedCdf = projectToIeeeCdf(model);
    const reParsed = parseIeeeCdf(exportedCdf);
    assert.equal(reParsed.buses.length, 5);
    assert.equal(reParsed.branches.length, 7);

    const raw = projectPowerWorldToPsseRaw(model);
    assert.ok(raw.includes("Bus_1"));
    assert.ok(raw.includes("END OF BRANCH DATA"));

    const dae = lowerPowerWorldToDae(model, { modelName: "IEEE5Bus" });
    assert.ok(dae.variables().length >= 22);
    assert.ok(dae.equations().length >= 18);
  });
});
