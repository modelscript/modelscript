// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { ReqIfWorkspaceIndex } from "../src/index.js";

const SAMPLE_REQIF = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="H1"><TITLE>Chassis Requirements</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-STRUCT-01" LONG-NAME="Structural Rigidity">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Torsional stiffness must be &gt;= 25000 N*m/deg.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-MASS-01" LONG-NAME="Curb Weight">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <THE-VALUE>Total chassis mass must be &lt;= 320 kg.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01" LONG-NAME="refines">
          <SOURCE><SPEC-OBJECT-REF>REQ-MASS-01</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-STRUCT-01</SPEC-OBJECT-REF></TARGET>
        </SPEC-RELATION>
      </SPEC-RELATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

describe("@modelscript/reqif workspace indexer", () => {
  it("indexes ReqIF files and resolves symbols across workspace", () => {
    const indexer = new ReqIfWorkspaceIndex();
    const uri = "file:///workspace/chassis.reqif";

    const index = indexer.indexFile(uri, SAMPLE_REQIF);
    assert.strictEqual(indexer.fileCount, 1);
    assert.ok(index.symbols.size >= 3); // Package + 2 requirements

    const found = indexer.findSymbols("Rigidity");
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0]!.name, "REQ-STRUCT-01");

    const resolved = indexer.resolveQualified("REQ-MASS-01");
    assert.ok(resolved);
    assert.strictEqual(resolved.name, "REQ-MASS-01");

    // References to REQ-STRUCT-01 (target of REL-01)
    const refs = indexer.referencesTo(found[0]!.id);
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0]!.uri, uri);
  });
});
