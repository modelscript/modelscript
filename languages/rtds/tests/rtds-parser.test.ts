// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRtdsDraft } from "../src/parser/rtds-parser.js";
import { projectRtdsToAtp } from "../src/projections/rtds-to-atp.js";

const SAMPLE_DFT = `
CASE HVDC_HIL_Test
TIME_STEP 50e-6
FINISH_TIME 0.2
FREQUENCY 60
SUBSYSTEM 1
COMPONENT SOURCE SRC1 nodes=BUS1,0 V=138000
COMPONENT R R_LINE nodes=BUS1,BUS2 R=0.5
COMPONENT L L_LINE nodes=BUS2,BUS3 L=0.01
COMPONENT C C_SHUNT nodes=BUS3,0 C=1e-5
`;

describe("RTDS Parser & ATP Projection", () => {
  it("parses .dft subsystems/components and exports to ATP-EMTP", () => {
    const draft = parseRtdsDraft(SAMPLE_DFT);
    assert.equal(draft.name, "HVDC_HIL_Test");
    assert.equal(draft.timeStepSec, 50e-6);
    assert.equal(draft.components.length, 4);
    assert.equal(draft.nodes.size, 3);

    const atp = projectRtdsToAtp(draft);
    assert.ok(atp.includes("BEGIN NEW DATA CASE"));
    assert.ok(atp.includes("/BRANCH"));
    assert.ok(atp.includes("/SOURCE"));
  });
});
