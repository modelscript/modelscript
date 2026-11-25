// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ALL_ANSATZ_LANGUAGES,
  ANSATZ_LANGUAGES,
  getLanguageExtension,
  getLanguageInfo,
} from "../../../packages/editor/src/workbench/constants.js";
import { decompressAnsatzPayload } from "../../../packages/editor/src/workbench/util/permalink.js";
import {
  ALL_ANSATZ_EDITOR_LANGUAGES,
  DEFAULT_EMPTY_MODELICA_CODE,
  HERO_EXAMPLES,
  TEMPLATE_CATEGORIES,
} from "../src/pages/ansatz-editor/constants.js";
import {
  buildEditorUrlForArtifact,
  inferDialectFromArtifact,
  isMultiFileArtifact,
} from "../src/util/editor-routing.js";

describe("66-Language Ansatz Registry & Single-File vs. Multi-File Editor Routing", () => {
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

  it("registers all 66 polyglot engineering languages in ALL_ANSATZ_LANGUAGES with extensions, maturity tiers, and starter templates", () => {
    assert.ok(
      ALL_ANSATZ_LANGUAGES.length >= 66,
      `Expected at least 66 languages in ALL_ANSATZ_LANGUAGES, found ${ALL_ANSATZ_LANGUAGES.length}`,
    );
    assert.ok(
      ANSATZ_LANGUAGES.length >= 65,
      `Expected at least 65 active languages in ANSATZ_LANGUAGES, found ${ANSATZ_LANGUAGES.length}`,
    );

    const seenIds = new Set<string>();
    const seenExts = new Set<string>();
    for (const lang of ALL_ANSATZ_LANGUAGES) {
      assert.ok(lang.id && lang.id.length > 0, "Language must have an id");
      assert.ok(!seenIds.has(lang.id), `Duplicate language id: ${lang.id}`);
      seenIds.add(lang.id);

      assert.ok(lang.name && lang.name.length > 0, `Language ${lang.id} must have a display name`);
      assert.ok(
        lang.tier === "beta" || lang.tier === "alpha" || lang.tier === "pre-alpha",
        `Language ${lang.id} must have a valid maturity tier`,
      );
      assert.ok(lang.ext && lang.ext.length > 0, `Language ${lang.id} must have a primary file extension`);
      assert.ok(!lang.ext.startsWith("."), `Language ${lang.id}.ext must not start with '.': ${lang.ext}`);
      assert.ok(!seenExts.has(lang.ext), `Duplicate primary ext '${lang.ext}' on language ${lang.id}`);
      seenExts.add(lang.ext);
      assert.ok(lang.extensions.includes(`.${lang.ext}`), `Language ${lang.id}.extensions must include '.${lang.ext}'`);
      assert.ok(lang.defaultCode && lang.defaultCode.trim().length > 0, `Language ${lang.id} must have starter code`);
      assert.equal(getLanguageExtension(lang.id), lang.ext);
      assert.equal(getLanguageInfo(lang.id).id, lang.id);
    }
  });

  it("distinguishes single-file artifacts (Ansatz) from multi-file artifacts (VS Code IDE)", () => {
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

  it("routes single-file artifacts to /ansatz and multi-file artifacts to /ide while preserving fork/edit/reply context", () => {
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
      singleFileUrl.startsWith("/editor?") ||
        singleFileUrl.startsWith("/ansatz?") ||
        singleFileUrl.startsWith("/sketch?"),
      `Expected /editor URL, got ${singleFileUrl}`,
    );
    assert.ok(singleFileUrl.includes("fromArtifact=42"));
    assert.ok(singleFileUrl.includes("lang=sysml2"));
    assert.ok(singleFileUrl.includes("editPostId=101"));
    assert.ok(singleFileUrl.includes("replyToPostId=202"));

    const hashIdx = singleFileUrl.indexOf("#m=");
    assert.ok(hashIdx !== -1, "Expected compressed #m= permalink hash for single-file code");
    const decoded = decompressAnsatzPayload(singleFileUrl.slice(hashIdx));
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
    assert.equal(inferDialectFromArtifact({}, "diet.ampl"), "ampl");
    assert.equal(getLanguageInfo("ampl").id, "ampl");
    assert.equal(getLanguageExtension("ampl"), "ampl");
  });

  it("verifies apps/web/nginx.conf routes /editor, /ide, and /studio to the React SPA across all hosts including modelscript.org", () => {
    const nginxConfPath = path.resolve(import.meta.dirname, "../nginx.conf");
    const nginxConf = fs.readFileSync(nginxConfPath, "utf-8");

    // Must have explicit location for /editor, /sketch, /ansatz, /editor, /ide, /studio
    assert.ok(
      nginxConf.includes("location ~ ^/(ansatz|sketch|ansatz|editor|ide|studio)(/|$)") ||
        nginxConf.includes("location ~ ^/(ansatz|sketch|ansatz|ide|studio)(/|$)") ||
        nginxConf.includes("location ~ ^/(ansatz|sketch|ide|studio)(/|$)") ||
        nginxConf.includes("location ~ ^/(ansatz|ide|studio)(/|$)"),
      "nginx.conf must contain regex location block for ansatz, sketch, ansatz, editor, ide, and studio",
    );
    assert.ok(nginxConf.includes("root /usr/share/nginx/html;"), "nginx.conf must specify SPA root for web surfaces");

    // Verify regex matches intended paths
    const ansatzEditorRegex = /^\/(ansatz|sketch|ansatz|editor|ide|studio)(\/|$)/;
    assert.ok(ansatzEditorRegex.test("/editor"), "Must match /editor");
    assert.ok(ansatzEditorRegex.test("/editor"), "Must match /editor");
    assert.ok(ansatzEditorRegex.test("/editor/"), "Must match /editor/");
    assert.ok(ansatzEditorRegex.test("/editor/subpath"), "Must match /editor/subpath");
    assert.ok(ansatzEditorRegex.test("/sketch"), "Must match /sketch");
    assert.ok(ansatzEditorRegex.test("/sketch/"), "Must match /sketch/");
    assert.ok(ansatzEditorRegex.test("/sketch/subpath"), "Must match /sketch/subpath");
    assert.ok(ansatzEditorRegex.test("/ansatz"), "Must match /ansatz");
    assert.ok(ansatzEditorRegex.test("/ansatz/"), "Must match /ansatz/");
    assert.ok(ansatzEditorRegex.test("/ansatz/subpath"), "Must match /ansatz/subpath");
    assert.ok(ansatzEditorRegex.test("/ide"), "Must match /ide");
    assert.ok(ansatzEditorRegex.test("/ide/"), "Must match /ide/");
    assert.ok(ansatzEditorRegex.test("/studio"), "Must match /studio");
    assert.ok(ansatzEditorRegex.test("/studio/"), "Must match /studio/");
    assert.ok(!ansatzEditorRegex.test("/Ansatz Editor environments"), "Must not match /Ansatz Editor environments");
    assert.ok(!ansatzEditorRegex.test("/sketchbook"), "Must not match /sketchbook");
    assert.ok(!ansatzEditorRegex.test("/identifier"), "Must not match /identifier");

    // Verify docs regex includes trademark
    assert.ok(nginxConf.includes("trademark"), "nginx.conf docs location block must include trademark");
    const docsRegex =
      /^\/(guide|ansatz|architecture|algorithms|cli|languages|reference|industries|pricing|trademark|vp-icons)(\/|$)/;
    assert.ok(docsRegex.test("/trademark"), "Must match /trademark");
    assert.ok(docsRegex.test("/guide/introduction"), "Must match /guide/introduction");
    assert.ok(!docsRegex.test("/editor"), "Docs regex must not match /editor");
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

    // Must guard root /:username with UserRootRouteGuard to prevent collisions with /editor or 404 swallowing
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

  it("propagates thumbnail simulation variables and time bounds into Ansatz URL parameters and permalink payload", () => {
    const editorUrl = buildEditorUrlForArtifact({
      artifactId: 501,
      viewType: "modelica-diagram",
      viewConfig: {
        code: "model ElectroHydrostaticActuator end ElectroHydrostaticActuator;",
        title: "ElectroHydrostaticActuator",
        dialect: "modelica",
        previewMode: "simulation",
        simulationPreview: {
          startTime: 0,
          stopTime: 5,
          states: ["x_cmd"],
        },
      },
    });

    assert.ok(editorUrl.includes("fromArtifact=501"));
    assert.ok(editorUrl.includes("view=split"));
    assert.ok(editorUrl.includes("subview=simulation"));
    assert.ok(editorUrl.includes("autoSimulate=1"));
    assert.ok(editorUrl.includes("simVars=x_cmd"), "Must include simVars=x_cmd parameter");
    assert.ok(editorUrl.includes("startTime=0"), "Must include startTime=0 parameter");
    assert.ok(editorUrl.includes("stopTime=5"), "Must include stopTime=5 parameter");

    const hashIdx = editorUrl.indexOf("#m=");
    assert.ok(hashIdx !== -1, "Expected compressed #m= permalink hash");
    const decoded = decompressAnsatzPayload(editorUrl.slice(hashIdx));
    assert.ok(decoded);
    assert.deepEqual(decoded.sim?.variables, ["x_cmd"]);
    assert.equal(decoded.sim?.startTime, 0);
    assert.equal(decoded.sim?.stopTime, 5);
  });

  it("propagates SysML v2 IBD diagram mode into Ansatz URL parameters and permalink payload matching post thumbnail", () => {
    const editorUrl = buildEditorUrlForArtifact({
      artifactId: 621973719857762304,
      viewType: "sysml2",
      viewConfig: {
        code: "package ArtemisLunarLanderGNC {\n  part def LunarDescentStage {}\n}",
        title: "ArtemisLunarLanderGNC",
        format: "SysML2",
        rootPartDef: "LunarDescentStage",
        parts: [{ name: "lidarHazardScanner", type: "TerrainRelativeNavSensor" }],
      },
    });

    assert.ok(editorUrl.includes("lang=sysml2"), "Must preserve dialect=sysml2");
    assert.ok(editorUrl.includes("diagramType=IBD"), "Must route to IBD diagram matching post thumbnail");

    const hashIdx = editorUrl.indexOf("#m=");
    assert.ok(hashIdx !== -1, "Expected compressed #m= permalink hash");
    const decoded = decompressAnsatzPayload(editorUrl.slice(hashIdx));
    assert.ok(decoded);
    assert.equal(decoded.diagramType, "IBD", "Decoded permalink payload must include diagramType=IBD");
  });

  it("strips query strings and hash tags from the URL bar in AnsatzEditorPage after loading or editing a Ansatz", () => {
    const ansatzEditorPath = path.resolve(import.meta.dirname, "../src/pages/AnsatzEditorPage.tsx");
    const src = fs.readFileSync(ansatzEditorPath, "utf-8");

    assert.ok(src.includes("function clearAnsatzEditorUrl("), "AnsatzEditorPage.tsx must define clearAnsatzEditorUrl");
    assert.ok(
      !src.includes("${location.pathname}${location.search}#m=") && !src.includes("${location.pathname}#m="),
      "AnsatzEditorPage.tsx must not write query strings or #m= hashes to window.history.replaceState",
    );
    assert.ok(
      src.includes("clearAnsatzEditorUrl(location.pathname);"),
      "AnsatzEditorPage.tsx must clear query string and hash after resolving loads and edits",
    );
  });

  it("resolves DIgSILENT PowerFactory (powerfactory) to PowerFactory XML starter code instead of Modelica fallback", () => {
    const pfInfo = getLanguageInfo("powerfactory");
    assert.equal(pfInfo.id, "powerfactory");
    assert.equal(pfInfo.ext, "dgs");
    assert.ok(pfInfo.defaultCode.includes("<PowerFactory"), "Starter code must be PowerFactory XML");
    assert.ok(pfInfo.defaultCode.includes('class="ElmTerm"'), "Starter code must include ElmTerm buses");
    assert.ok(
      !pfInfo.defaultCode.includes("Modelica.Blocks.Sources.Sine"),
      "Must not fall back to Modelica Sine model",
    );
  });

  it("ensures every language in ALL_ANSATZ_EDITOR_LANGUAGES resolves to itself in getLanguageInfo without Modelica fallback", () => {
    for (const pgLang of ALL_ANSATZ_EDITOR_LANGUAGES) {
      const info = getLanguageInfo(pgLang.id);
      assert.equal(
        info.id,
        pgLang.id.toLowerCase(),
        `Language '${pgLang.id}' (${pgLang.label}) fell back to '${info.id}' in getLanguageInfo()`,
      );
      assert.ok(info.defaultCode.trim().length > 0, `Language '${pgLang.id}' must have non-empty defaultCode`);
      if (pgLang.id !== "modelica") {
        assert.ok(
          !info.defaultCode.includes("Modelica.Blocks.Sources.Sine"),
          `Language '${pgLang.id}' must not use Modelica's Sine starter code`,
        );
      }
    }
  });
});
