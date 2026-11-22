// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { registerBuiltinLanguagePlugins } from "../src/registry/builtin-plugins.js";

/**
 * All 30 cleanroom standard-library languages organized by engineering domain.
 */
const CLEANROOM_STDLIB_DOMAINS: Record<string, readonly string[]> = {
  power: ["atp", "cyme", "oneliner", "plscadd", "powerfactory", "powerworld", "pslf", "rtds", "sel"],
  controlsAndAerospace: ["easy5", "rocets", "simulink"],
  multibodyAndMarine: ["adams", "gensys", "gtsuite", "sima", "simpack"],
  processOilGasAndNuclear: ["aspen", "eclipse", "gproms", "lps", "olga", "relap5", "tough"],
  pharmacometrics: ["mlxtran", "nmtran"],
  feaSpiceAmplMagicDraw: ["fea", "spice", "ampl", "magicdraw"],
};

const ALL_30_CLEANROOM_LANGUAGES = Object.values(CLEANROOM_STDLIB_DOMAINS).flat();

describe("Cleanroom Standard Libraries — LSP Auto-Registration & Cross-Language Benchmark E2E", () => {
  it("registers all 30 cleanroom standard libraries automatically when registerBuiltinLanguagePlugins() runs", () => {
    registerBuiltinLanguagePlugins({
      connection: undefined,
      parserService: undefined,
      workspaceManager: {
        getWorkspaceIndex: () => undefined,
        setWorkspaceIndex: () => {},
        getQueryEngine: () => undefined,
        setQueryEngine: () => {},
        unifiedWorkspace: { registerWorkspace: () => {}, registerLanguageDef: () => {} },
      } as any,
    });

    assert.equal(ALL_30_CLEANROOM_LANGUAGES.length, 30, "Expected exactly 30 cleanroom standard-library languages");

    const missingPlugins: string[] = [];
    const missingStdlibs: string[] = [];

    for (const lang of ALL_30_CLEANROOM_LANGUAGES) {
      const plugin = globalLanguageRegistry.getPluginById(lang);
      if (!plugin) missingPlugins.push(lang);

      const pkgs = globalLibraryRegistry.getPackagesForLanguage(lang);
      if (pkgs.length === 0) missingStdlibs.push(lang);
    }

    assert.deepEqual(missingPlugins, [], `Missing LSP plugins: ${missingPlugins.join(", ")}`);
    assert.deepEqual(missingStdlibs, [], `Missing auto-registered cleanroom stdlibs: ${missingStdlibs.join(", ")}`);
  });

  it("verifies every one of the 30 registered cleanroom packages has valid symbols, SVG diagrams, and instantiable WASM kernels", async () => {
    let totalSymbols = 0;
    let totalDiagrams = 0;
    let totalWasmBytes = 0;
    let totalWasmExports = 0;

    for (const [domain, langs] of Object.entries(CLEANROOM_STDLIB_DOMAINS)) {
      for (const lang of langs) {
        const pkgs = globalLibraryRegistry.getPackagesForLanguage(lang);
        assert.ok(pkgs.length >= 1, `[${domain}/${lang}] expected at least one registered library package`);

        for (const pkg of pkgs) {
          assert.ok(pkg.symbols.length > 0, `[${domain}/${lang}] ${pkg.packageName} has empty symbols`);
          assert.ok(pkg.diagrams.length > 0, `[${domain}/${lang}] ${pkg.packageName} has empty diagrams`);

          const svgCount = pkg.diagrams.filter((d) => typeof d.svg === "string" && d.svg.includes("<svg")).length;
          assert.ok(
            svgCount > 0,
            `[${domain}/${lang}] ${pkg.packageName} expected diagrams with <svg icons (got ${svgCount}/${pkg.diagrams.length})`,
          );

          assert.ok(
            pkg.wasmBytes instanceof Uint8Array && pkg.wasmBytes.byteLength > 8,
            `[${domain}/${lang}] ${pkg.packageName} expected non-empty wasmBytes`,
          );
          // Verify WebAssembly binary magic header: \0asm
          assert.equal(pkg.wasmBytes[0], 0x00, `[${domain}/${lang}] invalid WASM magic byte 0`);
          assert.equal(pkg.wasmBytes[1], 0x61, `[${domain}/${lang}] invalid WASM magic byte 1`);
          assert.equal(pkg.wasmBytes[2], 0x73, `[${domain}/${lang}] invalid WASM magic byte 2`);
          assert.equal(pkg.wasmBytes[3], 0x6d, `[${domain}/${lang}] invalid WASM magic byte 3`);

          const exportsObj = await globalLibraryRegistry.ensureWasmInstantiated(pkg);
          assert.ok(exportsObj, `[${domain}/${lang}] ${pkg.packageName} failed to instantiate WASM kernel`);
          const fnExports = Object.values(exportsObj).filter((v) => typeof v === "function");
          assert.ok(fnExports.length > 0, `[${domain}/${lang}] ${pkg.packageName} expected exported WASM functions`);

          totalSymbols += pkg.symbols.length;
          totalDiagrams += pkg.diagrams.length;
          totalWasmBytes += pkg.wasmBytes.byteLength;
          totalWasmExports += fnExports.length;
        }
      }
    }

    assert.ok(totalSymbols >= 300, `Expected >= 300 total cleanroom stdlib symbols, got ${totalSymbols}`);
    assert.ok(totalDiagrams >= 300, `Expected >= 300 total cleanroom stdlib diagrams, got ${totalDiagrams}`);
    assert.ok(totalWasmBytes > 0, "Expected non-zero total WASM byte size");
    assert.ok(totalWasmExports >= 30, `Expected >= 30 exported WASM functions, got ${totalWasmExports}`);
  });

  it("materializes SymbolIndex and resolves diagram specs across all engineering domains", () => {
    const representativeByDomain = [
      "powerfactory",
      "simulink",
      "adams",
      "aspen",
      "olga",
      "relap5",
      "mlxtran",
      "nmtran",
      "fea",
      "spice",
      "ampl",
      "magicdraw",
    ];

    for (const lang of representativeByDomain) {
      const idx = globalLibraryRegistry.materializeSymbolIndex(lang);
      assert.ok(idx.symbols.size > 0, `[${lang}] expected non-empty materialized SymbolIndex`);

      const pkg = globalLibraryRegistry.getPackagesForLanguage(lang)[0]!;
      const firstDiag = pkg.diagrams[0]!;
      const resolved = globalLibraryRegistry.getDiagramSpec(lang, firstDiag.namePath);
      assert.ok(resolved, `[${lang}] expected getDiagramSpec to resolve '${firstDiag.namePath}'`);
      assert.ok(resolved.svg?.includes("<svg"), `[${lang}] expected resolved diagram spec to contain <svg`);
    }
  });

  it("registers mlxtran plugin in globalLanguageRegistry with extension resolution, symbols, and validation", () => {
    const plugin = globalLanguageRegistry.getPluginForUri("file:///models/pk1cmt.mlxtran");
    assert.equal(plugin?.id, "mlxtran");

    const sample = `[LONGITUDINAL]
input = {ka, Cl, V}
EQUATION:
ddt_Depot = -ka * Depot
ddt_Central = ka * Depot - (Cl / V) * Central
Cc = Central / V
OUTPUT:
output = {Cc}
`;
    const syms = plugin?.customHandlers?.["symbols"]?.(sample) ?? [];
    assert.ok(Array.isArray(syms) && syms.length >= 1, "Expected MLXTRAN document symbols");
    const diags = plugin?.customHandlers?.["validate"]?.(sample) ?? [];
    assert.ok(Array.isArray(diags), "Expected MLXTRAN diagnostics array");
  });
});
