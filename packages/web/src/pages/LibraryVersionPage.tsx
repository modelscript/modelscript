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
  background-color: #0d1117;
  color: #c9d1d9;
  min-height: 100%;
  display: flex;
  flex-direction: column;
`;

const HeaderBar = styled.div`
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 40px 40px;
  box-sizing: border-box;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
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
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
`;

const SectionTitle = styled(Heading)`
  font-size: 12px !important;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #8b949e !important;
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
    border-color: rgba(88, 166, 255, 0.3);
    background: rgba(255, 255, 255, 0.05);
  }
`;

const VersionName = styled.span`
  font-size: 16px;
  font-weight: 600;
  color: #58a6ff;
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const IconBox = styled.div`
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(164, 133, 255, 0.2), rgba(0, 210, 255, 0.2));
  border: 1px solid rgba(255, 255, 255, 0.1);
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
            <PackageIcon size={24} fill="#a485ff" />
          </IconBox>
          <Box>
            <Box display="flex" alignItems="center" gap="8px">
              <Heading as="h1" style={{ color: "#e6edf3", fontWeight: 700, fontSize: 28, margin: 0 }}>
                {name}
              </Heading>
              <Label
                variant="secondary"
                style={{
                  fontSize: 13,
                  padding: "2px 10px",
                  background: "rgba(255,255,255,0.06)",
                  color: "#8b949e",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {library.versions.length} version{library.versions.length !== 1 ? "s" : ""}
              </Label>
            </Box>
            <Text as="p" style={{ color: "#8b949e", fontSize: 15, margin: "4px 0 0" }}>
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
                  background: "rgba(88,166,255,0.15)",
                  color: "#58a6ff",
                  border: "1px solid rgba(88,166,255,0.3)",
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
