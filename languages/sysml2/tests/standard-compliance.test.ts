// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl";
import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex, loadEmbeddedKerMLStdlib } from "../src/factory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../dist/parser.wasm");

interface DocEntry {
  text: string;
  tree: { rootNode: any };
}

function createMultiFileCstTree(docs: Map<string, DocEntry>, defaultUri: string) {
  return {
    getText(start: number, end: number, entry?: { resourceId?: string }) {
      const targetUri = entry?.resourceId ?? defaultUri;
      const doc = docs.get(targetUri) ?? docs.get(defaultUri);
      if (!doc || start < 0 || end < start || start > doc.text.length) return null;
      return doc.text.slice(start, Math.min(end, doc.text.length));
    },
    getNode(start: number, end: number, entry?: { resourceId?: string }) {
      const targetUri = entry?.resourceId ?? defaultUri;
      const doc = docs.get(targetUri) ?? docs.get(defaultUri);
      const root = doc?.tree?.rootNode;
      if (!root) return null;
      if (typeof root.descendantForIndex === "function") {
        return root.descendantForIndex(start, end);
      }
      return null;
    },
  };
}

const TEST_PACK_NAME = "@test/asme-bpvc-viii-1-unit";

describe("SysML v2 Standard Pack Compliance Linting & External Table Calculators", () => {
  after(() => {
    globalLibraryRegistry.unregisterPackage(TEST_PACK_NAME);
  });

  it("evaluates imported @StandardClause rules, lookup tables, assume guards, and automatic type-bound checks across files", async () => {
    const { parser } = await createWasmParser(sysmlWasm);

    // Register synthetic standard pack with keyed piecewise-linear allowable stress table
    globalLibraryRegistry.registerLibraryBundle(
      {
        name: TEST_PACK_NAME,
        version: "0.1.0",
        modelscript: {
          tier: "stable",
          category: "standard-pack",
          languages: ["sysml2"],
          standard: {
            code: "ASME-BPVC-VIII-1",
            edition: "2023",
            profile: "pressure-vessel",
            activation: "import",
            namespaces: ["ASME_BPVC_VIII_1_Test"],
          },
          runtime: {
            tables: {
              ASME_AllowableStress: "tables/allowable-stress.json",
            },
          },
        },
      },
      {
        tables: {
          ASME_AllowableStress: {
            kind: "keyed-piecewise-linear",
            series: {
              "SA-516-70": {
                x: [100, 500, 700],
                y: [137.9, 137.9, 124.0],
              },
            },
          },
        },
      },
    );

    const stdCode = `
      library package ASME_BPVC_VIII_1_Test {
        private import ScalarValues::*;

        part def CylindricalShell {
          attribute P : Real;
          attribute R : Real;
          attribute t : Real;
          attribute E : Real;
          attribute materialSpec : String;
          attribute designTempF : Real;
        }

        calc def AllowableStress {
          @ExternalCalculator { calculator = "ASME_AllowableStress"; }
          in mat : String;
          in tempF : Real;
          return : Real;
        }

        calc def UG27RequiredThickness {
          in P : Real;
          in R : Real;
          in S : Real;
          in E : Real;
          return : Real = (P * R) / (S * E - 0.6 * P);
        }

        requirement def UG27_CircumferentialStress {
          @StandardClause {
            standard = "ASME BPVC VIII-1";
            clauseId = "UG-27(c)(1)";
            severity = "error";
          }
          subject vessel : CylindricalShell;
          assume constraint { vessel.P > 0.0 }
          require constraint {
            vessel.t >= UG27RequiredThickness(
              vessel.P,
              vessel.R,
              AllowableStress(vessel.materialSpec, vessel.designTempF),
              vessel.E
            )
          }
        }

        requirement def UG125_AdvisoryInspection {
          @ComplianceRule {
            standard = "ASME BPVC VIII-1";
            clauseId = "UG-125(a)";
            severity = "warning";
          }
          subject vessel : CylindricalShell;
          assume constraint { vessel.P > 0.0 }
          require constraint { vessel.t >= 2.0 }
        }
      }
    `;

    const designCode = `
      package PlantVessels {
        private import ASME_BPVC_VIII_1_Test::*;

        // Required t for P=2.0, R=500, S=137.9, E=0.85:
        // (2.0 * 500.0) / (137.9 * 0.85 - 1.2) = 1000 / 116.015 = ~8.6196 mm
        // t = 6.0 violates UG-27, satisfies UG-125 (t >= 2.0)
        part badVessel : CylindricalShell {
          attribute :>> P = 2.0;
          attribute :>> R = 500.0;
          attribute :>> t = 6.0;
          attribute :>> E = 0.85;
          attribute :>> materialSpec = "SA-516-70";
          attribute :>> designTempF = 400.0;
        }

        // t = 12.0 satisfies both UG-27 and UG-125
        part goodVessel : CylindricalShell {
          attribute :>> P = 2.0;
          attribute :>> R = 500.0;
          attribute :>> t = 12.0;
          attribute :>> E = 0.85;
          attribute :>> materialSpec = "SA-516-70";
          attribute :>> designTempF = 400.0;
        }

        // P = 0.0 fails assume guard: vacuously satisfied automatically, warns S5022 if explicitly satisfied
        part atmosphericTank : CylindricalShell {
          attribute :>> P = 0.0;
          attribute :>> R = 500.0;
          attribute :>> t = 1.0;
          attribute :>> E = 0.85;
          attribute :>> materialSpec = "SA-516-70";
          attribute :>> designTempF = 100.0;
        }

        satisfy ASME_BPVC_VIII_1_Test::UG27_CircumferentialStress by atmosphericTank;

        // Advisories warn when violated (t = 1.5 < 2.0)
        part thinPressurizedTank : CylindricalShell {
          attribute :>> P = 0.2;
          attribute :>> R = 10.0;
          attribute :>> t = 1.5;
          attribute :>> E = 1.0;
          attribute :>> materialSpec = "SA-516-70";
          attribute :>> designTempF = 100.0;
        }
      }
    `;

    const unrelatedCode = `
      package UnimportedModel {
        part def CustomTank {
          attribute P : ScalarValues::Real = 2.0;
        }
        part standalone : CustomTank;
      }
    `;

    const stdUri = "file:///workspace/ASME_BPVC_VIII_1_Test.sysml";
    const designUri = "file:///workspace/PlantVessels.sysml";
    const unrelatedUri = "file:///workspace/UnimportedModel.sysml";

    const docs = new Map<string, DocEntry>([
      [stdUri, { text: stdCode, tree: parser.parse(stdCode)! }],
      [designUri, { text: designCode, tree: parser.parse(designCode)! }],
      [unrelatedUri, { text: unrelatedCode, tree: parser.parse(unrelatedCode)! }],
    ]);

    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws, parser);
    for (const [uri, doc] of docs) {
      ws.register(uri, () => doc.tree.rootNode);
    }

    const unified = await ws.getIndexAsync();
    const qe = createSysML2QueryEngine(unified, createMultiFileCstTree(docs, designUri) as any);
    const designDiags = qe.runAllLints(designUri);

    // 1. Implicit type-bound violation (S5020) on badVessel for UG-27(c)(1)
    const s5020 = designDiags.filter((d) => d.code === 5020);
    assert.strictEqual(s5020.length, 1, `Expected 1 S5020 error, got: ${JSON.stringify(designDiags, null, 2)}`);
    assert.strictEqual(s5020[0]!.severity, "error");
    assert.ok(s5020[0]!.message.includes("ASME BPVC VIII-1 UG-27(c)(1)"));
    assert.ok(s5020[0]!.message.includes("badVessel"));
    assert.ok(s5020[0]!.message.includes("UG27_CircumferentialStress"));
    assert.ok(s5020[0]!.message.includes("6 vs >="), `Expected operand values in message: ${s5020[0]!.message}`);

    // goodVessel must NOT trigger S5020 or S5021
    assert.ok(!designDiags.some((d) => d.message.includes("goodVessel")));

    // 2. Advisory rule violation (S5021) on thinPressurizedTank for UG-125(a)
    const s5021 = designDiags.filter((d) => d.code === 5021);
    assert.strictEqual(s5021.length, 1, `Expected 1 S5021 warning, got: ${JSON.stringify(designDiags, null, 2)}`);
    assert.strictEqual(s5021[0]!.severity, "warning");
    assert.ok(s5021[0]!.message.includes("ASME BPVC VIII-1 UG-125(a)"));
    assert.ok(s5021[0]!.message.includes("thinPressurizedTank"));

    // 3. Explicit satisfy on atmosphericTank where assume is false must warn S5022,
    //    while implicit UG-125 check on atmosphericTank stays vacuously silent (zero S5021)
    const s5022 = designDiags.filter((d) => d.code === 5022);
    assert.strictEqual(s5022.length, 1, `Expected 1 S5022 warning, got: ${JSON.stringify(designDiags, null, 2)}`);
    assert.strictEqual(s5022[0]!.severity, "warning");
    assert.ok(s5022[0]!.message.includes("atmosphericTank"));
    assert.ok(s5022[0]!.message.includes("ASME BPVC VIII-1 UG-27(c)(1)"));

    // 4. Unrelated file without import must have zero standard compliance diagnostics
    const qeUnrelated = createSysML2QueryEngine(unified, createMultiFileCstTree(docs, unrelatedUri) as any);
    const unrelatedDiags = qeUnrelated.runAllLints(unrelatedUri);
    assert.strictEqual(unrelatedDiags.filter((d) => d.code === 5020 || d.code === 5021 || d.code === 5022).length, 0);
  });
});
