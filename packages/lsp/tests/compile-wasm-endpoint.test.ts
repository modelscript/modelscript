// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerSimulationEndpoints } from "../src/handlers/simulationEndpoints.js";

test("LSP Simulation Endpoints: modelscript/compileWasm", async (t) => {
  await initBltWasm();

  const handlers = new Map<string, (...args: any[]) => any>();
  const mockConnection: any = {
    onRequest: (method: string, handler: (...args: any[]) => any) => {
      handlers.set(method, handler);
    },
    onNotification: () => {},
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

  registerSimulationEndpoints(mockContext);

  await t.test("should successfully compile model to WASM C source", async () => {
    const handler = handlers.get("modelscript/compileWasm");
    assert.ok(handler, "modelscript/compileWasm handler must be registered");

    documentInstances.set(docUri, [{ id: 1, name: "TestModel", compositeName: "TestModel", isClassInstance: true }]);

    const res = await handler({
      uri: docUri,
    });

    assert.ok(res, "Result must be returned");
    assert.ok(typeof res.wasmC === "string" && res.wasmC.length > 0, "WASM C code must be generated");
    assert.ok(Array.isArray(res.emccFlags), "emccFlags must be an array");
    assert.ok(Array.isArray(res.exportedFunctions), "exportedFunctions must be an array");
    assert.ok(res.exportedFunctions.includes("_wasm_init"), "exportedFunctions must include _wasm_init");
    assert.ok(Array.isArray(res.scalarVariables), "scalarVariables must be an array");
    assert.ok(
      res.scalarVariables.some((v: any) => v.name === "x"),
      "scalarVariables must include x",
    );
  });

  await t.test("should throw error if document has no Modelica classes", async () => {
    const handler = handlers.get("modelscript/compileWasm");
    documentInstances.clear();
    workspaceInstances.clear();
    mockValidationService.validateTextDocument = async () => {};
    mockWorkspaceManager.resolveModelicaClassInstance = () => null;

    await assert.rejects(
      async () => {
        await handler({
          uri: docUri,
        });
      },
      {
        message: "No Modelica classes found in the active document.",
      },
    );
  });
});
