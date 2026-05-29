import { ArrowLeftIcon, PlayIcon } from "@primer/octicons-react";
import { Button, Dialog, FormControl, Heading, Select, Text, TextInput } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "../components/Box";
import { CircleIconButton } from "../components/SharedStyles";

interface ScriptTemplate {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  config: string;
}

const TemplateDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<ScriptTemplate | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const focusRef = useRef(null);

  useEffect(() => {
    fetch(`/api/v1/jobs/templates/${id}`)
      .then((res) => res.json())
      .then((data) => setTemplate(data.template))
      .catch(console.error);
  }, [id]);

  const handleRun = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/jobs/templates/${id}/run`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.jobId) {
          navigate(`/scripts/${data.jobId}`);
        }
      } else {
        const data = await res.json();
        alert(`Failed to run template: ${data.error || res.statusText}`);
        setIsSubmitting(false);
      }
    } catch (e) {
      console.error(e);
      alert("Error starting job");
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

  const config = JSON.parse(template.config || "{}");

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
        <CircleIconButton onClick={() => navigate("/scripts")} aria-label="Back">
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
            <FormControl sx={{ mb: 3 }}>
              <FormControl.Label>Simulation Mesh Resolution</FormControl.Label>
              <Select defaultValue="medium">
                <Select.Option value="coarse">Coarse (Fast)</Select.Option>
                <Select.Option value="medium">Medium (Standard)</Select.Option>
                <Select.Option value="fine">Fine (High Accuracy)</Select.Option>
              </Select>
            </FormControl>
            <FormControl sx={{ mb: 3 }}>
              <FormControl.Label>Maximum Iterations</FormControl.Label>
              <TextInput defaultValue="1000" type="number" />
            </FormControl>
            <FormControl sx={{ mb: 3 }}>
              <FormControl.Label>Target Tolerance</FormControl.Label>
              <TextInput defaultValue="1e-5" />
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
