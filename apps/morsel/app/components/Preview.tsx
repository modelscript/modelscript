// SPDX-License-Identifier: AGPL-3.0-or-later

import { WorkflowIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { getClassIcon } from "~/util/lsp-bridge";
import { invertSvgColors } from "~/util/x6";

export interface ModelPreviewProps {
  model?: { id: string; name: string; content: string };
  colorMode?: string;
}

export const ModelPreview: React.FC<ModelPreviewProps> = ({ model, colorMode = "light" }) => {
  const isDark = colorMode.includes("night") || colorMode.includes("dark");
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!model?.name) return;
    let cancelled = false;
    getClassIcon(model.name)
      .then((res) => {
        if (!cancelled && res) setSvg(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [model?.name]);

  const displaySvg = svg ? invertSvgColors(svg, isDark) : null;

  return (
    <div
      style={{
        width: 120,
        height: 120,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.03)",
        borderRadius: 8,
        position: "relative",
        overflow: "hidden",
        border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)"}`,
      }}
    >
      {displaySvg ? (
        <div
          style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center" }}
          dangerouslySetInnerHTML={{ __html: displaySvg }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            color: isDark ? "#8b949e" : "#57606a",
          }}
        >
          <WorkflowIcon size={32} />
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              opacity: 0.7,
            }}
          >
            {model?.name ? model.name.split(".").pop() : "Model"}
          </span>
        </div>
      )}
    </div>
  );
};

export default ModelPreview;
