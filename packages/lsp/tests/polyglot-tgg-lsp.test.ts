// SPDX-License-Identifier: AGPL-3.0-or-later

import expect from "expect";
import { describe, it } from "node:test";
import { registerPolyglotEndpoints } from "../src/handlers/polyglotEndpoints.js";

class MockCorrespondenceIndex {
  public slots: {
    source: number;
    target: number;
    rule: number;
    parentSlot?: number;
    stale: boolean;
    conflicted: boolean;
    removed: boolean;
  }[] = [];

  get count(): number {
    return this.slots.length;
  }

  add(source: number, target: number, rule: number, parentSlot = -1): number {
    const slot = this.slots.length;
    this.slots.push({
      source,
      target,
      rule,
      parentSlot,
      stale: false,
      conflicted: false,
      removed: false,
    });
    return slot;
  }

  setConflicted(slot: number, val: boolean): void {
    if (this.slots[slot]) this.slots[slot].conflicted = val;
  }

  isConflicted(slot: number): boolean {
    return this.slots[slot]?.conflicted ?? false;
  }

  isRemoved(slot: number): boolean {
    return this.slots[slot]?.removed ?? false;
  }

  getSource(slot: number): number {
    return this.slots[slot]?.source ?? 0;
  }

  getTarget(slot: number): number {
    return this.slots[slot]?.target ?? 0;
  }

  getRule(slot: number): number {
    return this.slots[slot]?.rule ?? 0;
  }

  getParentSlot(slot: number): number {
    return this.slots[slot]?.parentSlot ?? -1;
  }

  markStaleCascading(parentSlot: number): number {
    let count = 0;
    if (this.slots[parentSlot]) {
      this.slots[parentSlot].stale = true;
      count++;
    }
    for (const slot of this.slots) {
      if (slot.parentSlot === parentSlot && !slot.stale) {
        slot.stale = true;
        count++;
      }
    }
    return count;
  }

  reconcileAll(_strategy: number): number {
    let resolved = 0;
    for (const slot of this.slots) {
      if (slot.conflicted) {
        slot.conflicted = false;
        resolved++;
      }
    }
    return resolved;
  }
}

describe("Polyglot TGG LSP Handlers: Conflict Diagnostics & Surgical Projection", () => {
  it("should detect correspondence conflicts and broadcast LSP diagnostics", async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const sentDiagnostics: { uri: string; diagnostics: any[] }[] = [];

    const mockConnection: any = {
      onRequest: (method: string, handler: (...args: any[]) => any) => {
        handlers.set(method, handler);
      },
      sendDiagnostics: (params: { uri: string; diagnostics: any[] }) => {
        sentDiagnostics.push(params);
      },
      console: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const corr = new MockCorrespondenceIndex();
    // Add two correspondence links
    const slot0 = corr.add(101, 201, 1);
    const slot1 = corr.add(102, 202, 2);

    // Mark slot1 as conflicted
    corr.setConflicted(slot1, true);

    const mockWorkspaceManager = {
      unifiedWorkspace: {
        queryEngine: {
          getCorrespondenceIndex: () => corr,
        },
      },
    };

    const mockDocuments: any = {
      get: () => null,
    };

    registerPolyglotEndpoints(mockConnection, mockDocuments, {}, {}, mockWorkspaceManager);

    const checkHandler = handlers.get("modelscript/checkCorrespondenceConflicts");
    expect(checkHandler).toBeDefined();

    const result = await checkHandler!({ uri: "file:///test/system.sysml" });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.conflicts[0].slot).toBe(slot1);
    expect(result.conflicts[0].source).toBe(102);
    expect(result.conflicts[0].target).toBe(202);

    // Diagnostic should be sent to the connection for file:///test/system.sysml
    expect(sentDiagnostics.length).toBe(1);
    expect(sentDiagnostics[0].uri).toBe("file:///test/system.sysml");
    expect(sentDiagnostics[0].diagnostics.length).toBe(1);
    expect(sentDiagnostics[0].diagnostics[0].code).toBe("CORR_FLAG_CONFLICT");
    expect(sentDiagnostics[0].diagnostics[0].source).toBe("polyglot-tgg");

    // Test propagateStale cascading
    const propagateHandler = handlers.get("modelscript/propagateStale");
    expect(propagateHandler).toBeDefined();

    const childSlot = corr.add(103, 203, 3, slot0);
    const propResult = await propagateHandler!({ parentSlot: slot0 });
    expect(propResult.success).toBe(true);
    expect(propResult.updatedCount).toBe(2); // parent + child

    // Test reconcileConflicts
    const reconcileHandler = handlers.get("modelscript/reconcileConflicts");
    expect(reconcileHandler).toBeDefined();

    const recResult = await reconcileHandler!({ strategy: 0, uri: "file:///test/system.sysml" });
    expect(recResult.success).toBe(true);
    expect(recResult.resolvedCount).toBe(1);

    // After reconcile, diagnostics for uri should be cleared (empty array sent)
    expect(sentDiagnostics.length).toBe(2);
    expect(sentDiagnostics[1].uri).toBe("file:///test/system.sysml");
    expect(sentDiagnostics[1].diagnostics.length).toBe(0);

    // Re-checking conflicts should yield 0 conflicts
    const resultAfter = await checkHandler!({ uri: "file:///test/system.sysml" });
    expect(resultAfter.count).toBe(0);
  });

  it("should surgically project updates into target document preserving user comments", async () => {
    const handlers = new Map<string, (...args: any[]) => any>();

    const moSource = `
model Motor
  parameter Real R = 1.5;
  Real v;
equation
  v = R * 10;
end Motor;
`.trim();

    const existingSysml = `
part def Motor {
  // Primary winding resistance - do not delete
  attribute R : Real = 1.0;
  attribute v : Real;
}
`.trim();

    const mockDocsMap = new Map<string, any>([
      [
        "file:///test/Motor.mo",
        {
          uri: "file:///test/Motor.mo",
          getText: () => moSource,
        },
      ],
      [
        "file:///test/Motor.sysml",
        {
          uri: "file:///test/Motor.sysml",
          getText: () => existingSysml,
        },
      ],
    ]);

    const mockConnection: any = {
      onRequest: (method: string, handler: (...args: any[]) => any) => {
        handlers.set(method, handler);
      },
      sendDiagnostics: () => {},
      console: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const corr = new MockCorrespondenceIndex();
    const mockWorkspaceManager = {
      unifiedWorkspace: {
        queryEngine: {
          getCorrespondenceIndex: () => corr,
        },
      },
    };

    const mockDocuments: any = {
      get: (uri: string) => mockDocsMap.get(uri),
    };

    registerPolyglotEndpoints(mockConnection, mockDocuments, {}, {}, mockWorkspaceManager);

    const projectHandler = handlers.get("modelscript/projectModel");
    expect(projectHandler).toBeDefined();

    const res = await projectHandler!({
      uri: "file:///test/Motor.mo",
      targetLang: "sysml2",
      targetUri: "file:///test/Motor.sysml",
    });

    expect(res.success).toBe(true);
    expect(res.targetSource).toBeDefined();

    // Verify surgical patching preserved the comment!
    expect(res.targetSource).toContain("// Primary winding resistance - do not delete");
    // Verify updated attribute value
    expect(res.targetSource).toContain("attribute R : Real = 1.5");
  });
});
