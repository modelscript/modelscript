// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDistributionExpr, parseSimscript } from "../src/parser/index.js";

const PORT_HARBOR_MODEL = `
'' MODEL: PortHarborBerths
PREAMBLE
  TEMPORARY ENTITIES
    EVERY SHIP HAS A TONNAGE AND BELONGS TO THE HARBOR.QUEUE
  PERMANENT ENTITIES
    EVERY PORT OWNS A HARBOR.QUEUE
  PROCESSES
    INCLUDE GENERATOR
    INCLUDE SHIP
  RESOURCES
    EVERY BERTH
  EVENT NOTICES
    INCLUDE TIDE.SHIFT
  DEFINE HARBOR.QUEUE AS A FIFO SET
  DEFINE TOTAL.SHIPS AS AN INTEGER VARIABLE
  TALLY MEAN.WAIT AS THE MEAN OF WAIT.TIME
  ACCUMULATE AVG.BUSY.BERTHS AS THE MEAN OF N.X.BERTH
  ACCUMULATE AVG.QUEUE.LEN AS THE MEAN OF N.Q.BERTH
END

MAIN
  CREATE EVERY BERTH(1)
  LET U.BERTH = 3
  ACTIVATE A GENERATOR NOW
  SCHEDULE A TIDE.SHIFT IN 12.0 HOURS
  START SIMULATION
END

PROCESS GENERATOR
  ACTIVATE A SHIP NOW
  ACTIVATE A GENERATOR IN EXPONENTIAL.F(2.0, 1) HOURS
END

PROCESS SHIP
  FILE THIS SHIP IN HARBOR.QUEUE
  REQUEST 1 BERTH
  REMOVE FIRST SHIP FROM HARBOR.QUEUE
  WORK EXPONENTIAL.F(4.0, 2) HOURS
  RELINQUISH 1 BERTH
  DESTROY THIS SHIP
END

EVENT TIDE.SHIFT
  PRINT TIDE SHIFTED
END
`;

describe("SIMSCRIPT II.5 Parser", () => {
  it("parses PREAMBLE entities, processes, resources, sets, defines, and statistics", () => {
    const model = parseSimscript(PORT_HARBOR_MODEL);
    assert.strictEqual(model.name, "PortHarborBerths");
    assert.strictEqual(model.preamble.present, true);
    assert.strictEqual(model.preamble.hasEnd, true);
    assert.strictEqual(model.syntaxErrors.length, 0);

    const ship = model.preamble.entities.find((e) => e.name === "SHIP" && e.kind === "temporary");
    assert.ok(ship, "Expected temporary entity SHIP");
    assert.ok(ship.attributes.includes("TONNAGE"));
    assert.ok(ship.belongsToSets.includes("HARBOR.QUEUE"));

    const port = model.preamble.entities.find((e) => e.name === "PORT" && e.kind === "permanent");
    assert.ok(port, "Expected permanent entity PORT");
    assert.ok(port.ownedSets.includes("HARBOR.QUEUE"));

    const berth = model.preamble.entities.find((e) => e.name === "BERTH" && e.kind === "resource");
    assert.ok(berth, "Expected resource BERTH");
    assert.strictEqual(berth.capacity, 3);
    assert.strictEqual(model.resourceCapacities.get("BERTH"), 3);

    assert.strictEqual(model.preamble.sets.get("HARBOR.QUEUE"), "FIFO");
    assert.strictEqual(model.preamble.stats.length, 3);
  });

  it("parses MAIN, PROCESS, and EVENT blocks with statements", () => {
    const model = parseSimscript(PORT_HARBOR_MODEL);
    assert.ok(model.main);
    assert.ok(model.main.statements.some((s) => s.kind === "START_SIMULATION"));
    assert.ok(model.processes.has("GENERATOR"));
    assert.ok(model.processes.has("SHIP"));
    assert.ok(model.events.has("TIDE.SHIFT"));

    const shipProc = model.processes.get("SHIP")!;
    assert.ok(shipProc.statements.some((s) => s.kind === "REQUEST" && s.resource === "BERTH" && s.quantity === 1));
    assert.ok(shipProc.statements.some((s) => s.kind === "WORK" && s.duration.kind === "EXPONENTIAL.F"));
    assert.ok(shipProc.statements.some((s) => s.kind === "RELINQUISH" && s.resource === "BERTH"));
    assert.ok(shipProc.statements.some((s) => s.kind === "FILE" && s.setName === "HARBOR.QUEUE"));
    assert.ok(shipProc.statements.some((s) => s.kind === "REMOVE" && s.setName === "HARBOR.QUEUE"));
  });

  it("parses SIMSCRIPT II.5 distribution expressions", () => {
    const exp = parseDistributionExpr("EXPONENTIAL.F(5.5, 2)");
    assert.strictEqual(exp.kind, "EXPONENTIAL.F");
    assert.deepStrictEqual(exp.args, [5.5]);
    assert.strictEqual(exp.stream, 2);

    const norm = parseDistributionExpr("NORMAL.F(10.0, 1.5, 3)");
    assert.strictEqual(norm.kind, "NORMAL.F");
    assert.deepStrictEqual(norm.args, [10.0, 1.5]);
    assert.strictEqual(norm.stream, 3);

    const unif = parseDistributionExpr("UNIFORM.F(2.0, 8.0, 4)");
    assert.strictEqual(unif.kind, "UNIFORM.F");
    assert.deepStrictEqual(unif.args, [2.0, 8.0]);
    assert.strictEqual(unif.stream, 4);

    const erl = parseDistributionExpr("ERLANG.F(6.0, 3, 1)");
    assert.strictEqual(erl.kind, "ERLANG.F");
    assert.deepStrictEqual(erl.args, [6.0, 3]);
    assert.strictEqual(erl.stream, 1);

    const pois = parseDistributionExpr("POISSON.F(4.0, 5)");
    assert.strictEqual(pois.kind, "POISSON.F");
    assert.deepStrictEqual(pois.args, [4.0]);
    assert.strictEqual(pois.stream, 5);
  });
});
