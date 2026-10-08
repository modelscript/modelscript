// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, PlayIcon } from "@primer/octicons-react";
import { Button, Dialog, Flash, FormControl, Heading, Select, Text, TextInput } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
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

interface TemplateConfig {
  solver?: string;
  estimatedDuration?: string;
  steps?: unknown[];
}

const TemplateDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<ScriptTemplate | null>(null);
  usePageTitle(template ? template.name : "Template Details");
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [meshResolution, setMeshResolution] = useState<"coarse" | "medium" | "fine">("medium");
  const [maxIterations, setMaxIterations] = useState<number>(1000);
  const [tolerance, setTolerance] = useState<string>("1e-5");
  const [error, setError] = useState<string | null>(null);
  const focusRef = useRef(null);

  useEffect(() => {
    if (!id) return;
    getJobTemplate(id)
      .then((data) => setTemplate(data.template))
      .catch(console.error);
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
        (axios.isAxiosError(e) && (e.response?.data as { error?: string })?.error) ||
        (e instanceof Error ? e.message : "Error starting job");
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!template) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height="100%">
        <Text color="var(--color-fg-muted)">Loading...</Text>
      </Box>
    );
  }

  const config = safeJsonParse<TemplateConfig>(template.config, {});

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
        <Button variant="primary" leadingVisual={PlayIcon} onClick={() => setIsWizardOpen(true)}>
          Configure & Run
        </Button>
      </Box>

      {/* Content */}
      <Box flex={1} p={4} bg="var(--color-canvas-subtle)" style={{ overflowY: "auto" }}>
        <Box
          bg="var(--color-canvas-default)"
          p={4}
          borderRadius="6px"
          border="1px solid var(--color-border-default)"
          maxWidth="800px"
          mx="auto"
        >
          <Text fontSize="16px" color="var(--color-fg-muted)" display="block" mb={4}>
            {template.description}
          </Text>
          <Box display="grid" gridTemplateColumns="1fr 1fr" gridGap={3}>
            <Box>
              <Text fontWeight="bold" display="block" mb={1}>
                Category
              </Text>
              <Text>{template.category}</Text>
            </Box>
            <Box>
              <Text fontWeight="bold" display="block" mb={1}>
                Solver
              </Text>
              <Text>{config.solver || "N/A"}</Text>
            </Box>
            <Box>
              <Text fontWeight="bold" display="block" mb={1}>
                Estimated Time
              </Text>
              <Text>{config.estimatedDuration || "Unknown"}</Text>
            </Box>
            <Box>
              <Text fontWeight="bold" display="block" mb={1}>
                Steps
              </Text>
              <Text>{config.steps ? config.steps.length : "Unknown"}</Text>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Wizard Modal */}
      {isWizardOpen && (
        <Dialog
          returnFocusRef={focusRef}
          isOpen={isWizardOpen}
          onDismiss={() => setIsWizardOpen(false)}
          aria-labelledby="header-id"
        >
          <Dialog.Header id="header-id">Configure Run: {template.name}</Dialog.Header>
          <Box p={3}>
            {error && (
              <Flash variant="danger" sx={{ mb: 3 }}>
                {error}
              </Flash>
            )}
            <FormControl sx={{ mb: 3 }}>
              <FormControl.Label>Simulation Mesh Resolution</FormControl.Label>
              <Select
                value={meshResolution}
                onChange={(e) => setMeshResolution(e.target.value as "coarse" | "medium" | "fine")}
              >
                <Select.Option value="coarse">Coarse (Fast)</Select.Option>
                <Select.Option value="medium">Medium (Standard)</Select.Option>
                <Select.Option value="fine">Fine (High Accuracy)</Select.Option>
              </Select>
            </FormControl>
            <FormControl sx={{ mb: 3 }}>
              <FormControl.Label>Maximum Iterations</FormControl.Label>
              <TextInput
                value={String(maxIterations)}
                onChange={(e) => setMaxIterations(Number(e.target.value) || 0)}
                type="number"
                min="1"
                max="100000"
              />
            </FormControl>
            <FormControl sx={{ mb: 3 }}>
              <FormControl.Label>Target Tolerance</FormControl.Label>
              <TextInput value={tolerance} onChange={(e) => setTolerance(e.target.value)} placeholder="1e-5" />
            </FormControl>
            <Box display="flex" justifyContent="flex-end" gap={2} mt={4}>
              <Button onClick={() => setIsWizardOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleRun} disabled={isSubmitting}>
                {isSubmitting ? "Starting..." : "Start Simulation"}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  );
};

export default TemplateDetailPage;
