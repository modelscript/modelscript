// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { PolyglotTransformer } from "../../runtime/src/index.js";
import { ThreadDiagnosticsProvider, type AlignedDomainElement } from "../src/providers/threadDiagnosticsProvider.js";
import { ThreadExplorerProvider } from "../src/providers/threadExplorerProvider.js";

const expect = (val: any) => ({
  toBe: (expected: any) => assert.strictEqual(val, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(val, expected),
  toBeDefined: () => assert.notStrictEqual(val, undefined),
  toHaveLength: (n: number) => assert.strictEqual(val?.length, n),
  toContain: (str: string) => assert.ok(String(val).includes(str)),
});

describe("Incremental Theory Diagnostics Provider for Digital Thread", () => {
  it("should directly surface formal Theory Coordinator conflict clauses as LSP diagnostics", () => {
    const domainElements: AlignedDomainElement[] = [
      {
        domain: "sysml2",
        name: "ElectricMotor",
        line: 12,
        column: 4,
        status: "conflict",
      },
      {
        domain: "modelica",
        name: "MotorModel",
        line: 25,
        column: 2,
        status: "conflict",
      },
    ];

    const mockConflict = {
      explanation: "Difference Bound / Temporal Succession Conflict: Negative cycle detected in Octagon DBM.",
      culpritEntities: ["ElectricMotor.startupTime", "MotorModel.t_spinup"],
    };

    const diagnostics = ThreadDiagnosticsProvider.diagnoseThread("thread_42", domainElements, 0.05, mockConflict);

    expect(diagnostics).toHaveLength(1);
    const diag = diagnostics[0]!;
    expect(diag.domain).toBe("sysml2");
    expect(diag.severity).toBe("error");
    expect(diag.elementName).toBe("ElectricMotor.startupTime");
    expect(diag.message).toContain("[Digital Thread Theory Conflict]");
    expect(diag.message).toContain("Negative cycle detected in Octagon DBM");
    expect(diag.line).toBe(12);
    expect(diag.column).toBe(4);
    expect(diag.source).toBe("modelscript-digital-thread");
  });

  it("should integrate seamlessly with ThreadExplorerProvider and DigitalThreadHypergraph", () => {
    const transformer = new PolyglotTransformer();
    const hypergraph = transformer.getHypergraph();

    transformer.registerThread("thread_55", {
      sysml2: { name: "Battery" },
      modelica: { name: "Cell" },
    });

    const slot = hypergraph.findSlotByThreadId(55)!;
    expect(slot).toBeDefined();

    // Inject an interval conflict: [0, 5] and [10, 15]
    transformer.syncThreadTheory(
      slot,
      [
        { kind: "interval", varName: "V_limit", min: 0, max: 5 },
        { kind: "interval", varName: "V_limit", min: 10, max: 15 },
      ],
      "VoltageContract",
    );

    expect(hypergraph.isConflicted(slot)).toBe(true);
    expect(hypergraph.getConflict(slot)).toBeDefined();

    // Build thread graph for web IDE
    const graphResponse = ThreadExplorerProvider.buildThreadGraph(hypergraph);
    expect(graphResponse.summary.conflict).toBe(1);

    const threadItem = graphResponse.threads.find((t) => t.threadId === 55)!;
    expect(threadItem).toBeDefined();
    expect(threadItem.status).toBe("conflict");
    expect(threadItem.diagnostics.length).toBe(1);
    expect(threadItem.diagnostics[0]!.message).toContain("[Digital Thread Theory Conflict]");
  });
});
