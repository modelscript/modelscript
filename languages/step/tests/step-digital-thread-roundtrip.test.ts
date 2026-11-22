// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DigitalThreadHypergraph,
  ingestAlmIntoDigitalThread,
  type AlmArtifact,
  type AlmLink,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractStepAssembly } from "../src/assembly-extractor.js";
import { mapStepToMultiBody } from "../step-multibody-mapper.js";

describe("STEP AP242 Digital Thread & PLM eBOM Alignment", () => {
  const stepBatteryEnclosure = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('EV Battery Enclosure AP242 Assembly'),'2;1');
FILE_NAME('ev_enclosure.stp','2026-11-21T00:00:00',('ModelScript'),('ModelScript'),'','','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
#1 = APPLICATION_CONTEXT('mechanical design');
#2 = PRODUCT_CONTEXT('',#1,'mechanical');
#3 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );
#4 = ( NAMED_UNIT(*) MASS_UNIT() SI_UNIT($,.KILO.,.GRAM.) );

#10 = PRODUCT('BAT-ENC-001','EV Battery Pack Enclosure','',(#2));
#11 = PRODUCT_DEFINITION_FORMATION('B','',#10);
#12 = PRODUCT_DEFINITION('design','',#11,#2);

#20 = PRODUCT('BAT-LID-002','Top Stamped Aluminum Lid','',(#2));
#21 = PRODUCT_DEFINITION_FORMATION('A','',#20);
#22 = PRODUCT_DEFINITION('design','',#21,#2);

#30 = PRODUCT('BAT-TRAY-003','Extruded Cooling Tray','',(#2));
#31 = PRODUCT_DEFINITION_FORMATION('C','',#30);
#32 = PRODUCT_DEFINITION('design','',#31,#2);

#40 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO_LID','Lid Usage','',#12,#22,$);
#41 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO_TRAY','Tray Usage','',#12,#32,$);

#50 = MASS_MEASURE_WITH_UNIT(MASS_MEASURE(4.25), #4);
#51 = CARTESIAN_POINT('centre of mass', (0.0, 0.0, 0.12));
#52 = INERTIA_MATRIX('Lid Inertia', (0.12, 0.18, 0.25, 0.0, 0.0, 0.0));
#53 = PROPERTY_DEFINITION('LidMass', 'mass', #22);
#54 = PROPERTY_DEFINITION_REPRESENTATION(#53, #55);
#55 = REPRESENTATION('LidProps', (#50, #51, #52), #3);

#60 = MASS_MEASURE_WITH_UNIT(MASS_MEASURE(11.75), #4);
#61 = CARTESIAN_POINT('centre of mass', (0.0, 0.0, -0.05));
#62 = INERTIA_MATRIX('Tray Inertia', (0.45, 0.62, 0.91, 0.0, 0.0, 0.0));
#63 = PROPERTY_DEFINITION('TrayMass', 'mass', #32);
#64 = PROPERTY_DEFINITION_REPRESENTATION(#63, #65);
#65 = REPRESENTATION('TrayProps', (#60, #61, #62), #3);
ENDSEC;
END-ISO-10303-21;`;

  it("extracts STEP AP242 assembly BOM and projects total mass within 1e-6 tolerance", () => {
    const assembly = extractStepAssembly(stepBatteryEnclosure);
    assert.ok(assembly.parts.size >= 3, `Expected at least 3 STEP assembly parts, got ${assembly.parts.size}`);

    let totalMass = 0;
    for (const props of assembly.massProperties.values()) {
      totalMass += props.mass;
    }
    assert.ok(Math.abs(totalMass - 16.0) < 1e-6, `Expected total mass 16.0 kg, got ${totalMass}`);

    const mb = mapStepToMultiBody("BatteryEnclosure", assembly);
    assert.ok(mb.bodies.length >= 2);
  });

  it("projects STEP AP242 assembly parts into DigitalThreadHypergraph alongside PLM eBOM artifacts", () => {
    const assembly = extractStepAssembly(stepBatteryEnclosure);
    const artifacts: AlmArtifact[] = [];
    for (const [id, part] of assembly.parts.entries()) {
      const mass = assembly.massProperties.get(id)?.mass ?? 0;
      artifacts.push({
        externalId: part.name,
        kind: "document_section",
        uri: `step://ev_enclosure.stp#${encodeURIComponent(part.name)}`,
        title: part.name,
        text: `Mass = ${mass} kg`,
        status: "Released",
        attributes: {
          stepEntityId: id,
          massKg: mass,
        },
      });
    }
    const links: AlmLink[] = artifacts
      .filter((a) => a.externalId !== "BAT-ENC-001")
      .map((a) => ({
        sourceId: "BAT-ENC-001",
        targetId: a.externalId,
        relation: "derivesFrom",
      }));

    const hypergraph = new DigitalThreadHypergraph();
    const ingestedCount = ingestAlmIntoDigitalThread(hypergraph, "@cad/ev-enclosure", artifacts, links);
    assert.ok(ingestedCount >= 3, `Expected >= 3 ingested STEP parts, got ${ingestedCount}`);
    assert.ok(hypergraph.getThreadCount() >= 5);
  });
});
