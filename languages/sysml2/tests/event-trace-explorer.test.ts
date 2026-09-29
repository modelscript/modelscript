// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SysML2EventTraceExplorer } from "../src/event-trace-explorer.js";

describe("SysML v2 Event Trace Explorer (Monterey Phoenix Bridge)", () => {
  it("should extract activity actions and generate scope-complete execution traces", () => {
    const sysml = `
      package SpacecraftGuidance {
        action def GuidanceRoutine {
          first action InitSensors;
          then action ComputeTrajectory;
          then action FireThrusters;
        }
      }
    `;

    const res = SysML2EventTraceExplorer.exploreText(sysml, { scope: 1 });
    assert(res.totalTracesExplored >= 1, "Should find at least 1 valid trace");
    assert.strictEqual(res.isCertified, true);
    assert(res.traces[0]?.summary.includes("GuidanceRoutine.InitSensors"));
    assert(res.traces[0]?.summary.includes("GuidanceRoutine.ComputeTrajectory"));
    assert(res.traces[0]?.summary.includes("GuidanceRoutine.FireThrusters"));
  });

  it("should detect race conditions and assertion violations with normalized trace records", () => {
    const sysml = `
      package PowerGrid {
        action def MainGrid {
          first action ConnectGenerator;
        }

        action def BackupGrid {
          first action ConnectGenerator;
        }

        // Both grids connecting generator simultaneously triggers bus overcurrent hazard
        assert mutex(MainGrid.ConnectGenerator, BackupGrid.ConnectGenerator);
      }
    `;

    const res = SysML2EventTraceExplorer.exploreText(sysml, { scope: 1 });
    assert.strictEqual(res.isCertified, false);
    assert.strictEqual(res.violations.length, 1);
    assert(res.violations[0]?.description.includes("Mutual exclusion"));
    assert(res.violations[0]?.traceRecord !== undefined);
    assert.strictEqual(res.violations[0]?.traceRecord.source, "bmc");
    assert.strictEqual(res.violations[0]?.traceRecord.status, "FALSIFIED");
  });
});
