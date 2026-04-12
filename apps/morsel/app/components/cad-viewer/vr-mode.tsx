// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * VR mode wrapper — adds WebXR support to the CadViewer canvas.
 *
 * Wraps Three.js scene contents in `<XR>` from @react-three/xr and renders
 * a VR button overlay. Controller grip/trigger events map to the same
 * selection callbacks used by the desktop mouse controls.
 */

import { XR, createXRStore } from "@react-three/xr";
import { useState } from "react";

const store = createXRStore();

interface VrModeProps {
  children: React.ReactNode;
  enabled?: boolean;
}

/** VR toggle button overlay. */
export function VrButton() {
  const [supported, setSupported] = useState<boolean | null>(null);

  // Check WebXR support once
  if (supported === null && typeof navigator !== "undefined" && "xr" in navigator) {
    navigator.xr?.isSessionSupported("immersive-vr").then((s) => setSupported(s));
  }

  if (!supported) return null;

  return (
    <button
      onClick={() => store.enterVR()}
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "8px 20px",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        boxShadow: "0 4px 14px rgba(102, 126, 234, 0.4)",
        zIndex: 10,
        letterSpacing: "0.5px",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.target as HTMLElement).style.transform = "translateX(-50%) scale(1.05)";
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLElement).style.transform = "translateX(-50%)";
      }}
    >
      Enter VR
    </button>
  );
}

/** VR wrapper — wraps scene children in XR context. */
export default function VrMode({ children, enabled = true }: VrModeProps) {
  if (!enabled) return <>{children}</>;

  return <XR store={store}>{children}</XR>;
}
