// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { getAvailableFileIcons, getFileIconPath } from "../../../packages/editor/src/workbench/util/file-icons";

const available = getAvailableFileIcons();
assert.ok(available.has("modelica"), "Expected modelica.svg to be discovered in public/file-icons");
assert.ok(available.has("default"), "Expected default.svg to be discovered in public/file-icons");

// Language inferred from filename
assert.strictEqual(getFileIconPath("Circuit.mo"), "/file-icons/modelica.svg");
assert.strictEqual(getFileIconPath("System.sysml"), "/file-icons/sysml2.svg");
assert.strictEqual(getFileIconPath("Model.ampl"), "/file-icons/ampl.svg");
assert.strictEqual(getFileIconPath("Bracket.step"), "/file-icons/step.svg");
assert.strictEqual(getFileIconPath("Part.scad"), "/file-icons/scad.svg");
assert.strictEqual(getFileIconPath("Scene.usd"), "/file-icons/usd.svg");
assert.strictEqual(getFileIconPath("Filter.sp"), "/file-icons/spice.svg");

// Explicit language name overrides filename
assert.strictEqual(getFileIconPath("custom.txt", "modelica"), "/file-icons/modelica.svg");

// Language without dedicated SVG or unknown extension falls back to default.svg
assert.strictEqual(getFileIconPath("Grid.raw"), "/file-icons/default.svg");
assert.strictEqual(getFileIconPath("README.unknown"), "/file-icons/default.svg");
assert.strictEqual(getFileIconPath("notes.txt", "nonexistent-lang"), "/file-icons/default.svg");

console.log("morsel-file-icons.test.ts passed");
