// SPDX-License-Identifier: AGPL-3.0-or-later

import { Heading, Text } from "@primer/react";
import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CURATED_ENGINEERING_DOMAINS } from "../../../pages/explore/constants";
import Box from "../../Box";
import { Card } from "../styles";

export const EngineeringDomainsCard: React.FC = () => {
  const [searchParams] = useSearchParams();
  const activeTopic = (searchParams.get("topic") || searchParams.get("tag") || "").toLowerCase();

  return (
    <Card>
      <Box display="flex" alignItems="center" gap={2} mb={1}>
        <Heading
          as="h2"
          style={{
            fontSize: "15px",
            lineHeight: "20px",
            fontWeight: 700,
            margin: 0,
            color: "var(--color-text-heading)",
          }}
        >
          Engineering Domains
        </Heading>
      </Box>
      <Text
        as="p"
        style={{
          fontSize: "12.5px",
          lineHeight: "16px",
          color: "var(--color-text-muted)",
          margin: "0 0 12px 0",
        }}
      >
        Browse simulation models, CAD geometries, and physical twins by discipline.
      </Text>
      <Box display="flex" flexDirection="column" gap="6px">
        {CURATED_ENGINEERING_DOMAINS.map((dom) => {
          const IconComp = dom.icon;
          const isActive = activeTopic === dom.tag.toLowerCase();
          return (
            <Link key={dom.tag} to={`/explore?topic=${encodeURIComponent(dom.tag)}`} style={{ textDecoration: "none" }}>
              <Box
                display="flex"
                alignItems="center"
                gap="10px"
                p="7px 10px"
                borderRadius="8px"
                style={{
                  background: isActive ? "rgba(139, 92, 246, 0.14)" : "rgba(255, 255, 255, 0.02)",
                  border: isActive
                    ? "1px solid rgba(139, 92, 246, 0.45)"
                    : "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.06))",
                  transition: "all 0.15s ease",
                }}
                sx={{
                  "&:hover": {
                    backgroundColor: "var(--surface-row-hover, rgba(255, 255, 255, 0.05))",
                    borderColor: "var(--color-accent-purple)",
                  },
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "6px",
                    background: "var(--color-canvas-subtle)",
                    border: "1px solid var(--color-border-subtle)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--color-accent-cyan)",
                    flexShrink: 0,
                  }}
                >
                  {IconComp ? <IconComp size={13} /> : null}
                </div>
                <Box flex={1} minWidth={0}>
                  <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "13px",
                        lineHeight: "18px",
                        color: "var(--color-text-heading)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {dom.name}
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        lineHeight: "14px",
                        fontFamily: "var(--font-mono)",
                        padding: "1px 5px",
                        borderRadius: "4px",
                        backgroundColor: "rgba(139, 92, 246, 0.12)",
                        color: "var(--color-accent-purple)",
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      #{dom.tag}
                    </span>
                  </Box>
                  <div
                    style={{
                      fontSize: "11.5px",
                      lineHeight: "15px",
                      color: "var(--color-text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      marginTop: "1px",
                    }}
                  >
                    {dom.desc}
                  </div>
                </Box>
              </Box>
            </Link>
          );
        })}
      </Box>
    </Card>
  );
};
