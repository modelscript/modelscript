// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  applyStickDeadzone,
  createDynamicWireTubeBuffer,
  pointAlongRayPose,
  predictTossIntoRecycleBin,
  readThumbstick,
  releaseEventForBinding,
  resolveXrPointerBinding,
  sampleXrSpaceWorldPose,
  shouldTriggerForcePull,
  springFollowStep,
  VerletCableSim,
} from "@modelscript/rotunda/index.js";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import * as THREE from "three";

/** Minimal fake XR input source (only the fields the binding logic reads). */
function fakeInputSource(opts: { handedness?: "left" | "right"; hand?: boolean; axes?: number[] }): XRInputSource {
  return {
    handedness: opts.handedness ?? "right",
    hand: opts.hand ? ({ get: () => undefined } as unknown as XRHand) : undefined,
    targetRaySpace: { tag: "ray" } as unknown as XRSpace,
    gripSpace: { tag: "grip" } as unknown as XRSpace,
    gamepad: opts.axes ? ({ axes: opts.axes, hapticActuators: [] } as unknown as Gamepad) : undefined,
  } as unknown as XRInputSource;
}

describe("VR Rotunda — XR pointer binding (input follows the hand, never the head)", () => {
  test("desktop mouse events resolve to a desktop binding", () => {
    const b = resolveXrPointerBinding({ pointerId: 1, pointerType: "mouse", distance: 2.5 });
    assert.equal(b.kind, "desktop");
    assert.equal(b.inputSource, null);
    assert.equal(b.hitDistance, 2.5);
  });

  test("native touchscreen 'touch' without an XR pointerState is still desktop", () => {
    const b = resolveXrPointerBinding({ pointerId: 3, pointerType: "touch" });
    assert.equal(b.kind, "desktop");
  });

  test("controller laser / grip / hand events bind to their own input source", () => {
    const src = fakeInputSource({ handedness: "left" });
    const ray = resolveXrPointerBinding({
      pointerId: 7,
      pointerType: "ray",
      pointerState: { inputSource: src },
      distance: 1.2,
    });
    assert.equal(ray.kind, "ray");
    assert.equal(ray.handedness, "left");
    assert.equal(ray.inputSource, src);
    assert.equal(ray.hitDistance, 1.2);
    assert.equal(releaseEventForBinding(ray), "selectend");

    const grab = resolveXrPointerBinding({ pointerId: 8, pointerType: "grab", pointerState: { inputSource: src } });
    assert.equal(grab.kind, "grab");
    assert.equal(grab.isHand, false);
    assert.equal(releaseEventForBinding(grab), "squeezeend", "controller direct grab releases on grip");

    const handSrc = fakeInputSource({ hand: true });
    const handGrab = resolveXrPointerBinding({
      pointerId: 9,
      pointerType: "grab",
      pointerState: { inputSource: handSrc },
    });
    assert.equal(handGrab.isHand, true);
    assert.equal(releaseEventForBinding(handGrab), "selectend", "hand grab releases on pinch end");

    const touch = resolveXrPointerBinding({
      pointerId: 10,
      pointerType: "touch",
      pointerState: { inputSource: handSrc },
    });
    assert.equal(releaseEventForBinding(touch), null);
  });

  test("sampleXrSpaceWorldPose applies the XROrigin (locomotion) transform", () => {
    const space = {} as XRSpace;
    const frame = {
      getPose: (s: XRSpace) =>
        s === space
          ? ({
              transform: {
                position: { x: 0, y: 1.5, z: -0.3 },
                orientation: { x: 0, y: 0, z: 0, w: 1 },
              },
            } as unknown as XRPose)
          : undefined,
    } as unknown as XRFrame;
    const origin = new THREE.Group();
    origin.position.set(2, 0, -1);
    origin.rotation.y = Math.PI; // turned around
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const ok = sampleXrSpaceWorldPose(frame, {} as XRReferenceSpace, origin, space, pos, quat);
    assert.ok(ok);
    assert.ok(Math.abs(pos.x - 2) < 1e-6);
    assert.ok(Math.abs(pos.y - 1.5) < 1e-6);
    assert.ok(Math.abs(pos.z - -0.7) < 1e-6, `z=${pos.z}`); // -1 + 0.3 after 180° yaw
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    assert.ok(fwd.z > 0.99, "forward flips with origin yaw");
  });

  test("moving the controller moves the laser tip; head pose is irrelevant", () => {
    const tipA = pointAlongRayPose(new THREE.Vector3(0, 1, 0), new THREE.Quaternion(), 1, new THREE.Vector3());
    const tipB = pointAlongRayPose(new THREE.Vector3(0.3, 1, 0), new THREE.Quaternion(), 1, new THREE.Vector3());
    assert.ok(Math.abs(tipB.x - tipA.x - 0.3) < 1e-9, "tip translates 1:1 with the hand");
    assert.ok(Math.abs(tipA.z - -1) < 1e-9, "tip is along controller -Z");
  });

  test("thumbstick read + deadzone", () => {
    const b = resolveXrPointerBinding({
      pointerId: 1,
      pointerType: "ray",
      pointerState: { inputSource: fakeInputSource({ axes: [0, 0, 0.05, -0.9] }) },
    });
    const s = readThumbstick(b);
    assert.equal(s.x, 0.05);
    assert.equal(s.y, -0.9);
    assert.equal(applyStickDeadzone(s.x), 0);
    assert.ok(applyStickDeadzone(s.y) < -0.85);
    assert.deepEqual(readThumbstick(undefined), { x: 0, y: 0 });
  });

  test("springFollowStep converges without overshoot (critically damped)", () => {
    const pos = new THREE.Vector3(0, 0, 0);
    const vel = new THREE.Vector3();
    const target = new THREE.Vector3(1, 0, 0);
    let maxX = 0;
    for (let i = 0; i < 120; i++) {
      springFollowStep(pos, vel, target, 1 / 90, 0.03);
      maxX = Math.max(maxX, pos.x);
    }
    assert.ok(Math.abs(pos.x - 1) < 1e-3, `converged x=${pos.x}`);
    assert.ok(maxX <= 1.0005, `no overshoot (max=${maxX})`);
  });

  test("VerletCableSim pins endpoints, drapes under gravity, and drives DynamicWireTubeBuffer cleanly", () => {
    const sim = new VerletCableSim(25);
    const start: [number, number, number] = [-0.25, 0.1, 0];
    const startN: [number, number, number] = [1, 0, 0];
    const end: [number, number, number] = [0.25, 0.1, 0];
    for (let i = 0; i < 60; i++) {
      sim.step(start, startN, end, null, 1 / 90);
    }
    const pts = sim.positions;
    // Endpoints stay pinned
    assert.ok(Math.abs(pts[0]! - start[0]) < 1e-6);
    assert.ok(Math.abs(pts[1]! - start[1]) < 1e-6);
    const last = (sim.nodeCount - 1) * 3;
    assert.ok(Math.abs(pts[last]! - end[0]) < 1e-6);
    assert.ok(Math.abs(pts[last + 1]! - end[1]) < 1e-6);
    // Midpoint sags below the y = 0.1 line under gravity
    const midY = pts[12 * 3 + 1]!;
    assert.ok(midY < 0.08, `expected cable sag below 0.1, got midY=${midY}`);

    // Drives DynamicWireTubeBuffer with all finite vertices & normals
    const tube = createDynamicWireTubeBuffer(24, 8);
    tube.updateFromPolyline(pts, sim.nodeCount, 0.004);
    const posArr = tube.geometry.getAttribute("position").array;
    const normArr = tube.geometry.getAttribute("normal").array;
    for (let i = 0; i < posArr.length; i++) {
      assert.ok(Number.isFinite(posArr[i]!), `non-finite position[${i}]`);
      assert.ok(Number.isFinite(normArr[i]!), `non-finite normal[${i}]`);
    }
    tube.dispose();
  });

  test("predictTossIntoRecycleBin detects ballistic throws into the disposal chute", () => {
    const bin: [number, number, number] = [0.64, -0.34, 0.14];
    // Aimed toss toward bin -> hit!
    const hit = predictTossIntoRecycleBin([0.1, 0.0, 0.14], [1.4, 0.25, 0], bin);
    assert.equal(hit.willHit, true, `expected hit, minDist=${hit.minDistance}`);
    assert.ok(hit.impactTimeSec > 0.1 && hit.impactTimeSec < 0.85);
    // Gentle drop below min speed -> never triggers accidental toss delete
    const slow = predictTossIntoRecycleBin([0.4, -0.2, 0.14], [0.2, -0.1, 0], bin);
    assert.equal(slow.willHit, false);
    // Throw in opposite direction -> miss
    const miss = predictTossIntoRecycleBin([0.1, 0.0, 0.14], [-1.5, 0.4, 0], bin);
    assert.equal(miss.willHit, false);
  });

  test("shouldTriggerForcePull triggers only on brisk backward wrist flick for distant objects", () => {
    const rayFwd: [number, number, number] = [0, 0, -1];
    // Brisk backward flick (+Z = opposite to rayFwd -Z) at 2 m/s while holding at 1.2 m
    assert.equal(shouldTriggerForcePull([0, 1.2, 0], [0, 1.2, 0.04], rayFwd, 0.02, 1.2), true);
    // Slow hand drift (0.3 m/s) -> false
    assert.equal(shouldTriggerForcePull([0, 1.2, 0], [0, 1.2, 0.006], rayFwd, 0.02, 1.2), false);
    // Pushing forward (-Z) -> false
    assert.equal(shouldTriggerForcePull([0, 1.2, 0], [0, 1.2, -0.05], rayFwd, 0.02, 1.2), false);
    // Already close to hand (0.25 m) -> false
    assert.equal(shouldTriggerForcePull([0, 1.2, 0], [0, 1.2, 0.04], rayFwd, 0.02, 0.25), false);
  });
});
