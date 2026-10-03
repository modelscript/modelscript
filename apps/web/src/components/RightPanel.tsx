// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
  ArrowRightIcon,
  KebabHorizontalIcon,
  MarkGithubIcon,
  PlayIcon,
  PlusIcon,
  ServerIcon,
  SyncIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Button, Dialog, Heading, Text } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { getClusterStatus, getUnifiedUserJobs, type ClusterStatus, type UnifiedJob } from "../api";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";
import Box from "./Box";
import CloudSimulationModal from "./CloudSimulationModal";
import FollowButton from "./FollowButton";
import ProfileHoverCard from "./ProfileHoverCard";

const PanelContainer = styled.aside`
  width: 350px;
  position: sticky;
  top: 0;
  padding: 16px 24px 12px 24px;
  box-sizing: border-box;

  @media (max-width: 1000px) {
    display: none;
  }
`;

const GitLabIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M15.82 7.42L14.07 2.05C13.98 1.77 13.58 1.77 13.49 2.05L11.83 7.15H4.17L2.51 2.05C2.42 1.77 2.02 1.77 1.93 2.05L0.18 7.42C0.09 7.69 0.19 8.01 0.43 8.18L8 13.68L15.57 8.18C15.81 8.01 15.91 7.69 15.82 7.42Z"
      fill="#FC6D26"
    />
    <path d="M8 13.68L4.17 7.15H11.83L8 13.68Z" fill="#E24329" />
    <path
      d="M8 13.68L11.83 7.15H15.57C15.81 8.01 15.91 7.69 15.82 7.42L14.07 2.05C13.98 1.77 13.58 1.77 13.49 2.05L11.83 7.15Z"
      fill="#FCA326"
    />
    <path
      d="M8 13.68L4.17 7.15H0.43C0.19 8.01 0.09 7.69 0.18 7.42L1.93 2.05C2.02 1.77 2.42 1.77 2.51 2.05L4.17 7.15Z"
      fill="#FCA326"
    />
  </svg>
);

const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const SearchContainer = styled.div`
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 100;
  margin-top: -16px;
  margin-left: -24px;
  margin-right: -24px;
  padding-top: 16px;
  padding-bottom: 12px;
  padding-left: 24px;
  padding-right: 24px;
  margin-bottom: 4px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--color-bg-primary);
    opacity: 0.85;
    z-index: -1;
  }
`;

const SearchWrapper = styled.div`
  width: 100%;
  position: relative;
  display: flex;
  align-items: center;

  svg {
    position: absolute;
    left: 16px;
    color: var(--color-fg-muted);
  }

  input {
    width: 100%;
    padding: 12px 16px 12px 42px;
    border-radius: 9999px;
    background-color: var(--color-search-bg);
    border: 1px solid var(--color-search-border);
    color: var(--color-text-primary);
    font-size: 15px;
    outline: none;
    box-sizing: border-box;

    &::placeholder {
      color: var(--color-text-tertiary);
    }

    &:focus {
      background-color: var(--color-search-bg);
      border-color: var(--color-accent-cyan);
      box-shadow:
        0 0 0 1px var(--color-accent-cyan),
        var(--glow-cyan-sm);
    }
  }
`;

const DropdownWrapper = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  margin-top: 4px;
  z-index: 100;
  max-height: 500px;
  overflow-y: auto;
  overflow-x: hidden;
`;

const DropdownSection = styled.div`
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);

  &:last-child {
    border-bottom: none;
  }
`;

const DropdownTitle = styled.div`
  font-size: 13px;
  font-weight: bold;
  color: var(--color-fg-muted);
  padding: 4px 16px;
`;

const DropdownItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;

  &:hover {
    background-color: var(--color-bg-secondary);
  }
`;

const Card = styled.div`
  background: var(--color-bg-card, rgba(15, 23, 42, 0.65));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1));
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 16px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    border-color: rgba(139, 92, 246, 0.35);
    box-shadow:
      0 8px 24px -6px rgba(0, 0, 0, 0.5),
      0 0 16px rgba(139, 92, 246, 0.12);
  }
`;

const WalletCard = styled(Card)`
  background: linear-gradient(135deg, rgba(30, 27, 75, 0.45) 0%, rgba(15, 23, 42, 0.75) 100%);
  border: 1px solid rgba(139, 92, 246, 0.25);
  position: relative;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, #06b6d4, #8b5cf6, #3b82f6);
  }
`;

const SpinSyncIcon = styled(SyncIcon)<{ $isSpinning: boolean }>`
  animation: ${(props) => (props.$isSpinning ? "spin 1s linear infinite" : "none")};
  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
`;

const Avatar = styled.div<{ $url?: string; $letter?: string }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--color-done-emphasis);
  background-image: ${(props) => (props.$url ? `url(${props.$url})` : "none")};
  background-size: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  flex-shrink: 0;

  &::after {
    content: "${(props) => (!props.$url && props.$letter ? props.$letter : "")}";
  }

  &:hover {
    filter: brightness(0.85);
  }
`;

const ProfileNameLink = styled(Link)`
  color: inherit;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  &:hover {
    text-decoration: underline;
  }
`;

const ProviderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-glass);
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  width: 100%;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--color-border-strong);
  }
`;

const TrendingItem = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 8px 16px;
  margin: 0 -16px;
  cursor: pointer;
  position: relative;
  transition: background-color 0.2s;
  border-radius: 6px;

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
  }
`;

const ShowMoreLink = styled(Link)`
  color: var(--color-accent-cyan);
  text-decoration: none;
  font-size: 14px;
  padding: 12px 16px;
  margin: 4px -16px -16px -16px;
  border-radius: 0 0 16px 16px;
  display: block;
  transition: all 0.2s;

  &:hover {
    background-color: rgba(6, 182, 212, 0.06);
    color: var(--color-link-hover);
  }
`;

const KebabButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 0.2s,
    color 0.2s;

  &:hover {
    background-color: var(--color-accent-purple-bg);
    color: var(--color-accent-purple);
  }
`;

const RightPanel: React.FC = () => {
  const { token, user, creditBalance, refreshWallet } = useAuth();
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [trending, setTrending] = useState<any[]>([]);
  const [popularRepos, setPopularRepos] = useState<any[]>([]);
  const [hpcJobs, setHpcJobs] = useState<UnifiedJob[]>([]);
  const [isHpcLoading, setIsHpcLoading] = useState(false);
  const [clusterInfo, setClusterInfo] = useState<ClusterStatus | null>(null);
  const [isSimModalOpen, setIsSimModalOpen] = useState(false);
  const [legalModal, setLegalModal] = useState<"terms" | "privacy" | "cookies" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTrendMenu, setActiveTrendMenu] = useState<number | null>(null);
  const [searchCompletions, setSearchCompletions] = useState<{
    topics: any[];
    users: any[];
    packages: any[];
    repositories: any[];
  } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";

  const panelRef = useRef<HTMLElement>(null);
  const [panelTop, setPanelTop] = useState(0);

  useEffect(() => {
    if (!panelRef.current) return;

    const updateTop = () => {
      if (!panelRef.current) return;
      const height = panelRef.current.getBoundingClientRect().height;
      const vh = window.innerHeight;
      // If sidebar is taller than viewport, stick its bottom to viewport bottom
      if (height > vh) {
        setPanelTop(vh - height);
      } else {
        // Otherwise stick its top to viewport top (accounting for dev header if any)
        setPanelTop(0);
      }
    };

    const observer = new ResizeObserver(() => updateTop());
    observer.observe(panelRef.current);
    window.addEventListener("resize", updateTop);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateTop);
    };
  }, []);

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      navigate(`/explore?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  useEffect(() => {
    if (query) {
      setSearchQuery(query);
    }
  }, [query]);

  const fetchJobsAndCluster = React.useCallback(async () => {
    setIsHpcLoading(true);
    try {
      const [jobs, cluster] = await Promise.all([getUnifiedUserJobs(), getClusterStatus()]);
      setHpcJobs(jobs.slice(0, 4));
      setClusterInfo(cluster);
    } catch {
      // ignore
    } finally {
      setIsHpcLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobsAndCluster();
    const interval = setInterval(fetchJobsAndCluster, 10000);
    return () => clearInterval(interval);
  }, [fetchJobsAndCluster, token]);

  useEffect(() => {
    if (searchQuery.trim().length === 0) {
      setSearchCompletions(null);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/search/completions?q=${encodeURIComponent(searchQuery)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          setSearchCompletions(await res.json());
        }
      } catch (err) {
        // ignore
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, token]);

  useEffect(() => {
    async function fetchSuggestions() {
      try {
        const res = await fetch(`${API_BASE_URL}/users/suggestions?limit=4`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          const filtered = (data.suggestions || []).filter((s: any) => !user || s.username !== user.username);
          setSuggestions(filtered);
        }
      } catch (err) {
        console.error(err);
      }
    }
    fetchSuggestions();
  }, [token, user]);

  useEffect(() => {
    async function fetchTrending() {
      try {
        const res = await fetch(`${API_BASE_URL}/social/trending?limit=4`);
        if (res.ok) {
          const data = await res.json();
          setTrending(data.topics);
        }
      } catch (err) {
        console.error(err);
      }
    }
    fetchTrending();
  }, []);

  useEffect(() => {
    async function fetchPopularRepos() {
      try {
        const res = await fetch(`${API_BASE_URL}/repos/popular`);
        if (res.ok) {
          const data = await res.json();
          setPopularRepos(data.repos);
        }
      } catch (err) {
        console.error(err);
      }
    }
    fetchPopularRepos();
  }, []);

  return (
    <PanelContainer
      ref={panelRef}
      style={{
        top: panelTop < 0 ? `calc(${panelTop}px + var(--dev-header-height, 0px))` : "var(--dev-header-height, 0px)",
      }}
    >
      {(location.pathname === "/explore" || query) && (
        <Card style={{ padding: "16px" }}>
          <Heading
            as="h3"
            style={{
              fontSize: "18px",
              fontWeight: 800,
              marginBottom: "16px",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            }}
          >
            Search filters
          </Heading>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <Text
                style={{
                  fontWeight: "bold",
                  fontSize: "14px",
                  display: "block",
                  marginBottom: "8px",
                  color: "var(--color-text-primary)",
                }}
              >
                People
              </Text>
              <label
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "14px",
                  cursor: "pointer",
                  marginBottom: "8px",
                  color: "var(--color-text-primary)",
                }}
              >
                <span>From anyone</span>
                <input
                  type="radio"
                  name="people-filter"
                  defaultChecked
                  style={{ accentColor: "var(--color-accent-cyan)", width: "16px", height: "16px" }}
                />
              </label>
              <label
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "14px",
                  cursor: "pointer",
                  color: "var(--color-text-primary)",
                }}
              >
                <span>People you follow</span>
                <input
                  type="radio"
                  name="people-filter"
                  style={{ accentColor: "var(--color-accent-cyan)", width: "16px", height: "16px" }}
                />
              </label>
            </div>

            <div style={{ height: "1px", backgroundColor: "var(--color-border)" }} />

            <div>
              <Text
                style={{
                  fontWeight: "bold",
                  fontSize: "14px",
                  display: "block",
                  marginBottom: "8px",
                  color: "var(--color-text-primary)",
                }}
              >
                Location
              </Text>
              <label
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "14px",
                  cursor: "pointer",
                  marginBottom: "8px",
                  color: "var(--color-text-primary)",
                }}
              >
                <span>Anywhere</span>
                <input
                  type="radio"
                  name="location-filter"
                  defaultChecked
                  style={{ accentColor: "var(--color-accent-cyan)", width: "16px", height: "16px" }}
                />
              </label>
              <label
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "14px",
                  cursor: "pointer",
                  color: "var(--color-text-primary)",
                }}
              >
                <span>Near you</span>
                <input
                  type="radio"
                  name="location-filter"
                  style={{ accentColor: "var(--color-accent-cyan)", width: "16px", height: "16px" }}
                />
              </label>
            </div>

            <div style={{ height: "1px", backgroundColor: "var(--color-border)" }} />

            <a
              href="#advanced"
              style={{ color: "var(--color-accent-cyan)", textDecoration: "none", fontSize: "14px", fontWeight: "500" }}
            >
              Advanced search
            </a>
          </div>
        </Card>
      )}
      {!user && (
        <Card>
          <Heading as="h2" style={{ fontSize: "16px", marginBottom: "6px", fontWeight: 700 }}>
            Engineering Platform
          </Heading>
          <Text
            as="p"
            color="var(--color-text-muted)"
            style={{ fontSize: "13px", marginBottom: "12px", lineHeight: 1.4 }}
          >
            Simulate physical systems, export FMUs, and collaborate with engineers worldwide.
          </Text>
          <Box display="flex" flexDirection="column" gap={2}>
            <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/github")}>
              <MarkGithubIcon size={16} />
              Continue with GitHub
            </ProviderButton>
            <button
              onClick={() => navigate("/signup")}
              style={{
                height: 36,
                background: "var(--gradient-cta)",
                color: "white",
                border: "none",
                borderRadius: 9999,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                width: "100%",
                boxShadow: "0 0 10px rgba(139, 92, 246, 0.25)",
              }}
            >
              Create Free Account
            </button>
          </Box>
          <Box
            mt={3}
            pt={2}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTop: "1px solid var(--color-border-subtle)",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Have an account?</span>
            <button
              onClick={() => navigate("/login")}
              style={{
                background: "none",
                border: "none",
                color: "var(--color-accent-cyan)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
              }}
            >
              Sign in →
            </button>
          </Box>
        </Card>
      )}

      {user && (
        <WalletCard>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Box display="flex" alignItems="center" gap={2}>
              <ZapIcon size={14} fill="#8b5cf6" style={{ color: "var(--color-accent-purple)" }} />
              <Text
                style={{
                  fontSize: "12px",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: "var(--color-text-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Compute Wallet
              </Text>
            </Box>
            <span
              style={{
                fontSize: "10px",
                color: "var(--color-accent-purple)",
                fontFamily: "var(--font-mono)",
                background: "rgba(139, 92, 246, 0.15)",
                border: "1px solid rgba(139, 92, 246, 0.3)",
                padding: "1px 6px",
                borderRadius: "4px",
                fontWeight: 600,
              }}
            >
              RESEARCH TIER
            </span>
          </Box>

          <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={2}>
            <div>
              <span
                style={{
                  fontSize: "26px",
                  fontWeight: 800,
                  fontFamily: "var(--font-mono)",
                  background: "linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  letterSpacing: "-0.5px",
                }}
              >
                {creditBalance.toFixed(2)}
              </span>
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "var(--color-accent-purple)",
                  marginLeft: "4px",
                  fontFamily: "var(--font-mono)",
                }}
              >
                cr
              </span>
            </div>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-topup"))}
              style={{
                background: "rgba(139, 92, 246, 0.15)",
                border: "1px solid rgba(139, 92, 246, 0.4)",
                color: "var(--color-text-primary)",
                borderRadius: "6px",
                padding: "4px 10px",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.15s ease",
              }}
            >
              <PlusIcon size={12} />
              <span>Top Up</span>
            </button>
          </Box>

          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            pt={2}
            style={{
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
            }}
          >
            <span style={{ color: "var(--color-text-muted)" }}>Auto-Allocation: Active</span>
            <Link
              to="/settings/billing"
              style={{
                color: "var(--color-accent-cyan)",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                fontSize: "11px",
              }}
            >
              <span>Usage Log</span>
              <ArrowRightIcon size={10} />
            </Link>
          </Box>
        </WalletCard>
      )}

      <Card>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Box display="flex" alignItems="center" gap={2}>
            <ServerIcon size={14} style={{ color: "var(--color-text-muted)" }} />
            <Text
              style={{
                fontSize: "12px",
                fontWeight: "bold",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--color-text-muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              Cloud &amp; HPC Queue
            </Text>
          </Box>
          <Box display="flex" alignItems="center" gap={2}>
            <span
              style={{
                fontSize: "10px",
                color: clusterInfo?.slurmRunning ? "var(--color-status-verified)" : "var(--color-accent-cyan)",
                fontFamily: "var(--font-mono)",
                background: clusterInfo?.slurmRunning ? "rgba(16, 185, 129, 0.12)" : "rgba(6, 182, 212, 0.12)",
                border: `1px solid ${clusterInfo?.slurmRunning ? "rgba(16, 185, 129, 0.3)" : "rgba(6, 182, 212, 0.3)"}`,
                padding: "1px 6px",
                borderRadius: "4px",
                fontWeight: 600,
              }}
            >
              ● {clusterInfo?.slurmRunning ? `${clusterInfo.nodes} NODES` : "ONLINE"}
            </span>
            <button
              onClick={() => fetchJobsAndCluster()}
              disabled={isHpcLoading}
              title="Refresh queue"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-text-muted)",
                cursor: "pointer",
                padding: "2px",
                display: "flex",
                alignItems: "center",
              }}
            >
              <SpinSyncIcon size={12} $isSpinning={isHpcLoading} />
            </button>
          </Box>
        </Box>

        <Box display="flex" flexDirection="column" gap={3} style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>
          {hpcJobs.length > 0 ? (
            hpcJobs.map((job) => {
              const isRunning = job.status === "running" || job.status === "processing";
              const isDone = job.status === "completed" || job.status === "SUCCESS";
              const isFailed = job.status === "failed" || job.status === "FAILED";
              const progress = Math.min(100, Math.max(0, job.progress || (isDone ? 100 : isRunning ? 55 : 0)));

              return (
                <div key={job.id} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--color-text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "190px",
                      }}
                      title={job.name}
                    >
                      #{String(job.id).slice(0, 6)} {job.name}
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 600,
                        padding: "1px 5px",
                        borderRadius: "3px",
                        background: isDone
                          ? "rgba(16, 185, 129, 0.15)"
                          : isFailed
                            ? "rgba(239, 68, 68, 0.15)"
                            : isRunning
                              ? "rgba(6, 182, 212, 0.15)"
                              : "rgba(245, 158, 11, 0.15)",
                        color: isDone
                          ? "var(--color-status-verified)"
                          : isFailed
                            ? "#ef4444"
                            : isRunning
                              ? "var(--color-accent-cyan)"
                              : "#f59e0b",
                      }}
                    >
                      {job.status.toUpperCase()}
                    </span>
                  </Box>

                  <div
                    style={{
                      height: "4px",
                      background: "rgba(255, 255, 255, 0.08)",
                      borderRadius: "9999px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${progress}%`,
                        background: isFailed
                          ? "#ef4444"
                          : isDone
                            ? "var(--color-status-verified)"
                            : "var(--gradient-ai)",
                        borderRadius: "9999px",
                        boxShadow: isRunning ? "0 0 8px rgba(6, 182, 212, 0.5)" : "none",
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>

                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
                      {job.domain.toUpperCase()} · {job.profile || "standard"}
                    </span>
                    {job.costCredits != null && (
                      <span style={{ fontSize: "10px", color: "var(--color-accent-purple)" }}>
                        {job.costCredits.toFixed(2)} cr
                      </span>
                    )}
                  </Box>
                </div>
              );
            })
          ) : (
            <Box display="flex" flexDirection="column" alignItems="center" py={3} textAlign="center" gap={2}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  background: "rgba(6, 182, 212, 0.08)",
                  border: "1px solid rgba(6, 182, 212, 0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-accent-cyan)",
                }}
              >
                <ServerIcon size={18} />
              </div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                Cluster Ready &amp; Idle
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-muted)", maxWidth: 220, lineHeight: 1.4 }}>
                No active simulations. Run batched SUNDIALS CVODE, SU2 CFD, or CalculiX FEA.
              </div>
              <button
                onClick={() => setIsSimModalOpen(true)}
                style={{
                  marginTop: "6px",
                  background: "rgba(6, 182, 212, 0.1)",
                  border: "1px solid rgba(6, 182, 212, 0.3)",
                  color: "var(--color-accent-cyan)",
                  borderRadius: "6px",
                  padding: "5px 12px",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.15s ease",
                }}
              >
                <PlayIcon size={12} />
                <span>Launch Cloud Run</span>
              </button>
            </Box>
          )}
        </Box>
      </Card>

      <Card>
        <Heading
          as="h2"
          style={{
            fontSize: "15px",
            fontWeight: 700,
            marginBottom: "12px",
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "var(--color-text-muted)",
          }}
        >
          Trending Models & Topics
        </Heading>
        <Box display="flex" flexDirection="column">
          {trending.length > 0 ? (
            trending.map((topic) => (
              <TrendingItem key={topic.id}>
                <Box flex={1} onClick={() => navigate(`/explore?topic=${encodeURIComponent(topic.concept)}`)}>
                  <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "2px" }}>
                    {topic.location ? `Trending in ${topic.location}` : "Trending"}
                  </div>
                  <Text
                    as="div"
                    fontWeight="bold"
                    style={{ fontWeight: "bold", fontSize: "14px", color: "var(--color-text-primary)" }}
                  >
                    {topic.display_name}
                  </Text>
                </Box>
                <Box position="relative">
                  <KebabButton
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setActiveTrendMenu(activeTrendMenu === topic.id ? null : topic.id);
                    }}
                  >
                    <KebabHorizontalIcon size={16} />
                  </KebabButton>
                  {activeTrendMenu === topic.id && (
                    <>
                      <div
                        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setActiveTrendMenu(null);
                        }}
                      />
                      <Box
                        position="absolute"
                        top="100%"
                        right="0"
                        bg="var(--color-bg-primary)"
                        border="1px solid var(--color-border)"
                        borderRadius="12px"
                        boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                        p={2}
                        zIndex={100}
                        minWidth="280px"
                        display="flex"
                        flexDirection="column"
                        gap={1}
                      >
                        {[
                          "The associated content is not relevant",
                          "This trend is spam",
                          "This trend is abusive or harmful",
                          "Not interested in this",
                          "This trend is a duplicate",
                          "This trend is harmful or spammy",
                        ].map((label, i) => (
                          <button
                            key={i}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveTrendMenu(null);
                            }}
                            style={{
                              padding: "10px 12px",
                              background: "none",
                              border: "none",
                              textAlign: "left",
                              cursor: "pointer",
                              fontSize: "14px",
                              fontWeight: "bold",
                              color: "var(--color-text-primary)",
                              borderRadius: "8px",
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                          >
                            <span style={{ fontSize: "16px", color: "var(--color-text-muted)", lineHeight: 1 }}>
                              ☹️
                            </span>
                            {label}
                          </button>
                        ))}
                      </Box>
                    </>
                  )}
                </Box>
              </TrendingItem>
            ))
          ) : (
            <Box display="flex" flexDirection="column" gap={1} py={1}>
              {[
                { concept: "modelica", tag: "#Modelica 3.4", category: "Physical Systems" },
                { concept: "cfd", tag: "#CFD Aerodynamics", category: "Finite Volume" },
                { concept: "cvode", tag: "#SUNDIALS CVODE", category: "Stiff DAE Integrators" },
                { concept: "fmu", tag: "#FMI 3.0 Standard", category: "Co-Simulation" },
              ].map((topic, i) => (
                <Box
                  key={i}
                  onClick={() => navigate(`/explore?topic=${encodeURIComponent(topic.concept)}`)}
                  style={{
                    cursor: "pointer",
                    padding: "6px 8px",
                    borderRadius: "6px",
                    transition: "background-color 0.2s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{topic.category}</div>
                  <Text style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-primary)" }}>
                    {topic.tag}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          <ShowMoreLink to="/explore">Explore all models →</ShowMoreLink>
        </Box>
      </Card>

      {user && (
        <Card>
          <Heading as="h2" style={{ fontSize: "20px", marginBottom: "16px" }}>
            Who to follow
          </Heading>
          <Box display="flex" flexDirection="column" gap={3}>
            {suggestions
              .filter((u) => !user || u.username !== user.username)
              .map((u) => (
                <Box key={u.id} display="flex" alignItems="center" justifyContent="space-between">
                  <ProfileHoverCard username={u.username}>
                    <ProfileNameLink to={`/${u.username}`} style={{ flex: 1, minWidth: 0 }}>
                      <Avatar $url={u.avatar_url} $letter={u.username.charAt(0).toUpperCase()} />
                    </ProfileNameLink>
                  </ProfileHoverCard>
                  <Box
                    flex={1}
                    minWidth={0}
                    style={{ margin: "0 12px" }}
                    display="flex"
                    flexDirection="column"
                    alignItems="flex-start"
                  >
                    <div style={{ maxWidth: "100%", display: "flex", minWidth: 0 }}>
                      <ProfileHoverCard username={u.username}>
                        <ProfileNameLink to={`/${u.username}`} style={{ maxWidth: "100%" }}>
                          <Text
                            style={{
                              fontWeight: "bold",
                              fontSize: "15px",
                              color: "var(--color-text-heading)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              display: "block",
                            }}
                            title={u.display_name || u.username}
                          >
                            {u.display_name || u.username}
                          </Text>
                        </ProfileNameLink>
                      </ProfileHoverCard>
                    </div>
                    <Text
                      className="handle-text"
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        marginTop: "-2px",
                        display: "block",
                        maxWidth: "100%",
                      }}
                      title={`@${u.username}`}
                    >
                      @{u.username}
                    </Text>
                  </Box>
                  <div style={{ flexShrink: 0 }}>
                    <FollowButton username={u.username} initialIsFollowing={false} size="small" />
                  </div>
                </Box>
              ))}
            {suggestions.length === 0 && (
              <Text color="var(--color-fg-muted)" sx={{ fontSize: "14px" }}>
                No suggestions at this time.
              </Text>
            )}
          </Box>
        </Card>
      )}

      {location.pathname.startsWith("/repos") && popularRepos.length > 0 && (
        <Card>
          <Heading as="h2" style={{ fontSize: "20px", marginBottom: "16px" }}>
            Popular Repositories
          </Heading>
          <Box display="flex" flexDirection="column" gap={3}>
            {popularRepos.map((repo) => (
              <Box key={repo.id} display="flex" alignItems="center" justifyContent="space-between">
                <Link
                  to={`/repos/${repo.provider}/${repo.namespace}/${repo.project}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textDecoration: "none",
                    color: "inherit",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    overflow: "hidden",
                  }}
                >
                  <Avatar $url={repo.avatar_url} $letter={repo.project.charAt(0).toUpperCase()} />
                  <Box flex={1} minWidth={0} mr={2} display="flex" flexDirection="column">
                    <Text
                      style={{
                        fontWeight: "bold",
                        fontSize: "15px",
                        color: "var(--color-text-heading)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={repo.project}
                    >
                      {repo.project}
                    </Text>
                    <Text
                      style={{
                        color: "var(--color-text-muted)",
                        fontSize: "14px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={repo.namespace}
                    >
                      {repo.namespace}
                    </Text>
                  </Box>
                </Link>
              </Box>
            ))}
          </Box>
        </Card>
      )}

      {legalModal && (
        <Dialog isOpen={!!legalModal} onDismiss={() => setLegalModal(null)} aria-labelledby="legal-modal-title">
          <Dialog.Header id="legal-modal-title">
            {legalModal === "terms"
              ? "Terms of Service"
              : legalModal === "privacy"
                ? "Privacy Policy"
                : "Cookie Policy"}
          </Dialog.Header>
          <Box p={3} style={{ maxHeight: "400px", overflowY: "auto" }}>
            {legalModal === "terms" && (
              <Box display="flex" flexDirection="column" gap={2}>
                <Heading as="h4" style={{ fontSize: "15px" }}>
                  1. Acceptance of Terms
                </Heading>
                <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "13px", lineHeight: 1.5 }}>
                  By accessing ModelScript OS services, simulation runtimes, and engineering repositories, you agree to
                  comply with open scientific modeling standards and all applicable regulations.
                </Text>
                <Heading as="h4" style={{ fontSize: "15px", marginTop: "8px" }}>
                  2. Cloud & HPC Computing Usage
                </Heading>
                <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "13px", lineHeight: 1.5 }}>
                  Compute allocations, SUNDIALS solvers, and Slurm batch workers must be used exclusively for lawful
                  computational engineering and simulation tasks.
                </Text>
              </Box>
            )}
            {legalModal === "privacy" && (
              <Box display="flex" flexDirection="column" gap={2}>
                <Heading as="h4" style={{ fontSize: "15px" }}>
                  Privacy & Data Sovereignty
                </Heading>
                <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "13px", lineHeight: 1.5 }}>
                  ModelScript values data integrity. Public models are federated across the scientific network according
                  to your specified repository permissions. Private code and simulation traces remain encrypted.
                </Text>
              </Box>
            )}
            {legalModal === "cookies" && (
              <Box display="flex" flexDirection="column" gap={2}>
                <Heading as="h4" style={{ fontSize: "15px" }}>
                  Cookie & Local Storage Policy
                </Heading>
                <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "13px", lineHeight: 1.5 }}>
                  We utilize essential authentication session tokens and local preferences (e.g., color scheme themes)
                  to deliver a seamless workspace environment.
                </Text>
              </Box>
            )}
            <Box display="flex" justifyContent="flex-end" mt={4}>
              <Button onClick={() => setLegalModal(null)}>Close</Button>
            </Box>
          </Box>
        </Dialog>
      )}

      {isSimModalOpen && (
        <CloudSimulationModal
          isOpen={isSimModalOpen}
          onClose={() => {
            setIsSimModalOpen(false);
            fetchJobsAndCluster();
          }}
        />
      )}
    </PanelContainer>
  );
};

export default RightPanel;
