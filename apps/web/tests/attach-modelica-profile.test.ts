// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allBlockingIssues, needsWizard, visibleSteps } from "../src/components/compose/attach/engine";
import { modelicaAttachProfile } from "../src/components/compose/attach/profiles/ModelicaProfile";
import {
  defaultModelicaClass,
  scanModelicaClasses,
  selectableModelicaClasses,
} from "../src/components/compose/attach/profiles/modelica-classes";
import type { AttachContext } from "../src/components/compose/attach/types";

const SINGLE = `model Pendulum
  parameter Real L = 1;
  Real phi(start = 0.1);
equation
  der(phi) = -L * phi;
end Pendulum;
`;

const PACKAGE = `within;
package Demo "A demo package"
  // model Commented end Commented;
  connector Pin
    Real v;
    flow Real i;
  end Pin;

  type Voltage = Real(unit = "V");

  partial model Base
    Pin p;
  end Base;

  model Ohm
    extends Base;
    parameter Real R = 1 "model Fake end Fake;";
  end Ohm;

  package Examples
    model Circuit
      Ohm r;
      annotation (experiment(StopTime = 10), Documentation(info = "model Nope"));
    end Circuit;

    model Other
    end Other;
  end Examples;

  function f
    input Real x;
    output Real y;
  algorithm
    y := x;
  end f;
end Demo;
`;

describe("Modelica class scanner", () => {
  it("finds a single top-level model", () => {
    const classes = scanModelicaClasses(SINGLE);
    assert.deepEqual(
      classes.map((c) => [c.qualifiedName, c.kind, c.depth]),
      [["Pendulum", "model", 0]],
    );
  });

  it("tracks nesting, kinds, partial and experiments while ignoring comments, strings and short classes", () => {
    const classes = scanModelicaClasses(PACKAGE);
    assert.deepEqual(
      classes.map((c) => c.qualifiedName),
      [
        "Demo",
        "Demo.Pin",
        "Demo.Base",
        "Demo.Ohm",
        "Demo.Examples",
        "Demo.Examples.Circuit",
        "Demo.Examples.Other",
        "Demo.f",
      ],
    );
    const byName = new Map(classes.map((c) => [c.qualifiedName, c]));
    assert.equal(byName.get("Demo.Base")!.partial, true);
    assert.equal(byName.get("Demo.Ohm")!.partial, false);
    assert.equal(byName.get("Demo.Examples.Circuit")!.hasExperiment, true);
    assert.equal(byName.get("Demo.Examples")!.hasExperiment, false);
    assert.equal(byName.get("Demo.Examples.Circuit")!.depth, 2);
    assert.equal(byName.get("Demo.f")!.kind, "function");
  });

  it("offers models (not types or packages) and defaults to a runnable model with an experiment", () => {
    const classes = scanModelicaClasses(PACKAGE);
    const candidates = selectableModelicaClasses(classes);
    assert.ok(candidates.every((c) => c.kind !== "package" && c.kind !== "type"));
    assert.equal(defaultModelicaClass(candidates)?.qualifiedName, "Demo.Examples.Circuit");
  });

  it("returns nothing selectable for a library of only packages and handles empty input", () => {
    assert.deepEqual(selectableModelicaClasses(scanModelicaClasses("package P\n package Q\n end Q;\nend P;")), []);
    assert.deepEqual(scanModelicaClasses(""), []);
  });
});

interface Upload {
  name: string;
  fields: Record<string, string>;
}

function ctxWith(uploads: Upload[]): AttachContext {
  return {
    uploadFile: async (file, options) => {
      uploads.push({ name: file.name, fields: options?.fields ?? {} });
      return {
        url: `/uploads/${file.name}`,
        view_type: "modelica-diagram",
        svg: "<svg/>",
        view_config_additions: { previewMode: "diagram", className: "Pendulum" },
      };
    },
    createArtifact: async () => ({ id: 1 }),
    listArtifacts: async () => [],
    loadArtifactSource: async () => undefined,
    updateArtifact: async () => {},
    loadArtifactView: async () => undefined,
  };
}

describe("Modelica attach profile", () => {
  it("attaches a single-model file immediately, with no hint sent to the server", async () => {
    const uploads: Upload[] = [];
    const analysis = await modelicaAttachProfile.analyze(new File([SINGLE], "pendulum.mo"), ctxWith(uploads));
    assert.equal(needsWizard(modelicaAttachProfile, analysis), false);
    const built = await modelicaAttachProfile.build(analysis.draft, ctxWith(uploads));
    assert.deepEqual(uploads[0]!.fields, {});
    assert.equal(built.view_config["primaryClass"], undefined);
    assert.equal(built.view_config["previewMode"], "diagram");
    assert.equal(built.view_config["code"], SINGLE);
  });

  it("asks which model to show for multi-model files, pre-selecting the best one", async () => {
    const analysis = await modelicaAttachProfile.analyze(new File([PACKAGE], "demo.mo"), ctxWith([]));
    assert.equal(needsWizard(modelicaAttachProfile, analysis), true);
    assert.equal(visibleSteps(modelicaAttachProfile, analysis.draft).length, 1);
    assert.equal(analysis.draft.selected, "Demo.Examples.Circuit");
    assert.equal(allBlockingIssues(modelicaAttachProfile, analysis.draft, analysis.issues).length, 0);
    assert.equal(allBlockingIssues(modelicaAttachProfile, { ...analysis.draft, selected: undefined }, []).length, 1);
  });

  it("sends the chosen class to the server and records it, plus the requested open mode", async () => {
    const uploads: Upload[] = [];
    const { draft } = await modelicaAttachProfile.analyze(new File([PACKAGE], "demo.mo"), ctxWith(uploads));
    const built = await modelicaAttachProfile.build(
      { ...draft, selected: "Demo.Ohm", openAs: "simulation" },
      ctxWith(uploads),
    );
    assert.deepEqual(uploads[0]!.fields, { primary_class: "Demo.Ohm" });
    assert.equal(built.view_config["primaryClass"], "Demo.Ohm");
    assert.equal(built.view_config["previewMode"], "simulation");
    assert.match(built.suggestedCaption ?? "", /Demo\.Ohm/);
  });

  it("blocks empty files", async () => {
    const analysis = await modelicaAttachProfile.analyze(new File([""], "empty.mo"), ctxWith([]));
    assert.equal(needsWizard(modelicaAttachProfile, analysis), true);
    assert.ok(allBlockingIssues(modelicaAttachProfile, analysis.draft, analysis.issues).length > 0);
  });
});

describe("Modelica edit-after-post", () => {
  const view = (config: Record<string, unknown>) => ({
    artifact_type: "modelica-diagram",
    title: "demo",
    view_config: { code: PACKAGE, url: "/uploads/demo.mo", svg: "<svg>old</svg>", ...config },
  });

  it("is offered for Modelica artifacts only", () => {
    const edit = modelicaAttachProfile.edit!;
    assert.equal(edit.matches(view({})), true);
    assert.equal(edit.matches({ ...view({}), artifact_type: "qif" }), false);
  });

  it("opens with the stored choice and shows the step even for a single-model file", async () => {
    const analysis = await modelicaAttachProfile.edit!.open(
      view({ primaryClass: "Demo.Ohm", previewMode: "simulation" }),
      ctxWith([]),
    );
    assert.equal(analysis.draft.selected, "Demo.Ohm");
    assert.equal(analysis.draft.openAs, "simulation");
    assert.equal(visibleSteps(modelicaAttachProfile, analysis.draft).length, 1);

    const single = await modelicaAttachProfile.edit!.open(view({ code: SINGLE }), ctxWith([]));
    assert.equal(visibleSteps(modelicaAttachProfile, single.draft).length, 1);
  });

  it("falls back to the best default when the stored class no longer exists", async () => {
    const analysis = await modelicaAttachProfile.edit!.open(view({ primaryClass: "Gone" }), ctxWith([]));
    assert.equal(analysis.draft.selected, "Demo.Examples.Circuit");
  });

  it("changing only the open mode does not re-render server-side", async () => {
    const uploads: Upload[] = [];
    const v = view({});
    const { draft } = await modelicaAttachProfile.edit!.open(v, ctxWith(uploads));
    const { view_config } = await modelicaAttachProfile.edit!.apply({ ...draft, openAs: "code" }, v, ctxWith(uploads));
    assert.equal(uploads.length, 0);
    assert.equal(view_config["previewMode"], "code");
    assert.equal(view_config["svg"], "<svg>old</svg>");
  });

  it("changing the model re-renders it on the server and records the new class", async () => {
    const uploads: Upload[] = [];
    const v = view({});
    const { draft } = await modelicaAttachProfile.edit!.open(v, ctxWith(uploads));
    const { view_config } = await modelicaAttachProfile.edit!.apply(
      { ...draft, selected: "Demo.Ohm" },
      v,
      ctxWith(uploads),
    );
    assert.deepEqual(uploads[0]!.fields, { primary_class: "Demo.Ohm" });
    assert.equal(view_config["primaryClass"], "Demo.Ohm");
    assert.equal(view_config["svg"], "<svg/>", "new thumbnail replaces the old one");
  });

  it("saves nothing different when nothing was changed", async () => {
    const uploads: Upload[] = [];
    const v = view({});
    const { draft } = await modelicaAttachProfile.edit!.open(v, ctxWith(uploads));
    const { view_config } = await modelicaAttachProfile.edit!.apply(draft, v, ctxWith(uploads));
    assert.deepEqual(view_config, v.view_config);
    assert.equal(uploads.length, 0);
  });
});
