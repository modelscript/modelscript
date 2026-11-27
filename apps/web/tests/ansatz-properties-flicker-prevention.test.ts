// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Ansatz Properties Panel Zero-Flicker & Smooth Synchronization", () => {
  const ansatzPath = path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/AnsatzEditor.tsx");
  const propertiesPath = path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/Properties.tsx");
  const diagramDir = path.resolve(import.meta.dirname, "../../../packages/diagram/src");
  const readDiagramSrc = () =>
    [
      "index.ts",
      "graph-state.ts",
      "canvas-state.ts",
      "canvas-render.ts",
      "canvas-render-normalize.ts",
      "canvas-ui-handlers.ts",
      "canvas-node-editing.ts",
    ]
      .map((f) => fs.readFileSync(path.join(diagramDir, f), "utf-8"))
      .join("\n");

  it("verifies Ansatz.tsx maintains refs for selectedComponent and selectedComponentProperties", () => {
    const ansatzSrc = fs.readFileSync(ansatzPath, "utf-8");
    assert.ok(
      ansatzSrc.includes("const selectedComponentRef = useRef<string | null>(selectedComponent)"),
      "Ansatz must define selectedComponentRef to prevent stale closures",
    );
    assert.ok(
      ansatzSrc.includes("selectedComponentPropertiesRef = useRef<") &&
        ansatzSrc.includes("(selectedComponentProperties)"),
      "Ansatz must define selectedComponentPropertiesRef to check active property depth",
    );
  });

  it("verifies handleSelectComponent guards against skeleton downgrades during diagram re-renders", () => {
    const ansatzSrc = fs.readFileSync(ansatzPath, "utf-8");
    assert.ok(
      ansatzSrc.includes("const isSameComponent = selectedComponentRef.current === name;"),
      "handleSelectComponent must detect when the event targets the already-selected component",
    );
    assert.ok(
      ansatzSrc.includes("const hasRichProps = isRichProps(currentProps);"),
      "handleSelectComponent must check whether rich properties are already loaded",
    );
    assert.ok(
      ansatzSrc.includes("const isSkeleton = Boolean(") && ansatzSrc.includes("!isRichProps("),
      "handleSelectComponent must identify lightweight skeleton properties",
    );
    assert.ok(
      ansatzSrc.includes("isSameComponent && hasRichProps && (") && ansatzSrc.includes("|| isSkeleton)"),
      "handleSelectComponent must guard against skeleton downgrades for the active component",
    );
  });

  it("verifies enqueueDiagramAction optimistically updates values in selectedComponentProperties", () => {
    const ansatzSrc = fs.readFileSync(ansatzPath, "utf-8");
    assert.ok(
      ansatzSrc.includes("enqueueDiagramAction") &&
        ansatzSrc.includes("Optimistically update selectedComponentProperties"),
      "enqueueDiagramAction must optimistically update selectedComponentProperties",
    );
  });

  it("verifies packages/diagram caches rich properties in showProperties", () => {
    const diagramSrc = readDiagramSrc();
    assert.ok(
      diagramSrc.includes("propertyCache") && diagramSrc.includes("getPropertyCache"),
      "packages/diagram must maintain propertyCache for rich properties",
    );
  });

  it("verifies diagram diff reconciliation preserves property panel without skeleton flashes", () => {
    const diagramSrc = readDiagramSrc();
    assert.ok(
      diagramSrc.includes("getPropertyCache") && diagramSrc.includes("propertyCache"),
      "Diagram reconciler must maintain propertyCache for property panel updates",
    );
  });

  it("verifies Properties.tsx guards local value sync against redundant state resets", () => {
    const propsSrc = fs.readFileSync(propertiesPath, "utf-8");
    assert.ok(
      propsSrc.includes("if (nextVal !== localVal && nextVal !== lastCommittedRef.current)"),
      "SchemaFieldRow must not overwrite localVal if it matches current or last committed value",
    );
    assert.ok(
      propsSrc.includes("if (value !== localValue && value !== lastCommittedRef.current)"),
      "ParameterRow must not overwrite localValue if it matches current or last committed value",
    );
  });

  it("verifies Properties.tsx narrows liveIconSvg dependencies to primitive fields", () => {
    const propsSrc = fs.readFileSync(propertiesPath, "utf-8");
    assert.ok(
      propsSrc.includes("applyLivePropertyIconSubstitutions") && propsSrc.includes("properties?.iconSvg"),
      "liveIconSvg must use applyLivePropertyIconSubstitutions with properties?.iconSvg",
    );
  });

  it("verifies Properties.tsx skips remote sync when serialized values are unchanged", () => {
    const propsSrc = fs.readFileSync(propertiesPath, "utf-8");
    assert.ok(
      propsSrc.includes("prevRemoteValuesRef") && propsSrc.includes("serialized === prevRemoteValuesRef.current"),
      "PropertiesWidget must skip syncing remote values when content is identical",
    );
  });
});
