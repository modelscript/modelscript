import { SearchIcon } from "@primer/octicons-react";
import { Breadcrumbs, Flash, Heading, Label, NavList, PageLayout, Spinner, TextInput } from "@primer/react";
import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ClassSummary, JobStatus } from "../api";
import { getClasses, getJobStatus } from "../api";
import Box from "../components/Box";

const LibraryDetailPage: React.FC = () => {
  const { name, version } = useParams<{ name: string; version: string }>();
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);

  const fetchClasses = useCallback(async () => {
    if (!name || !version) return;
    try {
      const data = await getClasses(name, version, undefined, query);
      setClasses(data);
    } catch (err) {
      setError("Failed to load classes");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [name, version, query]);

  useEffect(() => {
    const timer = setTimeout(fetchClasses, 300);
    return () => clearTimeout(timer);
  }, [fetchClasses]);

  useEffect(() => {
    if (!name || !version || jobStatus === "completed" || jobStatus === "failed") return;

    const checkStatus = async () => {
      try {
        const status = await getJobStatus(name, version);
        setJobStatus(status.status);
        if (status.status === "completed") {
          fetchClasses();
        }
      } catch (err) {
        console.error("Failed to check job status", err);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [name, version, jobStatus, fetchClasses]);

  if (loading && classes.length === 0) {
    return (
      <Box display="flex" justifyContent="center" p={12}>
        <Spinner size="large" />
      </Box>
    );
  }

  return (
    <PageLayout>
      <PageLayout.Header>
        <Breadcrumbs>
          <Breadcrumbs.Item href="/">Libraries</Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/${name}`}>{name}</Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/${name}/${version}`} selected>
            {version}
          </Breadcrumbs.Item>
        </Breadcrumbs>
        <Box display="flex" justifyContent="space-between" alignItems="center" mt={4} mb={8}>
          <Box display="flex" alignItems="center" gap="16px">
            <Heading as="h1">
              {name} {version}
            </Heading>
            {jobStatus && jobStatus !== "completed" && (
              <Label variant="attention">{jobStatus === "processing" ? "Processing..." : "Pending"}</Label>
            )}
          </Box>
          <TextInput
            leadingVisual={SearchIcon}
            placeholder="Search classes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Box>
      </PageLayout.Header>
      <PageLayout.Content>
        {error ? (
          <Flash variant="danger">{error}</Flash>
        ) : (
          <NavList>
            {classes.map((cls) => (
              <NavList.Item key={cls.class_name} as={Link} to={`/${name}/${version}/classes/${cls.class_name}`}>
                <Box display="flex" alignItems="center" gap="8px">
                  <span>{cls.class_name}</span>
                  <Label variant="accent">{cls.class_kind}</Label>
                </Box>
                <NavList.TrailingVisual>
                  {cls.description && (
                    <Box fontSize="12px" opacity={0.6}>
                      {cls.description}
                    </Box>
                  )}
                </NavList.TrailingVisual>
              </NavList.Item>
            ))}
            {classes.length === 0 && !loading && (
              <Box p={12} textAlign="center" opacity={0.6}>
                No classes found.
              </Box>
            )}
          </NavList>
        )}
      </PageLayout.Content>
    </PageLayout>
  );
};

export default LibraryDetailPage;
