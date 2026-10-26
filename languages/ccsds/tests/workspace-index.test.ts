// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { CcsdsWorkspaceIndex } from "../src/workspace-index.js";

const FILE_OPM = `CCSDS_OPM_VERS = 2.0
OBJECT_NAME = SAT_ALPHA
REF_FRAME = EME2000
TIME_SYSTEM = UTC
EPOCH = 2026-10-26T00:00:00.000
SEMI_MAJOR_AXIS = 7000.0
ECCENTRICITY = 0.001
MASS = 800.0
`;

const FILE_XTCE = `<?xml version="1.0" encoding="UTF-8"?>
<SpaceSystem name="SAT_ALPHA_TM">
  <TelemetryMetaData>
    <ParameterSet>
      <Parameter name="SolarArrayCurrent" parameterTypeRef="float" />
    </ParameterSet>
    <ContainerSet>
      <SequenceContainer name="PowerPacket">
        <EntryList>
          <ParameterRefEntry parameterRef="SolarArrayCurrent" />
        </EntryList>
      </SequenceContainer>
    </ContainerSet>
  </TelemetryMetaData>
</SpaceSystem>
`;

describe("CCSDS Multi-File Workspace Indexer", () => {
  it("indexes multiple flight dynamics and telemetry files across workspace", () => {
    const indexer = new CcsdsWorkspaceIndex();

    indexer.indexSource("file:///orbits/sat_alpha.opm", FILE_OPM);
    indexer.indexSource("file:///telemetry/sat_alpha_tm.xtce", FILE_XTCE);

    assert.strictEqual(indexer.fileCount, 2);

    const alphaSyms = indexer.getSymbolsByName("SAT_ALPHA");
    assert(alphaSyms.length >= 1);
    assert.strictEqual(alphaSyms[0]!.kind, "spacecraft");

    const tmParams = indexer.findByType("telemetry_parameter");
    assert(tmParams.length >= 1);
    assert.strictEqual(tmParams[0]!.name, "SolarArrayCurrent");
  });
});
