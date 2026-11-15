// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry, parseSysmlRequirements } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  filterRequirementsForModel,
  resolveActiveComplianceProfiles,
  type TaggedSysmlRequirement,
} from "../src/services/compliance-profile-service.js";
import { mountedLibraryMetadata, normalizeLibraryName } from "../src/utils/hierarchy-utils.js";

const PACK_NAME = "@test/asme-profile-scoping";

describe("Compliance Profile Service — Standard Pack Activation Scoping", () => {
  after(() => {
    globalLibraryRegistry.unregisterPackage(PACK_NAME);
    mountedLibraryMetadata.delete(normalizeLibraryName(PACK_NAME));
  });

  const stdSysml = `
    library package ASME_VIII_Scope {
      @StandardClause { standard = "ASME-BPVC-VIII-1"; clauseId = "UG-27"; severity = "error"; }
      requirement def UG27_Shell {
        subject v : Vessel;
        require constraint { v.t >= v.P * 0.1 }
      }
    }
  `;

  it("isolates unimported standard packs while activating on import, @twin, package.json standards, or UI toggle", () => {
    globalLibraryRegistry.registerLibraryBundle({
      name: PACK_NAME,
      version: "1.0.0",
      modelscript: {
        tier: "stable",
        category: "standard-pack",
        languages: ["sysml2", "modelica"],
        standard: {
          code: "ASME-BPVC-VIII-1",
          edition: "2023",
          profile: "pressure-vessel",
          activation: "import",
          namespaces: ["ASME_VIII_Scope"],
        },
      },
    });
    mountedLibraryMetadata.set(normalizeLibraryName(PACK_NAME), {
      name: PACK_NAME,
      version: "1.0.0",
      category: "standard-pack",
      standardCode: "ASME-BPVC-VIII-1",
      activation: "import",
      active: false,
    });

    const parsedReqs = parseSysmlRequirements(stdSysml);
    assert.strictEqual(parsedReqs.length, 1);
    const tagged: TaggedSysmlRequirement[] = parsedReqs.map((req) => ({
      req,
      sourceUri: `modelscript-stdpack://${PACK_NAME}/rules.sysml`,
    }));

    // 1. Unrelated Modelica model without import/@twin/manifest: standard rule stays inactive
    const unrelatedRes = resolveActiveComplianceProfiles({
      modelText: "model Pendulum Real theta; equation der(theta) = 0; end Pendulum;",
      allSysmlDocs: [],
    });
    assert.strictEqual(filterRequirementsForModel(tagged, unrelatedRes).length, 0);

    // 2. Modelica or SysML import activates the imported pack rules
    const importedRes = resolveActiveComplianceProfiles({
      modelText: "model MyVessel import ASME_VIII_Scope.*; Real t; end MyVessel;",
      allSysmlDocs: [],
    });
    assert.strictEqual(filterRequirementsForModel(tagged, importedRes).length, 1);

    // 3. Explicit package.json#modelscript.standards activates across workspace
    const manifestRes = resolveActiveComplianceProfiles({
      modelText: "model Vessel Real t; end Vessel;",
      allSysmlDocs: [],
      packageJsonTexts: [
        JSON.stringify({
          name: "plant-project",
          modelscript: { standards: ["ASME-BPVC-VIII-1"] },
        }),
      ],
    });
    assert.strictEqual(filterRequirementsForModel(tagged, manifestRes).length, 1);

    // 4. UI profile override activates without edits, and explicit disable suppresses even imported
    const enabledOverrideRes = resolveActiveComplianceProfiles({
      modelText: "model Vessel Real t; end Vessel;",
      allSysmlDocs: [],
      activeStandardOverrides: new Map([[normalizeLibraryName(PACK_NAME), true]]),
    });
    assert.strictEqual(filterRequirementsForModel(tagged, enabledOverrideRes).length, 1);

    const disabledOverrideRes = resolveActiveComplianceProfiles({
      modelText: "model Vessel import ASME_VIII_Scope.*; Real t; end Vessel;",
      allSysmlDocs: [],
      activeStandardOverrides: new Map([[normalizeLibraryName(PACK_NAME), false]]),
    });
    assert.strictEqual(filterRequirementsForModel(tagged, disabledOverrideRes).length, 0);
  });
});
