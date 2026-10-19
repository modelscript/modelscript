// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LSPBridge, PositionIndex } from "../src/lsp-bridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

test("Rich LSP Hover Declarations & Documentation Test Suite", async (t) => {
  const sineVoltagePath = path.join(
    repoRoot,
    "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Sources/SineVoltage.mo",
  );
  const voltageSourcePath = path.join(
    repoRoot,
    "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Interfaces/VoltageSource.mo",
  );
  const sineVoltageSource = fs.readFileSync(sineVoltagePath, "utf-8");
  const voltageSourceText = fs.readFileSync(voltageSourcePath, "utf-8");

  const sineUri = "file:///modelscript_registry/Modelica/4.1.0/Electrical/Analog/Sources/SineVoltage.mo";
  const vsUri = "file:///modelscript_registry/Modelica/4.1.0/Electrical/Analog/Interfaces/VoltageSource.mo";
  const onePortUri = "file:///modelscript_registry/Modelica/4.1.0/Electrical/Analog/Interfaces/OnePort.mo";
  const onePortText = `within Modelica.Electrical.Analog.Interfaces;
partial model OnePort "Component with two electrical pins p and n and current i from p to n"
  SI.Voltage v "Voltage drop of the two pins (= p.v - n.v)";
  SI.Current i "Current flowing from pin p to pin n";
  PositivePin p "Positive electrical pin";
  NegativePin n "Negative electrical pin";
end OnePort;`;

  const circuitUri = "file:///workspace/Circuit.mo";
  const circuitText = `/**
 * AC test circuit with a sine voltage source.
 */
model Circuit "Test AC circuit"
  // Primary AC excitation source
  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, offset = 0) "Main sine source";
equation
  connect(Vb.p, Vb.n);
end Circuit;`;

  const fileTexts = new Map<string, string>([
    [sineUri, sineVoltageSource],
    [vsUri, voltageSourceText],
    [onePortUri, onePortText],
    [circuitUri, circuitText],
  ]);

  // Build realistic SymbolIndex mirroring `lsp-bundle.zip` + live CST indexer spans
  // Note: in `lsp-bundle.zip`, `SineVoltage` has `metadata: { classPrefixes: "model" }`
  // and `component_declaration` spans only `V(start=1) "Amplitude of sine wave"`!
  const vDeclStart = sineVoltageSource.indexOf('V(start=1) "Amplitude of sine wave"');
  const vDeclEnd = vDeclStart + 'V(start=1) "Amplitude of sine wave"'.length;
  const phaseDeclStart = sineVoltageSource.indexOf('phase=0 "Phase of sine wave"');
  const phaseDeclEnd = phaseDeclStart + 'phase=0 "Phase of sine wave"'.length;
  const fDeclStart = sineVoltageSource.indexOf('f(start=1) "Frequency of sine wave"');
  const fDeclEnd = fDeclStart + 'f(start=1) "Frequency of sine wave"'.length;

  const offsetDeclStart = voltageSourceText.indexOf('offset=0 "Voltage offset"');
  const offsetDeclEnd = offsetDeclStart + 'offset=0 "Voltage offset"'.length;

  const pDeclStart = onePortText.indexOf('p "Positive electrical pin"');
  const pDeclEnd = pDeclStart + 'p "Positive electrical pin"'.length;

  const vbDeclStart = circuitText.indexOf('Vb(V = 10, offset = 0) "Main sine source"');
  const vbDeclEnd = vbDeclStart + 'Vb(V = 10, offset = 0) "Main sine source"'.length;

  const symbols = new Map<number, any>([
    // Package hierarchy: Modelica.Electrical.Analog.{Sources, Interfaces}
    [1, { id: 1, kind: "Class", name: "Modelica", parentId: null, metadata: { classPrefixes: "package" } }],
    [2, { id: 2, kind: "Class", name: "Electrical", parentId: 1, metadata: { classPrefixes: "package" } }],
    [3, { id: 3, kind: "Class", name: "Analog", parentId: 2, metadata: { classPrefixes: "package" } }],
    [4, { id: 4, kind: "Class", name: "Sources", parentId: 3, metadata: { classPrefixes: "package" } }],
    [5, { id: 5, kind: "Class", name: "Interfaces", parentId: 3, metadata: { classPrefixes: "package" } }],
    // Unrelated Sources package to test qualified disambiguation
    [6, { id: 6, kind: "Class", name: "Sources", parentId: 1, metadata: { classPrefixes: "package" } }],

    // SineVoltage (hydrated from lsp-bundle.zip with only classPrefixes: "model")
    [
      10,
      {
        id: 10,
        kind: "Class",
        name: "SineVoltage",
        ruleName: "class_definition",
        parentId: 4,
        resourceId: sineUri,
        startOffset: sineVoltageSource.indexOf("model SineVoltage"),
        endOffset: sineVoltageSource.length,
        metadata: { classPrefixes: "model" },
      },
    ],
    [
      11,
      {
        id: 11,
        kind: "Component",
        name: "V",
        ruleName: "component_declaration",
        parentId: 10,
        resourceId: sineUri,
        startOffset: vDeclStart,
        endOffset: vDeclEnd,
        metadata: { typeSpecifier: "SI.Voltage" },
      },
    ],
    [
      12,
      {
        id: 12,
        kind: "Component",
        name: "phase",
        ruleName: "component_declaration",
        parentId: 10,
        resourceId: sineUri,
        startOffset: phaseDeclStart,
        endOffset: phaseDeclEnd,
        metadata: { typeSpecifier: "SI.Angle" },
      },
    ],
    [
      13,
      {
        id: 13,
        kind: "Component",
        name: "f",
        ruleName: "component_declaration",
        parentId: 10,
        resourceId: sineUri,
        startOffset: fDeclStart,
        endOffset: fDeclEnd,
        metadata: { typeSpecifier: "SI.Frequency" },
      },
    ],
    [
      14,
      {
        id: 14,
        kind: "Extends",
        name: "Interfaces.VoltageSource",
        ruleName: "extends_clause",
        parentId: 10,
        resourceId: sineUri,
        startOffset: sineVoltageSource.indexOf("extends Interfaces.VoltageSource"),
        endOffset: sineVoltageSource.indexOf("phase=phase));") + "phase=phase));".length,
        metadata: { typeSpecifier: "Interfaces.VoltageSource" },
      },
    ],

    // Interfaces.VoltageSource
    [
      20,
      {
        id: 20,
        kind: "Class",
        name: "VoltageSource",
        ruleName: "class_definition",
        parentId: 5,
        resourceId: vsUri,
        startOffset: voltageSourceText.indexOf("partial model VoltageSource"),
        endOffset: voltageSourceText.length,
        metadata: { classPrefixes: "partial model" },
      },
    ],
    [
      21,
      {
        id: 21,
        kind: "Extends",
        name: "OnePort",
        ruleName: "extends_clause",
        parentId: 20,
        resourceId: vsUri,
        startOffset: voltageSourceText.indexOf("extends OnePort"),
        endOffset: voltageSourceText.indexOf("extends OnePort;") + "extends OnePort;".length,
        metadata: { typeSpecifier: "OnePort" },
      },
    ],
    [
      22,
      {
        id: 22,
        kind: "Component",
        name: "offset",
        ruleName: "component_declaration",
        parentId: 20,
        resourceId: vsUri,
        startOffset: offsetDeclStart,
        endOffset: offsetDeclEnd,
        metadata: { typeSpecifier: "SI.Voltage" },
      },
    ],

    // Interfaces.OnePort
    [
      30,
      {
        id: 30,
        kind: "Class",
        name: "OnePort",
        ruleName: "class_definition",
        parentId: 5,
        resourceId: onePortUri,
        startOffset: onePortText.indexOf("partial model OnePort"),
        endOffset: onePortText.length,
        metadata: { classPrefixes: "partial model" },
      },
    ],
    [
      31,
      {
        id: 31,
        kind: "Component",
        name: "p",
        ruleName: "component_declaration",
        parentId: 30,
        resourceId: onePortUri,
        startOffset: pDeclStart,
        endOffset: pDeclEnd,
        metadata: { typeSpecifier: "PositivePin" },
      },
    ],

    // Circuit model
    [
      100,
      {
        id: 100,
        kind: "Class",
        name: "Circuit",
        ruleName: "class_definition",
        parentId: null,
        resourceId: circuitUri,
        startOffset: circuitText.indexOf("model Circuit"),
        endOffset: circuitText.length,
        metadata: { classPrefixes: "model" },
      },
    ],
    [
      101,
      {
        id: 101,
        kind: "Component",
        name: "Vb",
        ruleName: "component_declaration",
        parentId: 100,
        resourceId: circuitUri,
        startOffset: vbDeclStart,
        endOffset: vbDeclEnd,
        metadata: { typeSpecifier: "Modelica.Electrical.Analog.Sources.SineVoltage" },
      },
    ],
    // Real MSL packages have `extends Modelica.Icons.Package` and `import` children
    [
      200,
      {
        id: 200,
        kind: "Extends",
        name: "Modelica.Icons.Package",
        parentId: 1,
        metadata: { typeSpecifier: "Modelica.Icons.Package" },
      },
    ],
    [
      201,
      {
        id: 201,
        kind: "Extends",
        name: "Modelica.Icons.Package",
        parentId: 2,
        metadata: { typeSpecifier: "Modelica.Icons.Package" },
      },
    ],
    [
      202,
      {
        id: 202,
        kind: "Extends",
        name: "Modelica.Icons.SourcesPackage",
        parentId: 4,
        metadata: { typeSpecifier: "Modelica.Icons.SourcesPackage" },
      },
    ],
    [
      203,
      {
        id: 203,
        kind: "Import",
        name: "Modelica.Electrical.Analog.Sources.*",
        parentId: 100,
      },
    ],
  ]);

  const byName = new Map<string, number[]>([
    ["Modelica", [1]],
    ["Electrical", [2]],
    ["Analog", [3]],
    ["Sources", [6, 4]], // Note: unrelated Sources is first to verify qualified resolution picks id 4!
    ["Interfaces", [5]],
    ["SineVoltage", [10]],
    ["V", [11]],
    ["phase", [12]],
    ["f", [13]],
    ["VoltageSource", [20]],
    ["offset", [22]],
    ["OnePort", [30]],
    ["p", [31]],
    ["Circuit", [100]],
    ["Vb", [101]],
  ]);

  const childrenOf = new Map<number | null, number[]>([
    [null, [1, 100]],
    [1, [200, 2, 6]],
    [2, [201, 3]],
    [3, [4, 5]],
    [4, [202, 10]],
    [5, [20, 30]],
    [10, [11, 12, 13, 14]],
    [20, [21, 22]],
    [30, [31]],
    [100, [203, 101]],
  ]);

  const mockIndex: any = {
    symbols,
    byName,
    childrenOf,
    symbolsByResource: new Map([
      [sineUri, [10, 11, 12, 13, 14]],
      [vsUri, [20, 21, 22]],
      [onePortUri, [30, 31]],
      [circuitUri, [100, 101, 203]],
    ]),
  };

  const mockEngine: any = {
    toQueryDB: () => ({ index: mockIndex }),
    index: mockIndex,
    cstText: (start: number, end: number, entry?: any) => {
      const uri = entry?.resourceId ?? circuitUri;
      const text = fileTexts.get(uri);
      if (!text) return null;
      return text.slice(start, Math.min(end, text.length));
    },
  };

  const bridge = new LSPBridge(mockIndex, mockEngine, new PositionIndex(circuitText), circuitUri);

  await t.test(
    "Hover over SineVoltage displays full model signature, parameters, extends, and Documentation(info) Markdown",
    () => {
      const sineOffset = circuitText.indexOf("SineVoltage") + 3;
      const hover = bridge.hover(sineOffset, circuitText);
      assert.ok(hover, "Expected hover result for SineVoltage");

      const md = hover.contents;
      // 1. Must NOT be bare "class SineVoltage" or hidden inside <details>
      assert.ok(!md.includes("class SineVoltage\n"), `Should not emit bare 'class SineVoltage', got:\n${md}`);
      assert.ok(!md.includes("<details>"), "Multi-line declaration should not be hidden in <details>");

      // 2. Must include the full model header, parameters, extends clause, and end SineVoltage;
      assert.ok(md.includes('model SineVoltage "Sine voltage source"'), "Must include model header with description");
      assert.ok(
        md.includes('parameter SI.Voltage V(start=1) "Amplitude of sine wave";'),
        "Must include parameter V declaration",
      );
      assert.ok(
        md.includes('parameter SI.Angle phase=0 "Phase of sine wave";'),
        "Must include parameter phase declaration",
      );
      assert.ok(
        md.includes('parameter SI.Frequency f(start=1) "Frequency of sine wave";'),
        "Must include parameter f declaration",
      );
      assert.ok(md.includes("extends Interfaces.VoltageSource"), "Must include extends clause");
      assert.ok(md.includes("end SineVoltage;"), "Must end with 'end SineVoltage;'");

      // 3. Must strip Icon/Documentation annotations from the code signature
      const codeBlockMatch = md.match(/```modelica\n([\s\S]*?)\n```/);
      assert.ok(codeBlockMatch, "Must contain fenced modelica code block");
      assert.ok(!codeBlockMatch[1]!.includes("annotation"), "Declaration code block must strip annotation(...)");
      assert.ok(!codeBlockMatch[1]!.includes("preserveAspectRatio"), "Declaration code block must strip Icon graphics");

      // 4. Must include description string, Documentation(info=...) converted from HTML to Markdown, and package scope
      assert.ok(md.includes("**Sine voltage source**"), "Must include bold short description");
      assert.ok(
        md.includes("This voltage source uses the corresponding signal source of the Modelica.Blocks.Sources package."),
        "Must include Documentation(info=...) paragraph text",
      );
      assert.ok(!md.includes("<html>"), "Must strip <html> tags when converting Documentation(info=...) to Markdown");
      assert.ok(!md.includes("<img"), "Must strip <img> tags from Documentation(info=...)");
      assert.ok(
        md.includes("*Defined in `Modelica.Electrical.Analog.Sources`*"),
        "Must display enclosing package scope",
      );
    },
  );

  await t.test("Hover over qualified package segment resolves exact package in hierarchy", () => {
    const sourcesOffset = circuitText.indexOf("Sources.SineVoltage") + 2;
    const hover = bridge.hover(sourcesOffset, circuitText);
    assert.ok(hover, "Expected hover on 'Sources'");
    assert.ok(
      hover.contents.includes("*Defined in `Modelica.Electrical.Analog`*"),
      `Expected Modelica.Electrical.Analog.Sources rather than unrelated Sources, got:\n${hover.contents}`,
    );
  });

  await t.test(
    "Hover over component Vb includes full type prefix/specifier, leading // doc comment, description, and resolved type info",
    () => {
      const vbOffset = circuitText.indexOf("Vb(V = 10") + 1;
      const hover = bridge.hover(vbOffset, circuitText);
      assert.ok(hover, "Expected hover on component Vb");

      const md = hover.contents;
      assert.ok(
        md.includes("Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, offset = 0)"),
        `Expected full component declaration with type specifier, got:\n${md}`,
      );
      assert.ok(md.includes("Main sine source"), "Expected component description string");
      assert.ok(md.includes("Primary AC excitation source"), "Expected leading // doc comment");
      assert.ok(
        md.includes("*Type:* `Modelica.Electrical.Analog.Sources.SineVoltage` — Sine voltage source"),
        "Expected resolved type summary",
      );
    },
  );

  await t.test("Hover over direct and inherited modification arguments inside Vb(V = 10, offset = 0)", () => {
    // Direct parameter 'V' on SineVoltage
    const vModOffset = circuitText.indexOf("V = 10");
    const vHover = bridge.hover(vModOffset, circuitText);
    assert.ok(vHover, "Expected hover on modifier 'V'");
    assert.ok(
      vHover.contents.includes("parameter SI.Voltage V(start=1)"),
      `Modifier 'V' should recover 'parameter SI.Voltage' from parent component_clause, got:\n${vHover.contents}`,
    );
    assert.ok(vHover.contents.includes("Amplitude of sine wave"), "Modifier 'V' should include parameter description");

    // Inherited parameter 'offset' from Interfaces.VoltageSource
    const offsetModOffset = circuitText.indexOf("offset = 0") + 2;
    const offsetHover = bridge.hover(offsetModOffset, circuitText);
    assert.ok(offsetHover, "Expected hover on inherited modifier 'offset'");
    assert.ok(
      offsetHover.contents.includes("parameter SI.Voltage offset=0"),
      `Inherited modifier 'offset' should show full declaration, got:\n${offsetHover.contents}`,
    );
    assert.ok(
      offsetHover.contents.includes("Voltage offset"),
      "Inherited modifier 'offset' should include description",
    );
  });

  await t.test(
    "Hover over dotted connector pin reference Vb.p resolves through component type and inheritance chain",
    () => {
      const pinPOffset = circuitText.indexOf("Vb.p") + 3;
      const pinHover = bridge.hover(pinPOffset, circuitText);
      assert.ok(pinHover, "Expected hover on dotted pin reference 'Vb.p'");
      assert.ok(
        pinHover.contents.includes("PositivePin p"),
        `Expected 'PositivePin p' declaration, got:\n${pinHover.contents}`,
      );
      assert.ok(pinHover.contents.includes("Positive electrical pin"), "Expected pin description string from OnePort");
      assert.ok(
        pinHover.contents.includes("*Defined in `Modelica.Electrical.Analog.Interfaces.OnePort`*"),
        "Expected OnePort defining scope",
      );
    },
  );

  await t.test("Hover over class with leading /** ... */ JSDoc comment includes both signature and JSDoc", () => {
    const circuitOffset = circuitText.indexOf("model Circuit") + "model ".length + 2;
    const circuitHover = bridge.hover(circuitOffset, circuitText);
    assert.ok(circuitHover, "Expected hover on Circuit class name");
    assert.ok(circuitHover.contents.includes('model Circuit "Test AC circuit"'), "Expected Circuit model signature");
    assert.ok(
      circuitHover.contents.includes("AC test circuit with a sine voltage source."),
      "Expected leading /** ... */ JSDoc comment in hover",
    );
  });

  await t.test("Hover over SysML v2 part def with doc /* ... */ extracts clean signature and doc comment", () => {
    const sysmlUri = "file:///workspace/Propulsion.sysml";
    const sysmlText = `package Propulsion {
  part def BrushlessMotor {
    doc /* High-efficiency 3-phase brushless DC motor for UAV propulsion. */
    attribute maxTorque : Real;
    port powerIn : ElectricalPowerPort;
  }
}`;
    const defStart = sysmlText.indexOf("part def BrushlessMotor");
    const defEnd = sysmlText.lastIndexOf("}");
    const sysmlSymbols = new Map<number, any>([
      [
        1,
        {
          id: 1,
          kind: "Class",
          name: "BrushlessMotor",
          language: "sysml",
          resourceId: sysmlUri,
          parentId: null,
          startOffset: defStart,
          endOffset: defEnd,
        },
      ],
    ]);
    const sysmlIndex: any = {
      symbols: sysmlSymbols,
      byName: new Map([["BrushlessMotor", [1]]]),
      childrenOf: new Map([[null, [1]]]),
      symbolsByResource: new Map([[sysmlUri, [1]]]),
    };
    const sysmlEngine: any = {
      index: sysmlIndex,
      cstText: (s: number, e: number) => sysmlText.slice(s, Math.min(e, sysmlText.length)),
    };
    const sysmlBridge = new LSPBridge(sysmlIndex, sysmlEngine, new PositionIndex(sysmlText), sysmlUri);
    const hover = sysmlBridge.hover(sysmlText.indexOf("BrushlessMotor") + 3, sysmlText);
    assert.ok(hover, "Expected hover on SysML v2 BrushlessMotor");
    assert.ok(hover.contents.includes("```sysml\npart def BrushlessMotor {"), "Must show sysml code block");
    assert.ok(hover.contents.includes("attribute maxTorque : Real;"), "Must include attributes in signature");
    assert.ok(
      !hover.contents.match(/```sysml[\s\S]*?doc\s*\/\*/),
      "Must strip inline doc /* ... */ from the code signature block",
    );
    assert.ok(
      hover.contents.includes("High-efficiency 3-phase brushless DC motor for UAV propulsion."),
      "Must render doc /* ... */ in Markdown documentation section",
    );
  });

  await t.test("Hover over ModelScript function extracts signature header without body and includes JSDoc", () => {
    const msxUri = "file:///workspace/control.msx";
    const msxText = `/**
 * Computes PID control effort with anti-windup clamping.
 */
function computePid(err: Real, dt: Real): Real {
  const kp = 2.5;
  return kp * err;
}`;
    const fnStart = msxText.indexOf("function computePid");
    const fnEnd = msxText.length;
    const msxSymbols = new Map<number, any>([
      [
        1,
        {
          id: 1,
          kind: "Function",
          name: "computePid",
          language: "modelscript",
          resourceId: msxUri,
          parentId: null,
          startOffset: fnStart,
          endOffset: fnEnd,
        },
      ],
    ]);
    const msxIndex: any = {
      symbols: msxSymbols,
      byName: new Map([["computePid", [1]]]),
      childrenOf: new Map([[null, [1]]]),
      symbolsByResource: new Map([[msxUri, [1]]]),
    };
    const msxEngine: any = {
      index: msxIndex,
      cstText: (s: number, e: number) => msxText.slice(s, Math.min(e, msxText.length)),
    };
    const msxBridge = new LSPBridge(msxIndex, msxEngine, new PositionIndex(msxText), msxUri);
    const hover = msxBridge.hover(msxText.indexOf("computePid") + 2, msxText);
    assert.ok(hover, "Expected hover on computePid");
    assert.ok(
      hover.contents.includes("```modelscript\nfunction computePid(err: Real, dt: Real): Real\n```"),
      `Expected clean function signature without body, got:\n${hover.contents}`,
    );
    assert.ok(
      hover.contents.includes("Computes PID control effort with anti-windup clamping."),
      "Expected JSDoc comment in hover",
    );
  });

  await t.test(
    "Hover terminates without stack overflow on circular extends, mutual wildcard imports, and 50KB strings",
    () => {
      const cycUri = "file:///workspace/Cyclic.mo";
      const hugeHtml = "<p>" + "Sine wave documentation content ".repeat(1800) + "</p>";
      const cycText = `model CyclicA "Cyclic model A"
  extends CyclicB;
  import CyclicB.*;
  import CyclicA.*;
  CyclicB b(nonExistentMod = 1);
  UnresolvedPkg.UnresolvedSub.UnresolvedType u;
  annotation(Documentation(info="<html>${hugeHtml}</html>"));
end CyclicA;`;

      const cycSymbols = new Map<number, any>([
        [
          1,
          {
            id: 1,
            kind: "Class",
            name: "CyclicA",
            resourceId: cycUri,
            parentId: null,
            startOffset: 0,
            endOffset: cycText.length,
            inherits: ["CyclicB", "CyclicA.Sub"],
            metadata: { classPrefixes: "model" },
          },
        ],
        [
          2,
          {
            id: 2,
            kind: "Class",
            name: "CyclicB",
            resourceId: cycUri,
            parentId: null,
            startOffset: 0,
            endOffset: cycText.length,
            inherits: ["CyclicA"],
            metadata: { classPrefixes: "model" },
          },
        ],
        [3, { id: 3, kind: "Extends", name: "CyclicB", parentId: 1, metadata: { typeSpecifier: "CyclicB" } }],
        [4, { id: 4, kind: "Extends", name: "CyclicA", parentId: 2, metadata: { typeSpecifier: "CyclicA" } }],
        [5, { id: 5, kind: "Import", name: "CyclicB.*", parentId: 1 }],
        [6, { id: 6, kind: "Import", name: "CyclicA.*", parentId: 2 }],
        [
          7,
          {
            id: 7,
            kind: "Component",
            name: "b",
            resourceId: cycUri,
            parentId: 1,
            startOffset: cycText.indexOf("CyclicB b"),
            endOffset: cycText.indexOf("b(nonExistentMod = 1);") + "b(nonExistentMod = 1);".length,
            metadata: { typeSpecifier: "CyclicB" },
          },
        ],
      ]);

      const cycIndex: any = {
        symbols: cycSymbols,
        byName: new Map([
          ["CyclicA", [1]],
          ["CyclicB", [2]],
          ["b", [7]],
        ]),
        childrenOf: new Map<number | null, number[]>([
          [null, [1, 2]],
          [1, [3, 5, 7]],
          [2, [4, 6]],
        ]),
        symbolsByResource: new Map([[cycUri, [1, 2, 3, 4, 5, 6, 7]]]),
      };
      const cycEngine: any = {
        index: cycIndex,
        cstText: (s: number, e: number) => cycText.slice(s, Math.min(e, cycText.length)),
      };
      const cycBridge = new LSPBridge(cycIndex, cycEngine, new PositionIndex(cycText), cycUri);

      // 1. Hover on CyclicA with 50KB Documentation(info=...) and circular inheritance
      const hoverA = cycBridge.hover(cycText.indexOf("CyclicA") + 2, cycText);
      assert.ok(hoverA, "Expected hover on CyclicA without stack overflow");
      assert.ok(hoverA.contents.includes('model CyclicA "Cyclic model A"'));

      // 2. Hover on unresolved modifier inside b(nonExistentMod = 1) with circular inheritance
      const hoverMod = cycBridge.hover(cycText.indexOf("nonExistentMod") + 2, cycText);
      // Should return null or resolve cleanly without throwing Maximum call stack size exceeded
      assert.strictEqual(hoverMod, null);

      // 3. Hover on unresolved multi-segment qualified name with active wildcard imports
      const hoverUnres = cycBridge.hover(cycText.indexOf("UnresolvedType") + 2, cycText);
      assert.strictEqual(hoverUnres, null);
    },
  );
});
