import assert from "node:assert";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { ParserService } from "../src/services/ParserService.js";
import { WorkspaceManager } from "../src/services/WorkspaceManager.js";

describe("LSP Services Recursion Safety", () => {
  it("should not exceed call stack when sysml2 parser or query engine is requested before initialization", () => {
    const wm = new WorkspaceManager({} as any);
    const mockConnection = {
      console: { info: () => {}, warn: () => {}, error: () => {} },
      sendNotification: () => {},
    } as any;
    const ps = new ParserService(mockConnection, null as any, wm);

    // Prior to fix, these triggered infinite ping-pong between sysml and sysml2
    assert.strictEqual(ps.getParser("sysml2"), null);
    assert.strictEqual(ps.getParser("sysml"), null);
    assert.strictEqual(ps.getFacade("sysml2"), null);
    assert.strictEqual(ps.getFacade("sysml"), null);
    assert.strictEqual(ps.isParserReady("sysml2"), false);
    assert.strictEqual(ps.isParserReady("sysml"), false);

    assert.strictEqual(wm.getQueryEngine("sysml2"), null);
    assert.strictEqual(wm.getQueryEngine("sysml"), null);
    assert.strictEqual(wm.globalSysML2QueryEngine, null);
  });

  it("should break cycles between WorkspaceManager.getQueryEngine and LanguageRegistry.queryEngine getter", () => {
    const wm = new WorkspaceManager({} as any);

    // Register a plugin whose queryEngine property delegates to WorkspaceManager
    globalLanguageRegistry.register({
      id: "cyclictest",
      name: "Cyclic Test Language",
      extensions: [".cyc"],
      get queryEngine() {
        return wm.getQueryEngine("cyclictest") ?? undefined;
      },
    });

    // Calling getQueryEngine on uninitialized context must safely return null without call stack overflow
    const qe = wm.getQueryEngine("cyclictest");
    assert.strictEqual(qe, null);

    // When queryEngine is set, it returns the engine
    const mockEngine = { toQueryDB: () => ({}) } as any;
    wm.setQueryEngine("cyclictest", mockEngine);
    assert.strictEqual(wm.getQueryEngine("cyclictest"), mockEngine);
  });
});
