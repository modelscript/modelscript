// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { OpenDriveWorkspaceIndex } from "../src/workspace-index.js";

const xmlA = `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="6"/>
  <road id="10" name="Highway_10" length="500.0" junction="-1">
    <planView><geometry s="0" x="0" y="0" hdg="0" length="500"><line/></geometry></planView>
    <lanes><laneSection s="0"><center><lane id="0" type="none"/></center></laneSection></lanes>
  </road>
</OpenDRIVE>`;

const xmlB = `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="6"/>
  <road id="20" name="Highway_20" length="300.0" junction="5">
    <planView><geometry s="0" x="500" y="0" hdg="0" length="300"><line/></geometry></planView>
    <lanes><laneSection s="0"><center><lane id="0" type="none"/></center></laneSection></lanes>
  </road>
  <junction id="5" name="Interchange_5">
    <connection id="0" incomingRoad="10" connectingRoad="20" contactPoint="start"/>
  </junction>
</OpenDRIVE>`;

describe("OpenDRIVE Multi-File Workspace Indexer", () => {
  it("indexes multiple road documents across workspace URIs", () => {
    const index = new OpenDriveWorkspaceIndex();
    index.indexFile("file:///roads/a.xodr", xmlA);
    index.indexFile("file:///roads/b.xodr", xmlB);

    assert.strictEqual(index.fileCount, 2);
    assert(index.has("file:///roads/a.xodr"));
    assert(index.has("file:///roads/b.xodr"));

    const docA = index.getDocument("file:///roads/a.xodr");
    assert.strictEqual(docA?.roads[0]?.id, "10");

    const docB = index.getDocument("file:///roads/b.xodr");
    assert.strictEqual(docB?.roads[0]?.id, "20");
    assert.strictEqual(docB?.junctions[0]?.id, "5");

    const fileIndexA = index.getFileIndex("file:///roads/a.xodr");
    assert(fileIndexA !== undefined);
    assert(fileIndexA.byName.has("10"));
  });

  it("handles reindexing and version increment", () => {
    const index = new OpenDriveWorkspaceIndex();
    index.indexFile("file:///roads/a.xodr", xmlA);
    const v1 = index.version;

    index.reindexDocument("file:///roads/a.xodr", () => xmlA);
    assert(index.version > v1);
  });
});
