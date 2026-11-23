// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendNmeaChecksum, lowerNmea0183ToDae, nmea0183ToDae, parseNmea0183 } from "../src/index.js";

const SAMPLE_TRACK = [
  appendNmeaChecksum("$GPGGA,120000,3723.2475,N,12158.3416,W,1,09,1.0,12.0,M,-30.0,M,,"),
  appendNmeaChecksum("$GPRMC,120000,A,3723.2475,N,12158.3416,W,12.0,090.0,221126,013.5,E"),
  appendNmeaChecksum("$GPGGA,120010,3723.2475,N,12158.3000,W,1,09,1.0,13.5,M,-30.0,M,,"),
  appendNmeaChecksum("$GPRMC,120010,A,3723.2475,N,12158.3000,W,12.2,090.0,221126,013.5,E"),
  appendNmeaChecksum("$GPGGA,120020,3723.2475,N,12158.2584,W,1,09,1.0,15.0,M,-30.0,M,,"),
  appendNmeaChecksum("$HCHDG,092.5,1.2,E,13.5,E"),
  appendNmeaChecksum("$SDDBT,42.0,f,12.8,M,7.0,F"),
  appendNmeaChecksum("$IIMWV,035.0,R,14.2,N,A"),
].join("\n");

describe("@modelscript/nmea0183 DAE Lowering Suite", () => {
  it("lowers 3D ENU vehicle trajectory kinematics directly into IDaeBuilder", () => {
    const variables: Array<{ name: string; startVal: number }> = [];
    const equations: Array<{ kind: number; lhs: number; rhs: number }> = [];

    const mockBuilder: any = {
      addVariable: (name: string, _type: number, _var: number, _caus: number, startVal: number) => {
        variables.push({ name, startVal });
        return variables.length - 1;
      },
      addEquation: (kind: number, lhs: number, rhs: number) => {
        equations.push({ kind, lhs, rhs });
        return equations.length - 1;
      },
      addBinaryExpr: () => 100 + equations.length,
      addName: (id: number) => 200 + id,
      addDer: (id: number) => 300 + id,
      lookupVariable: () => -1,
    };

    const doc = parseNmea0183(SAMPLE_TRACK);
    const res = lowerNmea0183ToDae(mockBuilder, doc);

    assert.strictEqual(res.stateVarIndices.length, 7);
    assert.strictEqual(res.equationCount, 8);
    assert.ok(res.variableMap.has("pos_e"));
    assert.ok(res.variableMap.has("pos_n"));
    assert.ok(res.variableMap.has("pos_u"));
    assert.ok(res.variableMap.has("vel_e"));
    assert.ok(res.variableMap.has("s_dist"));
    assert.ok(res.variableMap.has("heading_mag_deg"));
    assert.ok(res.variableMap.has("depth_below_transducer_m"));
    assert.ok(res.variableMap.has("wind_speed"));
  });

  it("constructs a live DAEBuilder arena via nmea0183ToDae", () => {
    const { builder, result } = nmea0183ToDae(SAMPLE_TRACK);
    assert.ok(builder);
    assert.strictEqual(result.equationCount, 8);
    assert.ok(result.track.totalDistanceVincentyM > 100);
    assert.strictEqual(result.track.durationSec, 20);
  });
});
