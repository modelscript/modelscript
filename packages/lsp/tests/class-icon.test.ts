// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import {
  AnnotationEvaluator,
  evaluateConnectLineWasm,
  evaluateDiagramWasm,
  evaluateIconWasm,
  evaluatePlacementWasm,
  getClassIconSvg,
  renderIconSvgWasm,
} from "@modelscript/modelica/diagram";
import assert from "assert";
import { readFileSync } from "fs";
import test, { before, describe } from "node:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { DocumentManager } from "../src/services/document-manager.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

import { FIELD_NAMES, SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");

describe("Class Icon Tests", () => {
  before(async () => {
    const wasmPath = resolve(repoRoot, "languages/modelica/dist/parser.wasm");
    const wasmBytes = readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes, {
      syntaxNames: modelicaSyntaxNames,
      fieldNames: FIELD_NAMES,
    });
    (globalThis as any).modelicaParser = parser;
  });

  test("test-class-icon", async () => {
    console.log("Starting test-class-icon...");

    const parser = (globalThis as any).modelicaParser;
    const docManager = new DocumentManager();
    const wm = new WorkspaceManager(docManager);

  // Load Resistor.mo
  const resistorPath = resolve(
    repoRoot,
    "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Basic/Resistor.mo",
  );
  const resistorText = readFileSync(resistorPath, "utf-8");

  // Register in sharedFs
  (globalThis as any).sharedFs = {
    exists: (p: string) => true,
    read: (p: string) => resistorText,
  };

  wm.unifiedWorkspace.registerWorkspace("modelica", wm.globalWorkspaceIndex);

  const tree = parser.parse(resistorText);
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Electrical/Analog/Basic/Resistor.mo",
    () => tree.rootNode,
    "Modelica.Electrical.Analog.Basic",
  );
  wm.globalWorkspaceIndex.ensureIndexed("modelica:/lib/Modelica/Electrical/Analog/Basic/Resistor.mo");
  wm.unifiedWorkspace.ensureChildrenIndexed("Modelica.Electrical.Analog.Basic");

  const partialIdx = wm.unifiedWorkspace.toUnifiedPartial();
  console.log("Index symbols count:", partialIdx.symbols.size);
  for (const [id, e] of partialIdx.symbols) {
    console.log(`Symbol ${id}: name=${e.name}, kind=${e.kind}, res=${e.resourceId}`);
  }
  console.log("byName keys:", Array.from(partialIdx.byName.keys()));

  console.log("Resolving Modelica.Electrical.Analog.Basic.Resistor...");
  const cls = wm.resolveModelicaClassInstance(
    "modelica:/lib/Modelica/Electrical/Analog/Basic/Resistor.mo",
    "Modelica.Electrical.Analog.Basic.Resistor",
  );

  assert(cls, "Resolved class instance must not be null");
  assert.strictEqual(cls.name, "Resistor", "Class name must be Resistor");

  const icon = cls.annotation("Icon");
  console.log("Icon graphics count:", icon?.graphics?.length);
  assert(icon, "Icon annotation must not be null");
  assert.strictEqual(icon["@type"], "Icon", "Icon type must be Icon");
  assert(Array.isArray(icon.graphics) && icon.graphics.length > 0, "Icon must have graphics");

  const heatPortLine = icon.graphics.find(
    (g: any) =>
      g["@type"] === "Line" &&
      Array.isArray(g.points) &&
      g.points.length === 2 &&
      g.points[0]?.[0] === 0 &&
      g.points[0]?.[1] === -100,
  );
  assert(heatPortLine, "Resistor Icon must include the conditional heatPort Line");
  assert.strictEqual(heatPortLine.visible, false, "Resistor heatPort Line must have visible === false by default");

  const svg = getClassIconSvg(cls, 20, false);
  console.log("Generated SVG length:", svg?.length);
  assert(svg, "getClassIconSvg must return non-null SVG string");
  assert(svg.startsWith("<svg"), "SVG must start with <svg");
  assert(svg.includes("<path"), "SVG must contain graphic elements like <path");
  assert(svg.includes('visibility="hidden"'), 'SVG must mark conditional heatPort line as visibility="hidden"');
  console.log("test-class-icon passed successfully!");
});

test("test-package-icon", async () => {
  console.log("Starting test-package-icon...");
  const docManager = new DocumentManager();
  const wm = new WorkspaceManager(docManager);

  const electricalPath = resolve(repoRoot, "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/package.mo");
  const electricalText = readFileSync(electricalPath, "utf-8");
  const iconsPath = resolve(repoRoot, "data/libraries/Modelica/4.1.0/extracted/Modelica/Icons.mo");
  const iconsText = readFileSync(iconsPath, "utf-8");

  (globalThis as any).sharedFs = {
    exists: () => true,
    read: (p: string) => {
      if (p.includes("Icons")) return iconsText;
      return electricalText;
    },
  };

  wm.unifiedWorkspace.registerWorkspace("modelica", wm.globalWorkspaceIndex);

  const electricalTree = (globalThis as any).modelicaParser.parse(electricalText);
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Electrical/package.mo",
    () => electricalTree.rootNode,
    "Modelica",
  );
  const iconsTree = (globalThis as any).modelicaParser.parse(iconsText);
  wm.globalWorkspaceIndex.register("modelica:/lib/Modelica/Icons.mo", () => iconsTree.rootNode, "Modelica");

  wm.globalWorkspaceIndex.ensureIndexed("modelica:/lib/Modelica/Electrical/package.mo");
  wm.globalWorkspaceIndex.ensureIndexed("modelica:/lib/Modelica/Icons.mo");
  wm.unifiedWorkspace.ensureChildrenIndexed("Modelica");

  const cls = wm.resolveModelicaClassInstance("modelica:/lib/Modelica/Electrical/package.mo", "Modelica.Electrical");

  assert(cls, "Resolved class instance for Modelica.Electrical must not be null");
  assert(cls.extendsClassInstances?.length > 0, "Modelica.Electrical must have extendsClassInstances");
  assert.strictEqual(
    cls.extendsClassInstances[0]?.classInstance?.name,
    "Package",
    "Base class must resolve to Modelica.Icons.Package",
  );
  const icon = cls.annotation("Icon");
  assert(icon, "Modelica.Electrical must have an Icon annotation");
  const svg = getClassIconSvg(cls, 20, false);
  assert(svg && svg.startsWith("<svg"), "Modelica.Electrical must produce a valid SVG icon");
  assert(svg.includes("linearGradient"), "SVG must include gradient definition for cylinder fill");
  assert(svg.includes("A 25 25"), "SVG must include rounded corners (radius 25) from Modelica.Icons.Package");
  assert(svg.includes("<line"), "SVG must include electrical circuit line graphics");
  console.log("test-package-icon passed successfully! SVG length:", svg.length);
});

test("test-nested-package-icons", async () => {
  console.log("Starting test-nested-package-icons...");
  const docManager = new DocumentManager();
  const wm = new WorkspaceManager(docManager);

  const electricalPath = resolve(repoRoot, "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/package.mo");
  const electricalText = readFileSync(electricalPath, "utf-8");
  const analogPath = resolve(repoRoot, "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/package.mo");
  const analogText = readFileSync(analogPath, "utf-8");
  const basicPath = resolve(
    repoRoot,
    "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Basic/package.mo",
  );
  const basicText = readFileSync(basicPath, "utf-8");
  const iconsPath = resolve(repoRoot, "data/libraries/Modelica/4.1.0/extracted/Modelica/Icons.mo");
  const iconsText = readFileSync(iconsPath, "utf-8");

  (globalThis as any).sharedFs = {
    exists: () => true,
    read: (p: string) => {
      if (p.includes("Icons")) return iconsText;
      if (p.includes("Basic")) return basicText;
      if (p.includes("Analog")) return analogText;
      return electricalText;
    },
  };

  wm.unifiedWorkspace.registerWorkspace("modelica", wm.globalWorkspaceIndex);

  // Register lazy loaders (simulating on-demand lazy indexing without pre-indexing Icons.mo)
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Electrical/package.mo",
    () => (globalThis as any).modelicaParser.parse(electricalText).rootNode,
    "Modelica",
  );
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Electrical/Analog/package.mo",
    () => (globalThis as any).modelicaParser.parse(analogText).rootNode,
    "Modelica.Electrical",
  );
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Electrical/Analog/Basic/package.mo",
    () => (globalThis as any).modelicaParser.parse(basicText).rootNode,
    "Modelica.Electrical.Analog",
  );
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Icons.mo",
    () => (globalThis as any).modelicaParser.parse(iconsText).rootNode,
    "Modelica",
  );

  // 1. Resolve Analog package
  const analogCls = wm.resolveModelicaClassInstance("file:///", "Modelica.Electrical.Analog");
  assert(analogCls, "Modelica.Electrical.Analog must resolve");
  assert(analogCls.extendsClassInstances?.length > 0, "Analog must have extendsClassInstances");
  const analogSvg = getClassIconSvg(analogCls, 20, false);
  assert(analogSvg && analogSvg.startsWith("<svg"), "Analog SVG must be generated");
  assert(analogSvg.includes("linearGradient"), "Analog SVG must include cylinder gradient");
  assert(
    analogSvg.includes("A 25 25"),
    "Analog SVG must include rounded corners (radius 25) from Modelica.Icons.Package",
  );
  assert(analogSvg.includes("<line"), "Analog SVG must include capacitor line graphics");

  // 2. Resolve Basic package
  const basicCls = wm.resolveModelicaClassInstance("file:///", "Modelica.Electrical.Analog.Basic");
  assert(basicCls, "Modelica.Electrical.Analog.Basic must resolve");
  assert(basicCls.extendsClassInstances?.length > 0, "Basic must have extendsClassInstances");
  const basicSvg = getClassIconSvg(basicCls, 20, false);
  assert(basicSvg && basicSvg.startsWith("<svg"), "Basic SVG must be generated");
  assert(basicSvg.includes("linearGradient"), "Basic SVG must include cylinder gradient");
  assert(
    basicSvg.includes("A 25 25"),
    "Basic SVG must include rounded corners (radius 25) from Modelica.Icons.Package",
  );
  assert(basicSvg.includes("<line"), "Basic SVG must include basic component line graphics");

  console.log("test-nested-package-icons passed successfully!");
});

test("test-wasm-icon-kernel", async () => {
  console.log("Starting test-wasm-icon-kernel...");
  const parser = (globalThis as any).modelicaParser;
  assert(parser, "modelicaParser must be initialized");

  const findClassDef = (node: any): any => {
    if (!node) return null;
    if (node.type === "class_definition") return node;
    for (const ch of node.children || []) {
      const found = findClassDef(ch);
      if (found) return found;
    }
    return null;
  };

  // 1. Test Capacitor.mo (literal Icon graphics + Text -> evaluated in WASM)
  const capacitorPath = resolve(
    repoRoot,
    "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Basic/Capacitor.mo",
  );
  const capacitorText = readFileSync(capacitorPath, "utf-8");
  const capTree = parser.parse(capacitorText);
  const capClassNode = findClassDef(capTree.rootNode);
  assert(capClassNode, "Capacitor class_definition CST node must be found");

  const wasmCapIcon = evaluateIconWasm(capClassNode);
  assert(wasmCapIcon, "evaluateIconWasm must evaluate Capacitor.mo in WASM without fallback");
  assert.strictEqual(wasmCapIcon["@type"], "Icon");
  assert.strictEqual(wasmCapIcon.graphics?.length, 6, "Capacitor must have 6 graphic items");
  assert.strictEqual(wasmCapIcon.graphics[0]["@type"], "Line");
  assert.strictEqual(wasmCapIcon.graphics[4]["@type"], "Text");
  assert.strictEqual(wasmCapIcon.graphics[4].textString, "C=%C");
  assert.strictEqual(wasmCapIcon.graphics[5].textString, "%name");

  // 2. Test pure geometric icon directly serialized in WASM via renderIconSvgWasm
  const pureGeoSource = `model PureGeoIcon
    annotation(Icon(coordinateSystem(extent={{-100,-100},{100,100}}), graphics={
      Rectangle(extent={{-70,30},{70,-30}}, lineColor={0,0,255}, fillColor={255,255,255}, fillPattern=FillPattern.Solid),
      Line(points={{-90,0},{-70,0}}, color={0,0,255})
    }));
  end PureGeoIcon;`;
  const geoTree = parser.parse(pureGeoSource);
  const geoClassNode = findClassDef(geoTree.rootNode);
  assert(geoClassNode, "PureGeoIcon class_definition CST node must be found");
  const wasmSvg = renderIconSvgWasm(geoClassNode, 20);
  assert(wasmSvg && wasmSvg.startsWith("<svg"), "renderIconSvgWasm must serialize pure geometric icon in WASM");
  assert(wasmSvg.includes("<path"), "WASM SVG must include <path for Rectangle");
  assert(wasmSvg.includes("<line"), "WASM SVG must include <line for Line");

  // 3. Test Resistor.mo (has dynamic visible=useHeatPort -> bails out cleanly to undefined so TS evaluator handles it)
  const resistorPath = resolve(
    repoRoot,
    "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Basic/Resistor.mo",
  );
  const resistorText = readFileSync(resistorPath, "utf-8");
  const resTree = parser.parse(resistorText);
  const resClassNode = findClassDef(resTree.rootNode);
  assert(resClassNode, "Resistor class_definition CST node must be found");
  const wasmResIcon = evaluateIconWasm(resClassNode);
  assert.strictEqual(
    wasmResIcon,
    undefined,
    "Resistor with dynamic visible=useHeatPort must return undefined for TS fallback",
  );
  const tsFallbackIcon = new AnnotationEvaluator().evaluate(resClassNode, "Icon");
  assert(tsFallbackIcon && tsFallbackIcon.graphics?.length === 6, "TS fallback must evaluate all 6 Resistor items");

  // 4. Test evaluateDiagramWasm, evaluatePlacementWasm, and evaluateConnectLineWasm
  const diagramSource = `model TestDiagramWasm
    Resistor R1 annotation(Placement(visible=true, transformation(origin={-20, 40}, extent={{-10,-10},{10,10}}, rotation=90), iconTransformation(origin={0, 10}, extent={{-5,-5},{5,5}}, rotation=180)));
  equation
    connect(R1.p, R1.n) annotation(Line(points={{-20,50},{-20,60},{20,60},{20,30},{-20,30}}, color={0,0,255}, thickness=0.5, pattern=LinePattern.Dash, smooth=Smooth.Bezier, arrow={Arrow.None, Arrow.Filled}, arrowSize=4));
    annotation(Diagram(coordinateSystem(preserveAspectRatio=false, extent={{-120,-80},{120,80}}), graphics={
      Rectangle(extent={{-100,60},{100,-60}}, lineColor={0,0,0})
    }));
  end TestDiagramWasm;`;
  const diagTree = parser.parse(diagramSource);
  const diagClassNode = findClassDef(diagTree.rootNode);
  assert(diagClassNode, "TestDiagramWasm class_definition CST node must be found");

  const wasmDiag = evaluateDiagramWasm(diagClassNode);
  assert(wasmDiag, "evaluateDiagramWasm must evaluate Diagram annotation in WASM");
  assert.strictEqual(wasmDiag["@type"], "Diagram");
  assert.deepStrictEqual(wasmDiag.coordinateSystem?.extent, [
    [-120, -80],
    [120, 80],
  ]);
  assert.strictEqual(wasmDiag.coordinateSystem?.preserveAspectRatio, false);
  assert.strictEqual(wasmDiag.graphics?.length, 1);
  assert.strictEqual(wasmDiag.graphics[0]["@type"], "Rectangle");

  const findByType = (node: any, targetType: string): any => {
    if (!node) return null;
    if (node.type === targetType) return node;
    for (const ch of node.children || []) {
      const found = findByType(ch, targetType);
      if (found) return found;
    }
    return null;
  };

  const compDeclNode = findByType(diagClassNode, "component_declaration");
  assert(compDeclNode, "component_declaration CST node must be found");
  const wasmPlacement = evaluatePlacementWasm(compDeclNode);
  assert(wasmPlacement, "evaluatePlacementWasm must evaluate Placement annotation in WASM");
  assert.strictEqual(wasmPlacement["@type"], "Placement");
  assert.strictEqual(wasmPlacement.visible, true);
  assert.deepStrictEqual(wasmPlacement.transformation?.origin, [-20, 40]);
  assert.deepStrictEqual(wasmPlacement.transformation?.extent, [
    [-10, -10],
    [10, 10],
  ]);
  assert.strictEqual(wasmPlacement.transformation?.rotation, 90);
  assert.deepStrictEqual(wasmPlacement.iconTransformation?.origin, [0, 10]);
  assert.strictEqual(wasmPlacement.iconTransformation?.rotation, 180);

  const someEqNode = findByType(diagClassNode, "some_equation");
  assert(someEqNode, "some_equation CST node must be found");
  const wasmLine = evaluateConnectLineWasm(someEqNode);
  assert(wasmLine, "evaluateConnectLineWasm must evaluate connect Line annotation in WASM");
  assert.strictEqual(wasmLine["@type"], "Line");
  assert.strictEqual(wasmLine.points?.length, 5);
  assert.deepStrictEqual(wasmLine.color, [0, 0, 255]);
  assert.strictEqual(wasmLine.thickness, 0.5);
  assert.strictEqual(wasmLine.pattern, "Dash");
  assert.strictEqual(wasmLine.smooth, "Bezier");
  assert.deepStrictEqual(wasmLine.arrow, ["None", "Filled"]);
  assert.strictEqual(wasmLine.arrowSize, 4);

  // 5. Test matrix syntax [x1, y1; x2, y2], multiple Icon clauses, positional color, %name macro, arrows, and text styles in WASM
  const advancedWasmSource = `model AdvancedWasmIcon
    annotation(Icon(coordinateSystem(extent=[-100, -100; 100, 100]), graphics={
      Rectangle(extent=[-60, -40; 60, 40], lineColor=[0, 128, 255], fillColor=[240, 248, 255], fillPattern=FillPattern.Solid),
      Line(true, [-80, 0; 0, 20; 80, 0], [255, 0, 0], arrow={Arrow.Open, Arrow.Filled}, arrowSize=5)
    }));
    annotation(Icon(graphics={
      Text(extent=[-100, 50; 100, 90], textString="Model: %name (100%%)", fontName="monospace", textStyle={TextStyle.Bold, TextStyle.Italic, TextStyle.Underline}, textColor=[10, 20, 30])
    }));
  end AdvancedWasmIcon;`;
  const advTree = parser.parse(advancedWasmSource);
  const advClassNode = findClassDef(advTree.rootNode);
  assert(advClassNode, "AdvancedWasmIcon class_definition CST node must be found");

  const wasmAdvIcon = evaluateIconWasm(advClassNode);
  assert(wasmAdvIcon, "evaluateIconWasm must evaluate matrix syntax and multiple Icon clauses in WASM");
  assert.strictEqual(wasmAdvIcon.graphics?.length, 3, "Multiple Icon clauses must concatenate all 3 graphics items");
  assert.deepStrictEqual(wasmAdvIcon.graphics[0].extent, [
    [-60, -40],
    [60, 40],
  ]);
  assert.deepStrictEqual(wasmAdvIcon.graphics[0].lineColor, [0, 128, 255]);
  assert.deepStrictEqual(wasmAdvIcon.graphics[1].points, [
    [-80, 0],
    [0, 20],
    [80, 0],
  ]);
  assert.deepStrictEqual(wasmAdvIcon.graphics[1].color, [255, 0, 0]);
  assert.deepStrictEqual(wasmAdvIcon.graphics[2].style, ["Bold", "Italic", "Underline"]);
  assert.strictEqual(wasmAdvIcon.graphics[2].fontName, "monospace");

  const advSvg = renderIconSvgWasm(advClassNode, 20, "AdvancedWasmIcon");
  assert(advSvg && advSvg.startsWith("<svg"), "renderIconSvgWasm must serialize AdvancedWasmIcon in WASM");
  assert(advSvg.includes("Model: AdvancedWasmIcon (100%)"), "WASM SVG must expand %name and %% macros");
  assert(advSvg.includes("<marker id=\"ms-mks-"), "WASM SVG must emit start arrow marker definition");
  assert(advSvg.includes("<marker id=\"ms-mke-"), "WASM SVG must emit end arrow marker definition");
  assert(advSvg.includes('marker-start="url(#ms-mks-'), "WASM SVG polyline must reference start arrow marker");
  assert(advSvg.includes('marker-end="url(#ms-mke-'), "WASM SVG polyline must reference end arrow marker");
  assert(advSvg.includes('font-family="monospace"'), "WASM SVG text must include custom font-family");
  assert(advSvg.includes('font-weight="bold"'), "WASM SVG text must include bold weight");
  assert(advSvg.includes('font-style="italic"'), "WASM SVG text must include italic style");
  assert(advSvg.includes('text-decoration="underline"'), "WASM SVG text must include underline decoration");

  console.log("test-wasm-icon-kernel passed successfully!");
});
});
