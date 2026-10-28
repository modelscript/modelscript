// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, SyncIcon, XCircleFillIcon } from "@primer/octicons-react";
import { Heading, Label, Link as PrimerLink, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import type { GitlabJob } from "../../../api";
import { getGitlabPipelineJobs, getGitlabPipelines } from "../../../api";
import Box from "../../../components/Box";
import { CommitRow, StyledBox } from "../styles";

export interface ActionsTabProps {
  projectId: string;
  provider: string;
  defaultBranch?: string | undefined;
}

export const ActionsTab: React.FC<ActionsTabProps> = ({ projectId, provider, defaultBranch = "main" }) => {
  const [latestJobs, setLatestJobs] = useState<GitlabJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const pipelinesData = await getGitlabPipelines(projectId, defaultBranch, provider).catch(() => []);
        if (pipelinesData.length > 0) {
          const jobs = await getGitlabPipelineJobs(projectId, pipelinesData[0]!.id, provider).catch(() => []);
          setLatestJobs(jobs);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId, provider, defaultBranch]);

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={4} color="var(--color-danger-fg)">
        Error: {error}
      </Box>
    );
  }

  return (
    <Box>
      <Heading as="h2" style={{ fontSize: "20px", marginBottom: "16px" }}>
        Latest CI Pipeline Jobs
      </Heading>
      <StyledBox>
        {latestJobs.map((job) => (
          <CommitRow key={job.id}>
            <Box display="flex" flexDirection="column" gap={2}>
              <Box display="flex" alignItems="center" gap={2}>
                {job.status === "success" && <CheckCircleFillIcon fill="var(--color-success-fg)" />}
                {job.status === "failed" && <XCircleFillIcon fill="var(--color-danger-fg)" />}
                {job.status === "running" && (
                  <SyncIcon size={16} fill="var(--color-accent-fg)" className="spinner-spin" />
                )}
                <Text style={{ fontWeight: "bold" }}>{job.name}</Text>
                <Label variant="secondary" style={{ marginLeft: "8px" }}>
                  {job.stage}
                </Label>
              </Box>
            </Box>
            <Box display="flex" flexDirection="column" alignItems="flex-end" color="var(--color-fg-muted)" fontSize={1}>
              <Text>{job.duration ? `Duration: ${Math.round(job.duration)}s` : "Pending"}</Text>
              {job.artifacts && job.artifacts.length > 0 && <Text>{job.artifacts.length} artifacts</Text>}
              <PrimerLink href={job.web_url} target="_blank" rel="noreferrer" style={{ marginTop: "4px" }}>
                View Log
              </PrimerLink>
            </Box>
          </CommitRow>
        ))}
        {latestJobs.length === 0 && (
          <Box p={4} textAlign="center" color="var(--color-fg-muted)">
            No CI jobs found for the latest pipeline.
          </Box>
        )}
      </StyledBox>
    </Box>
  );
};

export default ActionsTab;
