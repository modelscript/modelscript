// SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from "three";

/**
 * Convert URDF Z-up (X forward, Y left, Z up) pose into Three.js Y-up (X right, Y up, Z out):
 *   p_three = [x, z, -y]
 *   R_three = T * R_urdf * T^T, where T = [[1,0,0],[0,0,1],[0,-1,0]]
 */
export function urdfPoseToThree(
  pos: [number, number, number],
  rot?: [number, number, number, number, number, number, number, number, number],
): { position: [number, number, number]; quaternion: THREE.Quaternion } {
  const position: [number, number, number] = [pos[0], pos[2], -pos[1]];
  const quaternion = new THREE.Quaternion();
  if (rot && rot.length === 9) {
    const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = rot;
    const m4 = new THREE.Matrix4();
    m4.set(r0, r2, -r1, 0, r6, r8, -r7, 0, -r3, -r5, r4, 0, 0, 0, 0, 1);
    quaternion.setFromRotationMatrix(m4);
  }
  return { position, quaternion };
}
