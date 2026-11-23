// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SimscriptErrorCode, lintSimscript } from "../src/lints/index.js";
import { parseSimscript } from "../src/parser/index.js";

describe("SIMSCRIPT II.5 Static Analysis & Lints (SIMS1001–SIMS5006)", () => {
  it("reports zero diagnostics on a valid SIMSCRIPT II.5 model", () => {
    const valid = `
PREAMBLE
  TEMPORARY ENTITIES
    EVERY JOB BELONGS TO WAIT.Q
  PROCESSES
    INCLUDE GENERATOR
    INCLUDE JOB
  RESOURCES
    EVERY MACHINE
  DEFINE WAIT.Q AS A FIFO SET
  ACCUMULATE AVG.BUSY AS THE MEAN OF N.X.MACHINE
END

MAIN
  LET U.MACHINE = 2
  ACTIVATE A GENERATOR NOW
  START SIMULATION
END

PROCESS GENERATOR
  ACTIVATE A JOB NOW
  ACTIVATE A GENERATOR IN EXPONENTIAL.F(2.0, 1)
END

PROCESS JOB
  FILE THIS JOB IN WAIT.Q
  REQUEST 1 MACHINE
  REMOVE FIRST JOB FROM WAIT.Q
  WORK EXPONENTIAL.F(3.0, 2)
  RELINQUISH 1 MACHINE
END
`;
    const diags = lintSimscript(parseSimscript(valid));
    assert.strictEqual(diags.length, 0, `Expected no diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects SIMS1002 missing PREAMBLE END and SIMS4001 missing START SIMULATION", () => {
    const src = `
PREAMBLE
  RESOURCES
    EVERY BERTH
MAIN
  LET U.BERTH = 2
END
`;
    const diags = lintSimscript(parseSimscript(src));
    assert.ok(diags.some((d) => d.id === SimscriptErrorCode.MISSING_PREAMBLE_END.id));
    assert.ok(diags.some((d) => d.id === SimscriptErrorCode.MISSING_START_SIMULATION.id));
  });

  it("detects SIMS2001 duplicate declaration, SIMS2002 undefined resource, SIMS2003 undefined set", () => {
    const src = `
PREAMBLE
  RESOURCES
    EVERY BERTH
    EVERY BERTH
  PROCESSES
    INCLUDE SHIP
END

MAIN
  LET U.BERTH = 2
  ACTIVATE A SHIP NOW
  START SIMULATION
END

PROCESS SHIP
  FILE THIS SHIP IN GHOST.SET
  REQUEST 1 GHOST.RES
  WORK EXPONENTIAL.F(2.0, 1)
  RELINQUISH 1 GHOST.RES
END
`;
    const diags = lintSimscript(parseSimscript(src));
    assert.ok(diags.some((d) => d.id === "SIMS2001"));
    assert.ok(diags.some((d) => d.id === "SIMS2002"));
    assert.ok(diags.some((d) => d.id === "SIMS2003"));
  });

  it("detects SIMS3001 mismatched REQUEST/RELINQUISH and SIMS5001/5002/5003/5006", () => {
    const src = `
PREAMBLE
  RESOURCES
    EVERY CRANE
  PROCESSES
    INCLUDE WORKER
    INCLUDE IDLE.PROC
END

MAIN
  LET U.CRANE = 0
  ACTIVATE A MISSING.PROC NOW
  START SIMULATION
END

PROCESS WORKER
  REQUEST 2 CRANE
  WORK EXPONENTIAL.F(-1.0, 1)
  RELINQUISH 1 CRANE
END

PROCESS IDLE.PROC
END
`;
    const diags = lintSimscript(parseSimscript(src));
    assert.ok(
      diags.some((d) => d.id === "SIMS3001"),
      "Expected SIMS3001 mismatched REQUEST/RELINQUISH",
    );
    assert.ok(
      diags.some((d) => d.id === "SIMS5001"),
      "Expected SIMS5001 invalid resource capacity",
    );
    assert.ok(
      diags.some((d) => d.id === "SIMS5002"),
      "Expected SIMS5002 invalid distribution param",
    );
    assert.ok(
      diags.some((d) => d.id === "SIMS5003"),
      "Expected SIMS5003 undefined process target",
    );
    assert.ok(
      diags.some((d) => d.id === "SIMS5006"),
      "Expected SIMS5006 empty routine body",
    );
  });
});
