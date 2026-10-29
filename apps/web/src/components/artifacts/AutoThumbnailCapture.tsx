// SPDX-License-Identifier: AGPL-3.0-or-later

import { useThree } from "@react-three/fiber";
import React, { useEffect, useRef } from "react";
import { uploadArtifactThumbnail } from "../../api";

interface AutoThumbnailCaptureProps {
  artifactId?: number | undefined;
  hasThumbnail?: boolean | undefined;
}

export function captureCompositeCanvasDataUrl(sourceCanvas: HTMLCanvasElement | null | undefined): string | null {
  if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) {
    return null;
  }
  try {
    const w = Math.min(sourceCanvas.width, 960);
    const h = Math.max(1, Math.round(w * (sourceCanvas.height / sourceCanvas.width)));
    const probeCanvas = document.createElement("canvas");
    probeCanvas.width = w;
    probeCanvas.height = h;
    const ctx = probeCanvas.getContext("2d");
    if (!ctx || typeof ctx.getImageData !== "function" || typeof ctx.createRadialGradient !== "function") {
      const raw = sourceCanvas.toDataURL("image/webp", 0.85);
      return raw && raw.length > 1000 ? raw : null;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(sourceCanvas, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h).data;
    const cornerR = imgData[0] ?? 0;
    const cornerG = imgData[1] ?? 0;
    const cornerB = imgData[2] ?? 0;
    const cornerA = imgData[3] ?? 0;

    let renderedSamples = 0;
    const cols = 16;
    const rows = 10;
    for (let ry = 1; ry <= rows; ry++) {
      const y = Math.floor((ry / (rows + 1)) * h);
      for (let rx = 1; rx <= cols; rx++) {
        const x = Math.floor((rx / (cols + 1)) * w);
        const idx = (y * w + x) * 4;
        const r = imgData[idx] ?? 0;
        const g = imgData[idx + 1] ?? 0;
        const b = imgData[idx + 2] ?? 0;
        const a = imgData[idx + 3] ?? 0;
        if (cornerA < 16) {
          if (a > 24) renderedSamples++;
        } else {
          if (Math.abs(r - cornerR) + Math.abs(g - cornerG) + Math.abs(b - cornerB) > 15) {
            renderedSamples++;
          }
        }
      }
    }

    if (renderedSamples < 1) {
      return null;
    }

    const dataUrl = probeCanvas.toDataURL("image/webp", 0.88);
    return dataUrl && dataUrl.length > 1000 ? dataUrl : null;
  } catch {
    try {
      const raw = sourceCanvas.toDataURL("image/webp", 0.85);
      return raw && raw.length > 1000 ? raw : null;
    } catch {
      return null;
    }
  }
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
    if (!artifactId || capturedRef.current) return;

    const parentFailed = Boolean(gl.domElement?.closest?.("[data-thumbnail-failed='true']"));
    if (hasThumbnail && !parentFailed) return;

    const doCapture = (uploadToServer: boolean) => {
      try {
        const dataUrl = captureCompositeCanvasDataUrl(gl.domElement);
        if (dataUrl) {
          window.dispatchEvent(
            new CustomEvent("artifact-thumbnail-captured", {
              detail: { artifactId, dataUrl },
            }),
          );
          if (uploadToServer && !capturedRef.current) {
            capturedRef.current = true;
            uploadArtifactThumbnail(artifactId, dataUrl).catch(() => {});
          }
        }
      } catch {
        // Handled silently
      }
    };

    const t1 = setTimeout(() => doCapture(false), 600);
    const t2 = setTimeout(() => doCapture(true), 1600);
    const t3 = setTimeout(() => doCapture(true), 3200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [artifactId, hasThumbnail, gl]);

  return null;
};

export default AutoThumbnailCapture;
