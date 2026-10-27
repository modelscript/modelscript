// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getLanguageExtension, getLanguageInfo, MORSEL_LANGUAGES } from "../src/components/morsel/constants.js";
import { decompressMorselPayload } from "../src/components/morsel/util/permalink.js";
import {
  buildEditorUrlForArtifact,
  inferDialectFromArtifact,
  isMultiFileArtifact,
} from "../src/util/editor-routing.js";

describe("44-Language Playground Registry & Single-File vs. Multi-File Editor Routing", () => {
  it("registers all 44 polyglot engineering languages in MORSEL_LANGUAGES with extensions and starter templates", () => {
    assert.ok(MORSEL_LANGUAGES.length >= 44, `Expected at least 44 languages, found ${MORSEL_LANGUAGES.length}`);

    const seenIds = new Set<string>();
    for (const lang of MORSEL_LANGUAGES) {
      assert.ok(lang.id && lang.id.length > 0, "Language must have an id");
      assert.ok(!seenIds.has(lang.id), `Duplicate language id: ${lang.id}`);
      seenIds.add(lang.id);

      assert.ok(lang.name && lang.name.length > 0, `Language ${lang.id} must have a display name`);
      assert.ok(lang.ext && lang.ext.length > 0, `Language ${lang.id} must have a primary file extension`);
      assert.ok(lang.defaultCode && lang.defaultCode.trim().length > 0, `Language ${lang.id} must have starter code`);
      assert.equal(getLanguageExtension(lang.id), lang.ext);
      assert.equal(getLanguageInfo(lang.id).id, lang.id);
    }
  });

  it("distinguishes single-file artifacts (Playground) from multi-file artifacts (VS Code IDE)", () => {
    // Single-file artifacts
    assert.equal(
      isMultiFileArtifact({
        view_type: "modelica-diagram",
        view_config: { code: "model A end A;", dialect: "modelica" },
      }),
      false,
    );
    assert.equal(
      isMultiFileArtifact({
        view_type: "sysml2",
        view_config: { files: { "system.sysml": "package Sys {}" } },
      }),
      false,
    );

    // Multi-file artifacts
    assert.equal(
      isMultiFileArtifact({
        view_type: "modelica-code",
        view_config: {
          files: {
            "package.mo": "within ; package P end P;",
            "SubModel.mo": "within P; model SubModel end SubModel;",
          },
        },
      }),
      true,
    );
    assert.equal(
      isMultiFileArtifact({
        view_type: "repository",
        view_config: { namespace: "acme", project: "drivetrain" },
      }),
      true,
    );
    assert.equal(
      isMultiFileArtifact({
        view_type: "package",
        view_config: { name: "@acme/thermal" },
      }),
      true,
    );
  });

  it("routes single-file artifacts to /playground and multi-file artifacts to /ide while preserving fork/edit/reply context", () => {
    const singleFileUrl = buildEditorUrlForArtifact({
      artifactId: 42,
      viewType: "sysml2",
      code: "package DroneArchitecture { part def Drone; }",
      title: "DroneArchitecture.sysml",
      dialect: "sysml2",
      editPostId: 101,
      replyToPostId: 202,
    });

    assert.ok(singleFileUrl.startsWith("/playground?"), `Expected /playground URL, got ${singleFileUrl}`);
    assert.ok(singleFileUrl.includes("fromArtifact=42"));
    assert.ok(singleFileUrl.includes("lang=sysml2"));
    assert.ok(singleFileUrl.includes("editPostId=101"));
    assert.ok(singleFileUrl.includes("replyToPostId=202"));

    const hashIdx = singleFileUrl.indexOf("#m=");
    assert.ok(hashIdx !== -1, "Expected compressed #m= permalink hash for single-file code");
    const decoded = decompressMorselPayload(singleFileUrl.slice(hashIdx));
    assert.ok(decoded);
    assert.equal(decoded.lang, "sysml2");
    assert.equal(decoded.code, "package DroneArchitecture { part def Drone; }");
    assert.equal(decoded.artifactId, "42");

    const multiFileUrl = buildEditorUrlForArtifact({
      artifactId: 99,
      viewType: "modelica-code",
      viewConfig: {
        files: {
          "Controller.mo": "model Controller end Controller;",
          "Plant.sysml": "package Plant {}",
        },
        primaryFile: "Controller.mo",
      },
      title: "CoupledWorkspace",
      editPostId: 303,
      replyToPostId: 404,
    });

    assert.ok(multiFileUrl.startsWith("/ide?"), `Expected /ide URL for multi-file artifact, got ${multiFileUrl}`);
    assert.ok(multiFileUrl.includes("fromArtifact=99"));
    assert.ok(multiFileUrl.includes("editPostId=303"));
    assert.ok(multiFileUrl.includes("replyToPostId=404"));
    assert.ok(multiFileUrl.endsWith("#memfs:artifact-99"));
  });

  it("infers canonical dialect IDs across polyglot extensions and view types", () => {
    assert.equal(inferDialectFromArtifact({ view_type: "pscad" }), "pscad");
    assert.equal(inferDialectFromArtifact({}, "inverter.sp"), "spice");
    assert.equal(inferDialectFromArtifact({}, "wing_mesh.su2"), "cfd");
    assert.equal(inferDialectFromArtifact({}, "bracket.inp"), "fea");
    assert.equal(inferDialectFromArtifact({}, "bogie.tsimf"), "gensys");
    assert.equal(inferDialectFromArtifact({}, "suspension.spck"), "simpack");
    assert.equal(inferDialectFromArtifact({}, "ontology.ofn"), "owl2");
    assert.equal(inferDialectFromArtifact({}, "housing.scad"), "scad");
    assert.equal(inferDialectFromArtifact({}, "highway.xodr"), "opendrive");
    assert.equal(inferDialectFromArtifact({}, "cut_in.xosc"), "openscenario");
  });
});
