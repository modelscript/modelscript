import { PackageIcon, TagIcon } from "@primer/octicons-react";
import { Flash, Heading, Label, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import styled, { css, keyframes } from "styled-components";
import type { Library } from "../api";
import { getLibraryVersions } from "../api";
import Box from "../components/Box";
import Breadcrumbs from "../components/Breadcrumbs";

/* ─── styled helpers ─── */

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const PageWrap = styled.div`
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  min-height: 100%;
  display: flex;
  flex-direction: column;
  transition:
    background-color 0.3s ease,
    color 0.3s ease;
`;

const HeaderBar = styled.div`
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 40px 40px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--color-border);
`;

const ContentArea = styled.div`
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 40px 60px;
  box-sizing: border-box;
  animation: ${fadeIn} 0.4s ease;
`;

const glassCard = css`
  background: var(--color-glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-glass-border);
  border-radius: 8px;
`;

const SectionTitle = styled(Heading)`
  font-size: 12px !important;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--color-text-muted) !important;
  margin-bottom: 12px !important;
  font-weight: 600 !important;
`;

const VersionCard = styled(Link)`
  ${glassCard}
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  margin-bottom: 8px;
  text-decoration: none;
  transition: all 0.2s ease;

  &,
  &:hover,
  &:visited,
  &:active,
  & * {
    text-decoration: none;
  }

  &:hover {
    border-color: var(--color-accent-blue-border);
    background: var(--color-glass-bg-hover);
  }
`;

const VersionName = styled.span`
  font-size: 16px;
  font-weight: 600;
  color: var(--color-link);
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const IconBox = styled.div`
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: var(--gradient-icon-box);
  border: 1px solid var(--color-border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

/* ─── main page ─── */

const LibraryVersionPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVersions = async () => {
      if (!name) return;
      try {
        setLoading(true);
        const data = await getLibraryVersions(name);
        setLibrary(data);
      } catch (err) {
        setError("Failed to load versions");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchVersions();
  }, [name]);

  useEffect(() => {
    if (name) {
      document.title = `${name} — Versions | ModelScript`;
    }
  }, [name]);

  if (loading) {
    return (
      <PageWrap style={{ justifyContent: "center", alignItems: "center" }}>
        <Spinner size="large" />
      </PageWrap>
    );
  }

  if (error || !library) {
    return (
      <PageWrap>
        <Box p={8}>
          <Flash variant="danger">{error || "Library not found"}</Flash>
        </Box>
      </PageWrap>
    );
  }

  return (
    <PageWrap>
      {/* ── Header ── */}
      <HeaderBar>
        <Box mb={3}>
          <Breadcrumbs items={[{ label: "Libraries", href: "/libraries" }, { label: name || "" }]} />
        </Box>
        <Box display="flex" alignItems="center" gap="16px">
          <IconBox>
            <PackageIcon size={24} fill="var(--color-accent-purple)" />
          </IconBox>
          <Box>
            <Box display="flex" alignItems="center" gap="8px">
              <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 700, fontSize: 28, margin: 0 }}>
                {name}
              </Heading>
              <Label
                variant="secondary"
                style={{
                  fontSize: 13,
                  padding: "2px 10px",
                  background: "var(--color-badge-bg)",
                  color: "var(--color-text-muted)",
                  border: "1px solid var(--color-border-strong)",
                }}
              >
                {library.versions.length} version{library.versions.length !== 1 ? "s" : ""}
              </Label>
            </Box>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: "4px 0 0" }}>
              Select a version to view documentation and details.
            </Text>
          </Box>
        </Box>
      </HeaderBar>

      {/* ── Body ── */}
      <ContentArea>
        <SectionTitle as="h3">All Versions</SectionTitle>
        {library.versions.map((version, index) => (
          <VersionCard key={version} to={`/${name}/${version}`}>
            <VersionName>
              <TagIcon size={16} />
              {version}
            </VersionName>
            {index === 0 && (
              <Label
                variant="accent"
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  background: "var(--color-accent-blue-bg)",
                  color: "var(--color-accent-blue)",
                  border: "1px solid var(--color-accent-blue-border)",
                }}
              >
                latest
              </Label>
            )}
          </VersionCard>
        ))}
      </ContentArea>
    </PageWrap>
  );
};

export default LibraryVersionPage;
