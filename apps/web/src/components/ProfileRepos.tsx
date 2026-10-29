// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable react-hooks/exhaustive-deps */
import { CodeIcon, GitBranchIcon, PlusIcon, RepoForkedIcon, RepoIcon, StarIcon } from "@primer/octicons-react";
import { Button, Dialog, Heading, Label, Spinner, Text, TextInput } from "@primer/react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { createRepo, getRepos } from "../api";
import Box from "./Box";

export default function ProfileRepos({ username, isOwnProfile }: { username: string; isOwnProfile: boolean }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoDesc, setRepoDesc] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const fetchRepos = async () => {
    try {
      const data = await getRepos(isOwnProfile ? undefined : username);
      setRepos(data.repos || []);
    } catch (err) {
      console.error(err);
      setRepos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRepos();
  }, [username, isOwnProfile, token]);

  const handleAddRepo = async () => {
    if (!repoUrl) return;
    setLinking(true);
    setLinkError(null);

    // Parse GitHub/GitLab URL or owner/repo shorthand
    let provider = "github";
    let fullName = repoUrl.trim();

    if (
      fullName.startsWith("http://") ||
      fullName.startsWith("https://") ||
      fullName.startsWith("github.com/") ||
      fullName.startsWith("gitlab.com/")
    ) {
      try {
        const parsed = new URL(fullName.startsWith("http") ? fullName : "https://" + fullName);
        const host = parsed.hostname.toLowerCase();
        if (host === "gitlab.com" || host.endsWith(".gitlab.com")) provider = "gitlab";
        else if (host === "github.com" || host.endsWith(".github.com")) provider = "github";
        fullName = parsed.pathname
          .replace(/^\//, "")
          .replace(/\/$/, "")
          .replace(/\.git$/, "");
      } catch {
        // if not a URL, assume it's just namespace/project
      }
    }

    try {
      await createRepo({
        provider,
        external_repo_id: fullName,
        repo_full_name: fullName,
        default_branch: "main",
        description: repoDesc.trim() || undefined,
      });

      setShowAddModal(false);
      setRepoUrl("");
      setRepoDesc("");
      setLinkError(null);
      fetchRepos();
    } catch (err: any) {
      console.error("Failed to link repo", err);
      setLinkError(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          err?.message ||
          "Failed to link repository. Please verify the repository URL and try again.",
      );
    } finally {
      setLinking(false);
    }
  };

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  return (
    <Box p={4}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Heading as="h2" style={{ fontSize: "20px" }}>
          Repositories
        </Heading>
        {isOwnProfile && (
          <Button
            variant="primary"
            leadingVisual={PlusIcon}
            onClick={() => {
              setLinkError(null);
              setShowAddModal(true);
            }}
          >
            Add Repository
          </Button>
        )}
      </Box>

      {repos.length === 0 ? (
        <Box textAlign="center" py={5} sx={{ border: "1px solid var(--color-border-default)", borderRadius: 2 }}>
          <Heading as="h3" style={{ fontSize: "16px", marginBottom: "8px" }}>
            No repositories linked
          </Heading>
          <Text color="var(--color-fg-muted)">
            {isOwnProfile
              ? "Link a Git repository to show your code on your profile."
              : "This user hasn't linked any repositories."}
          </Text>
        </Box>
      ) : (
        <Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(300px, 1fr))" gridGap={3}>
          {repos.map((repo) => {
            const fullName =
              repo.repo_full_name ||
              (repo.namespace && repo.project
                ? `${repo.namespace}/${repo.project}`
                : repo.external_id || repo.name || "repository");
            const provider = repo.provider || "github";
            const branch = repo.default_branch || "main";
            return (
              <Box
                key={repo.id || fullName}
                p={3}
                sx={{
                  border: "1px solid var(--color-border-default)",
                  borderRadius: 2,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <Box>
                  <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} mb={2}>
                    <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0 }}>
                      <RepoIcon fill="var(--color-fg-muted)" />
                      <Link
                        to={`/repos/${provider}/${fullName}`}
                        style={{
                          color: "var(--color-accent-fg, var(--color-accent-emphasis))",
                          fontWeight: "bold",
                          textDecoration: "none",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {fullName}
                      </Link>
                    </Box>
                    <Label variant="secondary" size="small" style={{ textTransform: "capitalize" }}>
                      {provider === "gitlab" ? "GitLab" : provider === "local" ? "ModelScript" : "GitHub"}
                    </Label>
                  </Box>
                  <Text
                    color="var(--color-fg-muted)"
                    fontSize={1}
                    mb={3}
                    style={{ display: "block", lineHeight: 1.45 }}
                  >
                    {repo.description || `Engineering repository linked via ${provider}.`}
                  </Text>
                </Box>

                <Box
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  color="var(--color-fg-muted)"
                  fontSize={0}
                >
                  <Box display="flex" gap={3} alignItems="center">
                    <Box display="flex" alignItems="center" gap={1}>
                      <GitBranchIcon size={12} /> {branch}
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <StarIcon size={12} /> {repo.stars_count ?? repo.stargazers_count ?? 0}
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <RepoForkedIcon size={12} /> {repo.forks_count ?? 0}
                    </Box>
                  </Box>

                  <Button
                    size="small"
                    leadingVisual={CodeIcon}
                    onClick={() => navigate(`/repos/${provider}/${fullName}/ide?ref=${encodeURIComponent(branch)}`)}
                  >
                    IDE
                  </Button>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {showAddModal && (
        <Dialog onClose={() => setShowAddModal(false)} title="Link Repository" width="large">
          <Box p={3}>
            <Text as="p" mb={3} color="var(--color-fg-muted)">
              Enter the URL or owner/project of a public GitHub or GitLab repository to link it to your profile.
            </Text>
            {linkError && (
              <Box
                p={2}
                mb={3}
                style={{
                  backgroundColor: "rgba(248, 81, 73, 0.12)",
                  border: "1px solid rgba(248, 81, 73, 0.4)",
                  borderRadius: "6px",
                  color: "var(--color-danger-fg, #f85149)",
                  fontSize: "13px",
                }}
              >
                {linkError}
              </Box>
            )}
            <TextInput
              block
              value={repoUrl}
              onChange={(e) => {
                setRepoUrl(e.target.value);
                if (linkError) setLinkError(null);
              }}
              placeholder="e.g., https://github.com/modelica/ModelicaStandardLibrary"
              sx={{ mb: 2 }}
            />
            <TextInput
              block
              value={repoDesc}
              onChange={(e) => setRepoDesc(e.target.value)}
              placeholder="Optional description..."
              sx={{ mb: 3 }}
            />
            <Box display="flex" justifyContent="flex-end" gap={2}>
              <Button onClick={() => setShowAddModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleAddRepo} disabled={!repoUrl || linking}>
                {linking ? "Linking..." : "Link Repository"}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  );
}
