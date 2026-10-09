// SPDX-License-Identifier: AGPL-3.0-or-later

import { useThree } from "@react-three/fiber";
import React, { useEffect, useRef } from "react";
import { uploadArtifactThumbnail } from "../../api";

interface AutoThumbnailCaptureProps {
  artifactId?: number;
  hasThumbnail?: boolean;
}

/**
 * AutoThumbnailCapture
 *
 * Self-healing thumbnail generator mounted inside Three.js Canvas.
 * When a 3D scene renders without an existing server thumbnail,
 * this component captures a webp snapshot directly from the WebGL
 * context and uploads it to the backend.
 */
export const AutoThumbnailCapture: React.FC<AutoThumbnailCaptureProps> = ({ artifactId, hasThumbnail }) => {
  const { gl } = useThree();
  const capturedRef = useRef(false);

  useEffect(() => {
    if (!artifactId || hasThumbnail || capturedRef.current) return;

    const timer = setTimeout(() => {
      if (capturedRef.current) return;
      try {
        const dataUrl = gl.domElement.toDataURL("image/webp", 0.85);
        if (dataUrl && dataUrl.length > 500) {
          capturedRef.current = true;
          uploadArtifactThumbnail(artifactId, dataUrl).catch(() => {});
        }
      } catch {
        // Handled silently
      }
    }, 1800);

    return () => clearTimeout(timer);
  }, [artifactId, hasThumbnail, gl]);

  return null;
};

export default AutoThumbnailCapture;
