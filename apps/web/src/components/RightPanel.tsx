// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  getClusterStatus,
  getPopularRepos,
  getTrending,
  getUnifiedUserJobs,
  getUserSuggestions,
  type ClusterStatus,
  type UnifiedJob,
} from "../api";
import { useAuth } from "../AuthContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import CloudSimulationModal from "./CloudSimulationModal";
import {
  AiSearchHeader,
  AuthPromptCard,
  ClusterQueueCard,
  LegalModal,
  PanelContainer,
  PopularReposCard,
  SuggestedUsersCard,
  TrendingTopicsCard,
  WalletCard,
} from "./right-panel";

export interface RightPanelProps {
  clusterInfo?: ClusterStatus | null | undefined;
  onOpenCommandPalette?: (() => void) | undefined;
}

export const RightPanel: React.FC<RightPanelProps> = ({ clusterInfo: propClusterInfo, onOpenCommandPalette }) => {
  const { token, user, creditBalance } = useAuth();
  const hasBilling = useFeatureFlag("billing_stripe_live");
  const hasCloudSolver = useFeatureFlag("cae_cloud_solver");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [trending, setTrending] = useState<any[]>([]);
  const [popularRepos, setPopularRepos] = useState<any[]>([]);
  const [hpcJobs, setHpcJobs] = useState<UnifiedJob[]>([]);
  const [isHpcLoading, setIsHpcLoading] = useState(false);
  const [fallbackClusterInfo, setFallbackClusterInfo] = useState<ClusterStatus | null>(null);
  const clusterInfo = propClusterInfo !== undefined ? propClusterInfo : fallbackClusterInfo;
  const [isSimModalOpen, setIsSimModalOpen] = useState(false);
  const [legalModal, setLegalModal] = useState<"terms" | "privacy" | "cookies" | null>(null);
  const [activeTrendMenu, setActiveTrendMenu] = useState<number | null>(null);
  const location = useLocation();

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

  const fetchJobsAndCluster = React.useCallback(async () => {
    if (!hasCloudSolver) return;
    if (!token && propClusterInfo !== undefined) return;
    setIsHpcLoading(true);
    try {
      if (token) {
        const jobs = await getUnifiedUserJobs();
        setHpcJobs(jobs.slice(0, 4));
      }
      if (propClusterInfo === undefined) {
        const cluster = await getClusterStatus();
        setFallbackClusterInfo(cluster);
      }
    } catch {
      // ignore
    } finally {
      setIsHpcLoading(false);
    }
  }, [token, propClusterInfo, hasCloudSolver]);

  useEffect(() => {
    if (!hasCloudSolver) return;
    const poll = () => {
      if (document.visibilityState === "visible") {
        fetchJobsAndCluster();
      }
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [fetchJobsAndCluster, hasCloudSolver]);

  useEffect(() => {
    async function fetchSuggestions() {
      try {
        const data = await getUserSuggestions(4);
        const filtered = (data.suggestions || []).filter((s: any) => !user || s.username !== user.username);
        setSuggestions(filtered);
      } catch (err) {
        console.error(err);
      }
    }
    fetchSuggestions();
  }, [token, user]);

  useEffect(() => {
    async function fetchTrending() {
      try {
        const data = await getTrending(4);
        setTrending(data.topics || []);
      } catch (err) {
        console.error(err);
      }
    }
    fetchTrending();
  }, []);

  useEffect(() => {
    async function fetchPopularRepos() {
      try {
        const data = await getPopularRepos();
        setPopularRepos(data.repos || []);
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
      <AiSearchHeader onOpenCommandPalette={onOpenCommandPalette} />

      {!user && <AuthPromptCard />}

      {user && hasBilling && <WalletCard creditBalance={creditBalance} />}

      {user && hasCloudSolver && (
        <ClusterQueueCard
          clusterInfo={clusterInfo}
          hpcJobs={hpcJobs}
          isHpcLoading={isHpcLoading}
          onRefresh={fetchJobsAndCluster}
          onOpenSimModal={() => setIsSimModalOpen(true)}
        />
      )}

      {location.pathname !== "/explore" && (
        <TrendingTopicsCard
          trending={trending}
          activeTrendMenu={activeTrendMenu}
          setActiveTrendMenu={setActiveTrendMenu}
        />
      )}

      {user && <SuggestedUsersCard suggestions={suggestions} currentUsername={user.username} />}

      {location.pathname.startsWith("/repos") && <PopularReposCard popularRepos={popularRepos} />}

      {legalModal && <LegalModal legalModal={legalModal} onClose={() => setLegalModal(null)} />}

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
