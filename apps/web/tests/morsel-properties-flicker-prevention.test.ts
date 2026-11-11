// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Morsel Properties Panel Zero-Flicker & Smooth Synchronization", () => {
  const morselPath = path.resolve(import.meta.dirname, "../src/components/morsel/Morsel.tsx");
  const propertiesPath = path.resolve(import.meta.dirname, "../src/components/morsel/Properties.tsx");
  const diagramIndexPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/index.ts");

  it("verifies Morsel.tsx maintains refs for selectedComponent and selectedComponentProperties", () => {
    const morselSrc = fs.readFileSync(morselPath, "utf-8");
    assert.ok(
      morselSrc.includes("const selectedComponentRef = useRef<string | null>(selectedComponent)"),
      "Morsel must define selectedComponentRef to prevent stale closures",
    );
    assert.ok(
      morselSrc.includes("const selectedComponentPropertiesRef = useRef<any | null>(selectedComponentProperties)"),
      "Morsel must define selectedComponentPropertiesRef to check active property depth",
    );
  });

  it("verifies handleSelectComponent guards against skeleton downgrades during diagram re-renders", () => {
    const morselSrc = fs.readFileSync(morselPath, "utf-8");
    assert.ok(
      morselSrc.includes("const isSameComponent = selectedComponentRef.current === name;"),
      "handleSelectComponent must detect when the event targets the already-selected component",
    );
    assert.ok(
      morselSrc.includes("const hasRichProps = Boolean("),
      "handleSelectComponent must check whether rich properties are already loaded",
    );
    assert.ok(
      morselSrc.includes("const isSkeleton = Boolean(cachedProps && !cachedProps.schema && !cachedProps.parameters);"),
      "handleSelectComponent must identify lightweight skeleton properties",
    );
    assert.ok(
      morselSrc.includes("isSameComponent && hasRichProps && (cachedProps === undefined || isSkeleton)"),
      "handleSelectComponent must guard against skeleton downgrades for the active component",
    );
  });

  it("verifies enqueueDiagramAction optimistically updates values in selectedComponentProperties", () => {
    const morselSrc = fs.readFileSync(morselPath, "utf-8");
    assert.ok(
      morselSrc.includes("values:") && morselSrc.includes("[paramKey]: action.value"),
      "enqueueDiagramAction must optimistically update values dictionary for schema-driven tabs",
    );
  });

  it("verifies packages/diagram/src/index.ts caches rich properties in showProperties", () => {
    const diagramSrc = fs.readFileSync(diagramIndexPath, "utf-8");
    assert.ok(
      diagramSrc.includes("p.schema || p.parameters") &&
        diagramSrc.includes("propertyCache.set(nodeData.id, nodeData.properties)"),
      "showProperties must cache rich properties into propertyCache",
    );
  });

  it("verifies diagram diff reconciliation preserves property panel without skeleton flashes", () => {
    const diagramSrc = fs.readFileSync(diagramIndexPath, "utf-8");
    assert.ok(
      diagramSrc.includes("In diff updates, existing DOM/cells are preserved in place; do not downgrade"),
      "Diagram reconciler must document flicker prevention in diff updates",
    );
    assert.ok(
      diagramSrc.includes("const cached = propertyCache.get(selectedNodeId);") &&
        diagramSrc.includes("showProperties({ id: restoredNode.id, properties: cached, isLoading: false }, g);"),
      "Diagram reconciler must restore cached properties without isLoading: true",
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
      propsSrc.includes("[properties?.iconSvg, properties?.name, localValues, localName]"),
      "liveIconSvg must depend on primitive properties iconSvg and name to avoid unnecessary SVG recomputations",
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
