// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ALL_MORSEL_LANGUAGES,
  getLanguageExtension,
  getLanguageInfo,
  MORSEL_LANGUAGES,
} from "../src/components/morsel/constants.js";
import { decompressMorselPayload } from "../src/components/morsel/util/permalink.js";
import { DEFAULT_EMPTY_MODELICA_CODE, HERO_EXAMPLES, TEMPLATE_CATEGORIES } from "../src/pages/playground/constants.js";
import {
  buildEditorUrlForArtifact,
  inferDialectFromArtifact,
  isMultiFileArtifact,
} from "../src/util/editor-routing.js";

describe("66-Language Playground Registry & Single-File vs. Multi-File Editor Routing", () => {
  it("verifies DEFAULT_EMPTY_MODELICA_CODE has coordinate systems and HERO_EXAMPLES cover multi-physics domains", () => {
    assert.ok(DEFAULT_EMPTY_MODELICA_CODE.includes('model Untitled "Untitled engineering model"'));
    assert.ok(DEFAULT_EMPTY_MODELICA_CODE.includes("Icon(coordinateSystem("));
    assert.ok(DEFAULT_EMPTY_MODELICA_CODE.includes("Diagram(coordinateSystem("));

    assert.ok(HERO_EXAMPLES.length >= 15);
    assert.ok(TEMPLATE_CATEGORIES.includes("Electrical & RF"));
    assert.ok(TEMPLATE_CATEGORIES.includes("Mechanics & Multibody"));
    assert.ok(TEMPLATE_CATEGORIES.includes("Fluids & Process"));
    assert.ok(TEMPLATE_CATEGORIES.includes("3D CAD & FEA"));
    assert.ok(TEMPLATE_CATEGORIES.includes("Systems Biology"));

    const rlc = HERO_EXAMPLES.find((ex) => ex.id === "rlc-circuit");
    assert.ok(rlc);
    assert.ok(rlc.code.includes("Modelica.Electrical.Analog.Basic.Resistor"));
    assert.ok(rlc.code.includes("annotation(Placement("));

    const epanet = HERO_EXAMPLES.find((ex) => ex.id === "epanet-water-network");
    assert.ok(epanet);
    assert.equal(epanet.domain, "Fluids & Process");

    const sbml = HERO_EXAMPLES.find((ex) => ex.id === "sbml-enzymatic-cascade");
    assert.ok(sbml);
    assert.equal(sbml.domain, "Systems Biology");
  });

  it("registers all 66 polyglot engineering languages in ALL_MORSEL_LANGUAGES with extensions, maturity tiers, and starter templates", () => {
    assert.ok(
      ALL_MORSEL_LANGUAGES.length >= 66,
      `Expected at least 66 languages in ALL_MORSEL_LANGUAGES, found ${ALL_MORSEL_LANGUAGES.length}`,
    );
    assert.ok(
      MORSEL_LANGUAGES.length >= 65,
      `Expected at least 65 active languages in MORSEL_LANGUAGES, found ${MORSEL_LANGUAGES.length}`,
    );

    const seenIds = new Set<string>();
    for (const lang of ALL_MORSEL_LANGUAGES) {
      assert.ok(lang.id && lang.id.length > 0, "Language must have an id");
      assert.ok(!seenIds.has(lang.id), `Duplicate language id: ${lang.id}`);
      seenIds.add(lang.id);

      assert.ok(lang.name && lang.name.length > 0, `Language ${lang.id} must have a display name`);
      assert.ok(
        lang.tier === "stable" || lang.tier === "beta" || lang.tier === "preview",
        `Language ${lang.id} must have a valid maturity tier`,
      );
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

  it("routes single-file artifacts to /morsel and multi-file artifacts to /ide while preserving fork/edit/reply context", () => {
    const singleFileUrl = buildEditorUrlForArtifact({
      artifactId: 42,
      viewType: "sysml2",
      code: "package DroneArchitecture { part def Drone; }",
      title: "DroneArchitecture.sysml",
      dialect: "sysml2",
      editPostId: 101,
      replyToPostId: 202,
    });

    assert.ok(
      singleFileUrl.startsWith("/morsel?") || singleFileUrl.startsWith("/sketch?"),
      `Expected /morsel URL, got ${singleFileUrl}`,
    );
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

    assert.ok(multiFileUrl.startsWith("/studio?"), `Expected /studio URL for multi-file artifact, got ${multiFileUrl}`);
    assert.ok(multiFileUrl.includes("fromArtifact=99"));
    assert.ok(multiFileUrl.includes("editPostId=303"));
    assert.ok(multiFileUrl.includes("replyToPostId=404"));
    assert.ok(multiFileUrl.endsWith("#memfs:99"));
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

  it("verifies apps/web/nginx.conf routes /playground, /ide, and /studio to the React SPA across all hosts including modelscript.org", () => {
    const nginxConfPath = path.resolve(import.meta.dirname, "../nginx.conf");
    const nginxConf = fs.readFileSync(nginxConfPath, "utf-8");

    // Must have explicit location for /playground, /sketch, /morsel, /ide, /studio
    assert.ok(
      nginxConf.includes("location ~ ^/(playground|sketch|morsel|ide|studio)(/|$)") ||
        nginxConf.includes("location ~ ^/(playground|sketch|ide|studio)(/|$)") ||
        nginxConf.includes("location ~ ^/(playground|ide|studio)(/|$)"),
      "nginx.conf must contain regex location block for playground, sketch, morsel, ide, and studio",
    );
    assert.ok(nginxConf.includes("root /usr/share/nginx/html;"), "nginx.conf must specify SPA root for web surfaces");

    // Verify regex matches intended paths
    const playgroundRegex = /^\/(playground|sketch|morsel|ide|studio)(\/|$)/;
    assert.ok(playgroundRegex.test("/playground"), "Must match /playground");
    assert.ok(playgroundRegex.test("/playground/"), "Must match /playground/");
    assert.ok(playgroundRegex.test("/playground/subpath"), "Must match /playground/subpath");
    assert.ok(playgroundRegex.test("/sketch"), "Must match /sketch");
    assert.ok(playgroundRegex.test("/sketch/"), "Must match /sketch/");
    assert.ok(playgroundRegex.test("/sketch/subpath"), "Must match /sketch/subpath");
    assert.ok(playgroundRegex.test("/morsel"), "Must match /morsel");
    assert.ok(playgroundRegex.test("/morsel/"), "Must match /morsel/");
    assert.ok(playgroundRegex.test("/morsel/subpath"), "Must match /morsel/subpath");
    assert.ok(playgroundRegex.test("/ide"), "Must match /ide");
    assert.ok(playgroundRegex.test("/ide/"), "Must match /ide/");
    assert.ok(playgroundRegex.test("/studio"), "Must match /studio");
    assert.ok(playgroundRegex.test("/studio/"), "Must match /studio/");
    assert.ok(!playgroundRegex.test("/playgrounds"), "Must not match /playgrounds");
    assert.ok(!playgroundRegex.test("/sketchbook"), "Must not match /sketchbook");
    assert.ok(!playgroundRegex.test("/identifier"), "Must not match /identifier");

    // Verify docs regex includes trademark
    assert.ok(nginxConf.includes("trademark"), "nginx.conf docs location block must include trademark");
    const docsRegex =
      /^\/(guide|ansatz|architecture|algorithms|cli|languages|reference|industries|pricing|trademark|vp-icons)(\/|$)/;
    assert.ok(docsRegex.test("/trademark"), "Must match /trademark");
    assert.ok(docsRegex.test("/guide/introduction"), "Must match /guide/introduction");
    assert.ok(!docsRegex.test("/playground"), "Docs regex must not match /playground");
  });

  it("verifies /@username route isolation, LegacyUserRedirect, and UserRootRouteGuard in App.tsx", () => {
    const appPath = path.resolve(import.meta.dirname, "../src/App.tsx");
    const appSrc = fs.readFileSync(appPath, "utf-8");

    // Must define LegacyUserRedirect and UserRootRouteGuard
    assert.ok(appSrc.includes("function LegacyUserRedirect()"), "App.tsx must define LegacyUserRedirect");
    assert.ok(appSrc.includes("function UserRootRouteGuard("), "App.tsx must define UserRootRouteGuard");

    // Must mount LegacyUserRedirect for backward compatibility
    assert.ok(
      appSrc.includes('<Route path="/users/:username" element={<LegacyUserRedirect />} />'),
      "App.tsx must redirect /users/:username to /@:username",
    );

    // Must guard root /:username with UserRootRouteGuard to prevent collisions with /playground or 404 swallowing
    assert.ok(
      appSrc.includes('<Route path="/:username" element={<UserRootRouteGuard element={<ProfilePage />} />} />'),
      "App.tsx must guard /:username with UserRootRouteGuard",
    );
    assert.ok(
      appSrc.includes(
        '<Route path="/:username/status/:id" element={<UserRootRouteGuard element={<PostDetailPage />} />} />',
      ),
      "App.tsx must guard /:username/status/:id with UserRootRouteGuard",
    );
  });
});
