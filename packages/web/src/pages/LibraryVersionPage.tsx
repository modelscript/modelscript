import { Breadcrumbs, Flash, Heading, NavList, PageLayout, Spinner } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Library } from "../api";
import { getLibraryVersions } from "../api";
import Box from "../components/Box";

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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={12}>
        <Spinner size="large" />
      </Box>
    );
  }

  if (error || !library) {
    return (
      <Box p={12}>
        <Flash variant="danger">{error || "Library not found"}</Flash>
      </Box>
    );
  }

  return (
    <PageLayout>
      <PageLayout.Header>
        <Breadcrumbs>
          <Breadcrumbs.Item href="/">Libraries</Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/${name}`} selected>
            {name}
          </Breadcrumbs.Item>
        </Breadcrumbs>
        <Heading as="h1" style={{ marginTop: "16px" }}>
          {name}
        </Heading>
      </PageLayout.Header>
      <PageLayout.Content>
        <NavList>
          {library.versions.map((version) => (
            <NavList.Item key={version} as={Link} to={`/${name}/${version}`}>
              {version}
            </NavList.Item>
          ))}
        </NavList>
      </PageLayout.Content>
    </PageLayout>
  );
};

export default LibraryVersionPage;
