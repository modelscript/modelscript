// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { extractShortPostSlides, isPowerFlowCode, isWaveformCode } from "../src/components/post/PostArtifactSlider.js";

describe("Power Engineering Integration for Ansatz Social", () => {
  describe("1. Language Detection & Post Slide Lifting", () => {
    it("identifies powerflow language identifiers", () => {
      assert.strictEqual(isPowerFlowCode("psse"), true);
      assert.strictEqual(isPowerFlowCode("RAW"), true);
      assert.strictEqual(isPowerFlowCode("powerflow"), true);
      assert.strictEqual(isPowerFlowCode("sld"), true);
      assert.strictEqual(isPowerFlowCode("modelica"), false);
      assert.strictEqual(isPowerFlowCode("sysml2"), false);
    });

    it("identifies waveform / oscillography language identifiers", () => {
      assert.strictEqual(isWaveformCode("comtrade"), true);
      assert.strictEqual(isWaveformCode("PSOUT"), true);
      assert.strictEqual(isWaveformCode("oscillography"), true);
      assert.strictEqual(isWaveformCode("c"), false);
    });

    it("lifts single fenced PSS/E code block to a powerflow slide", () => {
      const post = {
        content: `Analyzing IEEE 14-bus base case:
\`\`\`psse
0, 100.0, 33, 0, 1, 60.0 / IEEE 14 Bus
1, 'BUS 1       ', 230.0, 3, 1, 1, 1, 1.06, 0.0
2, 'BUS 2       ', 230.0, 2, 1, 1, 1, 1.045, -4.98
0 / END OF BUS DATA
\`\`\`
Voltage profile remains within 0.95 - 1.05 pu.`,
      };

      const { isShortPost, slides, proseText } = extractShortPostSlides(post);
      assert.strictEqual(isShortPost, true);
      assert.strictEqual(slides.length, 1);
      assert.strictEqual(slides[0]?.type, "powerflow");
      assert.strictEqual(slides[0]?.lang, "psse");
      assert.ok(slides[0]?.code?.includes("IEEE 14 Bus"));
      assert.ok(proseText.includes("Analyzing IEEE 14-bus base case:"));
      assert.ok(proseText.includes("Voltage profile remains within 0.95 - 1.05 pu."));
    });

    it("lifts single COMTRADE code block to a waveform slide", () => {
      const post = {
        content: `Trip disturbance oscillography:
\`\`\`comtrade
Station,Device,2013
4,3A,1D
1,Ia,A,,A,0.001,0,0,-32768,32767,1,1,S
\`\`\``,
      };

      const { isShortPost, slides } = extractShortPostSlides(post);
      assert.strictEqual(isShortPost, true);
      assert.strictEqual(slides.length, 1);
      assert.strictEqual(slides[0]?.type, "waveform");
      assert.strictEqual(slides[0]?.lang, "comtrade");
    });

    it("correctly handles multi-item post with mixed standard code and powerflow", () => {
      const post = {
        content: `Comparison between Modelica and PSS/E models:
\`\`\`modelica
model Test
  Real x;
end Test;
\`\`\`

\`\`\`raw
0, 100.0 / RAW case
1, 'BUS 1', 115.0, 1, 1, 1, 1, 1.0, 0.0
0 / END
\`\`\``,
      };

      const { isShortPost, slides } = extractShortPostSlides(post);
      assert.strictEqual(isShortPost, true);
      assert.strictEqual(slides.length, 2);
      assert.strictEqual(slides[0]?.type, "code");
      assert.strictEqual(slides[1]?.type, "powerflow");
    });
  });

  describe("2. Package Registry Power Catalog Verification", () => {
    it("ensures standard power libraries exist in stdlibs.catalog.json", () => {
      const candidatePaths = [
        path.resolve(process.cwd(), "packages/exchange/src/catalog/stdlibs.catalog.json"),
        path.resolve(process.cwd(), "../../packages/exchange/src/catalog/stdlibs.catalog.json"),
      ];
      const catalogPath = candidatePaths.find((p) => fs.existsSync(p));
      assert.ok(catalogPath, "stdlibs.catalog.json must exist in packages/exchange");
      const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
      const pkgs = (catalog.libraries || catalog.packages) as { packageName: string; domain: string }[];

      const ieeeTransmission = pkgs.find((p) => p.packageName === "IEEE-Transmission-Benchmarks");
      assert.ok(ieeeTransmission, "IEEE-Transmission-Benchmarks must be in catalog");
      assert.strictEqual(ieeeTransmission.domain, "power-energy");

      const psseDynamics = pkgs.find((p) => p.packageName === "PSSE-Standard-Dynamics");
      assert.ok(psseDynamics, "PSSE-Standard-Dynamics must be in catalog");
      assert.strictEqual(psseDynamics.domain, "power-energy");

      const ieeeFeeders = pkgs.find((p) => p.packageName === "IEEE-Test-Feeders");
      assert.ok(ieeeFeeders, "IEEE-Test-Feeders must be in catalog");
      assert.strictEqual(ieeeFeeders.domain, "power-energy");
    });
  });

  describe("3. IEEE 2800 Verification Card Component", () => {
    it("instantiates Ieee2800VerificationCard with custom report", async () => {
      const { Ieee2800VerificationCard } =
        await import("../src/components/morsel/simulation-results/components/Ieee2800VerificationCard.js");
      assert.ok(Ieee2800VerificationCard, "Ieee2800VerificationCard must be exported");

      const customReport = {
        projectName: "Test Solar Farm Interconnection",
        overallStatus: "PASS" as const,
        evaluatedAt: new Date().toISOString(),
        checks: [
          {
            clause: "5.3.2",
            title: "Voltage Ride-Through (LVRT / HVRT)",
            status: "PASS" as const,
            measuredValue: "0.05 pu (No cessation)",
            requiredLimit: "V >= 0.0 pu (160ms)",
            details: "No tripping during 150ms fault.",
          },
        ],
        summary: "1 clause evaluated.",
      };

      const element = React.createElement(Ieee2800VerificationCard, {
        report: customReport,
        colorMode: "dark",
      });
      assert.ok(element, "React element should be created successfully");
      assert.strictEqual(element.props.report?.projectName, "Test Solar Farm Interconnection");
      assert.strictEqual(element.props.report?.overallStatus, "PASS");
    });
  });
});
