// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSynthesizedStep,
  parseBinaryStl,
  readGeometryCompanion,
  unionBounds,
} from "../src/components/artifacts/qif-step-geometry";
import { allBlockingIssues, needsWizard, planBatch, visibleSteps } from "../src/components/compose/attach/engine";
import { genericAttachProfile } from "../src/components/compose/attach/profiles/generic";
import {
  qifAttachProfile,
  summarizeReconciliation,
  type QifAttachDraft,
} from "../src/components/compose/attach/profiles/QifProfile";
import {
  getAttachAcceptList,
  registerAttachProfile,
  resolveAttachProfile,
} from "../src/components/compose/attach/registry";
import type { AttachContext, AttachCreateArtifactInput } from "../src/components/compose/attach/types";

const QIF_DSL = `
QIF 3.0.0
FEATURE F1 Plane "DatumPlane" step="#101" points=4
FEATURE F2 Cylinder "MainBore" size=25.0 step="#105" points=6
FEATURE F3 Sphere "MissingSphere" size=16.0 step="#999" points=5
`;

const STEP_TEXT = `
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('STEP AP242 Model'),'2;1');
ENDSEC;
DATA;
#10 = PLANE('DatumFaceA', #11);
#101 = ADVANCED_FACE('DatumFaceA_Adv', (#12), #10, .T.);
#20 = CYLINDRICAL_SURFACE('MainBoreCyl', #21, 12.5);
#105 = ADVANCED_FACE('MainBoreFace', (#22), #20, .T.);
ENDSEC;
END-ISO-10303-21;
`;

interface Calls {
  uploads: string[];
  created: AttachCreateArtifactInput[];
}

function fakeCtx(calls: Calls, viewTypeFor: (name: string) => string | undefined = () => undefined): AttachContext {
  return {
    uploadFile: async (file) => {
      calls.uploads.push(file.name);
      const viewType = viewTypeFor(file.name);
      return {
        url: `/uploads/${file.name}`,
        ...(viewType ? { view_type: viewType } : {}),
        // The server used to inject a synthesized STEP like this; the profile must drop it.
        view_config_additions: { stepSource: "SYNTH", stepCode: "SYNTH", qpId: "abc" },
      };
    },
    createArtifact: async (input) => {
      calls.created.push(input);
      return { id: 900 + calls.created.length };
    },
    listArtifacts: async () => [],
    loadArtifactSource: async () => undefined,
    updateArtifact: async () => {},
    loadArtifactView: async () => undefined,
  };
}

const newCalls = (): Calls => ({ uploads: [], created: [] });

describe("QIF attach profile", () => {
  it("is selected for .qif files and appears in the picker accept list", () => {
    const undo = registerAttachProfile(qifAttachProfile);
    try {
      assert.equal(resolveAttachProfile("Report.QIF")?.id, "qif");
      assert.ok(getAttachAcceptList().split(",").includes(".qif"));
    } finally {
      undo();
    }
  });

  it("summarizes the report and shows the geometry step instead of attaching immediately", async () => {
    const analysis = await qifAttachProfile.analyze(new File([QIF_DSL], "blade.qif"), fakeCtx(newCalls()));
    assert.deepEqual(analysis.chips.map((c) => c.label).slice(0, 1), ["3 features"]);
    assert.equal(analysis.issues.length, 0);
    assert.equal(needsWizard(qifAttachProfile, analysis), true);
    assert.equal(visibleSteps(qifAttachProfile, analysis.draft).length, 1);
    assert.equal(analysis.draft.geometryMode, "none");
  });

  it("reports an error (never a demo document) for empty or feature-less files", async () => {
    const empty = await qifAttachProfile.analyze(new File([""], "empty.qif"), fakeCtx(newCalls()));
    assert.equal(empty.issues[0]?.severity, "error");
    assert.equal(visibleSteps(qifAttachProfile, empty.draft).length, 0);
    assert.ok(allBlockingIssues(qifAttachProfile, empty.draft, empty.issues).length > 0);

    const bare = await qifAttachProfile.analyze(new File(["QIF 3.0.0\n"], "bare.qif"), fakeCtx(newCalls()));
    assert.equal(bare.issues[0]?.severity, "error");
  });

  it("blocks Attach until a chosen geometry source is actually provided", async () => {
    const { draft, issues } = await qifAttachProfile.analyze(new File([QIF_DSL], "blade.qif"), fakeCtx(newCalls()));
    assert.equal(allBlockingIssues(qifAttachProfile, draft, issues).length, 0);
    const uploadNoFile: QifAttachDraft = { ...draft, geometryMode: "upload" };
    assert.equal(allBlockingIssues(qifAttachProfile, uploadNoFile, issues).length, 1);
    const linkedNone: QifAttachDraft = { ...draft, geometryMode: "linked" };
    assert.equal(allBlockingIssues(qifAttachProfile, linkedNone, issues).length, 1);
    const linked: QifAttachDraft = { ...draft, geometryMode: "linked", linked: { id: 7, title: "blade.step" } };
    assert.equal(allBlockingIssues(qifAttachProfile, linked, issues).length, 0);
  });

  it("without geometry: no companion, no synthesized STEP in the stored config", async () => {
    const calls = newCalls();
    const { draft } = await qifAttachProfile.analyze(new File([QIF_DSL], "blade.qif"), fakeCtx(calls));
    const built = await qifAttachProfile.build(
      draft,
      fakeCtx(calls, () => "qif"),
    );
    assert.equal(built.artifact_type, "qif");
    assert.equal(built.view_config["code"], QIF_DSL);
    assert.equal(built.view_config["companions"], undefined);
    assert.equal(built.view_config["stepSource"], undefined);
    assert.equal(built.view_config["stepCode"], undefined);
    assert.equal(built.view_config["qpId"], "abc");
    assert.equal(calls.created.length, 0);
    assert.match(built.suggestedCaption ?? "", /3 features/);
  });

  it("with an uploaded STEP: creates a separate STEP artifact and stores a reference, not a copy", async () => {
    const calls = newCalls();
    const { draft } = await qifAttachProfile.analyze(new File([QIF_DSL], "blade.qif"), fakeCtx(calls));
    const stepFile = new File([STEP_TEXT], "blade.step");
    const built = await qifAttachProfile.build(
      { ...draft, geometryMode: "upload", stepFile, stepText: STEP_TEXT },
      fakeCtx(calls, (n) => (n.endsWith(".step") ? "cad-step" : "qif")),
    );
    assert.deepEqual(calls.uploads, ["blade.qif", "blade.step"]);
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0]!.artifact_type, "cad-step");
    assert.equal(calls.created[0]!.title, "blade.step");
    assert.equal(calls.created[0]!.view_config["url"], "/uploads/blade.step");
    assert.deepEqual(built.view_config["companions"], {
      geometry: { artifactId: 901, title: "blade.step", provenance: "user-provided" },
    });
    assert.equal(JSON.stringify(built.view_config).includes("ISO-10303-21"), false, "STEP text must not be embedded");
  });

  it("with a linked artifact: reuses it without uploading or creating anything", async () => {
    const calls = newCalls();
    const { draft } = await qifAttachProfile.analyze(new File([QIF_DSL], "blade.qif"), fakeCtx(calls));
    const built = await qifAttachProfile.build(
      { ...draft, geometryMode: "linked", linked: { id: 42, title: "rev_c.step" } },
      fakeCtx(calls),
    );
    assert.deepEqual(calls.uploads, ["blade.qif"]);
    assert.equal(calls.created.length, 0);
    assert.deepEqual(built.view_config["companions"], {
      geometry: { artifactId: 42, title: "rev_c.step", provenance: "linked" },
    });
  });

  it("reconciles QIF STEP references against a STEP model", async () => {
    const { draft } = await qifAttachProfile.analyze(new File([QIF_DSL], "blade.qif"), fakeCtx(newCalls()));
    const summary = summarizeReconciliation(draft.doc, STEP_TEXT);
    assert.equal(summary.matched, 2);
    assert.equal(summary.total, 3);
    assert.deepEqual(summary.unresolved, ["MissingSphere"]);
  });
});

function makeStl(triangles: number[][]): Uint8Array {
  const buf = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buf);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => {
    const off = 84 + i * 50;
    t.forEach((v, j) => view.setFloat32(off + j * 4, v, true));
  });
  return new Uint8Array(buf);
}

describe("QIF part geometry helpers", () => {
  it("parses binary STL into a mesh payload with bounds", () => {
    // normal(0,0,1), v1(0,0,0) v2(10,0,0) v3(0,5,2)
    const geo = parseBinaryStl(makeStl([[0, 0, 1, 0, 0, 0, 10, 0, 0, 0, 5, 2]]), "part");
    assert.ok(geo);
    assert.equal(geo.payload.vertices.length, 9);
    assert.deepEqual(geo.payload.normals.slice(0, 3), [0, 0, 1]);
    assert.equal(geo.payload.isBodyEnvelope, true);
    assert.deepEqual(geo.bounds, { min: [0, 0, 0], max: [10, 5, 2] });
  });

  it("returns null for empty or truncated STL and clamps an over-declared triangle count", () => {
    assert.equal(parseBinaryStl(new Uint8Array(10), "x"), null);
    assert.equal(parseBinaryStl(makeStl([]), "x"), null);
    const stl = makeStl([[0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]]);
    new DataView(stl.buffer).setUint32(80, 1000, true);
    assert.equal(parseBinaryStl(stl, "x")?.payload.vertices.length, 9);
  });

  it("unions scene and part bounds", () => {
    const b = unionBounds({ min: [-30, -22, 0], max: [50, 22, 22] }, { min: [-100, 0, -5], max: [10, 80, 10] });
    assert.deepEqual(b.min, [-100, -22, -5]);
    assert.deepEqual(b.max, [50, 80, 22]);
    assert.deepEqual(b.center, [-25, 29, 8.5]);
    assert.ok(b.radius > 20);
  });

  it("reads the geometry companion reference and rejects malformed ones", () => {
    assert.deepEqual(
      readGeometryCompanion({ companions: { geometry: { artifactId: 5, title: "a.step", provenance: "linked" } } }),
      { artifactId: 5, title: "a.step", provenance: "linked" },
    );
    assert.deepEqual(readGeometryCompanion({ companions: { geometry: { artifactId: "77" } } }), { artifactId: "77" });
    assert.equal(readGeometryCompanion({ companions: { geometry: { artifactId: "" } } }), undefined);
    assert.equal(readGeometryCompanion({ companions: {} }), undefined);
    assert.equal(readGeometryCompanion({}), undefined);
    assert.equal(readGeometryCompanion(null), undefined);
  });

  it("recognizes legacy synthesized STEP so it is never shown as real geometry", () => {
    assert.equal(
      isSynthesizedStep("FILE_DESCRIPTION(('ModelScript ISO 10303-242 AP242 MBD Companion B-Rep'),'2;1');"),
      true,
    );
    assert.equal(isSynthesizedStep(STEP_TEXT), false);
  });
});

describe("multi-file drop pairing", () => {
  const withProfiles = <T>(fn: () => T): T => {
    const undo = [registerAttachProfile(genericAttachProfile), registerAttachProfile(qifAttachProfile)];
    try {
      return fn();
    } finally {
      undo.forEach((u) => u());
    }
  };
  const f = (name: string) => new File(["x"], name);

  it("claims a dropped STEP as the companion of a dropped QIF, regardless of order", () => {
    withProfiles(() => {
      const qif = f("blade.qif");
      const step = f("blade.step");
      const plan = planBatch([step, qif], (n) => resolveAttachProfile(n));
      assert.equal(plan.length, 1);
      assert.equal(plan[0]!.file, qif);
      assert.deepEqual(plan[0]!.companions, [step]);
    });
  });

  it("leaves unrelated and lone files alone and preserves order", () => {
    withProfiles(() => {
      const a = f("a.csv");
      const step = f("only.step");
      const qif = f("r.qif");
      const plan = planBatch([a, step, qif], (n) => resolveAttachProfile(n));
      // the lone STEP is claimed by the QIF; CSV stays independent
      assert.deepEqual(
        plan.map((e) => e.file.name),
        ["a.csv", "r.qif"],
      );

      const noQif = planBatch([a, step], (n) => resolveAttachProfile(n));
      assert.deepEqual(
        noQif.map((e) => e.file.name),
        ["a.csv", "only.step"],
      );
      assert.ok(noQif.every((e) => e.companions.length === 0));
    });
  });

  it("gives each STEP to only one QIF", () => {
    withProfiles(() => {
      const plan = planBatch([f("1.qif"), f("2.qif"), f("m.step")], (n) => resolveAttachProfile(n));
      assert.equal(plan.length, 2);
      assert.equal(plan[0]!.companions.length, 1);
      assert.equal(plan[1]!.companions.length, 0);
    });
  });

  it("pre-selects the dropped STEP in the QIF draft and reports reconciliation", async () => {
    const { draft } = await qifAttachProfile.analyze(new File([QIF_DSL], "blade.qif"), fakeCtx(newCalls()));
    const step = new File([STEP_TEXT], "blade.step");
    const paired = await qifAttachProfile.withCompanions!(draft, [step]);
    assert.equal(paired.geometryMode, "upload");
    assert.equal(paired.stepFile, step);
    assert.equal(paired.reconciliation?.matched, 2);
    assert.equal(allBlockingIssues(qifAttachProfile, paired, []).length, 0);

    const unchanged = await qifAttachProfile.withCompanions!(draft, []);
    assert.equal(unchanged.geometryMode, "none");
  });
});

describe("QIF edit-after-post", () => {
  const view = (config: Record<string, unknown>) => ({
    artifact_type: "qif",
    title: "blade.qif",
    view_config: { code: QIF_DSL, url: "/uploads/blade.qif", ...config },
  });

  it("only offers customization for QIF artifacts that still carry their source", () => {
    const edit = qifAttachProfile.edit!;
    assert.equal(edit.matches(view({})), true);
    assert.equal(edit.matches({ ...view({}), artifact_type: "cad-step" }), false);
    assert.equal(edit.matches(view({ code: "  " })), false);
  });

  it("opens prefilled from the stored companion reference and recomputes the match report", async () => {
    const ctx: AttachContext = {
      ...fakeCtx(newCalls()),
      loadArtifactSource: async (id) => (String(id) === "42" ? STEP_TEXT : undefined),
    };
    const analysis = await qifAttachProfile.edit!.open(
      view({ companions: { geometry: { artifactId: 42, title: "rev_c.step", provenance: "user-provided" } } }),
      ctx,
    );
    assert.equal(analysis.draft.geometryMode, "linked");
    assert.deepEqual(analysis.draft.linked, { id: 42, title: "rev_c.step" });
    assert.equal(analysis.draft.reconciliation?.matched, 2);
  });

  it("adds a newly uploaded STEP as a reference, preserving every other config key", async () => {
    const calls = newCalls();
    const v = view({ svg: "<svg/>", extra: 1 });
    const { draft } = await qifAttachProfile.edit!.open(v, fakeCtx(calls));
    const stepFile = new File([STEP_TEXT], "new.step");
    const { view_config } = await qifAttachProfile.edit!.apply(
      { ...draft, geometryMode: "upload", stepFile, stepText: STEP_TEXT },
      v,
      fakeCtx(calls, () => "cad-step"),
    );
    assert.deepEqual(calls.uploads, ["new.step"], "the QIF itself is not re-uploaded");
    assert.deepEqual(view_config["companions"], {
      geometry: { artifactId: 901, title: "new.step", provenance: "user-provided" },
    });
    assert.equal(view_config["svg"], "<svg/>");
    assert.equal(view_config["extra"], 1);
    assert.equal(view_config["code"], QIF_DSL);
  });

  it("keeps an unchanged link untouched (no uploads, original provenance) and can remove the model", async () => {
    const calls = newCalls();
    const companions = { geometry: { artifactId: 42, title: "rev_c.step", provenance: "user-provided" } };
    const v = view({ companions });
    const { draft } = await qifAttachProfile.edit!.open(v, fakeCtx(calls));
    const same = await qifAttachProfile.edit!.apply(draft, v, fakeCtx(calls));
    assert.deepEqual(same.view_config["companions"], companions);
    assert.equal(calls.uploads.length + calls.created.length, 0);

    const removed = await qifAttachProfile.edit!.apply(
      { ...draft, geometryMode: "none", linked: undefined },
      v,
      fakeCtx(calls),
    );
    assert.equal(removed.view_config["companions"], undefined);
  });
});

describe("QIF opened from an attached STEP model", () => {
  it("links the STEP artifact as geometry and computes the match report", async () => {
    const { draft } = await qifAttachProfile.analyze(new File([QIF_DSL], "blade.qif"), fakeCtx(newCalls()));
    const ctx: AttachContext = {
      ...fakeCtx(newCalls()),
      loadArtifactSource: async (id) => (String(id) === "77" ? STEP_TEXT : undefined),
    };
    const linked = await qifAttachProfile.withLinkedArtifact!(
      draft,
      { id: 77, title: "blade.step", viewType: "cad-step" },
      ctx,
    );
    assert.equal(linked.geometryMode, "linked");
    assert.deepEqual(linked.linked, { id: 77, title: "blade.step" });
    assert.equal(linked.reconciliation?.matched, 2);
    assert.equal(allBlockingIssues(qifAttachProfile, linked, []).length, 0);
  });

  it("ignores linked artifacts that are not STEP models", async () => {
    const { draft } = await qifAttachProfile.analyze(new File([QIF_DSL], "blade.qif"), fakeCtx(newCalls()));
    const out = await qifAttachProfile.withLinkedArtifact!(
      draft,
      { id: 5, title: "data.csv", viewType: "csv" },
      fakeCtx(newCalls()),
    );
    assert.equal(out.geometryMode, "none");
  });

  it("still links the model when its source cannot be read (no match report, no block)", async () => {
    const { draft } = await qifAttachProfile.analyze(new File([QIF_DSL], "blade.qif"), fakeCtx(newCalls()));
    const out = await qifAttachProfile.withLinkedArtifact!(
      draft,
      { id: 9, title: "big.step", viewType: "step" },
      fakeCtx(newCalls()),
    );
    assert.equal(out.geometryMode, "linked");
    assert.equal(out.reconciliation, undefined);
    assert.equal(allBlockingIssues(qifAttachProfile, out, []).length, 0);
  });
});
