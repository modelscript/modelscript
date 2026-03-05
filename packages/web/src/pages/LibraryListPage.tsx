import { SearchIcon } from "@primer/octicons-react";
import { Flash, Heading, NavList, PageLayout, Spinner, TextInput } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLibraries } from "../api";
import Box from "../components/Box";

const LibraryListPage: React.FC = () => {
  const [libraries, setLibraries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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
    <PageLayout>
      <PageLayout.Header>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={6}>
          <Heading as="h1">Libraries</Heading>
          <TextInput
            leadingVisual={SearchIcon}
            placeholder="Search libraries..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Box>
      </PageLayout.Header>
      <PageLayout.Content>
        {loading && libraries.length === 0 ? (
          <Box display="flex" justifyContent="center" p={12}>
            <Spinner size="large" />
          </Box>
        ) : error ? (
          <Flash variant="danger">{error}</Flash>
        ) : (
          <NavList>
            {libraries.map((lib) => (
              <NavList.Item key={lib} as={Link} to={`/${lib}`}>
                {lib}
              </NavList.Item>
            ))}
            {libraries.length === 0 && !loading && (
              <Box p={12} textAlign="center" opacity={0.6}>
                No libraries found.
              </Box>
            )}
          </NavList>
        )}
      </PageLayout.Content>
    </PageLayout>
  );
};

export default LibraryListPage;
