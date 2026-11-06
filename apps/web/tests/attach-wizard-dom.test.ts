// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Component-level integration tests for the attach wizard: real React rendering (react-dom + jsdom),
 * the real `useAttachFlow` state machine, and the built-in QIF/Modelica profiles against a fake context.
 * (No Playwright/axe in this repo, so accessibility is asserted structurally.)
 */

import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "https://ansatz.social/",
  pretendToBeVisual: true,
});
const g = globalThis as Record<string, unknown>;
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "getComputedStyle",
]) {
  Object.defineProperty(globalThis, key, {
    value: (dom.window as unknown as Record<string, unknown>)[key],
    configurable: true,
    writable: true,
  });
}
g["IS_REACT_ACT_ENVIRONMENT"] = true;
g["requestAnimationFrame"] = (cb: () => void) => setTimeout(cb, 0);
g["cancelAnimationFrame"] = (id: number) => clearTimeout(id);

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const attach = await import("../src/components/compose/attach/index");
const { AttachWizard, useAttachFlow, registerAttachProfile, ChoiceCards, vegaPreviewRenderer, qifPreviewRenderer } =
  attach;
const realQifViewer = qifPreviewRenderer.Viewer;
type AttachFlow = import("../src/components/compose/attach/useAttachFlow").AttachFlow;
type AttachContext = import("../src/components/compose/attach/types").AttachContext;
type AttachProfile = import("../src/components/compose/attach/types").AttachProfile<{ ok: boolean; choice?: string }>;

const QIF_DSL = `
QIF 3.0.0
FEATURE F1 Plane "DatumPlane" step="#101" points=4
FEATURE F2 Cylinder "MainBore" size=25.0 step="#105" points=6
`;

interface Recorder {
  uploads: string[];
  created: { artifact_type: string; title: string; view_config: Record<string, unknown> }[];
  updated: { id: number | string; view_config: Record<string, unknown> }[];
  attached: { id: number; title: string; caption?: string | undefined }[];
  edited: (number | string)[];
  derived: { id: number; title: string; createdView: Record<string, unknown> }[];
  views: Map<number | string, { artifact_type: string; title?: string; view_config: Record<string, unknown> }>;
}

const newRecorder = (): Recorder => ({
  uploads: [],
  created: [],
  updated: [],
  attached: [],
  edited: [],
  derived: [],
  views: new Map(),
});

function makeCtx(rec: Recorder): AttachContext {
  return {
    uploadFile: async (file) => {
      rec.uploads.push(file.name);
      return { url: `/uploads/${file.name}`, view_type: file.name.endsWith(".qif") ? "qif" : "cad-step" };
    },
    createArtifact: async (input) => {
      rec.created.push(input);
      return { id: 100 + rec.created.length };
    },
    listArtifacts: async () => [{ id: 42, title: "blade_rev_C.step", viewType: "cad-step" }],
    loadArtifactSource: async () => undefined,
    loadArtifactView: async (id) => rec.views.get(id),
    updateArtifact: async (id, patch) => {
      rec.updated.push({ id, view_config: patch.view_config });
    },
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let flowRef: { current: AttachFlow | null };

function Harness({ ctx, rec }: { ctx: AttachContext; rec: Recorder }) {
  const flow = useAttachFlow({
    ctx,
    onAttached: (id, title, caption) => rec.attached.push({ id, title, caption }),
    onEdited: (id) => rec.edited.push(id),
  });
  React.useEffect(() => {
    flowRef.current = flow;
  });
  return React.createElement(AttachWizard, { flow });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await act(async () => new Promise<void>((r) => setTimeout(r, 0)));
}

async function mount(rec: Recorder): Promise<void> {
  await act(async () => {
    root.render(React.createElement(Harness, { ctx: makeCtx(rec), rec }));
  });
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => container.querySelector<T>(sel);
const buttonByText = (text: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

async function click(el: Element | null | undefined): Promise<void> {
  assert.ok(el, "element to click must exist");
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flowRef = { current: null };
  qifPreviewRenderer.Viewer = ((props: { viewConfig?: Record<string, unknown> }) =>
    React.createElement("div", {
      "data-testid": "fake-qif-viewer",
      "data-code": String(props.viewConfig?.code ?? ""),
    })) as never;
});

afterEach(async () => {
  qifPreviewRenderer.Viewer = realQifViewer;
  await act(async () => root.unmount());
  container.remove();
});

describe("AttachWizard (QIF)", () => {
  it("renders nothing until a file is attached, then shows the geometry step with summary chips", async () => {
    const rec = newRecorder();
    await mount(rec);
    assert.equal(q("section"), null);

    await act(async () => flowRef.current!.start(new File([QIF_DSL], "blade.qif")));
    await settle();

    assert.equal(q("h3")?.textContent, "Pair with a 3D model?");
    assert.match(q("ul[aria-label='Detected contents']")?.textContent ?? "", /2 features/);
    const radios = container.querySelectorAll<HTMLInputElement>("[role=radiogroup] input[type=radio]");
    assert.deepEqual(
      Array.from(radios).map((r) => r.value),
      ["upload", "linked", "none"],
    );
    assert.equal(container.querySelector<HTMLInputElement>("input[value=none]")!.checked, true);
    assert.equal(rec.attached.length, 0, "a QIF is never attached before the user has seen the step");
  });

  it("attaches without a 3D model when the user just confirms (no companion, QIF source stored)", async () => {
    const rec = newRecorder();
    await mount(rec);
    await act(async () => flowRef.current!.start(new File([QIF_DSL], "blade.qif")));
    await settle();

    await click(buttonByText("Attach"));

    assert.equal(rec.created.length, 1);
    assert.equal(rec.created[0]!.artifact_type, "qif");
    assert.equal(rec.created[0]!.view_config["companions"], undefined);
    assert.equal(rec.created[0]!.view_config["code"], QIF_DSL);
    assert.deepEqual(
      rec.attached.map((a) => [a.id, a.title]),
      [[101, "blade.qif"]],
    );
    assert.equal(q("section"), null, "wizard closes after attaching");
  });

  it("blocks Attach until a chosen source is provided, and exposes the linked-artifact picker", async () => {
    const rec = newRecorder();
    await mount(rec);
    await act(async () => flowRef.current!.start(new File([QIF_DSL], "blade.qif")));
    await settle();

    await click(container.querySelector("input[value=linked]"));
    assert.equal(buttonByText("Attach")!.disabled, true);
    assert.ok(q("[role=listbox]"), "picker is shown for linked mode");

    await click(container.querySelector("[role=option]"));
    assert.equal(container.querySelector("[role=option]")!.getAttribute("aria-selected"), "true");
    assert.equal(buttonByText("Attach")!.disabled, false);

    await click(buttonByText("Attach"));
    assert.deepEqual(rec.created[0]!.view_config["companions"], {
      geometry: { artifactId: 42, title: "blade_rev_C.step", provenance: "linked" },
    });
  });

  it("pre-pairs a STEP dropped together with the QIF", async () => {
    const rec = newRecorder();
    await mount(rec);
    await act(async () =>
      flowRef.current!.startMany([new File(["ISO-10303-21;"], "blade.step"), new File([QIF_DSL], "blade.qif")]),
    );
    await settle();
    assert.equal(container.querySelector<HTMLInputElement>("input[value=upload]")!.checked, true);
    assert.match(container.textContent ?? "", /blade\.step/);
    await click(buttonByText("Attach"));
    assert.deepEqual(rec.uploads, ["blade.qif", "blade.step"]);
    assert.equal(rec.attached.length, 1, "the STEP is a companion, not a separate attachment");
  });

  it("Escape cancels and the Close button is labelled", async () => {
    const rec = newRecorder();
    await mount(rec);
    await act(async () => flowRef.current!.start(new File([QIF_DSL], "blade.qif")));
    await settle();
    assert.equal(q("button[aria-label='Cancel attaching']")?.textContent?.trim(), "✕");

    await act(async () => {
      q("section")!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    assert.equal(q("section"), null);
    assert.equal(rec.created.length, 0);
  });

  it("shows an alert and a disabled Attach for an unusable file, never a demo document", async () => {
    const rec = newRecorder();
    await mount(rec);
    await act(async () => flowRef.current!.start(new File(["QIF 3.0.0\n"], "bare.qif")));
    await settle();
    assert.match(q("[role=alert]")?.textContent ?? "", /No features or characteristics/);
    assert.equal(buttonByText("Attach")!.disabled, true);
  });

  it("reports upload failures with Dismiss / Try again", async () => {
    const rec = newRecorder();
    const failing: AttachContext = {
      ...makeCtx(rec),
      uploadFile: async () => {
        throw new Error("Storage is down.");
      },
    };
    await act(async () => {
      root.render(React.createElement(Harness, { ctx: failing, rec }));
    });
    await act(async () => flowRef.current!.start(new File([QIF_DSL], "blade.qif")));
    await settle();
    await click(buttonByText("Attach"));
    assert.match(q("[role=alert]")?.textContent ?? "", /Storage is down/);
    assert.ok(buttonByText("Try again"));
    await click(buttonByText("Dismiss"));
    assert.equal(q("section"), null);
  });
});

describe("AttachWizard (QIF for an already-attached STEP)", () => {
  it("opens with the STEP preselected and attaches a QIF that references it (no new STEP is created)", async () => {
    const rec = newRecorder();
    await mount(rec);
    await act(async () =>
      flowRef.current!.startWithLinked(new File([QIF_DSL], "blade.qif"), {
        id: 55,
        title: "blade.step",
        viewType: "cad-step",
      }),
    );
    await settle();

    assert.equal(container.querySelector<HTMLInputElement>("input[value=linked]")!.checked, true);
    assert.match(container.textContent ?? "", /blade\.step/);
    assert.equal(buttonByText("Attach")!.disabled, false);

    await click(buttonByText("Attach"));
    assert.deepEqual(rec.uploads, ["blade.qif"], "only the QIF is uploaded");
    assert.equal(rec.created.length, 1);
    assert.deepEqual(rec.created[0]!.view_config["companions"], {
      geometry: { artifactId: 55, title: "blade.step", provenance: "linked" },
    });
    assert.equal(rec.attached.length, 1, "the QIF joins the post as its own attachment");
  });
});

describe("AttachWizard (edit after post)", () => {
  const qifView = (companions?: Record<string, unknown>) => ({
    artifact_type: "qif",
    title: "blade.qif",
    view_config: { code: QIF_DSL, url: "/uploads/blade.qif", ...(companions ? { companions } : {}) },
  });

  it("reopens on a posted QIF prefilled, and saves changes through updateArtifact", async () => {
    const rec = newRecorder();
    await mount(rec);
    let started = false;
    await act(async () => {
      started = flowRef.current!.startEdit(
        7,
        qifView({ geometry: { artifactId: 42, title: "rev_c.step", provenance: "user-provided" } }),
      );
    });
    await settle();
    assert.equal(started, true);
    assert.equal(container.querySelector<HTMLInputElement>("input[value=linked]")!.checked, true);
    assert.ok(buttonByText("Save"), "edit mode uses a Save action");
    assert.equal(buttonByText("Attach"), undefined);

    await click(container.querySelector("input[value=none]"));
    await click(buttonByText("Save"));

    assert.equal(rec.updated.length, 1);
    assert.equal(rec.updated[0]!.id, 7);
    assert.equal(rec.updated[0]!.view_config["companions"], undefined);
    assert.equal(rec.updated[0]!.view_config["code"], QIF_DSL);
    assert.deepEqual(rec.edited, [7]);
    assert.equal(rec.created.length, 0, "editing never creates a new artifact");
    assert.equal(q("section"), null);
  });

  it("refuses to start an edit for unsupported artifacts or while another flow is busy", async () => {
    const rec = newRecorder();
    await mount(rec);
    let unsupported = true;
    await act(async () => {
      unsupported = flowRef.current!.startEdit(1, { artifact_type: "picture", view_config: { url: "/x.png" } });
    });
    assert.equal(unsupported, false);

    let first = false;
    let second = true;
    await act(async () => {
      first = flowRef.current!.startEdit(7, qifView());
      second = flowRef.current!.startEdit(8, qifView());
    });
    await settle();
    assert.equal(first, true);
    assert.equal(second, false);
  });

  it("cancelling an edit changes nothing", async () => {
    const rec = newRecorder();
    await mount(rec);
    await act(async () => void flowRef.current!.startEdit(7, qifView()));
    await settle();
    await click(q("button[aria-label='Cancel attaching']"));
    assert.equal(rec.updated.length, 0);
    assert.equal(q("section"), null);
  });
});

describe("AttachWizard (multi-step navigation and accessibility)", () => {
  type D = { ok: boolean; choice?: string };
  const TwoStep: AttachProfile = {
    id: "two-step-test",
    label: "Two Step",
    match: { extensions: [".two"] },
    analyze: async () => ({ draft: { ok: false }, chips: [], issues: [] }),
    steps: [
      {
        id: "first",
        title: "First step",
        validate: (d: D) => (d.ok ? [] : [{ severity: "error", message: "Tick the box." }]),
        Component: ({ draft, update }) =>
          React.createElement(
            "label",
            null,
            React.createElement("input", {
              type: "checkbox",
              "aria-label": "I agree",
              checked: draft.ok,
              onChange: (e: { target: { checked: boolean } }) => update({ ok: e.target.checked }),
            }),
          ),
      },
      {
        id: "second",
        title: "Second step",
        skippable: true,
        Component: ({ draft, update }) =>
          React.createElement(ChoiceCards<string>, {
            label: "Pick one",
            value: draft.choice,
            onChange: (choice: string) => update({ choice }),
            options: [
              { value: "a", title: "A", recommended: true },
              { value: "b", title: "B" },
            ],
          }),
      },
    ],
    build: async (d: D) => ({ artifact_type: "test", title: "t.two", view_config: { choice: d.choice ?? null } }),
  };

  let unregister: () => void;
  beforeEach(() => {
    unregister = registerAttachProfile(TwoStep);
  });
  afterEach(() => unregister());

  it("gates Continue on validation, moves focus to each step title, tracks the stepper, and supports Back/Skip", async () => {
    const rec = newRecorder();
    await mount(rec);
    await act(async () => flowRef.current!.start(new File(["x"], "t.two")));
    await settle();

    assert.equal(q("h3")?.textContent, "First step");
    assert.equal(document.activeElement, q("h3"), "focus moves to the step title");
    assert.equal(q("ol")?.getAttribute("aria-label"), "Step 1 of 2");
    assert.equal(buttonByText("Continue")!.disabled, true);
    assert.equal(buttonByText("Back"), undefined, "no Back on the first step");

    await click(container.querySelector("input[aria-label='I agree']"));
    assert.equal(buttonByText("Continue")!.disabled, false);
    await click(buttonByText("Continue"));

    assert.equal(q("h3")?.textContent, "Second step");
    assert.equal(document.activeElement, q("h3"));
    const dots = Array.from(container.querySelectorAll("ol li"));
    assert.deepEqual(
      dots.map((d) => d.getAttribute("aria-current")),
      [null, "step"],
    );
    assert.equal(buttonByText("Attach")!.disabled, false, "last step offers Attach, not Continue");
    assert.equal(buttonByText("Continue"), undefined);

    await click(buttonByText("Back"));
    assert.equal(q("h3")?.textContent, "First step");
    assert.equal(
      container.querySelector<HTMLInputElement>("input[aria-label='I agree']")!.checked,
      true,
      "state survives Back",
    );

    await click(buttonByText("Continue"));
    await click(container.querySelector("input[value=b]"));
    await click(buttonByText("Attach"));
    assert.equal(rec.created[0]!.view_config["choice"], "b");
  });

  it("Enter advances like Continue, but not while the target is a button", async () => {
    const rec = newRecorder();
    await mount(rec);
    await act(async () => flowRef.current!.start(new File(["x"], "t.two")));
    await settle();
    await click(container.querySelector("input[aria-label='I agree']"));

    await act(async () => {
      q("section")!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    assert.equal(q("h3")?.textContent, "Second step");
  });

  it("exposes accessible names for every interactive control and a labelled radiogroup", async () => {
    const rec = newRecorder();
    await mount(rec);
    await act(async () => flowRef.current!.start(new File(["x"], "t.two")));
    await settle();
    await click(container.querySelector("input[aria-label='I agree']"));
    await click(buttonByText("Continue"));

    for (const button of Array.from(container.querySelectorAll("button"))) {
      const name = (button.getAttribute("aria-label") ?? button.textContent ?? "").trim();
      assert.ok(name.length > 0, "every button needs an accessible name");
    }
    const group = q("[role=radiogroup]");
    assert.equal(group?.getAttribute("aria-label"), "Pick one");
    assert.match(group?.textContent ?? "", /Recommended/);
    assert.equal(container.querySelectorAll("section[aria-label]").length, 1);
  });
});

describe("AttachWizard (Vega chart derived from a table)", () => {
  const CSV = "time,v_c1,v_c2,branch\n0.0,0.1,0.0,L1\n0.1,0.4,0.2,L1\n0.2,0.8,0.5,L2\n0.3,1.2,0.9,L2\n";
  const tableView = {
    artifact_type: "csv",
    title: "chua.csv",
    view_config: { rawData: CSV, url: "/uploads/chua.csv" },
  };

  // The real renderer is react-vega (canvas); swap in a stand-in so jsdom can exercise the wizard itself.
  const realChart = vegaPreviewRenderer.Chart;
  beforeEach(() => {
    vegaPreviewRenderer.Chart = ((props: { viewConfig: Record<string, unknown> }) =>
      React.createElement("div", {
        "data-testid": "fake-chart",
        "data-title": String(props.viewConfig["title"]),
      })) as never;
  });
  afterEach(() => {
    vegaPreviewRenderer.Chart = realChart;
  });

  async function openChart(rec: Recorder): Promise<void> {
    rec.views.set(5, tableView);
    await mount(rec);
    let accepted = false;
    await act(async () => {
      accepted = flowRef.current!.startDerive(5, (id, title, createdView) =>
        rec.derived.push({ id, title, createdView }),
      );
    });
    await settle();
    assert.equal(accepted, true);
  }

  function setInput(el: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  }

  it("walks template, mapping and style with a live preview, then creates a new vega-plot", async () => {
    const rec = newRecorder();
    await openChart(rec);

    // Step 1: pick a chart. The inferred default is preselected and the preview is already live.
    assert.equal(q("h3")?.textContent, "Pick a chart");
    assert.match(q("ul[aria-label='Detected contents']")?.textContent ?? "", /CSV.*4 rows.*4 columns/);
    const gallery = q("[data-testid=vega-template-gallery]");
    assert.equal(gallery?.getAttribute("role"), "radiogroup");
    assert.equal(q("[data-testid=vega-template-line]")?.getAttribute("aria-checked"), "true");
    assert.ok(q("[data-testid=fake-chart]"), "live preview renders under the step");

    await click(q("[data-testid=vega-template-scatter]"));
    assert.equal(q("[data-testid=vega-template-scatter]")?.getAttribute("aria-checked"), "true");
    assert.equal(q("[data-testid=vega-template-line]")?.getAttribute("aria-checked"), "false");

    // Category filter narrows the gallery.
    const before = container.querySelectorAll("[data-testid^=vega-template-]").length;
    await click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Distributions"));
    assert.ok(container.querySelectorAll("[data-testid^=vega-template-]").length < before);

    // Step 2: map the data. Changing X also renames the axis label while it is still the default.
    await click(buttonByText("Continue"));
    assert.equal(q("h3")?.textContent, "Map your data");
    const x = q<HTMLSelectElement>("#vega-x-field")!;
    assert.equal(x.value, "time");
    await act(async () => {
      x.value = "v_c2";
      x.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.equal(q<HTMLSelectElement>("#vega-x-field")!.value, "v_c2");

    // Step 3: style. The last step offers the original call to action and the "keep table" escape hatch.
    await click(buttonByText("Continue"));
    assert.equal(q("h3")?.textContent, "Style & labels");
    assert.equal(q<HTMLInputElement>("#vega-x-title")!.value, "v_c2", "axis label followed the X change");
    await act(async () => setInput(q<HTMLInputElement>("#vega-chart-title")!, "Chua Voltages"));
    assert.equal(q("[data-testid=fake-chart]")?.getAttribute("data-title"), "Chua Voltages", "preview follows edits");
    assert.ok(buttonByText("Keep Raw Table Only"));
    const submit = q<HTMLButtonElement>("[data-testid=attach-wizard-submit]")!;
    assert.equal(submit.textContent?.trim(), "Apply Visualization to Post");
    assert.equal(submit.disabled, false);

    await click(submit);

    assert.equal(rec.created.length, 1);
    assert.equal(rec.created[0]!.artifact_type, "vega-plot");
    assert.equal(rec.created[0]!.title, "📊 Chua Voltages");
    assert.equal((rec.created[0]!.view_config["wizardConfig"] as { templateId: string }).templateId, "scatter");
    assert.equal(rec.derived.length, 1);
    assert.deepEqual([rec.derived[0]!.id, rec.derived[0]!.title], [101, "Chua Voltages"]);
    assert.equal(rec.derived[0]!.createdView["artifact_type"], "vega-plot");
    assert.equal(rec.attached.length, 0, "deriving replaces/extends via the callback, not as a file attachment");
    assert.equal(rec.updated.length, 0, "the source table is never modified");
    assert.equal(q("section"), null);
  });

  it("'Keep Raw Table Only' closes without creating anything", async () => {
    const rec = newRecorder();
    await openChart(rec);
    await click(buttonByText("Continue"));
    await click(buttonByText("Continue"));
    await click(buttonByText("Keep Raw Table Only"));
    assert.equal(rec.created.length, 0);
    assert.equal(rec.derived.length, 0);
    assert.equal(q("section"), null);
  });

  it("blocks creation when the mapping is invalid and explains why", async () => {
    const rec = newRecorder();
    await openChart(rec);
    await click(buttonByText("Continue"));
    await act(async () => {
      const x = q<HTMLSelectElement>("#vega-x-field")!;
      // an option that does not exist leaves the select empty; the model must reject that
      Object.defineProperty(x, "value", { configurable: true, value: "" });
      x.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.match(q("[role=alert]")?.textContent ?? "", /X axis/);
    assert.equal(buttonByText("Continue")!.disabled, true);
  });

  it("opens an error card (with retry) when the artifact cannot be loaded, and refuses while busy", async () => {
    const rec = newRecorder();
    await mount(rec); // no view registered for id 9
    await act(async () => void flowRef.current!.startDerive(9, () => {}));
    await settle();
    assert.match(q("[role=alert]")?.textContent ?? "", /could not be loaded/);
    assert.ok(buttonByText("Try again"));
    let second = true;
    await act(async () => {
      second = flowRef.current!.startDerive(5, () => {});
    });
    assert.equal(second, false, "a second wizard cannot start while one is open");
    await click(buttonByText("Dismiss"));
    assert.equal(q("section"), null);
  });
});
