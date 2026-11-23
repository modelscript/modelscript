// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatHdf4Ddl, parseHdf4, parseHdf4Ddl } from "../src/parser/index.js";
import { Hdf4DataType } from "../src/types.js";

const SAMPLE_DDL = `# NASA EOS-HDF MODIS Radiance Granule
HDF4 MODIS_Granule VERSION="4.2"
  ATTR Mission = "Terra"
  ATTR Instrument = "MODIS"

  SDS Radiance TYPE=FLOAT32 REF=10 UNIT="W/(m2.sr.um)"
    DIM lines = 2
    DIM pixels = 3
    ATTR scale_factor = 0.01
    ATTR add_offset = 0.5
    ATTR _FillValue = -999
    DATA [10.0, 20.5, 30.0, 40.5, 50.0, 60.5]
  END

  VDATA Telemetry CLASS="OrbitMeta" REF=20
    FIELD timestamp : FLOAT64
    FIELD mode : INT16
    DATA [1000.25, 1]
    DATA [1001.50, 2]
  END

  RASTER8 Quicklook WIDTH=2 HEIGHT=2 REF=30
    DATA [0, 85, 170, 255]
  END

  VGROUP SwathRoot CLASS="SWATH" REF=40
    MEMBER SDS Radiance
    MEMBER VDATA Telemetry
    MEMBER RASTER8 Quicklook
  END
END
`;

describe("HDF4 DDL parser & formatter", () => {
  it("parses HDF4 header, SDS, VGROUP, VDATA, RASTER8, comments, and attributes", () => {
    const doc = parseHdf4Ddl(SAMPLE_DDL);
    assert.equal(doc.parseErrors.length, 0);
    assert.equal(doc.name, "MODIS_Granule");
    assert.equal(doc.version, "4.2");
    assert.equal(doc.attributes.length, 2);

    assert.equal(doc.sdsList.length, 1);
    const sds = doc.sdsList[0]!;
    assert.equal(sds.name, "Radiance");
    assert.equal(sds.dataType, Hdf4DataType.DFNT_FLOAT32);
    assert.equal(sds.ref, 10);
    assert.equal(sds.unit, "W/(m2.sr.um)");
    assert.equal(sds.scaleFactor, 0.01);
    assert.equal(sds.addOffset, 0.5);
    assert.equal(sds.fillValue, -999);
    assert.deepEqual(
      sds.dims.map((d) => [d.name, d.size]),
      [
        ["lines", 2],
        ["pixels", 3],
      ],
    );
    assert.deepEqual(sds.data, [10.0, 20.5, 30.0, 40.5, 50.0, 60.5]);

    assert.equal(doc.vdatas.length, 1);
    assert.equal(doc.vdatas[0]!.records.length, 2);
    assert.equal(doc.rasters.length, 1);
    assert.deepEqual(doc.rasters[0]!.pixels, [0, 85, 170, 255]);

    assert.equal(doc.vgroups.length, 1);
    assert.equal(doc.vgroups[0]!.members.length, 3);
  });

  it("round-trips through formatHdf4Ddl and unified parseHdf4", () => {
    const original = parseHdf4(SAMPLE_DDL);
    const formatted = formatHdf4Ddl(original);
    const reparsed = parseHdf4(formatted);

    assert.equal(reparsed.parseErrors.length, 0);
    assert.equal(reparsed.name, original.name);
    assert.equal(reparsed.sdsList.length, original.sdsList.length);
    assert.deepEqual(reparsed.sdsList[0]!.data, original.sdsList[0]!.data);
    assert.equal(reparsed.vgroups.length, original.vgroups.length);
    assert.equal(reparsed.vdatas.length, original.vdatas.length);
    assert.equal(reparsed.rasters.length, original.rasters.length);
  });
});
