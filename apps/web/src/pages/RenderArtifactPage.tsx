import { BaseStyles, ThemeProvider } from "@primer/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import CadStepViewer from "../components/artifacts/CadStepViewer";
import SimulationResultViewer from "../components/artifacts/SimulationResultViewer";
import Box from "../components/Box";
import { API_BASE_URL } from "../config";

export default function RenderArtifactPage() {
  const { id } = useParams<{ id: string }>();
  const [artifact, setArtifact] = useState<unknown>(null);

  useEffect(() => {
    async function fetchArtifact() {
      try {
        const res = await fetch(`${API_BASE_URL}/social/artifact-views/${id}`);
        if (res.ok) {
          const data = await res.json();
          setArtifact(data.artifactView);
        } else {
          // If artifact failed to load, signal ready to unblock Puppeteer
          (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
        }
      } catch (err) {
        console.error("Failed to fetch artifact", err);
        (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
      }
    }
    fetchArtifact();
  }, [id]);

  useEffect(() => {
    // When the artifact is successfully loaded and it is NOT a simulation or cad step,
    // we still need to unblock puppeteer.
    if (artifact) {
      if (!["simulation-result", "fea-result", "cfd-result", "cad-step", "cad_step"].includes(artifact.view_type)) {
        (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
      }
    }
  }, [artifact]);

  if (!artifact) return null;

  const viewConfig = JSON.parse(artifact.view_config || "{}");
  const isSimulation = ["simulation-result", "fea-result", "cfd-result"].includes(artifact.view_type);
  const isCadStep = ["cad-step", "cad_step"].includes(artifact.view_type);

  return (
    <ThemeProvider colorMode="night">
      <BaseStyles style={{ width: "100vw", height: "100vh", overflow: "hidden", margin: 0, padding: 0 }}>
        <Box width="100%" height="100%" bg="var(--color-canvas-default)">
          {isSimulation && <SimulationResultViewer viewConfig={viewConfig} isFullScreen={true} />}
          {isCadStep && <CadStepViewer viewConfig={viewConfig} isFullScreen={true} />}
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
