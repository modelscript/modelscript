// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseStyles, Spinner, ThemeProvider } from "@primer/react";
import { Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getArtifactView } from "../api";
import { ViewerDispatcher, resolveThumbnailUrls } from "../components/artifacts/card";
import Box from "../components/Box";
import type { ArtifactViewDTO } from "../types/api";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";

export default function RenderArtifactPage() {
  const { id } = useParams<{ id: string }>();
  const [artifact, setArtifact] = useState<ArtifactViewDTO | null>(null);
  usePageTitle(artifact ? `Artifact: ${artifact.title || artifact.view_type}` : "Render Artifact");

  useEffect(() => {
    async function fetchArtifact() {
      if (!id) return;
      try {
        const data = await getArtifactView(id);
        setArtifact(data.artifactView || data.artifact_view || data);
      } catch (err) {
        console.error("Failed to fetch artifact", err);
        (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
      }
    }
    fetchArtifact();
  }, [id]);

  useEffect(() => {
    // When the artifact is successfully loaded and it is NOT an asynchronous heavy WebGL/Three.js
    // renderer that sets __ARTIFACT_READY on its own post-render event, we unblock puppeteer.
    if (artifact) {
      const heavyAsyncTypes = [
        "simulation",
        "simulation-result",
        "fea-result",
        "cfd-result",
        "cad",
        "cad-step",
        "cad_step",
        "cad-3d-viewer",
        "step",
        "stp",
        "gcode",
        "cam-result",
        "cfd-animation",
        "3d-model",
      ];
      if (!heavyAsyncTypes.includes(artifact.view_type)) {
        (window as unknown as { __ARTIFACT_READY: boolean }).__ARTIFACT_READY = true;
      }
    }
  }, [artifact]);

  if (!artifact) return null;

  const parsedArtifactId = Number(artifact.id || id || 0);
  const viewConfig = {
    ...safeJsonParse<Record<string, unknown>>(artifact.view_config, {}),
    artifactId: parsedArtifactId,
  };
  const { resolvedThumbnailUrl, resolvedThumbnailUrlLight, resolvedThumbnailUrlDark } =
    resolveThumbnailUrls(viewConfig);

  return (
    <ThemeProvider colorMode="auto">
      <BaseStyles style={{ width: "100vw", height: "100vh", overflow: "hidden", margin: 0, padding: 0 }}>
        <Box width="100%" height="100%" bg="var(--color-canvas-default)">
          <Suspense
            fallback={
              <Box display="flex" alignItems="center" justifyContent="center" width="100%" height="100%">
                <Spinner size="large" />
              </Box>
            }
          >
            <ViewerDispatcher
              artifact={artifact}
              artifactId={parsedArtifactId}
              viewConfig={viewConfig}
              isFullScreen={true}
              resolvedThumbnailUrl={resolvedThumbnailUrl}
              resolvedThumbnailUrlLight={resolvedThumbnailUrlLight}
              resolvedThumbnailUrlDark={resolvedThumbnailUrlDark}
            />
          </Suspense>
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
