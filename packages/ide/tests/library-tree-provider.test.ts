// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LibraryTreeItem, LibraryTreeProvider } from "../src/library-tree-provider.js";
import { TreeItemCollapsibleState } from "./mocks/vscode.js";

describe("LibraryTreeProvider", () => {
  it("getParent returns undefined for root workspace classes and library roots", () => {
    const mockClient: any = {
      onNotification: () => ({ dispose: () => {} }),
      sendRequest: async () => [],
    };
    const provider = new LibraryTreeProvider(mockClient);

    const workspaceItemA = new LibraryTreeItem(
      {
        id: "A",
        name: "A",
        compositeName: "A",
        classKind: "class",
        hasChildren: false,
        language: "modelica",
        uri: "file:///workspace/test.mo",
        description: "class · workspace",
      },
      TreeItemCollapsibleState.None,
    );

    const workspaceItemA1 = new LibraryTreeItem(
      {
        id: "A1",
        name: "A1",
        compositeName: "A1",
        classKind: "class",
        hasChildren: false,
        language: "modelica",
        uri: "file:///workspace/test.mo",
        description: "class · workspace",
      },
      TreeItemCollapsibleState.None,
    );

    const libItem = new LibraryTreeItem(
      {
        id: "__LIB__:Modelica",
        name: "Modelica",
        compositeName: "__LIB__:Modelica",
        classKind: "package",
        hasChildren: true,
        language: "modelica",
      },
      TreeItemCollapsibleState.Collapsed,
    );

    // Root-level items must return undefined as their parent in VS Code TreeDataProvider
    assert.equal(provider.getParent(workspaceItemA), undefined);
    assert.equal(provider.getParent(workspaceItemA1), undefined);
    assert.equal(provider.getParent(libItem), undefined);
  });

  it("getParent resolves parent from itemMap or parentMap for nested elements", () => {
    const mockClient: any = {
      onNotification: () => ({ dispose: () => {} }),
      sendRequest: async () => [],
    };
    const provider = new LibraryTreeProvider(mockClient);

    const parentPkg = new LibraryTreeItem(
      {
        id: "MyPackage",
        name: "MyPackage",
        compositeName: "MyPackage",
        classKind: "package",
        hasChildren: true,
        language: "modelica",
      },
      TreeItemCollapsibleState.Collapsed,
    );

    const childItem = new LibraryTreeItem(
      {
        id: "MyPackage.MyModel",
        name: "MyModel",
        compositeName: "MyPackage.MyModel",
        classKind: "model",
        hasChildren: false,
        language: "modelica",
      },
      TreeItemCollapsibleState.None,
    );

    // Inject parent into itemMap
    (provider as any).itemMap.set("MyPackage", parentPkg);

    const parent = provider.getParent(childItem);
    assert.equal(parent, parentPkg);
  });

  it("refresh fires onDidChangeTreeData with undefined and clears itemMap/parentMap", () => {
    const mockClient: any = {
      onNotification: () => ({ dispose: () => {} }),
      sendRequest: async () => [],
    };
    const provider = new LibraryTreeProvider(mockClient);

    (provider as any).itemMap.set("temp", {} as any);
    (provider as any).parentMap.set("temp", {} as any);

    let firedElement: any = "NOT_FIRED";
    provider.onDidChangeTreeData((el) => {
      firedElement = el;
    });

    provider.refresh();

    assert.equal(firedElement, undefined);
    assert.equal((provider as any).itemMap.size, 0);
    assert.equal((provider as any).parentMap.size, 0);
  });

  it("getChildren queries modelscript/getLibraryTree and updates itemMap", async () => {
    const fakeNodes = [
      {
        id: "A1",
        name: "A1",
        compositeName: "A1",
        classKind: "class",
        hasChildren: false,
        language: "modelica",
        description: "class · workspace",
      },
      {
        id: "__LIB__:Modelica",
        name: "Modelica",
        compositeName: "__LIB__:Modelica",
        classKind: "package",
        hasChildren: true,
        language: "modelica",
      },
    ];

    const mockClient: any = {
      onNotification: () => ({ dispose: () => {} }),
      sendRequest: async (method: string, _params?: any) => {
        if (method === "modelscript/getLibraryTree") {
          return fakeNodes;
        }
        return [];
      },
    };

    const provider = new LibraryTreeProvider(mockClient);
    const children = await provider.getChildren(undefined);

    assert.equal(children.length, 2);
    assert.equal(children[0]?.info.name, "A1");
    assert.equal(children[1]?.info.name, "Modelica");

    assert.ok(provider.getItem("A1"));
    assert.equal(provider.getItem("A1")?.info.name, "A1");
  });

  it("registers modelscript/projectTreeChanged notification listener to refresh", () => {
    let notifHandler: (() => void) | undefined;
    const mockClient: any = {
      onNotification: (method: string, fn: any) => {
        if (method === "modelscript/projectTreeChanged") {
          notifHandler = fn;
        }
        return { dispose: () => {} };
      },
      sendRequest: async () => [],
    };

    const provider = new LibraryTreeProvider(mockClient);
    let refreshFired = false;
    provider.onDidChangeTreeData(() => {
      refreshFired = true;
    });

    assert.ok(notifHandler, "Notification handler for modelscript/projectTreeChanged should be registered");
    notifHandler!();
    assert.equal(refreshFired, true);
  });
});
