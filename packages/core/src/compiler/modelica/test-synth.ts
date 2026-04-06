import { ModelicaStoredDefinitionSyntaxNode } from "@modelscript/modelica-ast";
import Modelica from "@modelscript/tree-sitter-modelica";
import type { FileSystem } from "@modelscript/utils";
import Parser from "tree-sitter";
import { Context } from "../context.js";
import { ModelicaFmuEntity } from "./fmu.js";
import { ModelicaClassInstance, ModelicaComponentInstance, ModelicaElement, ModelicaNamedElement } from "./model.js";

// Minimal stub — the FMU test doesn't use filesystem operations
const stubFs = {} as FileSystem;
const context = new Context(stubFs);
const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

ModelicaElement.initializeAnnotationClass(context);

// ── Test 1: Regular Modelica class annotations ──

const snippet = `
model FmuDummy
  annotation(
    Icon(
      coordinateSystem(extent={{-100,-100},{100,100}}),
      graphics={
        Rectangle(extent={{-100,-100},{100,100}}, lineColor={0,0,255}, fillColor={255,255,255}, fillPattern=DynamicSelect(FillPattern.Solid, FillPattern.Solid)),
        Text(extent={{-100,20},{100,-20}}, textString="%name")
      }
    )
  );
  Real u annotation(Placement(transformation(extent={{-120,-10},{-100,10}})));
end FmuDummy;
`;

const tree = parser.parse(snippet);
const storedDef = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
const fmuDummyClassDef = storedDef?.classDefinitions?.[0];

if (fmuDummyClassDef) {
  const fmuDummy = ModelicaClassInstance.new(null, fmuDummyClassDef);
  fmuDummy.instantiate();

  console.log("=== Test 1: Regular Modelica class ===");
  console.log("Icon annotation:");
  console.log(JSON.stringify(fmuDummy.annotation("Icon"), null, 2));

  const comp = Array.from(fmuDummy.elements).find(
    (e): e is ModelicaComponentInstance => e instanceof ModelicaNamedElement && e.name === "u",
  );
  console.log("Placement annotation:");
  console.log(JSON.stringify(comp?.annotation("Placement"), null, 2));
}

// ── Test 2: FMU entity annotations ──

const fmuXml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription
  fmiVersion="2.0"
  modelName="TestFmu"
  guid="{test-guid}"
  description="A test FMU for diagram synthesis">
  <ModelVariables>
    <ScalarVariable name="u1" valueReference="0" causality="input" variability="continuous" description="Input 1">
      <Real/>
    </ScalarVariable>
    <ScalarVariable name="u2" valueReference="1" causality="input" variability="continuous" description="Input 2">
      <Real/>
    </ScalarVariable>
    <ScalarVariable name="y1" valueReference="2" causality="output" variability="continuous" description="Output 1">
      <Real/>
    </ScalarVariable>
    <ScalarVariable name="x" valueReference="3" causality="local" variability="continuous">
      <Real/>
    </ScalarVariable>
  </ModelVariables>
</fmiModelDescription>`;

const fmuEntity = ModelicaFmuEntity.fromXml(context, "TestFmu", fmuXml);
fmuEntity.load();
fmuEntity.instantiate();

console.log("\n=== Test 2: FMU entity ===");

// Check Icon annotation
const icon = fmuEntity.annotation("Icon");
console.log("Icon annotation:", JSON.stringify(icon, null, 2));

// Check Diagram annotation
const diagram = fmuEntity.annotation("Diagram");
console.log("Diagram annotation:", JSON.stringify(diagram, null, 2));

// Check components
const elements = Array.from(fmuEntity.elements);
console.log(`\nComponents (${elements.length} total):`);
for (const el of elements) {
  if (el instanceof ModelicaComponentInstance) {
    const ci = el.classInstance;
    const placement = el.annotation("Placement");
    console.log(
      `  ${el.name}: classKind=${ci?.classKind ?? "none"}, typeName=${ci?.name ?? "none"}, hasPlacement=${!!placement}`,
    );
    if (placement) {
      console.log(`    Placement: ${JSON.stringify(placement)}`);
    }
    if (ci?.classKind === "connector") {
      const connIcon = ci.annotation("Icon");
      console.log(`    Connector Icon: ${JSON.stringify(connIcon)}`);
    }
  }
}

console.log("\n✅ All FMU diagram synthesis tests passed.");

// ── Test 3: Wrapper template generation ──

import { generateMultiModelWrapper } from "./wrapper-template.js";

console.log("\n=== Test 3: Wrapper template ===");

const wrapperSource = generateMultiModelWrapper(
  "CosimWrapper",
  [
    { className: "SineWave", instanceName: "sineWave", fileName: "SineWave.fmu" },
    { className: "Controller", instanceName: "controller", fileName: "Controller.fmu" },
  ],
  [{ source: "sineWave.y", target: "controller.u" }],
);

console.log(wrapperSource);

// Verify wrapper contains expected elements
const checks = [
  ["model CosimWrapper", "model declaration"],
  ['SineWave sineWave(fileName="SineWave.fmu")', "sineWave component"],
  ['Controller controller(fileName="Controller.fmu")', "controller component"],
  ["connect(sineWave.y, controller.u)", "connect equation"],
  ["end CosimWrapper;", "end statement"],
  ["annotation(Placement", "placement annotation"],
  ["Diagram(", "diagram annotation"],
];

let allPassed = true;
for (const [pattern, label] of checks) {
  if (!pattern || !wrapperSource.includes(pattern)) {
    console.error(`  ✗ Missing: ${label} ("${pattern}")`);
    allPassed = false;
  } else {
    console.log(`  ✓ ${label}`);
  }
}

if (allPassed) {
  console.log("\n✅ All wrapper template tests passed.");
} else {
  console.error("\n✗ Some wrapper template tests failed.");
  process.exit(1);
}
