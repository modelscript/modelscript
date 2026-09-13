// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, compileDslToWasm, field, language, repeat, semanticToken, seq } from "@modelscript/dsl";
import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "node:assert";
import test from "node:test";
import { globalLanguageRegistry, type LanguagePlugin } from "../src/registry/LanguageRegistry.js";

test("Dynamic Polyglot LSP Runtime & WASM Hot-Reloading", async (t) => {
  let compiledRobot: any;
  let robotParser: any;
  let robotFacade: any;
  let robotPlugin: LanguagePlugin;

  // ── 1. In-Memory Compilation (Zero Disk I/O) ─────────────────────────────
  await t.test("should compile a dynamic DSL to WASM and Monarch tokens purely in-memory", async () => {
    const robotDslV1 = language({
      name: "RobotDSL",
      rules: {
        Program: ($: any) => repeat($.Decl),
        Decl: ($: any) => choice($.Robot, $.Motor),
        Robot: ($: any) =>
          seq(semanticToken("keyword", "robot"), field("name", $.Identifier), "{", repeat($.Joint), "}"),
        Joint: ($: any) => seq(semanticToken("keyword", "joint"), field("name", $.Identifier), ";"),
        Motor: ($: any) =>
          seq(semanticToken("keyword", "motor"), field("name", $.Identifier), "=", field("value", $.Number), ";"),
        Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
        Number: ($: any) => semanticToken("number", /[0-9]+/),
      },
      extras: ($: any) => [/\s+/],
      recovery: {
        sync: ["}", ";", "robot", "joint", "motor"],
      },
    });

    compiledRobot = await compileDslToWasm(robotDslV1 as any, {
      extensions: [".bot", ".rbt"],
    });

    assert.strictEqual(compiledRobot.id, "robotdsl");
    assert.deepStrictEqual(compiledRobot.extensions, [".bot", ".rbt"]);
    assert.ok(compiledRobot.wasmBytes instanceof Uint8Array);
    assert.ok(compiledRobot.wasmBytes.length > 1000, "WASM binary must be non-empty");

    // Verify Monarch syntax highlighting tokens were generated
    assert.ok(compiledRobot.monarch, "Monarch definition must be present");
    assert.ok(Array.isArray(compiledRobot.monarch.keywords), "Monarch keywords array must exist");
    assert.ok(compiledRobot.monarch.keywords.includes("robot"));
    assert.ok(compiledRobot.monarch.keywords.includes("joint"));
    assert.ok(compiledRobot.monarch.keywords.includes("motor"));
  });

  // ── 2. Dynamic WASM Instantiation & Parsing ──────────────────────────────
  await t.test("should instantiate WASM parser from in-memory bytes and parse documents", async () => {
    const instance = await createWasmParser(compiledRobot.wasmBytes);
    robotParser = instance.parser;
    robotFacade = instance.facade;

    assert.ok(robotFacade, "LspFacade must be instantiated");
    assert.ok(robotParser, "TreeSitterParser must be instantiated");

    // Test valid code parse
    const validCode = `
robot Arm {
  joint shoulder;
  joint elbow;
}
motor baseMotor = 100;
`;
    const tree = robotParser.parse(validCode);
    assert.ok(tree, "Parse tree must exist");
    assert.ok(tree.rootNode, "Root node must exist");
    assert.strictEqual(tree.rootNode.hasError(), false, "Valid code must have zero syntax errors");

    // Test invalid code parse (missing semicolon on joint)
    const invalidCode = `
robot Arm {
  joint shoulder
}
`;
    const invalidTree = robotParser.parse(invalidCode);
    assert.ok(invalidTree.rootNode.hasError(), "Invalid code must report syntax error");
  });

  // ── 3. Dynamic Registry Management & URI Resolution ──────────────────────
  await t.test("should register dynamic plugin in LanguageRegistry and resolve by URI/extension", async () => {
    robotPlugin = {
      id: compiledRobot.id,
      name: compiledRobot.name,
      extensions: compiledRobot.extensions,
      parser: robotParser,
      facade: robotFacade,
      monarch: compiledRobot.monarch,
      wasmBytes: compiledRobot.wasmBytes,
    };

    globalLanguageRegistry.register(robotPlugin);

    // URI lookups
    const pluginFromUri1 = globalLanguageRegistry.getPluginForUri("file:///models/manipulator.bot");
    const pluginFromUri2 = globalLanguageRegistry.getPluginForUri("file:///models/chassis.rbt");
    const pluginFromUnknown = globalLanguageRegistry.getPluginForUri("file:///models/other.xyz");

    assert.strictEqual(pluginFromUri1?.id, "robotdsl");
    assert.strictEqual(pluginFromUri2?.id, "robotdsl");
    assert.strictEqual(pluginFromUnknown, undefined);

    // Extension lookups
    assert.strictEqual(globalLanguageRegistry.getPluginForExtension(".bot")?.id, "robotdsl");
    assert.strictEqual(globalLanguageRegistry.getPluginForExtension("rbt")?.id, "robotdsl");
    assert.ok(globalLanguageRegistry.getAllExtensions().includes(".bot"));
    assert.ok(globalLanguageRegistry.getAllExtensions().includes(".rbt"));
  });

  // ── 4. Atomic Hot-Reloading with Grammar Evolution ────────────────────────
  await t.test("should hot-reload parser WASM when grammar is updated without restarting", async () => {
    const v2Snippet = "robot Arm { joint wrist; gripper claw; }";

    // V1 parser should fail on 'gripper'
    const treeBefore = robotPlugin.parser.parse(v2Snippet);
    assert.strictEqual(treeBefore.rootNode.hasError(), true, "V1 parser must flag 'gripper' as unexpected");

    // Version 2: grammar evolved to add 'gripper' inside robot body
    const robotDslV2 = language({
      name: "RobotDSL",
      rules: {
        Program: ($: any) => repeat($.Decl),
        Decl: ($: any) => choice($.Robot, $.Motor),
        Robot: ($: any) =>
          seq(
            semanticToken("keyword", "robot"),
            field("name", $.Identifier),
            "{",
            repeat(choice($.Joint, $.Gripper)),
            "}",
          ),
        Joint: ($: any) => seq(semanticToken("keyword", "joint"), field("name", $.Identifier), ";"),
        Gripper: ($: any) => seq(semanticToken("keyword", "gripper"), field("name", $.Identifier), ";"),
        Motor: ($: any) =>
          seq(semanticToken("keyword", "motor"), field("name", $.Identifier), "=", field("value", $.Number), ";"),
        Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
        Number: ($: any) => semanticToken("number", /[0-9]+/),
      },
      extras: ($: any) => [/\s+/],
      recovery: {
        sync: ["}", ";", "robot", "joint", "gripper", "motor"],
      },
    });

    const compiledV2 = await compileDslToWasm(robotDslV2 as any, { extensions: [".bot", ".rbt"] });
    const instanceV2 = await createWasmParser(compiledV2.wasmBytes);

    // Atomic Hot-Swap into existing registry entry
    robotPlugin.parser = instanceV2.parser;
    robotPlugin.facade = instanceV2.facade;
    robotPlugin.monarch = compiledV2.monarch;
    robotPlugin.wasmBytes = compiledV2.wasmBytes;

    // V2 parser should now parse 'gripper' cleanly with zero errors
    const treeAfter = robotPlugin.parser.parse(v2Snippet);
    assert.strictEqual(treeAfter.rootNode.hasError(), false, "V2 parser must accept 'gripper' without errors");
    assert.ok(robotPlugin.monarch?.keywords.includes("gripper"), "Monarch keywords must include 'gripper'");
  });

  // ── 5. Safe Unregistering & Resource Reclamation ──────────────────────────
  await t.test("should unregister language, dispose dynamic capabilities, and clean up routes", async () => {
    let capabilityDisposed = false;
    robotPlugin.disposables = [
      {
        dispose: () => {
          capabilityDisposed = true;
        },
      },
    ];

    // Unregister
    const unregistered = await globalLanguageRegistry.unregister("robotdsl");
    assert.strictEqual(unregistered?.id, "robotdsl");
    assert.strictEqual(capabilityDisposed, true, "Dynamic capability must be disposed");
    assert.strictEqual(globalLanguageRegistry.getPluginForUri("file:///test.bot"), undefined);
    assert.strictEqual(globalLanguageRegistry.getPluginForExtension(".bot"), undefined);
  });
});
