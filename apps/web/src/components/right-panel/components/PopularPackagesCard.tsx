// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@primer/react";
import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PackageIcon } from "../../../pages/libraries/components/PackageIcon";
import { formatDomainLabel, inferPackageDomains, splitScopedPackageName } from "../../../pages/libraries/constants";
import Box from "../../Box";
import { Card, CardHeader, CardTitle, PanelBadge, PanelList, ShowMoreLink, TrendingItem } from "../styles";

export interface PopularPackagesCardProps {
  popularPackages: any[];
}

export const PopularPackagesCard: React.FC<PopularPackagesCardProps> = ({ popularPackages }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isPackages =
    location.pathname.replace(/\/$/, "") === "/packages" || location.pathname.replace(/\/$/, "") === "/libraries";

  if (popularPackages.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Popular Packages</CardTitle>
      </CardHeader>
      <PanelList>
        {popularPackages.map((pkg) => {
          const latestVer =
            pkg.latestVersion || pkg.version || (Array.isArray(pkg.versions) && pkg.versions[0]) || "1.0.0";
          const targetUrl = latestVer ? `/packages/${pkg.name}/${latestVer}` : `/packages/${pkg.name}`;
          const { scope, baseName } = splitScopedPackageName(pkg.name);
          const domains = inferPackageDomains({
            name: pkg.name,
            domains: pkg.domains,
            description: pkg.description,
          });
          const subtitle = scope
            ? scope.replace(/^@/, "")
            : pkg.author
              ? String(pkg.author).replace(/^@/, "")
              : formatDomainLabel(domains[0] || "modelica");
          const isActive =
            location.pathname === `/packages/${pkg.name}` || location.pathname.startsWith(`/packages/${pkg.name}/`);

          return (
            <TrendingItem key={pkg.name} $active={isActive} onClick={() => navigate(targetUrl)}>
              <Link
                to={targetUrl}
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textDecoration: "none",
                  color: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  overflow: "hidden",
                }}
              >
                <PackageIcon
                  name={pkg.name}
                  version={latestVer}
                  domains={domains}
                  description={pkg.description}
                  size={34}
                />
                <Box flex={1} minWidth={0} display="flex" flexDirection="column">
                  <Text
                    style={{
                      fontWeight: 600,
                      fontSize: "13px",
                      lineHeight: "18px",
                      color: "var(--color-text-heading)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={pkg.name}
                  >
                    {baseName}
                  </Text>
                  <Text
                    style={{
                      color: "var(--color-text-muted)",
                      fontSize: "12px",
                      lineHeight: "16px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={subtitle}
                  >
                    {subtitle}
                  </Text>
                </Box>
              </Link>
              <PanelBadge>{`v${latestVer}`}</PanelBadge>
            </TrendingItem>
          );
        })}
        {!isPackages && <ShowMoreLink to="/packages">Explore all packages →</ShowMoreLink>}
      </PanelList>
    </Card>
  );
};
