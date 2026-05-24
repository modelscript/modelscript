/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import { PlusIcon, RepoForkedIcon, RepoIcon, StarIcon } from "@primer/octicons-react";
import { Button, Dialog, Heading, Spinner, Text, TextInput } from "@primer/react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";
import Box from "./Box";

export default function ProfileRepos({ username, isOwnProfile }: { username: string; isOwnProfile: boolean }) {
  const { token } = useAuth();
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [linking, setLinking] = useState(false);

  const fetchRepos = async () => {
    try {
      // In a real app we'd fetch repos by username.
      // For now, since the API only returns repos for the logged-in user, we'll fetch from /api/v1/repos if it's our own profile
      if (!isOwnProfile) {
        setRepos([]);
        setLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE_URL}/repos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRepos(data.repos);
      }
    } catch (err) {
      console.error(err);
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

    // Parse GitLab URL like https://gitlab.com/modelscript/msl
    let provider = "gitlab";
    let fullName = repoUrl;

    try {
      const url = new URL(repoUrl);
      if (url.hostname.includes("github.com")) provider = "github";
      fullName = url.pathname.replace(/^\//, "").replace(/\/$/, "");
    } catch {
      // if not a URL, assume it's just namespace/project
    }

    try {
      const res = await fetch(`${API_BASE_URL}/repos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider,
          external_repo_id: fullName,
          repo_full_name: fullName,
          default_branch: "main",
        }),
      });

      if (res.ok) {
        setShowAddModal(false);
        setRepoUrl("");
        fetchRepos();
      }
    } catch (err) {
      console.error("Failed to link repo", err);
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
          <Button variant="primary" leadingVisual={PlusIcon} onClick={() => setShowAddModal(true)}>
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
          {repos.map((repo) => (
            <Box
              key={repo.id}
              p={3}
              sx={{
                border: "1px solid var(--color-border-default)",
                borderRadius: 2,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Box display="flex" alignItems="center" gap={2} mb={2}>
                <RepoIcon fill="var(--color-fg-muted)" />
                <Link
                  to={`/repos/${repo.provider}/${repo.repo_full_name}`}
                  style={{ color: "var(--color-accent-emphasis)", fontWeight: "bold", textDecoration: "none" }}
                >
                  {repo.repo_full_name}
                </Link>
              </Box>
              <Text color="var(--color-fg-muted)" fontSize={1} mb={3} sx={{ flex: 1 }}>
                Linked from {repo.provider}
              </Text>
              <Box display="flex" gap={3} color="var(--color-fg-muted)" fontSize={0}>
                <Box display="flex" alignItems="center" gap={1}>
                  <StarIcon /> 0
                </Box>
                <Box display="flex" alignItems="center" gap={1}>
                  <RepoForkedIcon /> 0
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {showAddModal && (
        <Dialog onClose={() => setShowAddModal(false)} title="Link Repository" width="large">
          <Box p={3}>
            <Text as="p" mb={3} color="var(--color-fg-muted)">
              Enter the URL of a public GitLab or GitHub repository to link it to your profile.
            </Text>
            <TextInput
              block
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="e.g., https://gitlab.com/modelscript/msl"
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
