import { createWasmParser } from "@modelscript/dsl";
import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

async function run() {
  console.log("=== Testing SysML2 Parser Loading & Tree Resolution ===");

  const extDir = resolve("apps/ide/dist/extension");
  const manifestPath = resolve(extDir, "server/dist/languages-manifest.json");
  assert(existsSync(manifestPath), "languages-manifest.json must exist");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const sysml2Entry = manifest.find((x: any) => x.id === "sysml2");
  assert(sysml2Entry, "sysml2 entry must exist in languages-manifest.json");
  assert(Array.isArray(sysml2Entry.syntaxNames), "sysml2 entry must have syntaxNames");
  assert.strictEqual(sysml2Entry.syntaxNames.length, 1024, "sysml2 must have 1024 syntaxNames");

  // Verify wasm file and bindings.js file exist
  const wasmPath = resolve(extDir, `server/dist/${sysml2Entry.wasm}`);
  const bindingsPath = resolve(extDir, "server/dist/sysml2.bindings.js");
  assert(existsSync(wasmPath), "sysml2.wasm must exist");
  assert(existsSync(bindingsPath), "sysml2.bindings.js must exist");

  console.log("Loading WASM parser with embedded syntaxNames...");
  const wasmBytes = readFileSync(wasmPath);
  const { parser, facade } = await createWasmParser(wasmBytes, { syntaxNames: sysml2Entry.syntaxNames });
  assert(parser, "WASM parser must instantiate");

  // Parse sample SysML v2 source
  const sampleSysml = `package VehiclePkg {
    part def Engine;
    part def Vehicle {
        part engine : Engine;
    }
}`;
  const tree = parser.parse(sampleSysml);
  assert(tree, "Tree must be parsed");
  const root = tree.rootNode;
  console.log(`Parsed root type: ${root.type}`);
  assert.notStrictEqual(root.type, "node_0", "Root node should have semantic syntax name, not generic node_0");

  // Register in LanguageRegistry under sysml2 and alias sysml
  globalLanguageRegistry.register({
    id: "sysml2",
    name: "SysML v2",
    extensions: [".sysml", ".sysml2"],
    parser,
    facade,
  });

  const pluginSysml2 = globalLanguageRegistry.getPluginById("sysml2");
  const pluginSysml = globalLanguageRegistry.getPluginById("sysml");
  assert(pluginSysml2, "sysml2 plugin must resolve");
  assert(pluginSysml, "sysml plugin must resolve via alias");
  assert.strictEqual(pluginSysml2.parser, parser);
  assert.strictEqual(pluginSysml.parser, parser);

  // UnifiedWorkspace registration
  const uw = new UnifiedWorkspace();
  uw.registerParser(".sysml", parser);
  uw.registerParser(".sysml2", parser);
  assert.strictEqual(uw.getParser(".sysml"), parser);
  assert.strictEqual(uw.getParser(".sysml2"), parser);

  console.log("All SysML2 IDE loading and parsing checks passed successfully!");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
