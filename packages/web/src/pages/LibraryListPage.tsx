import { AlertIcon, PackageIcon, SearchIcon, TagIcon, VersionsIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import type { LibraryListItem } from "../api";
import { getLibraries } from "../api";
import Box from "../components/Box";

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

const ContentArea = styled.div`
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 40px 60px;
  box-sizing: border-box;
  animation: ${fadeIn} 0.35s ease;
`;

const ResultCount = styled.span`
  font-size: 14px;
  color: #8b949e;
  margin-left: 8px;
`;

const CardList = styled.div`
  display: flex;
  flex-direction: column;
`;

const CardRow = styled.div`
  display: block;
  padding: 20px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);

  &:first-child {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
`;

const CardInner = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
`;

const IconBox = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background: linear-gradient(135deg, rgba(164, 133, 255, 0.15), rgba(0, 210, 255, 0.15));
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
`;

const CardBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const LibName = styled(Link)`
  font-size: 18px;
  font-weight: 600;
  color: #58a6ff;
  text-decoration: none;
  transition: color 0.15s;

  &:hover {
    color: #79c0ff;
    text-decoration: underline;
  }
`;

const VersionBadge = styled.span`
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  color: #8b949e;
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 8px;
  border-radius: 12px;
  margin-left: 10px;
  vertical-align: middle;
`;

const VersionCount = styled.span`
  font-size: 12px;
  color: #6e7681;
  margin-left: 8px;
  vertical-align: middle;
`;

const Description = styled.p`
  font-size: 14px;
  color: #8b949e;
  margin: 6px 0 0;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
  font-size: 12px;
  color: #6e7681;

  span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
`;

/* ─── main page ─── */

const LibraryListPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [libraries, setLibraries] = useState<LibraryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = searchParams.get("q") || "";

  useEffect(() => {
    document.title = "Libraries | ModelScript";
  }, []);

  useEffect(() => {
    const fetchLibraries = async () => {
      try {
        setLoading(true);
        const libs = await getLibraries(query);
        setLibraries(libs);
      } catch (err) {
        setError("Failed to load libraries");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchLibraries, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <PageWrap>
      <ContentArea>
        {/* Search header */}
        <Box display="flex" alignItems="center" justifyContent="space-between" style={{ marginBottom: "32px" }}>
          <Box display="flex" alignItems="baseline" gap="8px">
            <Heading as="h1" style={{ color: "#e6edf3", fontWeight: 700, fontSize: 28, margin: 0 }}>
              Libraries
            </Heading>
            {!loading && (
              <ResultCount>
                {libraries.length} package{libraries.length !== 1 ? "s" : ""} found
              </ResultCount>
            )}
          </Box>
        </Box>

        {/* Content */}
        {loading && libraries.length === 0 ? (
          <Box display="flex" justifyContent="center" p={12}>
            <Spinner size="large" />
          </Box>
        ) : error ? (
          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 60,
              textAlign: "center",
            }}
          >
            <AlertIcon size={48} fill="#f85149" />
            <Heading as="h2" style={{ color: "#e6edf3", fontSize: 20, margin: 0 }}>
              Failed to load libraries
            </Heading>
            <Text as="p" style={{ color: "#8b949e", fontSize: 14, margin: 0 }}>
              The server may be unavailable. Please try again later.
            </Text>
          </Box>
        ) : libraries.length === 0 ? (
          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 60,
              textAlign: "center",
            }}
          >
            <SearchIcon size={48} fill="#8b949e" />
            <Heading as="h2" style={{ color: "#e6edf3", fontSize: 20, margin: 0 }}>
              No packages found
            </Heading>
            <Text as="p" style={{ color: "#8b949e", fontSize: 14, margin: 0 }}>
              {query ? `No results matching "${query}"` : "No libraries have been published yet."}
            </Text>
          </Box>
        ) : (
          <CardList>
            {libraries.map((lib) => (
              <CardRow key={lib.name}>
                <CardInner>
                  <IconBox>
                    <PackageIcon size={20} fill="#a485ff" />
                  </IconBox>
                  <CardBody>
                    <div>
                      <LibName to={lib.latestVersion ? `/${lib.name}/${lib.latestVersion}` : `/${lib.name}`}>
                        {lib.name}
                      </LibName>
                      {lib.latestVersion && (
                        <>
                          <VersionBadge>v{lib.latestVersion}</VersionBadge>
                          {lib.versions.length > 1 && (
                            <VersionCount>
                              +{lib.versions.length - 1} version{lib.versions.length > 2 ? "s" : ""}
                            </VersionCount>
                          )}
                        </>
                      )}
                    </div>
                    <Description>Modelica library package</Description>
                    <MetaRow>
                      {lib.latestVersion && (
                        <span>
                          <TagIcon size={12} /> latest: {lib.latestVersion}
                        </span>
                      )}
                      {lib.versions.length > 0 && (
                        <Link
                          to={`/${lib.name}`}
                          style={{
                            color: "#6e7681",
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <VersionsIcon size={12} /> {lib.versions.length} version{lib.versions.length !== 1 ? "s" : ""}
                        </Link>
                      )}
                    </MetaRow>
                  </CardBody>
                </CardInner>
              </CardRow>
            ))}
          </CardList>
        )}
      </ContentArea>
    </PageWrap>
  );
};

export default LibraryListPage;
