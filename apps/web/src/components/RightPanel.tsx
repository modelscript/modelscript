// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  getClusterStatus,
  getLibraries,
  getPopularRepos,
  getTrending,
  getUnifiedUserJobs,
  getUserSuggestions,
  type ClusterStatus,
  type UnifiedJob,
} from "../api";
import { useAuth } from "../AuthContext";
import { ANSATZ_VERSION } from "../config";
import { useFeatureFlag } from "../FeatureFlagContext";
import { useInstanceBranding } from "../InstanceBrandingContext";
import {
  TutorialGuideDockPane,
  type TutorialGuideDockPaneProps,
} from "../pages/post-detail/components/TutorialGuideDockPane";
import CloudSimulationModal from "./CloudSimulationModal";
import {
  AiSearchHeader,
  AuthPromptCard,
  ClusterQueueCard,
  PanelContainer,
  PanelFooter,
  PopularPackagesCard,
  PopularReposCard,
  SuggestedUsersCard,
  TrendingTopicsCard,
  WalletCard,
} from "./right-panel";

export interface RightPanelProps {
  clusterInfo?: ClusterStatus | null | undefined;
  onOpenCommandPalette?: (() => void) | undefined;
}

interface ArticleInspectorDetail extends TutorialGuideDockPaneProps {
  active: boolean;
}

export const RightPanel: React.FC<RightPanelProps> = ({ clusterInfo: propClusterInfo, onOpenCommandPalette }) => {
  const { token, user, creditBalance } = useAuth();
  const branding = useInstanceBranding();
  const version = (branding.buildVersion || ANSATZ_VERSION).replace(/^v/i, "");
  const hasBilling = useFeatureFlag("billing_stripe_live");
  const hasCloudSolver = useFeatureFlag("cae_cloud_solver");
  const hasPackages = useFeatureFlag("package_browser");
  const hasRepos = useFeatureFlag("git_repositories");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [trending, setTrending] = useState<any[]>([]);
  const [popularPackages, setPopularPackages] = useState<any[]>([]);
  const [popularRepos, setPopularRepos] = useState<any[]>([]);
  const [hpcJobs, setHpcJobs] = useState<UnifiedJob[]>([]);
  const [isHpcLoading, setIsHpcLoading] = useState(false);
  const [fallbackClusterInfo, setFallbackClusterInfo] = useState<ClusterStatus | null>(null);
  const clusterInfo = propClusterInfo !== undefined ? propClusterInfo : fallbackClusterInfo;
  const [isSimModalOpen, setIsSimModalOpen] = useState(false);
  const [activeTrendMenu, setActiveTrendMenu] = useState<number | null>(null);
  const [articleInspector, setArticleInspector] = useState<ArticleInspectorDetail | null>(null);
  const location = useLocation();
  const isExplore = location.pathname.startsWith("/explore");
  const isStatusRoute = location.pathname.includes("/status/");

  useEffect(() => {
    if (!isStatusRoute) {
      setArticleInspector(null);
    }
  }, [isStatusRoute]);

  useEffect(() => {
    const handleInspector = (e: Event) => {
      const detail = (e as CustomEvent<ArticleInspectorDetail | undefined>).detail;
      if (detail?.active && detail.post && detail.notebookData) {
        setArticleInspector(detail);
      } else {
        setArticleInspector(null);
      }
    };
    window.addEventListener("modelscript:notebook-inspector", handleInspector);
    return () => {
      window.removeEventListener("modelscript:notebook-inspector", handleInspector);
    };
  }, []);

  const showArticleSidebar = Boolean(isStatusRoute && articleInspector?.active);

  const panelRef = useRef<HTMLElement>(null);
  const [panelTop, setPanelTop] = useState<number | null>(null);

  useEffect(() => {
    if (!panelRef.current) return;

    const updateTop = () => {
      if (!panelRef.current) return;
      const height = Math.round(panelRef.current.getBoundingClientRect().height);
      const vh = window.innerHeight;
      setPanelTop(vh - height);
    };

    updateTop();
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
    if (!hasCloudSolver || showArticleSidebar) return;
    if (!token && propClusterInfo !== undefined) return;
    const poll = () => {
      if (document.visibilityState === "visible") {
        fetchJobsAndCluster();
      }
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [fetchJobsAndCluster, hasCloudSolver, token, propClusterInfo, showArticleSidebar]);

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
        const data = await getTrending(isExplore ? 8 : 4);
        setTrending(data.topics || []);
      } catch (err) {
        console.error(err);
      }
    }
    fetchTrending();
    window.addEventListener("modelscript:post-created", fetchTrending);
    return () => window.removeEventListener("modelscript:post-created", fetchTrending);
  }, [isExplore]);

  useEffect(() => {
    if (!hasPackages) return;
    async function fetchPopularPackages() {
      try {
        const pkgs = await getLibraries(undefined, "recommended");
        setPopularPackages((pkgs || []).slice(0, 7));
      } catch (err) {
        console.error(err);
      }
    }
    fetchPopularPackages();
  }, [hasPackages]);

  useEffect(() => {
    async function fetchPopularRepos() {
      try {
        const data = await getPopularRepos(7);
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
        top: panelTop !== null ? `min(var(--dev-header-height, 0px), ${panelTop}px)` : "var(--dev-header-height, 0px)",
      }}
    >
      {!isExplore && <AiSearchHeader onOpenCommandPalette={onOpenCommandPalette} />}

      {showArticleSidebar && articleInspector ? (
        <div style={{ marginTop: "8px" }}>
          <TutorialGuideDockPane
            post={articleInspector.post}
            notebookData={articleInspector.notebookData}
            notebookHeadings={articleInspector.notebookHeadings}
            readTimeMinutes={articleInspector.readTimeMinutes}
            activeHeadingSlug={articleInspector.activeHeadingSlug}
            setActiveHeadingSlug={articleInspector.setActiveHeadingSlug}
            readingProgress={articleInspector.readingProgress}
          />
        </div>
      ) : (
        <>
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

          <TrendingTopicsCard
            trending={trending}
            activeTrendMenu={activeTrendMenu}
            setActiveTrendMenu={setActiveTrendMenu}
          />

          {(user || (isExplore && suggestions.length > 0)) && (
            <SuggestedUsersCard suggestions={suggestions} currentUsername={user?.username} />
          )}

          {hasPackages &&
            (location.pathname.startsWith("/packages") ||
              location.pathname.startsWith("/libraries") ||
              location.pathname.startsWith("/repos") ||
              isExplore) && <PopularPackagesCard popularPackages={popularPackages} />}

          {hasRepos &&
            (location.pathname.startsWith("/repos") ||
              location.pathname.startsWith("/packages") ||
              location.pathname.startsWith("/libraries") ||
              isExplore) && <PopularReposCard popularRepos={popularRepos} />}
        </>
      )}

      <PanelFooter>
        <Link to="/terms">Terms</Link>
        <span>·</span>
        <Link to="/privacy">Privacy</Link>
        <span>·</span>
        <Link to="/cookies">Cookies</Link>
        <span>·</span>
        <a href="https://github.com/modelscript/modelscript" target="_blank" rel="noopener noreferrer">
          {branding.instanceName || "Ansatz"} v{version}
        </a>
      </PanelFooter>

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
