// SPDX-License-Identifier: AGPL-3.0-or-later

import { LanguageWorkspaceIndex } from "@modelscript/runtime";
import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { mountedLibraryMetadata } from "../src/utils/hierarchy-utils.js";
import { BrowserFileSystem } from "../src/vfs/browser-file-system.js";
import { mountCuratedFallbackPackage, mountPolyglotLibrary, type LoaderContext } from "../src/vfs/library-loader.js";

describe("Polyglot VFS Library Mount", () => {
  it("mounts zip archive into VFS and hydrates pre-indexed symbols", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vfs-mount-test-"));
    const zipPath = path.join(tmpDir, "testlib.zip");

    const zip = new AdmZip();
    zip.addFile("package.mo", Buffer.from("package TestLib\nend TestLib;", "utf-8"));
    zip.addFile(
      "index.json",
      Buffer.from(
        JSON.stringify({
          symbols: [
            [
              1,
              {
                id: 1,
                name: "TestLib",
                kind: "Class",
                ruleName: "class_definition",
                parentId: null,
                startOffset: 0,
                endOffset: 27,
                exports: [],
                inherits: [],
                metadata: {},
                fieldName: null,
                resourceId: "sources/package.mo",
              },
            ],
          ],
          byName: [["TestLib", [1]]],
          childrenOf: [[null, [1]]],
        }),
        "utf-8",
      ),
    );
    zip.writeZip(zipPath);

    const vfs = new BrowserFileSystem();
    const globalWorkspaceIndex = new LanguageWorkspaceIndex();

    const loaderCtx: LoaderContext = {
      connectionState: { sendNotification: () => {} },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      sharedFs: vfs,
      sharedContext: null,
      globalWorkspaceIndex,
      sysml2WorkspaceIndex: null,
      documentTrees: new Map(),
      sysml2Parser: null,
      federatedEndpoints: [],
    };

    const success = await mountPolyglotLibrary(`file://${tmpDir}`, loaderCtx, {
      packageName: "TestLib",
      version: "1.0.0",
      filename: "testlib.zip",
    });

    assert.equal(success, true);
    assert.equal(vfs.exists("/lib/TestLib/package.mo"), true);
    assert.equal(vfs.read("/lib/TestLib/package.mo"), "package TestLib\nend TestLib;");

    // Verify WorkspaceIndex was hydrated with the symbol
    const unified = globalWorkspaceIndex.getIndex({ eager: true });
    const symId = unified.byName.get("TestLib")?.[0];
    assert.ok(symId, "TestLib should be resolvable in WorkspaceIndex");
    const sym = unified.symbols.get(symId);
    assert.equal(sym?.name, "TestLib");

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false cleanly when archive is non-ZIP data (e.g. HTML SPA fallback)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vfs-mount-html-test-"));
    const badZipPath = path.join(tmpDir, "SPICE-Standard-1.0.0.zip");
    fs.writeFileSync(badZipPath, "<!doctype html><html><body>Not found</body></html>", "utf-8");

    const errors: unknown[] = [];
    const warnings: string[] = [];
    const loaderCtx: LoaderContext = {
      connectionState: { sendNotification: () => {} },
      logger: {
        log: () => {},
        warn: (m: string) => warnings.push(m),
        error: (...args: unknown[]) => errors.push(args),
      },
      sharedFs: new BrowserFileSystem(),
      sharedContext: null,
      globalWorkspaceIndex: new LanguageWorkspaceIndex(),
      sysml2WorkspaceIndex: null,
      documentTrees: new Map(),
      sysml2Parser: null,
      federatedEndpoints: [],
    };

    const success = await mountPolyglotLibrary(`file://${tmpDir}`, loaderCtx, {
      packageName: "SPICE-Standard",
      version: "1.0.0",
      filename: "SPICE-Standard-1.0.0.zip",
      language: "spice",
    });

    assert.equal(success, false);
    assert.equal(errors.length, 0, "Should not throw or log error on non-ZIP archive");
    assert.ok(warnings.some((w) => w.includes("not a valid ZIP file")));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mounts SPICE-Standard curated fallback package when zip is unavailable", async () => {
    const vfs = new BrowserFileSystem();
    const loaderCtx: LoaderContext = {
      connectionState: { sendNotification: () => {} },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      sharedFs: vfs,
      sharedContext: null,
      globalWorkspaceIndex: new LanguageWorkspaceIndex(),
      sysml2WorkspaceIndex: null,
      documentTrees: new Map(),
      sysml2Parser: null,
      federatedEndpoints: [],
    };

    const ok = await mountCuratedFallbackPackage("SPICE-Standard", "1.0.0", loaderCtx);
    assert.equal(ok, true);
    assert.equal(vfs.exists("/packages/SPICE-Standard/SPICE/package.mo"), true);
    assert.equal(mountedLibraryMetadata.get("SPICE-Standard")?.language, "spice");
  });

  it("mounts SPICE-Standard-1.0.0.zip and indexes .lib/.cir models into SPICE workspace index", async () => {
    const scriptsDir = path.resolve(process.cwd(), "scripts");
    const zipPath = path.join(scriptsDir, "SPICE-Standard-1.0.0.zip");
    if (!fs.existsSync(zipPath)) return;

    const { spiceLanguage } = await import("@modelscript/spice");
    const { UnifiedWorkspace } = await import("@modelscript/runtime");
    const { globalLanguageRegistry } = await import("../src/registry/LanguageRegistry.js");
    const spiceWorkspace = new UnifiedWorkspace();
    spiceWorkspace.registerLanguage(spiceLanguage);
    globalLanguageRegistry.register({
      id: "spice",
      name: "SPICE",
      extensions: [".cir", ".sp", ".net", ".lib"],
      languageDef: spiceLanguage,
      workspaceIndex: spiceWorkspace,
    });

    const vfs = new BrowserFileSystem();
    const loaderCtx: LoaderContext = {
      connectionState: { sendNotification: () => {} },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      sharedFs: vfs,
      sharedContext: null,
      globalWorkspaceIndex: spiceWorkspace,
      sysml2WorkspaceIndex: null,
      documentTrees: new Map(),
      sysml2Parser: null,
      federatedEndpoints: [],
    };

    const ok = await mountPolyglotLibrary(`file://${scriptsDir}`, loaderCtx, {
      packageName: "SPICE-Standard",
      version: "1.0.0",
      filename: "SPICE-Standard-1.0.0.zip",
      language: "spice",
    });

    assert.equal(ok, true);
    assert.equal(vfs.exists("/lib/SPICE-Standard/diodes.lib"), true);
    assert.equal(vfs.exists("/lib/SPICE-Standard/opamps.lib"), true);
    assert.equal(vfs.exists("/lib/SPICE-Standard/examples/SallenKeyFilter.cir"), true);

    const spiceIdx = spiceWorkspace.getIndex();
    assert.ok(spiceIdx.byName.has("D1N4148"), "Expected D1N4148 diode model to be indexed");
    assert.ok(spiceIdx?.byName?.has("Q2N2222"), "Expected Q2N2222 BJT model to be indexed");
    assert.ok(spiceIdx?.byName?.has("LM741"), "Expected LM741 op-amp subcircuit to be indexed");
  });

  it("suppresses warnings when quietIfMissing is true for optional catalog archives", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vfs-mount-quiet-test-"));
    const warnings: string[] = [];
    const errors: unknown[] = [];
    const loaderCtx: LoaderContext = {
      connectionState: { sendNotification: () => {} },
      logger: {
        log: () => {},
        warn: (m: string) => warnings.push(m),
        error: (...args: unknown[]) => errors.push(args),
      },
      sharedFs: new BrowserFileSystem(),
      sharedContext: null,
      globalWorkspaceIndex: new LanguageWorkspaceIndex(),
      sysml2WorkspaceIndex: null,
      documentTrees: new Map(),
      sysml2Parser: null,
      federatedEndpoints: [],
    };

    const ok = await mountPolyglotLibrary(`file://${tmpDir}`, loaderCtx, {
      packageName: "GENSYS-Profiles",
      version: "1.0.0",
      filename: "GENSYS-Profiles-1.0.0.zip",
      language: "gensys",
      quietIfMissing: true,
    });

    assert.equal(ok, false);
    assert.equal(
      warnings.some((w) => w.includes("Library archive")),
      false,
    );
    assert.equal(errors.length, 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers all built-in cleanroom stdlibs in globalLibraryRegistry when builtin plugins load", async () => {
    const { globalLibraryRegistry } = await import("@modelscript/runtime");
    await import("../src/registry/builtin-plugins.js");

    const repoRoot = fs.existsSync(path.resolve(process.cwd(), "languages"))
      ? process.cwd()
      : path.resolve(process.cwd(), "../..");
    const languagesDir = path.join(repoRoot, "languages");
    const stdlibLangs = fs
      .readdirSync(languagesDir)
      .filter((d) => fs.existsSync(path.join(languagesDir, d, "assets", `${d}-std-lib`)));

    assert.ok(stdlibLangs.length >= 90, `Expected >= 90 cleanroom stdlib languages, found ${stdlibLangs.length}`);
    for (const lang of stdlibLangs) {
      const pkgs = globalLibraryRegistry.getPackagesForLanguage(lang);
      assert.ok(pkgs.length > 0, `Built-in cleanroom stdlib for '${lang}' should be registered`);
      assert.ok(pkgs[0]!.symbols.length > 0, `Built-in cleanroom stdlib for '${lang}' should have symbols`);
    }
  });
});
