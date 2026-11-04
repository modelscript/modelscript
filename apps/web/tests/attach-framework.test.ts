// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  allBlockingIssues,
  attachFlowReducer,
  clampStepIndex,
  fileExtension,
  needsWizard,
  visibleSteps,
} from "../src/components/compose/attach/engine";
import { genericAttachProfile } from "../src/components/compose/attach/profiles/generic";
import {
  getAttachAcceptList,
  listAttachProfiles,
  registerAttachProfile,
  resolveAttachProfile,
} from "../src/components/compose/attach/registry";
import type { AttachContext, AttachFlowState, AttachProfile } from "../src/components/compose/attach/types";

interface Draft {
  needsGeometry: boolean;
  geometry?: string;
}

function makeProfile(overrides: Partial<AttachProfile<Draft>> = {}): AttachProfile<Draft> {
  return {
    id: "test-lang",
    label: "Test",
    match: { extensions: [".tst"], accept: ["application/x-test"] },
    analyze: async () => ({ draft: { needsGeometry: true }, chips: [{ label: "1 thing" }], issues: [] }),
    steps: [
      {
        id: "geometry",
        title: "Geometry",
        when: (d) => d.needsGeometry,
        validate: (d) => (d.geometry ? [] : [{ severity: "error", message: "Pick geometry." }]),
        Component: () => null,
      },
    ],
    build: async (d) => ({ artifact_type: "test", view_config: { geometry: d.geometry }, title: "t" }),
    ...overrides,
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("attach registry", () => {
  it("registers the generic fallback only when explicitly registered, and resolves unknown extensions to it", () => {
    cleanups.push(registerAttachProfile(genericAttachProfile));
    assert.equal(resolveAttachProfile("model.unknownext")?.id, "generic");
  });

  it("prefers a specific profile over the fallback", () => {
    cleanups.push(registerAttachProfile(genericAttachProfile));
    cleanups.push(registerAttachProfile(makeProfile()));
    assert.equal(resolveAttachProfile("A.TST")?.id, "test-lang");
    assert.equal(resolveAttachProfile("a.csv")?.id, "generic");
  });

  it("honors sniffing when an extension is ambiguous", () => {
    cleanups.push(registerAttachProfile(genericAttachProfile));
    cleanups.push(
      registerAttachProfile(makeProfile({ match: { extensions: [".tst"], sniff: (h) => h.includes("MAGIC") } })),
    );
    assert.equal(resolveAttachProfile("a.tst", "MAGIC header")?.id, "test-lang");
    assert.equal(resolveAttachProfile("a.tst", "other")?.id, "generic");
  });

  it("derives the file picker accept list from every profile, including .qif and media wildcards", () => {
    cleanups.push(registerAttachProfile(genericAttachProfile));
    cleanups.push(registerAttachProfile(makeProfile()));
    const accept = getAttachAcceptList().split(",");
    assert.ok(accept.includes(".qif"), "generic profile must accept .qif");
    assert.ok(accept.includes(".step"));
    assert.ok(accept.includes("image/*"));
    assert.ok(accept.includes(".tst"));
    assert.ok(accept.includes("application/x-test"));
    assert.equal(new Set(accept).size, accept.length, "accept tokens must be unique");
  });

  it("unregister only removes the profile it registered", () => {
    const first = makeProfile();
    const undo = registerAttachProfile(first);
    const second = makeProfile();
    cleanups.push(registerAttachProfile(second));
    undo();
    assert.ok(listAttachProfiles().includes(second));
  });
});

describe("attach engine", () => {
  it("extracts lower-cased extensions", () => {
    assert.equal(fileExtension("Part.STEP"), ".step");
    assert.equal(fileExtension("noext"), "");
    assert.equal(fileExtension("a.b.qif"), ".qif");
  });

  it("hides steps whose `when` is false and skips the wizard when nothing needs deciding", () => {
    const profile = makeProfile();
    assert.equal(visibleSteps(profile, { needsGeometry: false }).length, 0);
    assert.equal(needsWizard(profile, { draft: { needsGeometry: false }, chips: [], issues: [] }), false);
    assert.equal(needsWizard(profile, { draft: { needsGeometry: true }, chips: [], issues: [] }), true);
  });

  it("shows the wizard when analysis reports a blocking error even with no steps", () => {
    const profile = makeProfile({ steps: [] });
    const analysis = {
      draft: { needsGeometry: false },
      chips: [],
      issues: [{ severity: "error" as const, message: "Bad file." }],
    };
    assert.equal(needsWizard(profile, analysis), true);
  });

  it("blocks finishing until every visible step validates", () => {
    const profile = makeProfile();
    assert.equal(allBlockingIssues(profile, { needsGeometry: true }, []).length, 1);
    assert.equal(allBlockingIssues(profile, { needsGeometry: true, geometry: "x.step" }, []).length, 0);
    assert.equal(allBlockingIssues(profile, { needsGeometry: false }, []).length, 0);
  });

  it("clamps the step index when visibility shrinks the step list", () => {
    const profile = makeProfile();
    assert.equal(clampStepIndex(profile, { needsGeometry: true }, 5), 0);
    assert.equal(clampStepIndex(profile, { needsGeometry: false }, 3), 0);
  });
});

describe("attach flow reducer", () => {
  it("walks analyzing -> wizard -> building -> idle and records failures", () => {
    let s: AttachFlowState = { phase: "idle" };
    s = attachFlowReducer(s, { type: "analyze-start", fileName: "a.tst" });
    assert.equal(s.phase, "analyzing");
    s = attachFlowReducer(s, {
      type: "analyzed",
      profileId: "test-lang",
      fileName: "a.tst",
      analysis: { draft: { x: 1 }, chips: [{ label: "c" }], issues: [] },
    });
    assert.equal(s.phase, "wizard");
    s = attachFlowReducer(s, { type: "patch-draft", draft: { x: 2 } });
    assert.deepEqual((s as { draft: unknown }).draft, { x: 2 });
    s = attachFlowReducer(s, { type: "goto", stepIndex: -4 });
    assert.equal((s as { stepIndex: number }).stepIndex, 0);
    s = attachFlowReducer(s, { type: "build-start", fileName: "a.tst" });
    assert.equal(s.phase, "building");
    s = attachFlowReducer(s, { type: "failed", fileName: "a.tst", message: "boom" });
    assert.deepEqual(s, { phase: "error", fileName: "a.tst", message: "boom" });
    assert.equal(attachFlowReducer(s, { type: "reset" }).phase, "idle");
  });

  it("applies functional draft updates to the latest draft (no stale-closure overwrites)", () => {
    let s: AttachFlowState = attachFlowReducer(
      { phase: "analyzing", fileName: "a" },
      { type: "analyzed", profileId: "p", fileName: "a", analysis: { draft: { a: 1 }, chips: [], issues: [] } },
    );
    s = attachFlowReducer(s, { type: "update-draft", patch: { b: 2 } });
    // an async handler that captured the pre-update draft still merges into the current one
    s = attachFlowReducer(s, { type: "update-draft", patch: (d: unknown) => ({ ...(d as object), c: 3 }) });
    assert.deepEqual((s as { draft: unknown }).draft, { a: 1, b: 2, c: 3 });
    const same = attachFlowReducer(s, { type: "update-draft", patch: (d: unknown) => d });
    assert.equal(same, s, "identity updates do not create a new state");
  });

  it("ignores draft patches outside the wizard phase", () => {
    const s: AttachFlowState = { phase: "idle" };
    assert.equal(attachFlowReducer(s, { type: "patch-draft", draft: {} }), s);
  });
});

describe("generic attach profile", () => {
  const ctx = (view_type?: string): AttachContext => ({
    uploadFile: async () => ({ url: "/u/x", ...(view_type ? { view_type } : {}) }),
    createArtifact: async () => ({ id: 1 }),
    listArtifacts: async () => [],
    loadArtifactSource: async () => undefined,
    updateArtifact: async () => {},
    loadArtifactView: async () => undefined,
  });

  it("has no wizard steps so existing single-shot uploads attach immediately", async () => {
    const file = new File(["a,b\n1,2\n"], "data.csv");
    const analysis = await genericAttachProfile.analyze(file, ctx());
    assert.equal(needsWizard(genericAttachProfile, analysis), false);
  });

  it("reads small text datasets client-side and falls back to a table artifact type", async () => {
    const file = new File(["a,b\n1,2\n"], "data.csv");
    const { draft } = await genericAttachProfile.analyze(file, ctx());
    const built = await genericAttachProfile.build(draft, ctx("other"));
    assert.equal(built.artifact_type, "dataset-table");
    assert.equal(built.title, "data.csv");
    assert.equal(built.view_config["rawData"], "a,b\n1,2\n");
    assert.equal(built.view_config["url"], "/u/x");
  });

  it("uses json-table for .json and keeps the server-provided view type when present", async () => {
    const json = new File(["[]"], "d.json");
    const a = await genericAttachProfile.analyze(json, ctx());
    assert.equal((await genericAttachProfile.build(a.draft, ctx())).artifact_type, "json-table");

    const step = new File(["ISO-10303-21;"], "part.step");
    const b = await genericAttachProfile.analyze(step, ctx());
    assert.equal((await genericAttachProfile.build(b.draft, ctx("cad-step"))).artifact_type, "cad-step");
  });
});
