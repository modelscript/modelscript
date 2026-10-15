// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerClassQueryEndpoints } from "../src/handlers/classqueryEndpoints.js";

test("LSP classquery: modelscript/getClassLocation", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const mockConnection: any = {
    onRequest: (method: string, handler: (...args: any[]) => any) => {
      handlers.set(method, handler);
    },
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  const docUri = "file:///workspace/MyPackage/MyModel.mo";
  const docContent = "within MyPackage;\n\nmodel MyModel\n  Real x;\nend MyModel;";
  const doc = TextDocument.create(docUri, "modelica", 1, docContent);

  const mockDocuments: any = {
    get: (uri: string) => (uri === docUri ? doc : undefined),
    all: () => [doc],
  };

  const symbols = new Map<number, any>();
  symbols.set(1, {
    id: 1,
    name: "MyModel",
    startByte: docContent.indexOf("model MyModel"),
    resourceId: docUri,
    parentId: null,
  });

  const byName = new Map<string, number[]>();
  byName.set("MyModel", [1]);
  byName.set("MyPackage.MyModel", [1]);

  const mockWorkspaceManager: any = {
    getWorkspaceIndex: (_lang: string) => ({
      getFileUriForFQN: (fqn: string) => (fqn === "MyPackage.MyModel" ? docUri : undefined),
    }),
    unifiedWorkspace: {
      toUnifiedPartial: () => ({
        symbols,
        byName,
      }),
    },
    documentInstances: new Map(),
  };

  const mockContext: any = {
    connection: mockConnection,
    documents: mockDocuments,
    workspaceManager: mockWorkspaceManager,
    state: {},
  };

  registerClassQueryEndpoints(mockContext);

  const handler = handlers.get("modelscript/getClassLocation");
  assert.ok(handler, "getClassLocation request handler should be registered");

  // 1. Resolve by FQN
  const loc1 = await handler({ className: "MyPackage.MyModel" });
  assert.ok(loc1, "Location should be resolved for MyPackage.MyModel");
  assert.strictEqual(loc1.uri, docUri);
  assert.strictEqual(loc1.line, 2);
  assert.strictEqual(loc1.character, 0);

  // 2. Resolve by simple name
  const loc2 = await handler({ className: "MyModel" });
  assert.ok(loc2, "Location should be resolved for simple name MyModel");
  assert.strictEqual(loc2.uri, docUri);
  assert.strictEqual(loc2.line, 2);

  // 3. Resolve by UnifiedWorkspace with modelica: virtual URI
  (mockWorkspaceManager.unifiedWorkspace as any).getFileUriForFQN = (fqn: string) =>
    fqn === "Modelica.Mechanics.Translational.Examples.Vehicle"
      ? "modelica:///lib/Modelica 4.1.0/Mechanics/Translational/Examples/Vehicle.mo"
      : undefined;

  const loc3 = await handler({ className: "Modelica.Mechanics.Translational.Examples.Vehicle" });
  assert.ok(loc3, "Location should be resolved for Vehicle");
  assert.strictEqual(loc3.uri, "modelica:///lib/Modelica 4.1.0/Mechanics/Translational/Examples/Vehicle.mo");
});
