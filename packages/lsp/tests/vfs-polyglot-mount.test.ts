// SPDX-License-Identifier: AGPL-3.0-or-later

import { LanguageWorkspaceIndex } from "@modelscript/runtime";
import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { BrowserFileSystem } from "../src/vfs/browser-file-system.js";
import { mountPolyglotLibrary, type LoaderContext } from "../src/vfs/library-loader.js";

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
});
