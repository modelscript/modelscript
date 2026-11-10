// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BarrierCertificateShellSpec } from "@modelscript/cad";

export interface BarrierShellOverlayProps {
  shells?: BarrierCertificateShellSpec[] | undefined;
  visible?: boolean | undefined;
}

/**
 * BarrierShellOverlay — Renders formal Lyapunov safety barrier iso-surfaces in 3D.
 */
export const BarrierShellOverlay: React.FC<BarrierShellOverlayProps> = ({ shells, visible = true }) => {
  if (!visible || !shells || shells.length === 0) return null;

  return (
    <group name="barrier-certificate-shells">
      {shells.map((shell) => (
        <BarrierSingleShell key={shell.id} shell={shell} />
      ))}
    </group>
  );
};

const BarrierSingleShell: React.FC<{ shell: BarrierCertificateShellSpec }> = ({ shell }) => {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(shell.vertices), 3));
    if (shell.indices && shell.indices.length > 0) {
      geo.setIndex(shell.indices);
    }
    if (shell.normals && shell.normals.length === shell.vertices.length) {
      geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(shell.normals), 3));
    } else {
      geo.computeVertexNormals();
    }
    return geo;
  }, [shell]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const shellColor = shell.color ?? "#38bdf8";

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={shellColor}
        transparent
        opacity={shell.opacity ?? 0.3}
        wireframe={false}
        side={THREE.DoubleSide}
        depthWrite={false}
        roughness={0.4}
        metalness={0.1}
      />
    </mesh>
  );
};
