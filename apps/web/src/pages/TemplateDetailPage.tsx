// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, PlayIcon } from "@primer/octicons-react";
import { Button, Flash, FormControl, Heading, Label, Select, Text, TextInput } from "@primer/react";
import axios from "axios";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getJobTemplate, runJobTemplate } from "../api";
import Box from "../components/Box";
import { CircleIconButton } from "../components/SharedStyles";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";

interface ScriptTemplate {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  config: string;
}

interface TemplateStepItem {
  name?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  command?: string | undefined;
}

interface TemplateConfig {
  solver?: string | undefined;
  estimatedDuration?: string | undefined;
  steps?: (string | TemplateStepItem)[] | undefined;
}

const TemplateDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<ScriptTemplate | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  usePageTitle(template ? template.name : "Template Details");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [meshResolution, setMeshResolution] = useState<"coarse" | "medium" | "fine">("medium");
  const [maxIterations, setMaxIterations] = useState<number>(1000);
  const [tolerance, setTolerance] = useState<string>("1e-5");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setLoadError("Template ID is missing.");
      return;
    }
    setLoading(true);
    setLoadError(null);
    getJobTemplate(id)
      .then((data) => {
        if (data?.template) {
          setTemplate(data.template);
        } else {
          setLoadError(`Template #${id} not found.`);
        }
      })
      .catch((err) => {
        console.error(err);
        setLoadError(err?.response?.data?.error || err?.message || `Failed to load template #${id}.`);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  const handleRun = async () => {
    if (!id) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const data = await runJobTemplate(id, {
        meshResolution,
        maxIterations: Number(maxIterations),
        tolerance: parseFloat(tolerance),
      });
      if (data.jobId) {
        navigate(`/jobs/${data.jobId}`);
      }
    } catch (e: unknown) {
      console.error(e);
      const msg =
        (axios.isAxiosError(e) && (e.response?.data as { error?: string | undefined })?.error) ||
        (e instanceof Error ? e.message : "Error starting job");
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height="100%" p={5}>
        <Text color="var(--color-fg-muted)">Loading...</Text>
      </Box>
    );
  }

  if (loadError || !template) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        height="100%"
        p={5}
        gap={3}
      >
        <Flash variant="danger">{loadError || "Template not found."}</Flash>
        <Button onClick={() => navigate("/jobs")}>Back to Cloud Jobs</Button>
      </Box>
    );
  }

  const config = safeJsonParse<TemplateConfig>(template.config, {});
  const stepsList = Array.isArray(config.steps) ? config.steps : [];

  return (
    <Box display="flex" flexDirection="column" style={{ minHeight: "100%", height: "100%" }}>
      {/* Header */}
      <Box
        p={3}
        display="flex"
        alignItems="center"
        gap={3}
        borderBottom="1px solid var(--color-border-subtle)"
        bg="var(--color-canvas-default)"
      >
        <CircleIconButton onClick={() => navigate("/jobs")} aria-label="Back">
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Box flex={1}>
          <Heading as="h2" style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "var(--color-fg-default)" }}>
            {template.name}
          </Heading>
        </Box>
        <Button variant="primary" leadingVisual={PlayIcon} onClick={handleRun} disabled={isSubmitting}>
          {isSubmitting ? "Starting..." : "Start Simulation"}
        </Button>
      </Box>

      {/* 2-Column Workbench Content */}
      <Box flex={1} p={4} bg="var(--color-canvas-subtle)" style={{ overflowY: "auto" }}>
        <Box
          maxWidth="1120px"
          mx="auto"
          display="grid"
          sx={{
            gridTemplateColumns: ["1fr", "1fr", "minmax(0, 1.35fr) minmax(0, 1fr)"],
            gap: 4,
            alignItems: "start",
          }}
        >
          {/* Left Column: Overview & Pipeline Steps */}
          <Box display="flex" flexDirection="column" gap={4}>
            <Box
              bg="var(--color-canvas-default)"
              p={4}
              borderRadius="8px"
              border="1px solid var(--color-border-default)"
            >
              <Text fontSize="15px" color="var(--color-fg-default)" display="block" mb={4} style={{ lineHeight: 1.6 }}>
                {template.description}
              </Text>
              <Box display="grid" gridTemplateColumns="1fr 1fr" gridGap={3}>
                <Box>
                  <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-muted)" display="block" mb={1}>
                    Category
                  </Text>
                  <Label variant="accent">{template.category}</Label>
                </Box>
                <Box>
                  <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-muted)" display="block" mb={1}>
                    Solver
                  </Text>
                  <Text fontWeight="bold">{config.solver || "N/A"}</Text>
                </Box>
                <Box>
                  <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-muted)" display="block" mb={1}>
                    Estimated Time
                  </Text>
                  <Text>{config.estimatedDuration || "Unknown"}</Text>
                </Box>
                <Box>
                  <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-muted)" display="block" mb={1}>
                    Pipeline Stages
                  </Text>
                  <Text>{stepsList.length} stages</Text>
                </Box>
              </Box>
            </Box>

            <Box
              bg="var(--color-canvas-default)"
              p={4}
              borderRadius="8px"
              border="1px solid var(--color-border-default)"
            >
              <Heading as="h3" style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 16px 0" }}>
                Pipeline Execution Steps ({stepsList.length})
              </Heading>
              {stepsList.length > 0 ? (
                <Box display="flex" flexDirection="column" gap={2}>
                  {stepsList.map((step, index) => {
                    const stepTitle =
                      typeof step === "string"
                        ? step
                        : step?.name || step?.title || step?.command || `Stage ${index + 1}`;
                    const stepDesc = typeof step === "object" && step !== null ? step.description : undefined;
                    return (
                      <Box
                        key={index}
                        display="flex"
                        alignItems="flex-start"
                        gap={3}
                        p={3}
                        borderRadius="6px"
                        bg="var(--color-canvas-subtle)"
                        border="1px solid var(--color-border-subtle)"
                      >
                        <Box
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: "rgba(6, 182, 212, 0.15)",
                            color: "var(--color-accent-cyan, #06b6d4)",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {index + 1}
                        </Box>
                        <Box flex={1}>
                          <Text fontWeight="bold" fontSize="14px" display="block">
                            {stepTitle}
                          </Text>
                          {stepDesc && (
                            <Text fontSize="12px" color="var(--color-fg-muted)" display="block" mt={1}>
                              {stepDesc}
                            </Text>
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              ) : (
                <Text color="var(--color-fg-muted)" fontSize="14px">
                  Standard single-stage solver execution.
                </Text>
              )}
            </Box>
          </Box>

          {/* Right Column: Embedded Solver Configuration Workbench */}
          <Box bg="var(--color-canvas-default)" p={4} borderRadius="8px" border="1px solid var(--color-border-default)">
            <Heading as="h3" style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 16px 0" }}>
              Solver Configuration
            </Heading>
            {error && (
              <Flash variant="danger" sx={{ mb: 3 }}>
                {error}
              </Flash>
            )}
            <FormControl style={{ marginBottom: 16 }}>
              <FormControl.Label>Simulation Mesh Resolution</FormControl.Label>
              <Select
                block
                value={meshResolution}
                onChange={(e) => setMeshResolution(e.target.value as "coarse" | "medium" | "fine")}
              >
                <Select.Option value="coarse">Coarse (Fast)</Select.Option>
                <Select.Option value="medium">Medium (Standard)</Select.Option>
                <Select.Option value="fine">Fine (High Accuracy)</Select.Option>
              </Select>
            </FormControl>
            <FormControl style={{ marginBottom: 16 }}>
              <FormControl.Label>Maximum Iterations</FormControl.Label>
              <TextInput
                block
                value={String(maxIterations)}
                onChange={(e) => setMaxIterations(Number(e.target.value) || 0)}
                type="number"
                min="1"
                max="100000"
              />
            </FormControl>
            <FormControl style={{ marginBottom: 20 }}>
              <FormControl.Label>Target Tolerance</FormControl.Label>
              <TextInput block value={tolerance} onChange={(e) => setTolerance(e.target.value)} placeholder="1e-5" />
            </FormControl>
            <Button variant="primary" leadingVisual={PlayIcon} onClick={handleRun} disabled={isSubmitting} block>
              {isSubmitting ? "Starting..." : "Start Simulation"}
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default TemplateDetailPage;
