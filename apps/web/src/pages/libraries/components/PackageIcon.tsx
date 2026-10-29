// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import Box from "../../../components/Box";
import InvertedSvg from "../../../components/InvertedSvg";
import { encodePackagePath } from "../../../util/url";

export interface PackageIconProps {
  name: string;
  version: string;
}

export const PackageIcon: React.FC<PackageIconProps> = ({ name, version }) => {
  const rootClassName = name.includes("/") ? name.split("/")[1]! : name;
  const iconUrl = `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/classes/${encodeURIComponent(rootClassName)}/icon.svg`;

  const fallbackBox = (
    <Box
      sx={{
        width: 40,
        height: 40,
        borderRadius: "8px",
        background: "var(--gradient-icon-box)",
        border: "1px solid var(--gradient-icon-box-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "18px",
        flexShrink: 0,
        boxShadow: "var(--glow-ai-sm)",
      }}
    >
      📦
    </Box>
  );

  return (
    <InvertedSvg
      src={iconUrl}
      alt={`${name} icon`}
      width={40}
      height={40}
      style={{ borderRadius: "8px", flexShrink: 0 }}
      fallback={fallbackBox}
    />
  );
};
