// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintSedml, parseSedml, SedmlErrorCode } from "../src/index.js";

test("SED-ML Linter: detects invalid time course bounds (M9151)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sedML level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="sim_bad" initialTime="10" outputStartTime="0" outputEndTime="5" numberOfSteps="20">
      <algorithm kisaoID="KISAO:0000019"/>
    </uniformTimeCourse>
  </listOfSimulations>
</sedML>`;
  const doc = parseSedml(xml);
  const diags = lintSedml(doc);
  assert.ok(diags.some((d) => d.code === SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.code));
});

test("SED-ML Linter: detects malformed KiSAO ID (M9152)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sedML level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="sim1" initialTime="0" outputStartTime="0" outputEndTime="10" numberOfSteps="20">
      <algorithm kisaoID="INVALID_KISAO"/>
    </uniformTimeCourse>
  </listOfSimulations>
</sedML>`;
  const doc = parseSedml(xml);
  const diags = lintSedml(doc);
  assert.ok(diags.some((d) => d.code === SedmlErrorCode.INVALID_KISAO_ID.code));
});

test("SED-ML Linter: detects undefined model reference in task (M9153)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sedML level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="sim1" initialTime="0" outputStartTime="0" outputEndTime="10" numberOfSteps="20">
      <algorithm kisaoID="KISAO:0000019"/>
    </uniformTimeCourse>
  </listOfSimulations>
  <listOfTasks>
    <task id="t1" modelReference="missing_model" simulationReference="sim1"/>
  </listOfTasks>
</sedML>`;
  const doc = parseSedml(xml);
  const diags = lintSedml(doc);
  assert.ok(diags.some((d) => d.code === SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.code));
});
