import { Breadcrumbs, Flash, Heading, Label, NavList, PageLayout, Spinner, Text, Truncate } from "@primer/react";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { ClassDetail, JobStatus } from "../api";
import { getClassDetail, getDiagramUrl, getIconUrl, getJobStatus } from "../api";
import Box from "../components/Box";

const ClassDetailPage: React.FC = () => {
  const { name, version, className } = useParams<{ name: string; version: string; className: string }>();
  const [cls, setCls] = useState<ClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchClassDetail = useCallback(async () => {
    if (!name || !version || !className) return;
    try {
      const data = await getClassDetail(name, version, className);
      setCls(data);
      setError(null);
    } catch (err) {
      setError("Failed to load class details");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [name, version, className]);

  useEffect(() => {
    setLoading(true);
    fetchClassDetail();
  }, [fetchClassDetail]);

  useEffect(() => {
    if (!name || !version || jobStatus === "completed" || jobStatus === "failed") return;

    const checkStatus = async () => {
      try {
        const status = await getJobStatus(name, version);
        setJobStatus(status.status);
        if (status.status === "completed") {
          fetchClassDetail();
        }
      } catch (err) {
        console.error("Failed to check job status", err);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [name, version, jobStatus, fetchClassDetail]);

  if (loading && !cls) {
    return (
      <Box display="flex" justifyContent="center" p={12}>
        <Spinner size="large" />
      </Box>
    );
  }

  if (error || !cls) {
    return (
      <Box p={12}>
        <Flash variant="danger">{error || "Class not found"}</Flash>
      </Box>
    );
  }

  return (
    <PageLayout>
      <PageLayout.Header>
        <Breadcrumbs>
          <Breadcrumbs.Item href="/">Libraries</Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/${name}`}>{name}</Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/${name}/${version}`}>{version}</Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/${name}/${version}/classes/${className}`} selected>
            {className}
          </Breadcrumbs.Item>
        </Breadcrumbs>
        <Box display="flex" alignItems="center" gap="8px" mt={4} mb={8}>
          <Heading as="h1">{className}</Heading>
          <Label variant="accent">{cls.classKind}</Label>
          {jobStatus && jobStatus !== "completed" && (
            <Label variant="attention">{jobStatus === "processing" ? "Processing..." : "Pending"}</Label>
          )}
        </Box>
      </PageLayout.Header>

      <PageLayout.Pane position="start">
        <Heading as="h3" style={{ fontSize: "16px", marginBottom: "8px" }}>
          Components
        </Heading>
        <NavList>
          {cls.components.map((comp) => (
            <NavList.Item key={comp.component_name}>
              <Box fontWeight="bold">{comp.component_name}</Box>
              <Box fontSize="12px" opacity={0.6}>
                <Truncate title={comp.type_name}>{comp.type_name}</Truncate>
              </Box>
              {comp.description && (
                <Box fontSize="12px" opacity={0.8} mt={1}>
                  {comp.description}
                </Box>
              )}
            </NavList.Item>
          ))}
          {cls.components.length === 0 && <Text style={{ opacity: 0.6, fontSize: "14px" }}>No components.</Text>}
        </NavList>
      </PageLayout.Pane>

      <PageLayout.Content>
        <Box display="flex" gap="32px" mb={8} flexWrap="wrap">
          <Box flex="0 0 auto">
            <Heading as="h4" style={{ fontSize: "12px", marginBottom: "8px", opacity: 0.6 }}>
              Icon
            </Heading>
            <Box
              p={2}
              bg="var(--color-canvas-subtle)"
              border="1px solid var(--color-border-default)"
              borderRadius={2}
              display="flex"
              justifyContent="center"
              alignItems="center"
              width={200}
              height={200}
            >
              <img
                src={`${getIconUrl(name!, version!, className!)}?t=${retryCount}`}
                alt={`${className} icon`}
                style={{ maxWidth: "100%", maxHeight: "100%" }}
                onError={() => {
                  if (jobStatus !== "completed") {
                    setTimeout(() => setRetryCount((prev) => prev + 1), 3000);
                  }
                }}
              />
            </Box>
          </Box>
          <Box flex="1 1 400px">
            <Heading as="h4" style={{ fontSize: "12px", marginBottom: "8px", opacity: 0.6 }}>
              Diagram
            </Heading>
            <Box
              p={2}
              bg="var(--color-canvas-subtle)"
              border="1px solid var(--color-border-default)"
              borderRadius={2}
              display="flex"
              justifyContent="center"
              alignItems="center"
              minHeight={200}
            >
              <img
                src={`${getDiagramUrl(name!, version!, className!)}?t=${retryCount}`}
                alt={`${className} diagram`}
                style={{ maxWidth: "100%" }}
                onError={() => {
                  if (jobStatus !== "completed") {
                    setTimeout(() => setRetryCount((prev) => prev + 1), 3000);
                  }
                }}
              />
            </Box>
          </Box>
        </Box>

        {cls.description && (
          <Box mb={8}>
            <Heading as="h3" style={{ fontSize: "16px", marginBottom: "8px" }}>
              Description
            </Heading>
            <Text as="p">{cls.description}</Text>
          </Box>
        )}

        {cls.documentation ? (
          <Box mb={8}>
            <Heading as="h3" style={{ fontSize: "16px", marginBottom: "8px" }}>
              Documentation
            </Heading>
            <Box
              border="1px solid var(--color-border-default)"
              borderRadius={2}
              p={4}
              dangerouslySetInnerHTML={{ __html: cls.documentation }}
            />
          </Box>
        ) : (
          <Box mb={8} opacity={0.6}>
            <Text style={{ fontStyle: "italic" }}>No detailed documentation available.</Text>
          </Box>
        )}

        {cls.extends.length > 0 && (
          <Box mt={8}>
            <Heading as="h3" style={{ fontSize: "16px", marginBottom: "8px" }}>
              Extends
            </Heading>
            <Box display="flex" gap="8px" flexWrap="wrap">
              {cls.extends.map((base) => (
                <Label key={base} variant="secondary">
                  {base}
                </Label>
              ))}
            </Box>
          </Box>
        )}
      </PageLayout.Content>
    </PageLayout>
  );
};

export default ClassDetailPage;
