// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("Salsa Connect & Short Class Specifier Lint Suite", () => {
  it("should detect M2003 when a short class specifier references an undefined type", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      package P
        type Voltage = NonExistentType;
      end P;
    `;

    const uri = "file:///test/ShortClassUndefined.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m2003 = diags.filter(
      (d: any) => d.code === 2003 || d.message?.includes("Class or type 'NonExistentType' not found in scope"),
    );

    assert.ok(m2003.length > 0, "Expected M2003 for undefined short class type 'NonExistentType'");
    assert.match(m2003[0].message, /Class or type 'NonExistentType' not found in scope\./);
  });

  it("should produce 0 diagnostics for valid short class specifiers referencing primitives or declared types", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      package P
        type MyReal = Real;
        type MyVoltage = MyReal;
      end P;
    `;

    const uri = "file:///test/ShortClassValid.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m2003 = diags.filter((d: any) => d.code === 2003);
    assert.equal(m2003.length, 0, "Expected 0 M2003 diagnostics for valid short class specifiers");
  });

  it("should detect M2002 when connect() references an undeclared component", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      connector Pin
        Real v;
        flow Real i;
      end Pin;

      model Circuit
        Pin p1;
      equation
        connect(p1, nonExistentPin);
      end Circuit;
    `;

    const uri = "file:///test/ConnectUndeclared.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m2002 = diags.filter(
      (d: any) => d.code === 2002 || (d.message?.includes("nonExistentPin") && d.message?.includes("not found")),
    );

    assert.ok(m2002.length > 0, "Expected M2002 for undeclared endpoint 'nonExistentPin'");
  });

  it("should detect M3004 when connect() references a non-connector component", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      connector Pin
        Real v;
        flow Real i;
      end Pin;

      model Circuit
        Pin p1;
        Real notAConnector;
      equation
        connect(p1, notAConnector);
      end Circuit;
    `;

    const uri = "file:///test/ConnectNonConnector.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m3004 = diags.filter((d: any) => d.code === 3004 || d.message?.includes("is not a valid connector"));

    assert.ok(m3004.length > 0, "Expected M3004 for non-connector endpoint");
    assert.match(m3004[0].message, /notAConnector is not a valid connector/);
  });

  it("should detect M5004 when connecting connectors with mismatched flow variables", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      connector Pin1
        Real v;
        flow Real i;
      end Pin1;

      connector Pin2
        Real v;
        Real i;
      end Pin2;

      model Circuit
        Pin1 p1;
        Pin2 p2;
      equation
        connect(p1, p2);
      end Circuit;
    `;

    const uri = "file:///test/ConnectFlowMismatch.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m5004 = diags.filter((d: any) => d.code === 5004 || d.message?.includes("Cannot connect flow component"));

    assert.ok(m5004.length > 0, "Expected M5004 for flow/non-flow variable mismatch");
    assert.match(m5004[0].message, /Cannot connect flow component p1\.i to non-flow component p2\.i/);
  });

  it("should produce 0 diagnostics for valid connect() equations between plug-compatible connectors", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      connector Pin
        Real v;
        flow Real i;
      end Pin;

      model Resistor
        Pin p, n;
      end Resistor;

      model Circuit
        Resistor r1, r2;
      equation
        connect(r1.p, r2.n);
      end Circuit;
    `;

    const uri = "file:///test/ConnectValid.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const connectDiags = diags.filter(
      (d: any) => d.code === 2002 || d.code === 3003 || d.code === 3004 || d.code === 5004,
    );

    assert.equal(connectDiags.length, 0, "Expected 0 connection diagnostics for valid circuit connection");
  });

  it("should detect M2003 for unknown type even when wildcard import is present (no blanket suppression)", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      package Constants
        constant Real pi = 3.14159;
      end Constants;

      model M
        import Constants.*;
        BogusType x;
      end M;
    `;

    const uri = "file:///test/WildcardImportUndefined.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m2003 = diags.filter(
      (d: any) => d.code === 2003 || d.message?.includes("Class or type 'BogusType' not found in scope"),
    );

    assert.ok(m2003.length > 0, "Expected M2003 for undefined type 'BogusType' despite wildcard import");
    assert.match(m2003[0].message, /Class or type 'BogusType' not found in scope\./);
  });

  it("should resolve qualified types and type aliases through short class specifiers without M2003", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      package Modelica
        package SIunits
          type Voltage = Real;
        end SIunits;
      end Modelica;

      package App
        type MyVoltage = Modelica.SIunits.Voltage;

        model Resistor
          MyVoltage v;
        end Resistor;
      end App;
    `;

    const uri = "file:///test/QualifiedShortClassValid.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    const m2003 = diags.filter((d: any) => d.code === 2003);
    assert.equal(m2003.length, 0, "Expected 0 M2003 diagnostics for valid qualified short class alias");
  });

  it("should suppress cascading M2002 when connect() references a component with unresolved class", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const code = `
      model Circuit
        NonExistentResistor R1;
        Real dummy;
      equation
        connect(R1.p, dummy);
      end Circuit;
    `;

    const uri = "file:///test/ConnectUnresolvedComponent.mo";
    ctx.load(code, uri);

    const diags = await ctx.queryEngine.runAllLintsAsync(uri);
    // Should have M2003 for NonExistentResistor
    const m2003 = diags.filter((d: any) => d.code === 2003 || d.message?.includes("NonExistentResistor"));
    assert.ok(m2003.length > 0, "Expected M2003 for unresolved class NonExistentResistor");

    // Should NOT have M2002 for R1.p or p in scope Circuit
    const m2002 = diags.filter(
      (d: any) => d.code === 2002 || (d.message?.includes("Variable") && d.message?.includes("not found")),
    );
    assert.equal(m2002.length, 0, "Should not emit cascading M2002 for unresolved component type");
  });

  it("should produce 0 M3007 diagnostics on RLC connect(Vb.p, L.p) when multi-file packages are lazily indexed", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());

    const files: Record<string, { parentFQN: string; content: string }> = {
      "file:///msl/Modelica/package.mo": {
        parentFQN: "",
        content: `package Modelica end Modelica;`,
      },
      "file:///msl/Modelica/Electrical/package.mo": {
        parentFQN: "Modelica",
        content: `within Modelica; package Electrical end Electrical;`,
      },
      "file:///msl/Modelica/Electrical/Analog/package.mo": {
        parentFQN: "Modelica.Electrical",
        content: `within Modelica.Electrical; package Analog end Analog;`,
      },
      "file:///msl/Modelica/Electrical/Analog/Interfaces/package.mo": {
        parentFQN: "Modelica.Electrical.Analog",
        content: `within Modelica.Electrical.Analog; package Interfaces end Interfaces;`,
      },
      "file:///msl/Modelica/Electrical/Analog/Interfaces/PositivePin.mo": {
        parentFQN: "Modelica.Electrical.Analog.Interfaces",
        content: `within Modelica.Electrical.Analog.Interfaces;
connector PositivePin
  Real v;
  flow Real i;
end PositivePin;`,
      },
      "file:///msl/Modelica/Electrical/Analog/Interfaces/NegativePin.mo": {
        parentFQN: "Modelica.Electrical.Analog.Interfaces",
        content: `within Modelica.Electrical.Analog.Interfaces;
connector NegativePin
  Real v;
  flow Real i;
end NegativePin;`,
      },
      "file:///msl/Modelica/Electrical/Analog/Interfaces/TwoPin.mo": {
        parentFQN: "Modelica.Electrical.Analog.Interfaces",
        content: `within Modelica.Electrical.Analog.Interfaces;
partial model TwoPin
  PositivePin p;
  NegativePin n;
end TwoPin;`,
      },
      "file:///msl/Modelica/Electrical/Analog/Interfaces/OnePort.mo": {
        parentFQN: "Modelica.Electrical.Analog.Interfaces",
        content: `within Modelica.Electrical.Analog.Interfaces;
partial model OnePort
  extends TwoPin;
end OnePort;`,
      },
      "file:///msl/Modelica/Electrical/Analog/Interfaces/VoltageSource.mo": {
        parentFQN: "Modelica.Electrical.Analog.Interfaces",
        content: `within Modelica.Electrical.Analog.Interfaces;
partial model VoltageSource
  extends OnePort;
end VoltageSource;`,
      },
      "file:///msl/Modelica/Electrical/Analog/Sources/package.mo": {
        parentFQN: "Modelica.Electrical.Analog",
        content: `within Modelica.Electrical.Analog; package Sources end Sources;`,
      },
      "file:///msl/Modelica/Electrical/Analog/Sources/SineVoltage.mo": {
        parentFQN: "Modelica.Electrical.Analog.Sources",
        content: `within Modelica.Electrical.Analog.Sources;
model SineVoltage
  extends Interfaces.VoltageSource;
end SineVoltage;`,
      },
      "file:///msl/Modelica/Electrical/Analog/Basic/package.mo": {
        parentFQN: "Modelica.Electrical.Analog",
        content: `within Modelica.Electrical.Analog; package Basic end Basic;`,
      },
      "file:///msl/Modelica/Electrical/Analog/Basic/Inductor.mo": {
        parentFQN: "Modelica.Electrical.Analog.Basic",
        content: `within Modelica.Electrical.Analog.Basic;
model Inductor
  extends Modelica.Electrical.Analog.Interfaces.OnePort;
end Inductor;`,
      },
    };

    for (const [uri, { parentFQN, content }] of Object.entries(files)) {
      ctx.workspaceIndex.register(uri, () => parser.parse(content, null, 0, 0, 0, uri).rootNode as any, parentFQN);
    }
    // Only index root Modelica/package.mo eagerly, leaving all subpackages lazy
    ctx.workspaceIndex.ensureIndexed("file:///msl/Modelica/package.mo");

    const rlcUri = "file:///test/RLC.mo";
    const rlcCode = `
model RLC
  Modelica.Electrical.Analog.Sources.SineVoltage Vb;
  Modelica.Electrical.Analog.Basic.Inductor L;
equation
  connect(Vb.p, L.p);
end RLC;
`;
    ctx.workspaceIndex.register(rlcUri, () => parser.parse(rlcCode, null, 0, 0, 0, rlcUri).rootNode as any);
    const fileIndex = ctx.workspaceIndex.getFileIndex(rlcUri);
    ctx.queryEngine.updateIndex(ctx.workspaceIndex.toUnifiedPartial());

    const fileIds = fileIndex ? new Set(fileIndex.symbols.keys()) : new Set<number>();
    const diags = await ctx.queryEngine.runAllLintsAsync(rlcUri, undefined, fileIds);
    assert.equal(diags.length, 0, `Expected 0 diagnostics on RLC model, got: ${JSON.stringify(diags)}`);
  });
});
