// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  computeFitzpatrickTre,
  lowerIgtlToDae,
  solvePivotCalibration,
  solveTransformChainAndPivot,
} from "../src/kinematics/index.js";
import { parseIgtl } from "../src/parser/index.js";
import type { Matrix4x4 } from "../src/types.js";

describe("SE(3) Transform Chain, Stylus Pivot Calibration, Fitzpatrick TRE & DAE Lowering", () => {
  it("solves shortest-path SE(3) transform chain and least-squares stylus pivot calibration", () => {
    // True stylus tip in tool coordinates: p_tip = [0, 0, 150] mm
    // True stationary pivot point in tracker coordinates: p_pivot = [100, 200, 300] mm
    // For any rotation R_i, t_i = p_pivot - R_i * p_tip
    const pose1: Matrix4x4 = [1, 0, 0, 100, 0, 1, 0, 200, 0, 0, 1, 150, 0, 0, 0, 1];
    // 90 deg rotation around X: R_2 * [0, 0, 150]^T = [0, -150, 0]^T => t_2 = [100, 350, 300]^T
    const pose2: Matrix4x4 = [1, 0, 0, 100, 0, 0, -1, 350, 0, 1, 0, 300, 0, 0, 0, 1];
    // 90 deg rotation around Y: R_3 * [0, 0, 150]^T = [150, 0, 0]^T => t_3 = [-50, 200, 300]^T
    const pose3: Matrix4x4 = [0, 0, 1, -50, 0, 1, 0, 200, -1, 0, 0, 300, 0, 0, 0, 1];

    const pivotRes = solvePivotCalibration([pose1, pose2, pose3]);
    assert.strictEqual(pivotRes.poseCount, 3);
    assert(Math.abs(pivotRes.stylusTipOffsetMm[2] - 150.0) < 1e-3);
    assert(Math.abs(pivotRes.stylusLengthMm - 150.0) < 1e-3);
    assert(Math.abs(pivotRes.pivotPointMm[0] - 100.0) < 1e-3);
    assert(Math.abs(pivotRes.pivotPointMm[1] - 200.0) < 1e-3);
    assert(Math.abs(pivotRes.pivotPointMm[2] - 300.0) < 1e-3);
    assert(pivotRes.rmsErrorMm < 1e-4);
  });

  it("computes Fitzpatrick (1998) Target Registration Error (TRE) and lowers model to DAEBuilder", () => {
    const fiducials: Array<[number, number, number]> = [
      [-50, -50, 0],
      [50, -50, 0],
      [50, 50, 0],
      [-50, 50, 0],
    ];
    // At the centroid (0,0,0), d_k = 0 so TRE = FLE / sqrt(N) = 1.0 / sqrt(4) = 0.5 mm
    const treAtCenter = computeFitzpatrickTre(fiducials, [0, 0, 0], 1.0);
    assert(Math.abs(treAtCenter.treMm - 0.5) < 1e-4);

    // Away from the centroid, TRE increases with distance d_k / f_k
    const treOffCenter = computeFitzpatrickTre(fiducials, [80, 80, 50], 1.0);
    assert(treOffCenter.treMm > treAtCenter.treMm);

    const doc = parseIgtl(`<PlusConfiguration version="2.1">
      <DataCollection>
        <DeviceSet Name="Nav">
          <Device Id="Polaris" Type="PolarisTracker" AcquisitionRate="60">
            <OutputChannels><OutputChannel Id="TrackerStream"/></OutputChannels>
          </Device>
        </DeviceSet>
      </DataCollection>
      <CoordinateDefinitions>
        <Transform From="StylusTip" To="Stylus" Matrix="1 0 0 0  0 1 0 0  0 0 1 150  0 0 0 1"/>
        <Transform From="Stylus" To="Reference" Matrix="1 0 0 10  0 1 0 20  0 0 1 30  0 0 0 1"/>
      </CoordinateDefinitions>
      <FiducialRegistration FLE="0.8" Target="10 20 180">
        <Fiducial Position="-50 -50 0"/>
        <Fiducial Position="50 -50 0"/>
        <Fiducial Position="50 50 0"/>
        <Fiducial Position="-50 50 0"/>
      </FiducialRegistration>
    </PlusConfiguration>`);

    const chainRes = solveTransformChainAndPivot(doc, { fromFrame: "StylusTip", toFrame: "Reference" });
    assert.strictEqual(chainRes.isConnected, true);
    assert.deepStrictEqual(chainRes.framePath, ["StylusTip", "Stylus", "Reference"]);
    assert.deepStrictEqual(chainRes.translationMm, [10, 20, 180]);

    const arena = lowerIgtlToDae(doc);
    assert(arena.getVarCount() >= 8);
    assert(arena.getEqCount() >= 8);
  });
});
