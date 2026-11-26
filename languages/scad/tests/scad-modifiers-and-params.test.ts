// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import {
  applyScadOperationOverrides,
  buildScadFeatureTreeFromCst,
  countScadFeatureNodes,
  EMPTY_SCAD_FEATURE_OVERRIDES,
  evaluateScad,
  extractScadCadComponents,
  extractScadParametersFromCst,
  getScadParser,
  hasActiveScadOverrides,
  ScadEvaluator,
} from "../src/index.js";

const EXPECTED_GHOST_COLOR: [number, number, number, number] = [0.96, 0.28, 0.34, 0.38];

async function testModifiersDirect() {
  // 1. Suppress modifier (*): skips node completely
  const suppressedSource = `
cube([10, 10, 10]);
*translate([30, 0, 0]) sphere(r = 5);
`;
  const suppressedComps = await extractScadCadComponents(suppressedSource);
  assert.equal(suppressedComps.length, 1, "* modifier should suppress the second top-level solid");
  assert.ok(!suppressedComps[0]!.cad.uri.startsWith("scad://ghost/"));

  // 2. Isolate modifier (!): only isolated solid is returned
  const isolatedSource = `
cube([20, 20, 20]);
difference() {
  cube([15, 15, 15]);
  !cylinder(h = 25, r = 4);
}
`;
  const isolatedComps = await extractScadCadComponents(isolatedSource);
  assert.equal(isolatedComps.length, 1, "! modifier should isolate only the marked solid");
  assert.ok(
    isolatedComps[0]!.name.toLowerCase().includes("cylinder"),
    `Expected cylinder, got ${isolatedComps[0]!.name}`,
  );

  // 3. Debug modifier (#): evaluates normally in CSG AND emits ghost with expected color & scad://ghost/ URI
  const debugSource = `
difference() {
  cube([20, 20, 20], center = true);
  #cylinder(h = 30, r = 5, center = true);
}
`;
  const debugComps = await extractScadCadComponents(debugSource);
  assert.equal(debugComps.length, 2, "# modifier should emit main solid plus 1 debug ghost");
  const mainDebug = debugComps.filter((c) => !c.cad.uri.startsWith("scad://ghost/"));
  const ghostDebug = debugComps.filter((c) => c.cad.uri.startsWith("scad://ghost/"));
  assert.equal(mainDebug.length, 1, "Expected 1 main solid");
  assert.equal(ghostDebug.length, 1, "Expected 1 debug ghost solid");
  assert.deepEqual(ghostDebug[0]!.proceduralMesh.color, EXPECTED_GHOST_COLOR);

  // 4. Background modifier (%): skips adding to main CSG union AND emits ghost
  const bgSource = `
cube([10, 10, 10]);
%translate([25, 0, 0]) sphere(r = 6);
`;
  const bgComps = await extractScadCadComponents(bgSource);
  const mainBg = bgComps.filter((c) => !c.cad.uri.startsWith("scad://ghost/"));
  const ghostBg = bgComps.filter((c) => c.cad.uri.startsWith("scad://ghost/"));
  assert.equal(mainBg.length, 1, "% modifier should exclude node from main CSG union");
  assert.equal(ghostBg.length, 1, "% modifier should emit background ghost solid");
  assert.deepEqual(ghostBg[0]!.proceduralMesh.color, EXPECTED_GHOST_COLOR);
  assert.ok(ghostBg[0]!.cad.uri.startsWith("scad://ghost/"));

  // 5. Nested transform with % ghost preserves transform on ghost
  const nestedBgSource = `translate([12, 0, 0]) %cube([4, 4, 4]);`;
  const nestedBgComps = await extractScadCadComponents(nestedBgSource);
  assert.equal(nestedBgComps.length, 1, "Nested % ghost should still be emitted");
  assert.ok(nestedBgComps[0]!.cad.uri.startsWith("scad://ghost/"));
  assert.deepEqual(nestedBgComps[0]!.proceduralMesh.color, EXPECTED_GHOST_COLOR);
  assert.deepEqual(nestedBgComps[0]!.cad.position, [12, 0, 0]);

  // 6. Synchronous evaluateScad fallback parser also respects *, !, #, %
  const syncSuppressed = evaluateScad(`cube(10); *sphere(5);`);
  assert.equal(syncSuppressed.solids.length, 1, "evaluateScad should suppress * node");
  const syncIsolated = evaluateScad(`cube(10); !sphere(5);`);
  assert.equal(syncIsolated.solids.length, 1, "evaluateScad should isolate ! node");
  const syncBg = evaluateScad(`cube(10); %sphere(5);`);
  assert.equal(syncBg.solids.length, 1, "evaluateScad should exclude % node from main solids");
}

async function testOperationOverrides() {
  const parser = await getScadParser();
  const baseSource = `difference() {
  cube([20, 20, 20], center = true);
  cylinder(h = 30, r = 5, center = true);
}
translate([40, 0, 0]) sphere(r = 8);
`;
  const tree = parser.parse(baseSource);
  assert.ok(tree?.rootNode, "Failed to parse baseSource");
  const featureTree = buildScadFeatureTreeFromCst(tree.rootNode, baseSource);

  assert.equal(hasActiveScadOverrides(EMPTY_SCAD_FEATURE_OVERRIDES), false);
  assert.equal(countScadFeatureNodes(featureTree), 5, "Expected difference, cube, cylinder, translate, sphere");

  const diffNode = featureTree[0]!;
  const cylinderNode = diffNode.children[1]!;
  const translateNode = featureTree[1]!;

  // Suppress translateNode -> only difference remains
  const supOverrides = {
    suppressedIds: new Set([translateNode.id]),
    isolatedId: null,
    ghostIds: new Set<string>(),
  };
  assert.equal(hasActiveScadOverrides(supOverrides), true);
  const supSrc = applyScadOperationOverrides(baseSource, featureTree, supOverrides);
  assert.ok(supSrc.includes("*translate([40, 0, 0])"), `Expected * prefix, got:\n${supSrc}`);
  const supComps = await extractScadCadComponents(supSrc);
  assert.equal(supComps.length, 1, "Suppressed translate branch should leave only 1 component");

  // Isolate cylinderNode -> only cylinder remains
  const isoOverrides = {
    suppressedIds: new Set<string>(),
    isolatedId: cylinderNode.id,
    ghostIds: new Set<string>(),
  };
  const isoSrc = applyScadOperationOverrides(baseSource, featureTree, isoOverrides);
  assert.ok(isoSrc.includes("!cylinder("), `Expected ! prefix, got:\n${isoSrc}`);
  const isoComps = await extractScadCadComponents(isoSrc);
  assert.equal(isoComps.length, 1, "Isolated cylinder should yield 1 component");
  assert.ok(isoComps[0]!.name.toLowerCase().includes("cylinder"));

  // Ghost cylinderNode -> 2 main solids + 1 ghost solid
  const ghostOverrides = {
    suppressedIds: new Set<string>(),
    isolatedId: null,
    ghostIds: new Set([cylinderNode.id]),
  };
  const ghostSrc = applyScadOperationOverrides(baseSource, featureTree, ghostOverrides);
  assert.ok(ghostSrc.includes("#cylinder("), `Expected # prefix, got:\n${ghostSrc}`);
  const ghostComps = await extractScadCadComponents(ghostSrc);
  const ghosts = ghostComps.filter((c) => c.cad.uri.startsWith("scad://ghost/"));
  const mains = ghostComps.filter((c) => !c.cad.uri.startsWith("scad://ghost/"));
  assert.equal(mains.length, 2, "Main solids should still both be present");
  assert.equal(ghosts.length, 1, "Ghost override should emit 1 ghost solid");
  assert.deepEqual(ghosts[0]!.proceduralMesh.color, EXPECTED_GHOST_COLOR);

  // Verify ScadEvaluator directly reports ghost solids and isolated root
  const ghostTree = parser.parse(ghostSrc);
  const ev = new ScadEvaluator();
  ev.evaluateParts(ghostTree!.rootNode);
  assert.equal(ev.getGhostSolids().length, 1);
  assert.equal(ev.hasIsolatedRoot(), false);
}

async function testExtractScadParametersFromCst() {
  const parser = await getScadParser();
  const source = `// Parametric bracket
$fn = 48;
width = 60;
wall_thickness = 4.5;
z_offset = -12.25;
dims = [width, 20, 10];
label = "bracket";
derived = width * 2;
enabled = true;

module helper() {
  local_r = 3;
  sphere(r = local_r);
}

translate([0, 0, z_offset]) cube([width, wall_thickness, 10]);
`;

  const tree = parser.parse(source);
  assert.ok(tree?.rootNode, "Failed to parse parametric SCAD source");

  const params = extractScadParametersFromCst(tree.rootNode, source);
  assert.equal(params.length, 3, `Expected exactly 3 top-level scalar numeric params, got: ${JSON.stringify(params)}`);

  assert.equal(params[0]!.name, "width");
  assert.equal(params[0]!.value, 60);
  assert.equal(params[0]!.line, 3);
  assert.equal(source.slice(params[0]!.valueStartOffset, params[0]!.valueEndOffset), "60");
  assert.equal(source.slice(params[0]!.startOffset, params[0]!.endOffset), "width = 60;");

  assert.equal(params[1]!.name, "wall_thickness");
  assert.equal(params[1]!.value, 4.5);
  assert.equal(params[1]!.line, 4);
  assert.equal(source.slice(params[1]!.valueStartOffset, params[1]!.valueEndOffset), "4.5");
  assert.equal(source.slice(params[1]!.startOffset, params[1]!.endOffset), "wall_thickness = 4.5;");

  assert.equal(params[2]!.name, "z_offset");
  assert.equal(params[2]!.value, -12.25);
  assert.equal(params[2]!.line, 5);
  assert.equal(source.slice(params[2]!.valueStartOffset, params[2]!.valueEndOffset), "-12.25");
  assert.equal(source.slice(params[2]!.startOffset, params[2]!.endOffset), "z_offset = -12.25;");
}

async function main() {
  await testModifiersDirect();
  await testOperationOverrides();
  await testExtractScadParametersFromCst();
  console.log("All SCAD modifier, override, and parameter extraction tests passed!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
