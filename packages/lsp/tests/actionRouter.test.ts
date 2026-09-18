// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { registerActionRouter } from "../src/handlers/actionRouter.js";
import { globalLanguageRegistry, type LanguagePlugin } from "../src/registry/LanguageRegistry.js";

test("LSP Action Router (Language-Agnostic Inversion-of-Control)", async (t) => {
  // Mock LSP Connection and Context
  const requestHandlers = new Map<string, (...args: any[]) => any>();
  const sentNotifications: { method: string; params: any }[] = [];

  const mockContext: any = {
    connection: {
      onRequest: (method: string, handler: (...args: any[]) => any) => {
        requestHandlers.set(method, handler);
      },
      sendNotification: (method: string, params: any) => {
        sentNotifications.push({ method, params });
      },
      console: {
        error: () => {},
        warn: () => {},
        info: () => {},
      },
    },
    documents: {
      get: (uri: string) => ({
        getText: () => "model MyTestModel\n  Real x;\nend MyTestModel;",
      }),
    },
    workspaceManager: {
      globalModelicaQueryEngine: {
        toQueryDB: () => ({}),
      },
    },
  };

  // Register the router
  registerActionRouter(mockContext);

  await t.test("endpoints should be registered", () => {
    assert.ok(requestHandlers.has("modelscript/listActions"), "modelscript/listActions registered");
    assert.ok(requestHandlers.has("modelscript/executeAction"), "modelscript/executeAction registered");
  });

  // Register a mock language plugin
  const testPlugin: LanguagePlugin = {
    id: "testlang",
    name: "TestLang",
    extensions: [".tst"],
    languageDef: {
      name: "testlang",
      actions: [
        {
          id: "test_flatten",
          title: "Flatten Test Model",
          description: "Flattens model into equations",
          category: "transform",
          inputs: {
            name: { type: "string", description: "Class name" },
          },
          ui: {
            editorTitle: {
              icon: "$(symbol-structure)",
              group: "navigation@1",
            },
          },
        },
        {
          id: "test_simulate",
          title: "Simulate Test Model",
          description: "Simulates test model",
          category: "simulate",
          inputs: {
            stopTime: { type: "number", default: 10 },
          },
          execute: async (ctx, inputs) => {
            ctx.notifyProgress?.("Simulating...", 50);
            return { simulated: true, stopTime: inputs.stopTime ?? 10 };
          },
        },
      ],
    } as any,
    actionHandlers: {
      test_flatten: async (ctx, inputs) => {
        ctx.notifyProgress?.("Flattening...", 100);
        return { text: `FLATTENED ${inputs.name || "Default"}` };
      },
    },
  };

  globalLanguageRegistry.register(testPlugin);

  await t.test("modelscript/listActions should return registered language actions", async () => {
    const listHandler = requestHandlers.get("modelscript/listActions")!;
    const actions = await listHandler({ languageId: "testlang" });

    assert.strictEqual(actions.length, 2);
    assert.strictEqual(actions[0].id, "test_flatten");
    assert.strictEqual(actions[0].command, "modelscript.testlang.test_flatten");
    assert.strictEqual(actions[0].category, "transform");
    assert.strictEqual(actions[0].ui?.editorTitle?.icon, "$(symbol-structure)");

    assert.strictEqual(actions[1].id, "test_simulate");
    assert.strictEqual(actions[1].category, "simulate");
  });

  await t.test("modelscript/executeAction should dispatch to plugin.actionHandlers", async () => {
    const executeHandler = requestHandlers.get("modelscript/executeAction")!;
    sentNotifications.length = 0;

    const result = await executeHandler({
      actionId: "test_flatten",
      languageId: "testlang",
      uri: "file:///workspace/test.tst",
      inputs: { name: "CustomModel" },
    });

    assert.deepStrictEqual(result, { text: "FLATTENED CustomModel" });
    assert.ok(
      sentNotifications.some((n) => n.method === "modelscript/status" && n.params.message === "Flattening..."),
      "Progress notification sent",
    );
  });

  await t.test("modelscript/executeAction should dispatch to action.execute fallback", async () => {
    const executeHandler = requestHandlers.get("modelscript/executeAction")!;
    sentNotifications.length = 0;

    const result = await executeHandler({
      actionId: "test_simulate",
      languageId: "testlang",
      inputs: { stopTime: 25 },
    });

    assert.deepStrictEqual(result, { simulated: true, stopTime: 25 });
    assert.ok(
      sentNotifications.some((n) => n.method === "modelscript/status" && n.params.message === "Simulating..."),
      "Progress notification sent",
    );
  });

  await t.test("modelscript/executeAction should resolve plugin by URI if languageId is omitted", async () => {
    const executeHandler = requestHandlers.get("modelscript/executeAction")!;

    const result = await executeHandler({
      actionId: "test_flatten",
      uri: "file:///workspace/test.tst",
      inputs: { name: "ByUriModel" },
    });

    assert.deepStrictEqual(result, { text: "FLATTENED ByUriModel" });
  });

  await t.test("modelscript/executeAction should throw on unknown action", async () => {
    const executeHandler = requestHandlers.get("modelscript/executeAction")!;

    await assert.rejects(async () => {
      await executeHandler({
        actionId: "nonexistent_action",
        languageId: "testlang",
      });
    }, /Action 'nonexistent_action' not found/);
  });
});
