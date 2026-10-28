// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import { DepRow, GlassCard, SectionTitle } from "../types";

export interface PackageDependenciesTabProps {
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string> | undefined;
}

export const PackageDependenciesTab: React.FC<PackageDependenciesTabProps> = ({ dependencies, devDependencies }) => {
  return (
    <>
      <SectionTitle as="h3">Dependencies</SectionTitle>
      <GlassCard>
        {Object.keys(dependencies).length > 0 ? (
          Object.entries(dependencies).map(([dep, range]) => (
            <DepRow key={dep}>
              <Link
                to={`/packages/${dep}`}
                style={{ color: "var(--color-link)", textDecoration: "none", fontSize: 14 }}
              >
                {dep}
              </Link>
              <Text style={{ color: "var(--color-text-muted)", fontSize: 13, fontFamily: "monospace" }}>{range}</Text>
            </DepRow>
          ))
        ) : (
          <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
            No dependencies.
          </Text>
        )}
      </GlassCard>

      {devDependencies && Object.keys(devDependencies).length > 0 && (
        <>
          <SectionTitle as="h3" style={{ marginTop: 24 }}>
            Dev Dependencies
          </SectionTitle>
          <GlassCard>
            {Object.entries(devDependencies).map(([dep, range]) => (
              <DepRow key={dep}>
                <Link
                  to={`/packages/${dep}`}
                  style={{ color: "var(--color-link)", textDecoration: "none", fontSize: 14 }}
                >
                  {dep}
                </Link>
                <Text style={{ color: "var(--color-text-muted)", fontSize: 13, fontFamily: "monospace" }}>{range}</Text>
              </DepRow>
            ))}
          </GlassCard>
        </>
      )}
    </>
  );
};
