// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventGrammarSolver, type EventGrammarModel } from "../src/formal/event_grammar.js";

describe("Declarative Event Grammar & Scope-Complete Trace Synthesis (MP-Firebird)", () => {
  it("should generate scope-complete traces for alternative choices", () => {
    // Producer with two alternative paths: ProduceA or ProduceB
    const model: EventGrammarModel = {
      name: "ProducerChoices",
      actors: {
        Producer: {
          name: "ProducerRoot",
          actor: "Producer",
          kind: "sequence",
          children: [
            {
              name: "Init",
              actor: "Producer",
              kind: "atomic",
            },
            {
              name: "ChooseBranch",
              actor: "Producer",
              kind: "alternative",
              children: [
                { name: "ProduceA", actor: "Producer", kind: "atomic" },
                { name: "ProduceB", actor: "Producer", kind: "atomic" },
              ],
            },
            {
              name: "Done",
              actor: "Producer",
              kind: "atomic",
            },
          ],
        },
      },
    };

    const res = EventGrammarSolver.explore(model, { scope: 2 });
    assert(res.totalTracesFound >= 2, `Expected at least 2 traces, got ${res.totalTracesFound}`);
    assert.strictEqual(res.isAssertionSatisfied, true);

    const summaries = res.traces.map((t) => t.summary);
    assert(
      summaries.some((s) => s.includes("ProduceA")),
      "Trace with ProduceA missing",
    );
    assert(
      summaries.some((s) => s.includes("ProduceB")),
      "Trace with ProduceB missing",
    );
  });

  it("should enforce precedence and cross-actor coordination rules", () => {
    // Client-Server handshake with coordination
    const model: EventGrammarModel = {
      name: "ClientServerHandshake",
      actors: {
        Client: {
          name: "ClientLifecycle",
          actor: "Client",
          kind: "sequence",
          children: [
            { name: "SendRequest", actor: "Client", kind: "atomic" },
            { name: "ReceiveResponse", actor: "Client", kind: "atomic" },
          ],
        },
        Server: {
          name: "ServerLifecycle",
          actor: "Server",
          kind: "sequence",
          children: [
            { name: "ProcessRequest", actor: "Server", kind: "atomic" },
            { name: "SendResponse", actor: "Server", kind: "atomic" },
          ],
        },
      },
      coordinations: [
        {
          sourceActor: "Client",
          sourceEvent: "SendRequest",
          targetActor: "Server",
          targetEvent: "ProcessRequest",
          relation: "precedes",
        },
        {
          sourceActor: "Server",
          sourceEvent: "SendResponse",
          targetActor: "Client",
          targetEvent: "ReceiveResponse",
          relation: "precedes",
        },
      ],
      assertions: [
        {
          id: "RESP_AFTER_REQ",
          description: "Server should not process request before client sends it",
          type: "precedence",
          eventA: "Client.SendRequest",
          eventB: "Server.ProcessRequest",
        },
      ],
    };

    const res = EventGrammarSolver.explore(model, { scope: 1 });
    assert(res.totalTracesFound >= 1);
    assert.strictEqual(res.isAssertionSatisfied, true);
    assert.strictEqual(res.violations.length, 0);
  });

  it("should detect assertion violations when a race condition or mutex is violated", () => {
    // Concurrent actors with a forbidden shared race state
    const model: EventGrammarModel = {
      name: "SharedResourceRace",
      actors: {
        Worker1: {
          name: "W1",
          actor: "Worker1",
          kind: "sequence",
          children: [{ name: "AccessDatabase", actor: "Worker1", kind: "atomic" }],
        },
        Worker2: {
          name: "W2",
          actor: "Worker2",
          kind: "sequence",
          children: [{ name: "AccessDatabase", actor: "Worker2", kind: "atomic" }],
        },
      },
      assertions: [
        {
          id: "NO_CONCURRENT_ACCESS",
          description: "Both workers cannot access database concurrently",
          type: "mutex",
          eventA: "Worker1.AccessDatabase",
          eventB: "Worker2.AccessDatabase",
        },
      ],
    };

    const res = EventGrammarSolver.explore(model, { scope: 1 });
    // Since there is no mutex rule enforced between Worker1 and Worker2, they can co-occur!
    assert.strictEqual(res.isAssertionSatisfied, false);
    assert(res.violations.length > 0);
    assert.strictEqual(res.violations[0]?.assertionId, "NO_CONCURRENT_ACCESS");
  });
});
