// SPDX-License-Identifier: AGPL-3.0-or-later

import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getClusterStatus, getUserWallet } from "../src/api";
import { clearPlacement, movePlacementGhost, startPlacement } from "../src/components/morsel/placement";

describe("Web App Security Hardening & Remediation Verification", () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      url: "https://modelscript.org/",
    });
    (globalThis as any).window = dom.window;
    (globalThis as any).localStorage = dom.window.localStorage;
    (globalThis as any).document = dom.window.document;
  });

  describe("Morsel Placement Coordinator", () => {
    it("safely handles placement calls when handlers are not registered without throwing", () => {
      assert.doesNotThrow(() => {
        startPlacement({ className: "Modelica.Electrical.Analog.Basic.Resistor" });
        movePlacementGhost(100, 200);
        clearPlacement();
      });
    });

    it("dispatches placement calls to registered window hooks when present", () => {
      let startedWith: any = null;
      let movedCoords: { x: number; y: number } | null = null;
      let cleared = false;

      (dom.window as any).__startPlacement = (opts: any) => {
        startedWith = opts;
      };
      (dom.window as any).__movePlacementGhost = (x: number, y: number) => {
        movedCoords = { x, y };
      };
      (dom.window as any).__clearPlacement = () => {
        cleared = true;
      };

      startPlacement({
        className: "Modelica.Mechanics.Rotational.Components.Inertia",
        classKind: "model",
      });
      assert.equal(startedWith?.className, "Modelica.Mechanics.Rotational.Components.Inertia");
      assert.equal(startedWith?.classKind, "model");

      movePlacementGhost(42, 88);
      assert.deepEqual(movedCoords, { x: 42, y: 88 });

      clearPlacement();
      assert.equal(cleared, true);
    });
  });

  describe("API Deceptive Mock Elimination", () => {
    it("reports cluster offline on failure instead of faking connected: true with UP partitions", async () => {
      const status = await getClusterStatus();
      // In offline/mock test environment without live cluster, must report connected: false
      assert.equal(status.connected, false);
      assert.equal(status.backend, "offline");
      assert.deepEqual(status.partitions, []);
    });

    it("rejects rather than returning a deceptive mock balance when wallet endpoint is unreachable", async () => {
      // Must reject and not fabricate a fake 100 credit balance
      await assert.rejects(async () => {
        await getUserWallet();
      });
    });
  });

  describe("Bundle Size Optimization & Code Splitting Invariants", () => {
    it("parseModelicaParameters extracts parameters correctly without loading AST/Monaco", async () => {
      const { parseModelicaParameters } = await import("../src/util/modelica-params");
      const modelicaCode = `
        model SpringDamper
          parameter Real c = 10.5 "Damping constant";
          parameter Real d = 2.0;
          parameter Integer n = 5 "Number of coils";
          parameter Boolean enableFriction = true;
          Real x(start = 0.0);
        equation
          der(x) = 0;
        end SpringDamper;
      `;
      const params = parseModelicaParameters(modelicaCode);
      assert.equal(params["c"], "10.5");
      assert.equal(params["d"], "2.0");
      assert.equal(params["n"], "5");
      assert.equal(params["enableFriction"], "true");
      assert.equal(params["x"], undefined);
    });

    it("ensures heavy modules are never statically imported in critical feed/card paths", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");

      const postSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/Post.tsx"), "utf-8");
      assert.ok(
        !postSrc.includes('import ComposeModal from "./ComposeModal";'),
        "Post.tsx must not statically import ComposeModal",
      );
      assert.ok(!postSrc.includes("import WorldMap"), "Post.tsx must not import WorldMap directly");
      assert.ok(postSrc.includes('React.lazy(() => import("./ComposeModal"))'), "Post.tsx must lazy-load ComposeModal");

      const composeBoxSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/ComposeBox.tsx"),
        "utf-8",
      );
      assert.ok(
        !composeBoxSrc.includes('import MorselComposeModal from "./MorselComposeModal";'),
        "ComposeBox must not statically import MorselComposeModal",
      );
      assert.ok(
        composeBoxSrc.includes('React.lazy(() => import("./MorselComposeModal"))'),
        "ComposeBox must lazy load MorselComposeModal",
      );

      const cardSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ArtifactViewCard.tsx"),
        "utf-8",
      );
      assert.ok(
        !cardSrc.includes('import ArtifactDiffModal from "./ArtifactDiffModal";'),
        "ArtifactViewCard must not statically import ArtifactDiffModal",
      );
      assert.ok(
        cardSrc.includes('React.lazy(() => import("./ArtifactDiffModal"))'),
        "ArtifactViewCard must lazy load ArtifactDiffModal",
      );

      const pkgSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/pages/PackageDetailPage.tsx"), "utf-8");
      assert.ok(
        !pkgSrc.includes('import MermaidViewer from "../components/artifacts/MermaidViewer";'),
        "PackageDetailPage must not statically import MermaidViewer",
      );
      assert.ok(
        !pkgSrc.includes('import CadStepViewer from "../components/artifacts/CadStepViewer";'),
        "PackageDetailPage must not statically import CadStepViewer",
      );

      const pkgArtifactsTabSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/pages/package/tabs/PackageArtifactsTab.tsx"),
        "utf-8",
      );
      assert.ok(
        !pkgArtifactsTabSrc.includes('import MermaidViewer from "../../../components/artifacts/MermaidViewer";'),
        "PackageArtifactsTab must not statically import MermaidViewer",
      );
      assert.ok(
        !pkgArtifactsTabSrc.includes('import CadStepViewer from "../../../components/artifacts/CadStepViewer";'),
        "PackageArtifactsTab must not statically import CadStepViewer",
      );
      assert.ok(
        pkgArtifactsTabSrc.includes('React.lazy(() => import("../../../components/artifacts/MermaidViewer"))'),
        "PackageArtifactsTab must lazy load MermaidViewer",
      );
      assert.ok(
        pkgArtifactsTabSrc.includes('React.lazy(() => import("../../../components/artifacts/CadStepViewer"))'),
        "PackageArtifactsTab must lazy load CadStepViewer",
      );

      const renderArtifactSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/pages/RenderArtifactPage.tsx"),
        "utf-8",
      );
      assert.ok(
        !renderArtifactSrc.includes('import CadStepViewer from "../components/artifacts/CadStepViewer";'),
        "RenderArtifactPage must not statically import CadStepViewer",
      );
      assert.ok(
        !renderArtifactSrc.includes('import MermaidViewer from "../components/artifacts/MermaidViewer";'),
        "RenderArtifactPage must not statically import MermaidViewer",
      );

      const appShellSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/AppShell.tsx"), "utf-8");
      assert.ok(
        !appShellSrc.includes('import ComposeModal from "./ComposeModal";'),
        "AppShell must not statically import ComposeModal",
      );
      assert.ok(
        !appShellSrc.includes('import { DevFlagsModal } from "./DevFlagsModal";'),
        "AppShell must not statically import DevFlagsModal",
      );
      assert.ok(
        appShellSrc.includes('React.lazy(() => import("./ComposeModal"))'),
        "AppShell must lazy load ComposeModal",
      );
    });
  });
});
