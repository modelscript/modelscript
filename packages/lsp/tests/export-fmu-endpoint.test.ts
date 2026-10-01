// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerInteropEndpoints } from "../src/handlers/interopEndpoints.js";

test("LSP Interop Endpoints: modelscript/exportFmu", async (t) => {
  await initBltWasm();

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
    workspace: {
      applyEdit: async () => true,
    },
  };

  const docUri = "file:///workspace/TestModel.mo";
  const doc = TextDocument.create(
    docUri,
    "modelica",
    1,
    "model TestModel\n  Real x;\nequation\n  der(x) = 1.0;\nend TestModel;",
  );

  const mockDocuments: any = {
    get: (uri: string) => (uri === docUri ? doc : undefined),
    all: () => [doc],
  };

  const documentInstances = new Map<string, any[]>();
  const workspaceInstances = new Map<string, any[]>();
  const documentContexts = new Map<string, any>();
  const activeValidationPromises = new Map<string, Promise<void>>();

  // Create a minimal DAEBuilder for mock flattening
  const builder = new DAEBuilder();
  const xVar = builder.addVariable("x", 0 /* Real */, 0 /* Continuous */, 0 /* Local */);
  builder.setVarState(xVar);

  (globalThis as any).flattenArenaFromInstance = () => {
    return builder;
  };

  const mockWorkspaceManager: any = {
    documentInstances,
    workspaceInstances,
    documentContexts,
    resolveModelicaClassInstance: () => {
      return { id: 1, name: "TestModel", compositeName: "TestModel", isClassInstance: true };
    },
  };

  const mockValidationService: any = {
    activeValidationPromises,
    validateTextDocument: async (textDoc: any) => {
      const inst = { id: 1, name: "TestModel", compositeName: "TestModel", isClassInstance: true };
      documentInstances.set(textDoc.uri, [inst]);
      workspaceInstances.set(textDoc.uri, [inst]);
    },
  };

  const mockContext: any = {
    connection: mockConnection,
    documents: mockDocuments,
    workspaceManager: mockWorkspaceManager,
    validationService: mockValidationService,
    state: {
      activeValidationPromises,
    },
  };

  registerInteropEndpoints(mockContext);

  await t.test("should export FMI 2.0 when instances are already populated in documentInstances", async () => {
    const handler = handlers.get("modelscript/exportFmu");
    assert.ok(handler, "modelscript/exportFmu handler must be registered");

    documentInstances.set(docUri, [{ id: 1, name: "TestModel", compositeName: "TestModel", isClassInstance: true }]);

    const res = await handler({
      uri: docUri,
      fmiVersion: "2.0",
    });

    assert.strictEqual(res.fmuName, "TestModel");
    assert.ok(res.base64 && res.base64.length > 0, "Base64 FMU payload must be present");
  });

  await t.test("should export FMI 3.0 and auto-validate when documentInstances is initially empty", async () => {
    const handler = handlers.get("modelscript/exportFmu");
    documentInstances.clear();
    workspaceInstances.clear();

    const res = await handler({
      uri: docUri,
      fmiVersion: "3.0",
    });

    assert.strictEqual(res.fmuName, "TestModel");
    assert.ok(res.base64 && res.base64.length > 0, "Base64 FMU payload must be present");
  });

  await t.test(
    "should export FMU via resolveModelicaClassInstance fallback if documentInstances is empty",
    async () => {
      const handler = handlers.get("modelscript/exportFmu");
      documentInstances.clear();
      workspaceInstances.clear();
      mockValidationService.validateTextDocument = async () => {}; // No-op validation

      const res = await handler({
        uri: docUri,
        fmiVersion: "2.0",
      });

      assert.strictEqual(res.fmuName, "TestModel");
      assert.ok(res.base64 && res.base64.length > 0, "Base64 FMU payload must be present");
    },
  );

  await t.test("should throw error if document has no Modelica classes", async () => {
    const handler = handlers.get("modelscript/exportFmu");
    documentInstances.clear();
    workspaceInstances.clear();
    mockValidationService.validateTextDocument = async () => {};
    mockWorkspaceManager.resolveModelicaClassInstance = () => null;

    await assert.rejects(
      async () => {
        await handler({
          uri: docUri,
          fmiVersion: "2.0",
        });
      },
      {
        message: "No Modelica classes found in the active document.",
      },
    );
  });
});
