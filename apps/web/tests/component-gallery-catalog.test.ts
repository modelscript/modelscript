// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CURATED_ANSATZ_PACKAGES,
  DOMAIN_FILTERS,
  GALLERY_COMPONENTS,
  inferDomainForFqn,
} from "../src/components/morsel/componentGalleryCatalog";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Morsel Component Gallery Catalog & Full MSL Hydration", () => {
  it("classifies Magnetic, ComplexBlocks, StateGraph, and polyglot namespaces into clean domains", () => {
    assert.equal(inferDomainForFqn("Modelica.Magnetic.FluxTubes.Basic.ConstantReluctance"), "electrical");
    assert.equal(inferDomainForFqn("Modelica.ComplexBlocks.Sources.ComplexConstant"), "control");
    assert.equal(inferDomainForFqn("Modelica.StateGraph.InitialStep"), "control");
    assert.equal(inferDomainForFqn("Modelica.Mechanics.MultiBody.Joints.Revolute"), "mechanics");
    assert.equal(inferDomainForFqn("Modelica.Fluid.Pipes.DynamicPipe"), "fluids-thermal");
    assert.equal(DOMAIN_FILTERS.length, 8);
    assert.ok(GALLERY_COMPONENTS.length >= 38);
    assert.ok(CURATED_ANSATZ_PACKAGES.length >= 10);
  });

  it("hydrates the full component catalog via getComponentCatalog and batches SVG icons via getClassIcons", () => {
    const modalPath = path.resolve(__dirname, "../src/components/morsel/AddLibraryModal.tsx");
    const src = fs.readFileSync(modalPath, "utf-8");

    assert.ok(src.includes("getComponentCatalog()"), "AddLibraryModal must hydrate full catalog from LSP");
    assert.ok(src.includes("getClassIcons("), "AddLibraryModal must batch-hydrate official MSL SVG icons");
    assert.ok(
      src.includes("COMPONENT_PAGE_SIZE = 72"),
      "AddLibraryModal must progressively paginate 72 cards per page",
    );
    assert.ok(src.includes("availableSubpackages"), "AddLibraryModal must render subpackage quick-filter pills");
  });
});
