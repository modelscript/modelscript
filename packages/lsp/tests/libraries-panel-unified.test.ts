// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerMiscEndpoints } from "../src/handlers/miscEndpoints.js";
import { ParserService } from "../src/services/parser-service.js";
import {
  getLibraryInfo,
  getLibraryName,
  getTreeChildrenFast,
  loadingLibraryState,
  mountedLibraryMetadata,
} from "../src/utils/hierarchy-utils.js";
import { unloadLibraryPackage } from "../src/vfs/library-loader.js";

describe("Unified Libraries Panel & URL-Driven Stdlib/Package Preloading", () => {
  it("classifies standard libraries and custom packages uniformly with version metadata", () => {
    mountedLibraryMetadata.clear();
    loadingLibraryState.clear();

    const mslInfo = getLibraryInfo("modelica:/lib/Modelica 4.1.0/package.mo");
    assert.deepEqual(mslInfo, { name: "Modelica", version: "4.1.0" });

    // Custom package mounted under modelica:/packages/<pkgName>/ must NOT be misclassified as Modelica Standard Library
    const customVfsInfo = getLibraryInfo("modelica:/packages/PlanarMechanics/PlanarMechanics/package.mo");
    assert.equal(customVfsInfo?.name, "PlanarMechanics");
    assert.equal(getLibraryName("modelica:/packages/PlanarMechanics/PlanarMechanics/package.mo"), "PlanarMechanics");

    // Registry bundle path with version
    const registryBundleInfo = getLibraryInfo("file:///modelscript_registry/Buildings/10.0.0/Buildings/package.mo");
    assert.deepEqual(registryBundleInfo, { name: "Buildings", version: "10.0.0" });

    // SysML v2 standard library
    const sysmlInfo = getLibraryInfo("sysml2://stdlib/sysml.library/Systems%20Library/Parts.sysml");
    assert.deepEqual(sysmlInfo, { name: "SysML", version: "2026.3.0" });
  });

  it("renders loading spinner nodes, unified library packages with version badges, and workspace models", async () => {
    mountedLibraryMetadata.clear();
    loadingLibraryState.clear();

    mountedLibraryMetadata.set("Modelica", { name: "Modelica", version: "4.1.0", language: "modelica" });
    mountedLibraryMetadata.set("SysML", { name: "SysML", version: "2026.3.0", language: "sysml2" });
    loadingLibraryState.set("PlanarMechanics", {
      name: "PlanarMechanics",
      version: "1.6.0",
      status: "Fetching bundle...",
    });

    const mockIndex = {
      symbols: new Map<number, any>([
        [
          1,
          {
            id: 1,
            name: "Modelica",
            kind: "Class",
            metadata: { classPrefixes: "package" },
            parentId: null,
            resourceId: "modelica:/lib/Modelica 4.1.0/package.mo",
          },
        ],
        [
          2,
          {
            id: 2,
            name: "HelloWorld",
            kind: "Class",
            metadata: { classPrefixes: "model" },
            parentId: null,
            resourceId: "memfs:/empty/HelloWorld.mo",
          },
        ],
      ]),
      childrenOf: new Map<number | null, number[]>([[null, [1, 2]]]),
    };

    const roots = await getTreeChildrenFast(mockIndex, undefined, false);

    // 1. Loading library appears with loading-package classKind
    const loadingNode = roots.find((r) => r.id === "__LOADING__:PlanarMechanics");
    assert.ok(loadingNode, "Expected in-progress loading node for PlanarMechanics");
    assert.equal(loadingNode.classKind, "loading-package");
    assert.ok(loadingNode.description?.includes("v1.6.0"));

    // 2. Both Modelica and SysML appear as __LIB__:<name> with version descriptions
    const modelicaNode = roots.find((r) => r.id === "__LIB__:Modelica");
    assert.ok(modelicaNode, "Expected __LIB__:Modelica node");
    assert.equal(modelicaNode.name, "Modelica");
    assert.equal(modelicaNode.description, "v4.1.0");

    const sysmlNode = roots.find((r) => r.id === "__LIB__:SysML");
    assert.ok(sysmlNode, "Expected __LIB__:SysML node even before lazy .sysml files are parsed");
    assert.equal(sysmlNode.name, "SysML");
    assert.equal(sysmlNode.description, "v2026.3.0");

    // 3. Workspace model has "model · workspace" description and is sorted after library packages
    const workspaceNode = roots.find((r) => r.name === "HelloWorld");
    assert.ok(workspaceNode, "Expected HelloWorld workspace model");
    assert.equal(workspaceNode.description, "model · workspace");

    const modelicaIdx = roots.indexOf(modelicaNode);
    const workspaceIdx = roots.indexOf(workspaceNode);
    assert.ok(modelicaIdx < workspaceIdx, "Library packages should be listed before workspace classes");

    mountedLibraryMetadata.clear();
    loadingLibraryState.clear();
  });

  it("evicts a library package cleanly via unloadLibraryPackage", () => {
    mountedLibraryMetadata.clear();
    loadingLibraryState.clear();

    mountedLibraryMetadata.set("PlanarMechanics", { name: "PlanarMechanics", version: "1.6.0" });
    const clearedUris: string[] = [];
    const mockWsIndex = {
      fileLoaders: new Map([
        ["modelica:/packages/PlanarMechanics/PlanarMechanics/package.mo", () => null],
        ["modelica:/lib/Modelica 4.1.0/package.mo", () => null],
      ]),
      fileSymbols: new Map([["library-bundle:/PlanarMechanics@1.6.0", new Set([10])]]),
      clear(uri: string) {
        clearedUris.push(uri);
        this.fileLoaders.delete(uri);
        this.fileSymbols.delete(uri);
      },
    };

    let notifiedTreeChanged = false;
    const evictedCount = unloadLibraryPackage("PlanarMechanics", {
      connectionState: {
        sendNotification: (method: string) => {
          if (method === "modelscript/projectTreeChanged") notifiedTreeChanged = true;
        },
      },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      sharedFs: {} as any,
      sharedContext: {},
      globalWorkspaceIndex: mockWsIndex,
      sysml2WorkspaceIndex: null,
      documentTrees: new Map(),
      sysml2Parser: null,
      federatedEndpoints: [],
    });

    assert.equal(evictedCount, 2);
    assert.equal(mountedLibraryMetadata.has("PlanarMechanics"), false);
    assert.equal(notifiedTreeChanged, true);
    assert.equal(mockWsIndex.fileLoaders.has("modelica:/lib/Modelica 4.1.0/package.mo"), true);
  });

  it("ParserService.getOrCreateLoaderContext lazily creates and binds loaderCtx", () => {
    delete (globalThis as any).savedLoaderCtx;

    const mockConnection: any = {
      console: { info: () => {}, warn: () => {}, error: () => {} },
      sendNotification: () => {},
    };
    const mockDocManager: any = { documentTrees: new Map() };
    const mockWorkspaceManager: any = {
      getWorkspaceIndex: () => null,
      unifiedWorkspace: { getIndex: () => null },
    };
    const mockDocuments: any = { all: () => [], get: () => undefined };

    const parserService = new ParserService(mockConnection, mockDocManager, mockWorkspaceManager, mockDocuments);

    assert.equal((globalThis as any).savedLoaderCtx, undefined);

    const ctx = parserService.getOrCreateLoaderContext();
    assert.ok(ctx, "LoaderContext should be instantiated");
    assert.equal(ctx.connectionState, mockConnection);
    assert.ok(ctx.sharedFs, "sharedFs should be initialized");
    assert.ok(ctx.cacheStore, "cacheStore should be initialized");
    assert.equal((globalThis as any).savedLoaderCtx, ctx, "savedLoaderCtx global should be bound");

    const ctx2 = parserService.getOrCreateLoaderContext();
    assert.equal(ctx2, ctx, "getOrCreateLoaderContext should return cached instance");
  });

  it("installDependency endpoint obtains loaderCtx via getOrCreateLoaderContext even if savedLoaderCtx was unset", async () => {
    delete (globalThis as any).savedLoaderCtx;

    const notifications: Record<string, any> = {};
    const warnings: string[] = [];
    const mockConnection: any = {
      console: {
        info: () => {},
        warn: (msg: string) => warnings.push(msg),
        error: () => {},
      },
      onNotification: (method: string, handler: (...args: unknown[]) => void) => {
        notifications[method] = handler;
      },
      onRequest: () => {},
      sendNotification: () => {},
    };
    const mockDocManager: any = { documentTrees: new Map() };
    const mockWorkspaceManager: any = {
      getWorkspaceIndex: () => null,
      unifiedWorkspace: { getIndex: () => null },
    };
    const mockDocuments: any = { all: () => [], get: () => undefined };

    const parserService = new ParserService(mockConnection, mockDocManager, mockWorkspaceManager, mockDocuments);

    const lspContext: any = {
      connection: mockConnection,
      parserService,
      workspaceManager: mockWorkspaceManager,
      documentManager: mockDocManager,
      documents: mockDocuments,
      validationService: { validateTextDocument: () => {} },
      settings: {},
    };

    registerMiscEndpoints(lspContext);

    assert.ok(notifications["modelscript/installDependency"], "Handler should be registered");

    // Call installDependency when savedLoaderCtx was initially unset
    await notifications["modelscript/installDependency"]({ name: "Modelica", version: "4.1.0" });

    // Ensure it did NOT reject with "loader context not ready."
    assert.equal(
      warnings.some((w) => w.includes("loader context not ready")),
      false,
      "installDependency should not fail with loader context not ready",
    );
    assert.ok((globalThis as any).savedLoaderCtx, "savedLoaderCtx should now be bound");
  });

  it("modelscript/installPackage mounts curated fallback packages deterministically and updates getMountedLibraries", async () => {
    mountedLibraryMetadata.clear();
    loadingLibraryState.clear();
    delete (globalThis as any).savedLoaderCtx;

    const requests: Record<string, (params: any) => Promise<any> | any> = {};
    const mockConnection: any = {
      console: { info: () => {}, warn: () => {}, error: () => {} },
      onNotification: () => {},
      onRequest: (method: string, handler: (params: any) => Promise<any> | any) => {
        requests[method] = handler;
      },
      sendNotification: () => {},
    };
    const mockWsIndex: any = {
      fileLoaders: new Map<string, () => any>(),
      fileSymbols: new Map<string, Set<number>>(),
      register(uri: string, loader: () => any) {
        this.fileLoaders.set(uri, loader);
      },
      ensureIndexed() {},
      clear(uri: string) {
        this.fileLoaders.delete(uri);
        this.fileSymbols.delete(uri);
      },
    };
    const mockDocManager: any = { documentTrees: new Map() };
    const mockWorkspaceManager: any = {
      getWorkspaceIndex: () => mockWsIndex,
      unifiedWorkspace: { toUnifiedPartial: () => null },
    };
    const mockDocuments: any = { all: () => [], get: () => undefined };
    const parserService = new ParserService(mockConnection, mockDocManager, mockWorkspaceManager, mockDocuments);
    const loaderCtx = parserService.getOrCreateLoaderContext();
    loaderCtx.globalWorkspaceIndex = mockWsIndex;
    loaderCtx.registryUrl = "http://127.0.0.1:1"; // unreachable offline endpoint -> exercises curated fallback

    registerMiscEndpoints({
      connection: mockConnection,
      parserService,
      workspaceManager: mockWorkspaceManager,
      documentManager: mockDocManager,
      documents: mockDocuments,
      validationService: { validateTextDocument: () => {} } as any,
      settings: {} as any,
    } as any);

    assert.ok(requests["modelscript/installPackage"], "installPackage request handler should be registered");
    assert.ok(requests["modelscript/getMountedLibraries"], "getMountedLibraries request handler should be registered");
    assert.ok(requests["modelscript/uninstallPackage"], "uninstallPackage request handler should be registered");

    const installRes = await requests["modelscript/installPackage"]!({
      name: "PlanarMechanics",
      version: "1.6.1",
    });
    assert.equal(installRes.ok, true);
    assert.equal(installRes.version, "1.6.1");

    const mountedAfterInstall = await requests["modelscript/getMountedLibraries"]!({});
    const planarEntry = mountedAfterInstall.mounted.find((m: any) => m.name === "PlanarMechanics");
    assert.ok(planarEntry, "PlanarMechanics should be listed in getMountedLibraries");
    assert.equal(planarEntry.version, "1.6.1");
    assert.equal(planarEntry.explicitlyInstalled, true);

    const uninstallRes = await requests["modelscript/uninstallPackage"]!({ name: "PlanarMechanics" });
    assert.equal(uninstallRes.ok, true);
    const mountedAfterUninstall = await requests["modelscript/getMountedLibraries"]!({});
    assert.equal(
      mountedAfterUninstall.mounted.some((m: any) => m.name === "PlanarMechanics"),
      false,
      "PlanarMechanics should be removed after uninstallPackage",
    );

    mountedLibraryMetadata.clear();
    loadingLibraryState.clear();
  });
});
