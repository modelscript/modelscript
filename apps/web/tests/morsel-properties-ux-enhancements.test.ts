// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { formatChoiceLabel, tryEvaluateFormula } from "../src/components/morsel/util/formula.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const propertiesPath = path.resolve(__dirname, "../src/components/morsel/Properties.tsx");
const propertiesSource = fs.readFileSync(propertiesPath, "utf-8");

describe("Morsel Properties Panel UI/UX Enhancements", () => {
  it("verifies PropertiesWidgetProps declares quick action handler props", () => {
    assert.ok(
      propertiesSource.includes("onLocateComponent?: ((name: string) => void) | undefined"),
      "PropertiesWidgetProps must declare onLocateComponent",
    );
    assert.ok(
      propertiesSource.includes("onGoToSource?: ((name: string) => void) | undefined"),
      "PropertiesWidgetProps must declare onGoToSource",
    );
    assert.ok(
      propertiesSource.includes("onDuplicateComponent?: ((name: string) => void) | undefined"),
      "PropertiesWidgetProps must declare onDuplicateComponent",
    );
    assert.ok(
      propertiesSource.includes("onDeleteComponent?: ((name: string) => void) | undefined"),
      "PropertiesWidgetProps must declare onDeleteComponent",
    );
  });

  it("verifies Quick Actions Toolbar renders Locate, Source, Duplicate, and Delete buttons", () => {
    assert.ok(
      propertiesSource.includes('aria-label="Locate on schematic"') && propertiesSource.includes("LocationIcon"),
      "Toolbar must include Locate button with LocationIcon",
    );
    assert.ok(
      propertiesSource.includes('aria-label="Go to source"') && propertiesSource.includes("CodeIcon"),
      "Toolbar must include Go to Source button with CodeIcon",
    );
    assert.ok(
      propertiesSource.includes('aria-label="Duplicate component"') && propertiesSource.includes("CopyIcon"),
      "Toolbar must include Duplicate button with CopyIcon",
    );
    assert.ok(
      propertiesSource.includes('aria-label="Delete component"') && propertiesSource.includes("TrashIcon"),
      "Toolbar must include Delete button with TrashIcon",
    );
  });

  it("verifies Density Mode Switcher is implemented with localStorage persistence", () => {
    assert.ok(
      propertiesSource.includes("ms-properties-density"),
      "PropertiesWidget must persist density mode to ms-properties-density localStorage",
    );
    assert.ok(
      propertiesSource.includes('aria-label="Toggle density"'),
      "Information section header must include a toggle density button",
    );
    assert.ok(
      propertiesSource.includes('density === "compact" ? "3px 16px" : "6px 16px"'),
      "Row padding must switch between 3px in compact mode and 6px in comfortable mode",
    );
  });

  it("verifies Compact Mode renders descriptions in InfoIcon tooltip to conserve vertical space", () => {
    assert.ok(
      propertiesSource.includes('density === "compact" && field.description') &&
        propertiesSource.includes("<InfoIcon size={12} />"),
      "SchemaFieldRow must render InfoIcon tooltip for descriptions when density is compact",
    );
    assert.ok(
      propertiesSource.includes('density === "compact" && parameter.localizedDescription') &&
        propertiesSource.includes("<InfoIcon size={12} />"),
      "ParameterRow must render InfoIcon tooltip for descriptions when density is compact",
    );
    assert.ok(
      propertiesSource.includes('density !== "compact" && field.description'),
      "SchemaFieldRow must only render full description row when density is not compact",
    );
  });

  it("verifies Formula button 𝑓(𝑥) and ExpandedFormulaEditor with quick chips", () => {
    assert.ok(
      propertiesSource.includes("ExpandedFormulaEditor"),
      "Properties.tsx must include ExpandedFormulaEditor component",
    );
    assert.ok(propertiesSource.includes("𝑓(𝑥)"), "Properties.tsx must render 𝑓(𝑥) formula editor toggle button");
    assert.ok(
      propertiesSource.includes("Modelica.Constants.pi") &&
        propertiesSource.includes("sqrt()") &&
        propertiesSource.includes("^2"),
      "ExpandedFormulaEditor must provide quick insertion chips for pi, sqrt, and power",
    );
  });

  it("verifies live evaluated formula preview badge", () => {
    assert.ok(propertiesSource.includes("(evaluated)"), "Properties.tsx must render evaluated formula preview badge");
    assert.ok(
      propertiesSource.includes("tryEvaluateFormula"),
      "Properties.tsx must call tryEvaluateFormula for formula expressions",
    );
  });

  it("verifies Modified Only parameter filter chip is available", () => {
    assert.ok(
      propertiesSource.includes('aria-label="Filter modified parameters only"'),
      "PropertiesWidget must render 'Modified' filter button next to search",
    );
    assert.ok(
      propertiesSource.includes("isFieldModified"),
      "PropertiesWidget must implement isFieldModified to filter non-default fields",
    );
    assert.ok(
      propertiesSource.includes("isParamModified"),
      "PropertiesWidget must implement isParamModified to filter non-default parameters",
    );
  });

  it("verifies choice dropdown options format clean labels without breaking values", () => {
    assert.ok(
      propertiesSource.includes("formatChoiceLabel(rawLbl, val)"),
      "SchemaFieldRow select dropdown must use formatChoiceLabel for clean enum rendering",
    );

    // Verify formatChoiceLabel logic directly
    const fullEnum = "Modelica.Blocks.Types.Init.SteadyState";
    const cleanLabel = formatChoiceLabel(fullEnum, fullEnum);
    assert.equal(cleanLabel, "SteadyState");

    const customLabel = formatChoiceLabel("No Initialization", "Modelica.Blocks.Types.Init.NoInit");
    assert.equal(customLabel, "No Initialization");
  });

  it("verifies formula evaluator handles critical damping formulas from screenshot", () => {
    // Formula 1 from user screenshot: w = 2*Modelica.Constants.pi*f/alpha
    const scope1 = { f: 10, alpha: 1 };
    const res1 = tryEvaluateFormula("2*Modelica.Constants.pi*f/alpha", scope1);
    assert.equal(res1.success, true);
    assert.ok(typeof res1.value === "number");
    assert.ok(Math.abs((res1.value as number) - 62.831853) < 0.001);

    // Formula 2 from user screenshot: alpha = if normalized then 1/sqrt(2^(1/n)-1) else 1
    const scope2 = { normalized: true, n: 2 };
    const res2 = tryEvaluateFormula("if normalized then 1/sqrt(2^(1/n)-1) else 1", scope2);
    assert.equal(res2.success, true);
    assert.ok(typeof res2.value === "number");
    assert.ok(Math.abs((res2.value as number) - 1.55377) < 0.001);

    // When normalized is false
    const scope3 = { normalized: false, n: 2 };
    const res3 = tryEvaluateFormula("if normalized then 1/sqrt(2^(1/n)-1) else 1", scope3);
    assert.equal(res3.success, true);
    assert.equal(res3.value, 1);
  });
});
