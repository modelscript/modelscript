// SPDX-License-Identifier: AGPL-3.0-or-later

import { language } from "@modelscript/dsl";
import assert from "node:assert";
import test from "node:test";
import { dispatchLanguageRequest } from "../src/handlers/languageProtocolRouter.js";
import { globalLanguageRegistry, type LanguagePlugin } from "../src/registry/LanguageRegistry.js";

test("Language-Defined Custom LSP Protocol Handlers", async (t) => {
  // Mock LSP Context
  const mockContext: any = {
    connection: {
      console: {
        info: () => {},
        warn: () => {},
        error: (msg: string) => console.error(msg),
      },
    },
    workspaceManager: {
      unifiedWorkspace: {
        toUnifiedPartial: () => ({ symbols: new Map() }),
      },
    },
    documentManager: new Map(),
    validationService: {},
    parserService: { sharedContext: {} },
    state: {},
  };

  await t.test("should register and dispatch custom LSP handlers declared on a LanguagePlugin", async () => {
    let handlerInvoked = false;
    let receivedContextUri = "";

    const robotPlugin: LanguagePlugin = {
      id: "robotdsl",
      name: "RobotDSL",
      extensions: [".bot", ".rbt"],
      handlers: {
        "modelscript/getCadComponents": async (ctx, params: { uri: string }) => {
          handlerInvoked = true;
          receivedContextUri = ctx.uri;
          return [
            {
              name: "base_link",
              cad: 'uri="modelica://Robots/base.glb"',
              dynamicBindings: [],
            },
          ];
        },
        "modelscript/customGeometry": async (ctx, params: { shape: string }) => {
          return { generated: true, shape: params.shape };
        },
      },
    };

    globalLanguageRegistry.register(robotPlugin);

    // 1. Verify getHandlerForUri works
    const handler = globalLanguageRegistry.getHandlerForUri("file:///robot.bot", "modelscript/getCadComponents");
    assert.ok(handler, "Handler must be found for .bot file");

    // 2. Dispatch via languageProtocolRouter
    const result = await dispatchLanguageRequest(
      mockContext,
      "modelscript/getCadComponents",
      "file:///robot.bot",
      { uri: "file:///robot.bot" },
      [],
    );

    assert.strictEqual(handlerInvoked, true, "Language handler must be invoked");
    assert.strictEqual(receivedContextUri, "file:///robot.bot");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "base_link");

    // 3. Dispatch second custom method
    const customResult = await dispatchLanguageRequest(mockContext, "modelscript/customGeometry", "file:///robot.rbt", {
      shape: "sphere",
    });
    assert.deepStrictEqual(customResult, { generated: true, shape: "sphere" });

    // Clean up
    await globalLanguageRegistry.unregister("robotdsl");
  });

  await t.test("should support handlers declared inside LanguageOptions.lsp.handlers", async () => {
    const dslDefinition = language({
      name: "SensorDSL",
      lsp: {
        fileExtension: ".sensor",
        handlers: {
          "modelscript/getCadComponents": async (ctx, params) => {
            return [
              {
                name: "sensor_housing",
                cad: 'uri="sensor.stl"',
                dynamicBindings: [],
              },
            ];
          },
        },
      },
    });

    const sensorPlugin: LanguagePlugin = {
      id: "sensordsl",
      name: "SensorDSL",
      extensions: [".sensor"],
      languageDef: dslDefinition,
      handlers: dslDefinition.lsp?.handlers,
    };

    globalLanguageRegistry.register(sensorPlugin);

    const result = await dispatchLanguageRequest(
      mockContext,
      "modelscript/getCadComponents",
      "file:///probe.sensor",
      { uri: "file:///probe.sensor" },
      [],
    );

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "sensor_housing");

    // Clean up
    await globalLanguageRegistry.unregister("sensordsl");
  });

  await t.test("should safely return fallback for unhandled or unknown URIs", async () => {
    // Unregistered extension
    const fallbackResult = await dispatchLanguageRequest(
      mockContext,
      "modelscript/getCadComponents",
      "file:///unknown.xyz",
      { uri: "file:///unknown.xyz" },
      [],
    );
    assert.deepStrictEqual(fallbackResult, []);

    // Registered language without this specific handler
    const plainPlugin: LanguagePlugin = {
      id: "plainlang",
      name: "PlainLang",
      extensions: [".plain"],
    };
    globalLanguageRegistry.register(plainPlugin);

    const fallbackForMissingHandler = await dispatchLanguageRequest(
      mockContext,
      "modelscript/getCadComponents",
      "file:///doc.plain",
      { uri: "file:///doc.plain" },
      [],
    );
    assert.deepStrictEqual(fallbackForMissingHandler, []);

    // Clean up
    await globalLanguageRegistry.unregister("plainlang");
  });
});
