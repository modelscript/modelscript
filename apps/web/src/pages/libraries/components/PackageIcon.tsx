// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import Box from "../../../components/Box";
import { encodePackagePath } from "../../../util/url";

export interface PackageIconProps {
  name: string;
  version: string;
}

export const PackageIcon: React.FC<PackageIconProps> = ({ name, version }) => {
  const [error, setError] = useState(false);
  const rootClassName = name.includes("/") ? name.split("/")[1]! : name;
  const iconUrl = `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/classes/${encodeURIComponent(rootClassName)}/icon.svg`;

  if (error) {
    return (
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: "10px",
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
  }

  return (
    <img
      src={iconUrl}
      alt={`${name} icon`}
      style={{ width: 40, height: 40, borderRadius: "8px", flexShrink: 0, objectFit: "contain" }}
      onError={() => setError(true)}
    />
  );
};
