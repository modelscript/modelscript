// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLibrarySpecsFromQuery } from "../src/utils/library-query.js";

describe("URL-Driven Stdlib and Custom Package Preloading Query Parser", () => {
  it("parses ?stdlib= and ?libs= URL query parameters for language-specific workspaces", () => {
    const modelicaOnly = parseLibrarySpecsFromQuery("#memfs:empty?stdlib=modelica");
    assert.equal(modelicaOnly.explicit, true);
    assert.deepEqual(modelicaOnly.deps, [{ name: "Modelica", version: "4.1.0" }]);

    const sysmlAndCustom = parseLibrarySpecsFromQuery(
      "#memfs:empty?stdlib=sysml2&libs=PlanarMechanics@1.6.0,@modelscript/thermal@2.1.0",
    );
    assert.equal(sysmlAndCustom.explicit, true);
    assert.deepEqual(sysmlAndCustom.deps, [
      { name: "SysML", version: "2026.3.0" },
      { name: "PlanarMechanics", version: "1.6.0" },
      { name: "@modelscript/thermal", version: "2.1.0" },
    ]);

    const explicitNone = parseLibrarySpecsFromQuery("#memfs:empty?stdlib=none");
    assert.equal(explicitNone.explicit, true);
    assert.deepEqual(explicitNone.deps, []);

    const noParams = parseLibrarySpecsFromQuery("#memfs:empty");
    assert.equal(noParams.explicit, false);
    assert.deepEqual(noParams.deps, []);
  });
});
