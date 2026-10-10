// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CheckIcon,
  ChevronDownIcon,
  CpuIcon,
  FileCodeIcon,
  FilterIcon,
  FlameIcon,
  GearIcon,
  GlobeIcon,
  PackageIcon,
  PlusIcon,
  PulseIcon,
  RocketIcon,
  SearchIcon,
  TagIcon,
  XIcon,
} from "@primer/octicons-react";
import { Spinner } from "@primer/react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { followUser, getTimeline, getTrending, unfollowUser } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import ComposeBox from "../components/ComposeBox";
import { ComposeContext } from "../components/ComposeContext";
import Post from "../components/Post";
import PostSkeleton from "../components/PostSkeleton";
import { cacheTimelinePosts, getCachedTimelinePosts } from "../util/offline-storage";
import { usePageTitle } from "../util/title";

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 20;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: var(--surface-hud);
`;

const Tab = styled.button<{ $active?: boolean }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 53px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
  position: relative;
  outline: none;

  &:hover {
    background-color: var(--surface-row-hover);
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--color-accent-cyan);
  }
`;

const TabText = styled.div<{ $active?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--gradient-cta);
    box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
    border-radius: var(--radius-pill);
    transform: ${(props) => (props.$active ? "scaleX(1)" : "scaleX(0.4)")};
    opacity: ${(props) => (props.$active ? 1 : 0)};
    transition:
      transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
      opacity 0.2s ease;
  }
`;

const SortMenu = styled.div`
  position: absolute;
  top: 30px;
  left: 50%;
  transform: translateX(-50%);
  width: 160px;
  background-color: var(--surface-overlay);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass);
  border-radius: 16px;
  box-shadow: var(--glow-card);
  padding: 12px 0;
  z-index: 100;

  button {
    width: 100%;
    padding: 12px 16px;
    background: none;
    border: none;
    text-align: left;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;

    &:hover {
      background-color: var(--surface-row-hover);
    }
  }

  .menu-header {
    padding: 0 16px 8px 16px;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
`;

const ComposePrompt = styled.div`
  display: flex;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
  cursor: text;
`;

export interface FilterChip {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  emoji?: string;
  artifactType?: string;
  description: string;
}

const FILTER_CHIPS: FilterChip[] = [
  { id: "all", label: "All", icon: GlobeIcon, emoji: "🌐", description: "All engineering updates" },
  { id: "cad", label: "CAD 3D", icon: PackageIcon, emoji: "📐", artifactType: "cad", description: "STEP & CAD models" },
  {
    id: "simulation",
    label: "FEA / CFD",
    icon: FlameIcon,
    emoji: "🔥",
    artifactType: "simulation",
    description: "Finite element & CFD simulations",
  },
  {
    id: "plot",
    label: "Plots & Data",
    icon: PulseIcon,
    emoji: "📈",
    artifactType: "plot",
    description: "Dynamic simulation trajectories",
  },
  {
    id: "modelica",
    label: "Modelica Code",
    icon: FileCodeIcon,
    emoji: "⚡",
    artifactType: "modelica",
    description: "Equations & models",
  },
  { id: "aas", label: "AAS Twins", icon: CpuIcon, emoji: "🏭", artifactType: "aas", description: "Digital Twins" },
  { id: "gcode", label: "Toolpaths", icon: GearIcon, emoji: "⚙️", artifactType: "gcode", description: "G-Code & CNC" },
];

interface TopicItem {
  concept: string;
  displayName: string;
  postCount?: number;
}

const DEFAULT_CURATED_HASHTAGS: TopicItem[] = [
  { concept: "aerodynamics", displayName: "Aerodynamics" },
  { concept: "thermodynamics", displayName: "Thermodynamics" },
  { concept: "robotics", displayName: "Robotics" },
  { concept: "additivemfg", displayName: "AdditiveMfg" },
  { concept: "digitaltwin", displayName: "DigitalTwin" },
  { concept: "controlsystems", displayName: "ControlSystems" },
  { concept: "multibody", displayName: "Multibody" },
  { concept: "fluiddynamics", displayName: "FluidDynamics" },
  { concept: "cad", displayName: "CAD" },
  { concept: "modelica", displayName: "Modelica" },
];

const FilterSection = styled.div`
  background: var(--surface-hud, rgba(14, 20, 36, 0.65));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--color-border);
  padding: 8px 16px;
  position: sticky;
  top: calc(var(--dev-header-height, 0px) + 53px);
  z-index: 15;
`;

const FilterChipsScroll = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

const FilterChipButton = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? "600" : "500")};
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: inherit;
  flex-shrink: 0;

  background: ${(props) =>
    props.$active
      ? "linear-gradient(135deg, rgba(6, 182, 212, 0.22) 0%, rgba(139, 92, 246, 0.3) 100%)"
      : "rgba(255, 255, 255, 0.04)"};
  border: 1px solid
    ${(props) => (props.$active ? "var(--color-accent-cyan)" : "var(--color-border-subtle, rgba(255, 255, 255, 0.08))")};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--color-text-secondary)")};
  box-shadow: ${(props) => (props.$active ? "0 0 12px rgba(6, 182, 212, 0.35)" : "none")};

  &:hover {
    background: ${(props) =>
      props.$active
        ? "linear-gradient(135deg, rgba(6, 182, 212, 0.3) 0%, rgba(139, 92, 246, 0.4) 100%)"
        : "rgba(255, 255, 255, 0.08)"};
    border-color: ${(props) =>
      props.$active ? "var(--color-accent-cyan)" : "var(--color-border-default, rgba(255, 255, 255, 0.2))"};
    color: ${(props) => (props.$active ? "#ffffff" : "var(--color-text-primary)")};
    transform: translateY(-1px);
  }

  .chip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: ${(props) => (props.$active ? "var(--color-accent-cyan)" : "var(--color-text-muted)")};
    transition: color 0.15s ease;
  }
`;

const HashtagPill = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 11.5px;
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  transition: all 0.15s ease;
  flex-shrink: 0;

  background: ${(props) => (props.$active ? "rgba(139, 92, 246, 0.25)" : "rgba(255, 255, 255, 0.03)")};
  border: 1px solid
    ${(props) =>
      props.$active ? "var(--color-accent-purple)" : "var(--color-border-subtle, rgba(255, 255, 255, 0.07))"};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--color-text-muted)")};
  box-shadow: ${(props) => (props.$active ? "0 0 10px rgba(139, 92, 246, 0.35)" : "none")};
  font-weight: ${(props) => (props.$active ? "600" : "400")};

  &:hover {
    background: rgba(139, 92, 246, 0.15);
    border-color: rgba(139, 92, 246, 0.4);
    color: var(--color-accent-purple);
  }

  .post-count {
    font-size: 10px;
    opacity: 0.75;
    background: rgba(255, 255, 255, 0.1);
    padding: 1px 4px;
    border-radius: 4px;
    margin-left: 2px;
  }
`;

const ActiveFilterBanner = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: rgba(6, 182, 212, 0.08);
  border-bottom: 1px solid rgba(6, 182, 212, 0.25);
  font-size: 12.5px;
  gap: 12px;
  flex-wrap: wrap;

  .filter-summary {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-accent-cyan);
    font-weight: 500;
  }

  .filter-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(6, 182, 212, 0.15);
    border: 1px solid rgba(6, 182, 212, 0.35);
    padding: 2px 8px;
    border-radius: 12px;
    color: #ffffff;
    font-size: 11.5px;

    button {
      background: none;
      border: none;
      padding: 0;
      margin-left: 4px;
      display: inline-flex;
      align-items: center;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      &:hover {
        color: #ffffff;
      }
    }
  }

  .result-count {
    color: var(--color-text-muted);
    font-size: 12px;
  }

  .filter-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .topic-hub-link {
    background: none;
    border: 1px solid rgba(139, 92, 246, 0.4);
    color: var(--color-accent-purple);
    font-size: 11.5px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover {
      background: rgba(139, 92, 246, 0.15);
      border-color: var(--color-accent-purple);
    }
  }

  .clear-all-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-size: 11.5px;
    cursor: pointer;
    text-decoration: underline;
    &:hover {
      color: var(--color-text-primary);
    }
  }
`;

const EmptyStateContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 56px 24px;
  max-width: 440px;
  margin: 0 auto;
`;

const EmptyStateIconOrb = styled.div`
  width: 64px;
  height: 64px;
  border-radius: var(--radius-lg);
  background: var(--gradient-ai-subtle);
  border: 1px solid var(--color-accent-purple-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent-cyan);
  box-shadow: var(--glow-ai-sm);
  margin-bottom: 20px;
`;

const EmptyStateTitle = styled.h2`
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-heading);
  margin: 0 0 8px 0;
  letter-spacing: -0.3px;
`;

const EmptyStateSubtitle = styled.p`
  font-size: 14px;
  color: var(--color-text-muted);
  line-height: 1.5;
  margin: 0 0 24px 0;
`;

const EmptyStateActions = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
`;

const PrimaryActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--gradient-cta);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  padding: 10px 18px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 0 14px rgba(139, 92, 246, 0.35);
  transition: all 0.2s ease;

  &:hover {
    box-shadow: 0 0 20px rgba(6, 182, 212, 0.5);
    transform: translateY(-1px);
  }
`;

const SecondaryActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--color-btn-secondary-bg);
  border: 1px solid var(--color-btn-secondary-border);
  color: var(--color-btn-secondary-text);
  border-radius: var(--radius-md);
  padding: 10px 18px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-row-hover);
    border-color: rgba(255, 255, 255, 0.2);
  }
`;

const QuickstartContainer = styled.div`
  margin: 16px 0 24px;
  padding: 20px;
  background: var(--surface-overlay, rgba(22, 27, 34, 0.5));
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: var(--radius-lg, 12px);
  backdrop-filter: blur(12px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: left;
`;

const HeroGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
`;

const HeroCard = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-muted, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-row-hover, rgba(255, 255, 255, 0.06));
    border-color: var(--color-accent-emphasis, #8b5cf6);
    transform: translateY(-1px);
  }
`;

const DisciplineFollowsSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.08));
  padding-top: 16px;
`;

const DisciplineTabsRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const DisciplineTabButton = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-pill, 20px);
  font-size: 12.5px;
  font-weight: ${(props) => (props.$active ? "600" : "500")};
  cursor: pointer;
  border: 1px solid
    ${(props) =>
      props.$active
        ? "var(--color-accent-emphasis, #8b5cf6)"
        : "var(--color-border-default, rgba(255, 255, 255, 0.12))"};
  background: ${(props) =>
    props.$active ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-subtle, rgba(255, 255, 255, 0.03))"};
  color: ${(props) =>
    props.$active ? "var(--color-accent-emphasis, #8b5cf6)" : "var(--color-text-secondary, #8b949e)"};
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--color-accent-emphasis, #8b5cf6);
    background: rgba(139, 92, 246, 0.1);
  }
`;

const SuggestedFollowsGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SuggestedFollowCard = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-muted, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 8px);
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-row-hover, rgba(255, 255, 255, 0.06));
    border-color: rgba(255, 255, 255, 0.16);
  }
`;

interface DisciplineItem {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  isPackage: boolean;
  description: string;
  exploreUrl: string;
}

interface DisciplineCategory {
  id: string;
  name: string;
  emoji: string;
  items: DisciplineItem[];
}

const DISCIPLINES: DisciplineCategory[] = [
  {
    id: "aerospace",
    name: "Aerospace",
    emoji: "🚀",
    items: [
      {
        id: "aero-1",
        name: "Modelica Fluid Dynamics",
        handle: "modelica_fluids",
        avatar: "🌊",
        isPackage: true,
        description: "Compressible multi-phase flow & propulsion",
        exploreUrl: "/explore?tag=fluids",
      },
      {
        id: "aero-2",
        name: "Orbital Mechanics Lab",
        handle: "aerospace_orbital",
        avatar: "🛰️",
        isPackage: false,
        description: "Keplerian orbits & satellite attitude control",
        exploreUrl: "/explore?tag=aerospace",
      },
      {
        id: "aero-3",
        name: "Propulsion Engineering",
        handle: "propulsion_sys",
        avatar: "🔥",
        isPackage: false,
        description: "Rocket nozzle acoustics & staging simulations",
        exploreUrl: "/explore?tag=propulsion",
      },
    ],
  },
  {
    id: "automotive",
    name: "Automotive",
    emoji: "🏎️",
    items: [
      {
        id: "auto-1",
        name: "Modelica Multibody Mechanics",
        handle: "modelica_mechanics",
        avatar: "⚙️",
        isPackage: true,
        description: "Suspension linkages, drivelines & tires",
        exploreUrl: "/explore?tag=mechanics",
      },
      {
        id: "auto-2",
        name: "EV Battery Dynamics",
        handle: "ev_powertrain",
        avatar: "🔋",
        isPackage: false,
        description: "Electro-thermal battery cells & BMS state estimation",
        exploreUrl: "/explore?tag=automotive",
      },
      {
        id: "auto-3",
        name: "Formula Race Dynamics",
        handle: "formula_dynamics",
        avatar: "🏁",
        isPackage: false,
        description: "Aero downforce balance & transient yaw analysis",
        exploreUrl: "/explore?tag=vehicle-dynamics",
      },
    ],
  },
  {
    id: "robotics",
    name: "Robotics",
    emoji: "🤖",
    items: [
      {
        id: "rob-1",
        name: "Spatial Kinematics",
        handle: "robotics_kinematics",
        avatar: "🦾",
        isPackage: false,
        description: "Serial 6-DOF manipulators & Denavit-Hartenberg",
        exploreUrl: "/explore?tag=robotics",
      },
      {
        id: "rob-2",
        name: "Bipedal Control Systems",
        handle: "dynamic_balance",
        avatar: "🦿",
        isPackage: false,
        description: "Zero-moment point & linear inverted pendulum",
        exploreUrl: "/explore?tag=control",
      },
      {
        id: "rob-3",
        name: "Modelica Magnetic",
        handle: "modelica_magnetic",
        avatar: "🧲",
        isPackage: true,
        description: "Flux tubes, solenoids & BLDC servo motors",
        exploreUrl: "/explore?tag=robotics",
      },
    ],
  },
  {
    id: "electrical",
    name: "Electrical",
    emoji: "⚡",
    items: [
      {
        id: "elec-1",
        name: "Modelica Electrical Analog",
        handle: "modelica_electrical",
        avatar: "🔌",
        isPackage: true,
        description: "SPICE analog circuits, semiconductor models & filters",
        exploreUrl: "/explore?tag=electrical",
      },
      {
        id: "elec-2",
        name: "Power Grid Stability",
        handle: "grid_systems",
        avatar: "🏭",
        isPackage: false,
        description: "HVDC transmission, microgrids & phasor DAEs",
        exploreUrl: "/explore?tag=power",
      },
      {
        id: "elec-3",
        name: "RF Signal Integrity",
        handle: "rf_microwave",
        avatar: "📡",
        isPackage: false,
        description: "S-parameters, impedance matching & microstrips",
        exploreUrl: "/explore?tag=rf",
      },
    ],
  },
];

const HomeFeedPage: React.FC = () => {
  usePageTitle("Home");
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"forYou" | "following" | "federated">("forYou");
  const [followingSort, setFollowingSort] = useState<"popular" | "recent">("recent");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [trendingTopics, setTrendingTopics] = useState<TopicItem[]>(DEFAULT_CURATED_HASHTAGS);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { openCompose } = React.useContext(ComposeContext);
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>("aerospace");
  const [followedHandles, setFollowedHandles] = useState<Record<string, boolean>>({});

  const handleToggleFollow = async (handle: string) => {
    const isNowFollowing = !followedHandles[handle];
    setFollowedHandles((prev) => ({ ...prev, [handle]: isNowFollowing }));
    if (token) {
      try {
        if (isNowFollowing) {
          await followUser(handle);
        } else {
          await unfollowUser(handle);
        }
      } catch {
        // Fallback gracefully
      }
    }
  };

  useEffect(() => {
    if (listRef.current) {
      setScrollMargin(listRef.current.offsetTop);
    }
  }, []);

  const rowVirtualizer = useWindowVirtualizer({
    count: posts.length,
    estimateSize: () => 180,
    overscan: 5,
    scrollMargin,
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".sort-menu-container")) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    async function fetchTrending() {
      try {
        const data = await getTrending(10);
        if (data?.topics && data.topics.length > 0) {
          const mapped: TopicItem[] = data.topics.map((t: any) => ({
            concept: t.concept,
            displayName: t.display_name || t.concept,
            postCount: t.post_count,
          }));
          setTrendingTopics(mapped);
        }
      } catch (err) {
        console.error("Failed to fetch trending engineering topics", err);
      }
    }
    fetchTrending();
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    async function fetchTimeline() {
      setLoading(true);
      setHasMore(true);
      try {
        const data = await getTimeline({
          following: activeTab === "following",
          federated: activeTab === "federated",
          sort: followingSort,
          limit: 20,
          artifactType: activeFilter !== "all" ? activeFilter : undefined,
          tag: activeTag || undefined,
        });
        const fetchedPosts = data.posts || [];
        setPosts(fetchedPosts);
        cacheTimelinePosts(fetchedPosts);
        if (fetchedPosts.length < 20) {
          setHasMore(false);
        }
      } catch (err) {
        console.warn("[HomeFeedPage] Network fetch failed, reading from offline cache:", err);
        const cached = await getCachedTimelinePosts();
        if (cached && cached.length > 0) {
          setPosts(cached);
          setHasMore(false);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchTimeline();
  }, [token, activeTab, followingSort, activeFilter, activeTag]);

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await getTimeline({
        following: activeTab === "following",
        federated: activeTab === "federated",
        sort: followingSort,
        limit: 20,
        offset: posts.length,
        artifactType: activeFilter !== "all" ? activeFilter : undefined,
        tag: activeTag || undefined,
      });
      const newPosts = data.posts || [];
      if (newPosts.length === 0) {
        setHasMore(false);
      } else {
        setPosts((prev) => [...prev, ...newPosts]);
        if (newPosts.length < 20) {
          setHasMore(false);
        }
      }
    } catch (err) {
      console.error("Failed to load more posts", err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const handlePostCreated = (e: any) => {
      const newPost = e.detail;
      if (newPost) {
        setPosts((prev) => [newPost, ...prev]);
      }
    };
    window.addEventListener("modelscript:post-created", handlePostCreated);
    return () => window.removeEventListener("modelscript:post-created", handlePostCreated);
  }, []);

  const handleKeyDownTab = (e: React.KeyboardEvent, currentTab: "forYou" | "following" | "federated") => {
    const tabs: ("forYou" | "following" | "federated")[] = ["forYou", "following", "federated"];
    const idx = tabs.indexOf(currentTab);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextTab = tabs[(idx + 1) % tabs.length];
      setActiveTab(nextTab);
      document.getElementById(`feed-tab-${nextTab}`)?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevTab = tabs[(idx - 1 + tabs.length) % tabs.length];
      setActiveTab(prevTab);
      document.getElementById(`feed-tab-${prevTab}`)?.focus();
    }
  };

  const isFiltering = activeFilter !== "all" || activeTag !== null;

  return (
    <Box style={{ paddingBottom: "200px" }}>
      <TabBar role="tablist" aria-label="Feed sections">
        <Tab
          id="feed-tab-forYou"
          role="tab"
          aria-selected={activeTab === "forYou"}
          aria-controls="feed-tabpanel"
          tabIndex={activeTab === "forYou" ? 0 : -1}
          $active={activeTab === "forYou"}
          onClick={() => setActiveTab("forYou")}
          onKeyDown={(e) => handleKeyDownTab(e, "forYou")}
        >
          <TabText $active={activeTab === "forYou"}>For you</TabText>
        </Tab>
        <Tab
          id="feed-tab-following"
          role="tab"
          aria-selected={activeTab === "following"}
          aria-controls="feed-tabpanel"
          tabIndex={activeTab === "following" ? 0 : -1}
          $active={activeTab === "following"}
          className="sort-menu-container"
          onClick={() => {
            if (activeTab === "following") {
              setShowSortMenu(!showSortMenu);
            } else {
              setActiveTab("following");
            }
          }}
          onKeyDown={(e) => handleKeyDownTab(e, "following")}
        >
          <TabText $active={activeTab === "following"}>
            Following
            {activeTab === "following" && (
              <div style={{ position: "relative" }}>
                <span style={{ marginLeft: "4px", padding: "2px", display: "inline-flex", alignItems: "center" }}>
                  <ChevronDownIcon size={16} />
                </span>
                {showSortMenu && (
                  <SortMenu role="menu" aria-label="Sort following feed">
                    <div className="menu-header">Sort by</div>
                    <button
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFollowingSort("popular");
                        setShowSortMenu(false);
                      }}
                    >
                      Popular {followingSort === "popular" && <CheckIcon size={16} fill="var(--color-accent-cyan)" />}
                    </button>
                    <button
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFollowingSort("recent");
                        setShowSortMenu(false);
                      }}
                    >
                      Recent {followingSort === "recent" && <CheckIcon size={16} fill="var(--color-accent-cyan)" />}
                    </button>
                  </SortMenu>
                )}
              </div>
            )}
          </TabText>
        </Tab>
        <Tab
          id="feed-tab-federated"
          role="tab"
          aria-selected={activeTab === "federated"}
          aria-controls="feed-tabpanel"
          tabIndex={activeTab === "federated" ? 0 : -1}
          $active={activeTab === "federated"}
          onClick={() => setActiveTab("federated")}
          onKeyDown={(e) => handleKeyDownTab(e, "federated")}
        >
          <TabText $active={activeTab === "federated"} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <GlobeIcon size={16} />
            <span>Federated</span>
          </TabText>
        </Tab>
      </TabBar>

      {/* Engineering Filter Chips & Hashtag Streamlined Bar */}
      <FilterSection>
        <FilterChipsScroll role="toolbar" aria-label="Engineering Artifact Filters & Topics">
          {FILTER_CHIPS.map((chip) => {
            const isActive = activeFilter === chip.id;
            const IconComponent = chip.icon;
            return (
              <FilterChipButton
                key={chip.id}
                $active={isActive}
                onClick={() => {
                  if (isActive && chip.id !== "all") {
                    setActiveFilter("all");
                  } else {
                    setActiveFilter(chip.id);
                  }
                }}
                title={chip.description}
                aria-pressed={isActive}
              >
                <span className="chip-icon">
                  <IconComponent size={13} />
                </span>
                <span>{chip.label}</span>
              </FilterChipButton>
            );
          })}

          <div
            style={{
              height: "18px",
              width: "1px",
              background: "var(--color-border-default)",
              margin: "0 4px",
              flexShrink: 0,
            }}
          />

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--color-text-muted)",
              whiteSpace: "nowrap",
              flexShrink: 0,
              paddingRight: "2px",
            }}
          >
            <TagIcon size={12} /> Topics:
          </span>

          {trendingTopics.map((item) => {
            const isSelected = activeTag === item.concept || activeTag === item.displayName;
            return (
              <HashtagPill
                key={item.concept}
                $active={isSelected}
                onClick={() => {
                  if (isSelected) {
                    setActiveTag(null);
                  } else {
                    setActiveTag(item.concept);
                  }
                }}
                title={`Filter by #${item.displayName}`}
                aria-pressed={isSelected}
              >
                <span>#{item.displayName}</span>
                {typeof item.postCount === "number" && item.postCount > 0 && (
                  <span className="post-count">{item.postCount}</span>
                )}
              </HashtagPill>
            );
          })}
        </FilterChipsScroll>
      </FilterSection>

      {/* Active Filter Notification Ribbon */}
      {isFiltering && (
        <ActiveFilterBanner>
          <div className="filter-summary">
            <FilterIcon size={13} />
            <span>Filtering feed:</span>
            {activeFilter !== "all" &&
              (() => {
                const matched = FILTER_CHIPS.find((c) => c.id === activeFilter);
                const MatchedIcon = matched?.icon;
                return (
                  <span className="filter-pill">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      {MatchedIcon && <MatchedIcon size={12} />}
                      {matched?.label}
                    </span>
                    <button type="button" onClick={() => setActiveFilter("all")} aria-label="Remove artifact filter">
                      <XIcon size={12} />
                    </button>
                  </span>
                );
              })()}
            {activeTag && (
              <span className="filter-pill">
                <span>#{trendingTopics.find((t) => t.concept === activeTag)?.displayName || activeTag}</span>
                <button type="button" onClick={() => setActiveTag(null)} aria-label="Remove hashtag filter">
                  <XIcon size={12} />
                </button>
              </span>
            )}
            <span className="result-count">
              ({posts.length} {posts.length === 1 ? "result" : "results"})
            </span>
          </div>
          <div className="filter-actions">
            {activeTag && (
              <button
                type="button"
                className="topic-hub-link"
                onClick={() => navigate(`/explore?topic=${encodeURIComponent(activeTag)}`)}
              >
                Topic Hub ↗
              </button>
            )}
            <button
              type="button"
              className="clear-all-btn"
              onClick={() => {
                setActiveFilter("all");
                setActiveTag(null);
              }}
            >
              Reset filters
            </button>
          </div>
        </ActiveFilterBanner>
      )}

      {user && (
        <ComposePrompt>
          <ComposeBox onPostCreated={(post) => setPosts([post, ...posts])} />
        </ComposePrompt>
      )}

      <div id="feed-tabpanel" role="tabpanel" aria-labelledby={`feed-tab-${activeTab}`}>
        {loading ? (
          <Box>
            <PostSkeleton />
            <PostSkeleton hasArtifact />
            <PostSkeleton />
          </Box>
        ) : (
          <Box ref={listRef}>
            {posts.length > 0 && (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: `${rowVirtualizer.getTotalSize()}px`,
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                  const post = posts[virtualItem.index];
                  return (
                    <div
                      key={post.id || virtualItem.key}
                      data-index={virtualItem.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualItem.start - (rowVirtualizer.options.scrollMargin ?? 0)}px)`,
                      }}
                    >
                      <Post post={post} />
                    </div>
                  );
                })}
              </div>
            )}
            {posts.length > 0 && hasMore && (
              <Box p={3} display="flex" justifyContent="center">
                <SecondaryActionButton onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? <Spinner size="small" /> : "Load more posts"}
                </SecondaryActionButton>
              </Box>
            )}
            {posts.length === 0 && (
              <EmptyStateContainer>
                <EmptyStateIconOrb>
                  {isFiltering ? <FilterIcon size={28} /> : <RocketIcon size={28} />}
                </EmptyStateIconOrb>
                <EmptyStateTitle>
                  {isFiltering ? "No Matching Engineering Posts" : "Engineering Timeline Ready"}
                </EmptyStateTitle>
                <EmptyStateSubtitle>
                  {isFiltering ? (
                    <>
                      No posts found matching{" "}
                      {activeFilter !== "all" && (
                        <strong>{FILTER_CHIPS.find((c) => c.id === activeFilter)?.label}</strong>
                      )}
                      {activeFilter !== "all" && activeTag && " and "}
                      {activeTag && <strong>#{activeTag}</strong>}. Try adjusting your filters or share the first
                      artifact!
                    </>
                  ) : (
                    "Follow physical modeling engineers, explore Modelica & SysML packages, or publish your first simulation artifact."
                  )}
                </EmptyStateSubtitle>
                {!isFiltering && (
                  <QuickstartContainer>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <RocketIcon size={20} fill="var(--color-accent-emphasis, #8b5cf6)" />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--color-text-heading)" }}>
                          Quickstart Cyber-Physical Studio
                        </div>
                        <div style={{ fontSize: "12.5px", color: "var(--color-text-muted)" }}>
                          Instant 1-click in-browser simulations to test Modelica DAE execution.
                        </div>
                      </div>
                    </div>
                    <HeroGrid>
                      <HeroCard onClick={() => navigate("/playground?model=bouncing-ball")}>
                        <div style={{ fontSize: "24px" }}>⚽</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-heading)" }}>
                            Bouncing Ball
                          </div>
                          <div
                            style={{
                              fontSize: "11px",
                              color: "var(--color-text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Hybrid physics & impact events
                          </div>
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--color-accent-cyan)", fontWeight: 600 }}>
                          Run ↗
                        </div>
                      </HeroCard>
                      <HeroCard onClick={() => navigate("/playground?model=rlc-filter")}>
                        <div style={{ fontSize: "24px" }}>⚡</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-heading)" }}>
                            RLC Filter
                          </div>
                          <div
                            style={{
                              fontSize: "11px",
                              color: "var(--color-text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Resonant analog electronics
                          </div>
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--color-accent-cyan)", fontWeight: 600 }}>
                          Run ↗
                        </div>
                      </HeroCard>
                      <HeroCard onClick={() => navigate("/playground?model=chua-circuit")}>
                        <div style={{ fontSize: "24px" }}>🌀</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-heading)" }}>
                            Chua Circuit
                          </div>
                          <div
                            style={{
                              fontSize: "11px",
                              color: "var(--color-text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Nonlinear chaotic attractor
                          </div>
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--color-accent-cyan)", fontWeight: 600 }}>
                          Run ↗
                        </div>
                      </HeroCard>
                      <HeroCard onClick={() => navigate("/playground?model=sysml2-powertrain")}>
                        <div style={{ fontSize: "24px" }}>🔋</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text-heading)" }}>
                            EV Powertrain
                          </div>
                          <div
                            style={{
                              fontSize: "11px",
                              color: "var(--color-text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            SysML v2 multi-domain architecture
                          </div>
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--color-accent-cyan)", fontWeight: 600 }}>
                          Run ↗
                        </div>
                      </HeroCard>
                    </HeroGrid>

                    <DisciplineFollowsSection>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text-heading)" }}>
                            Engineering Disciplines & Suggested Follows
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                            Follow domain specialists and packages across key cyber-physical engineering sectors.
                          </div>
                        </div>
                      </div>

                      <DisciplineTabsRow>
                        {DISCIPLINES.map((d) => (
                          <DisciplineTabButton
                            key={d.id}
                            $active={selectedDiscipline === d.id}
                            onClick={() => setSelectedDiscipline(d.id)}
                          >
                            <span>{d.emoji}</span>
                            <span>{d.name}</span>
                          </DisciplineTabButton>
                        ))}
                      </DisciplineTabsRow>

                      <SuggestedFollowsGrid>
                        {(DISCIPLINES.find((d) => d.id === selectedDiscipline)?.items || []).map((item) => (
                          <SuggestedFollowCard key={item.id}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  width: "36px",
                                  height: "36px",
                                  borderRadius: "8px",
                                  background: "var(--color-canvas-subtle, rgba(255, 255, 255, 0.05))",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: "18px",
                                  border: "1px solid var(--color-border-muted)",
                                  flexShrink: 0,
                                }}
                              >
                                {item.avatar}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      fontSize: "13px",
                                      color: "var(--color-text-heading)",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {item.name}
                                  </span>
                                  {item.isPackage && (
                                    <span
                                      style={{
                                        fontSize: "10px",
                                        padding: "1px 5px",
                                        borderRadius: "4px",
                                        background: "rgba(139, 92, 246, 0.15)",
                                        color: "var(--color-accent-emphasis, #8b5cf6)",
                                        fontWeight: 600,
                                      }}
                                    >
                                      PKG
                                    </span>
                                  )}
                                </div>
                                <div
                                  style={{
                                    fontSize: "11px",
                                    color: "var(--color-text-muted)",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  @{item.handle} • {item.description}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                              <button
                                onClick={() => handleToggleFollow(item.handle)}
                                style={{
                                  padding: "5px 12px",
                                  borderRadius: "16px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  transition: "all 0.2s ease",
                                  background: followedHandles[item.handle]
                                    ? "var(--color-canvas-subtle, rgba(255, 255, 255, 0.08))"
                                    : "var(--color-accent-emphasis, #8b5cf6)",
                                  color: followedHandles[item.handle]
                                    ? "var(--color-text-primary, #ffffff)"
                                    : "#ffffff",
                                  border: followedHandles[item.handle]
                                    ? "1px solid var(--color-border-default, rgba(255, 255, 255, 0.2))"
                                    : "none",
                                }}
                              >
                                {followedHandles[item.handle] ? (
                                  <>
                                    <CheckIcon size={12} />
                                    <span>Following</span>
                                  </>
                                ) : (
                                  <>
                                    <PlusIcon size={12} />
                                    <span>Follow</span>
                                  </>
                                )}
                              </button>
                              <button
                                onClick={() => navigate(item.exploreUrl)}
                                style={{
                                  padding: "5px 8px",
                                  borderRadius: "8px",
                                  fontSize: "12px",
                                  background: "none",
                                  border: "1px solid var(--color-border-muted, rgba(255, 255, 255, 0.12))",
                                  color: "var(--color-text-muted)",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                                title="Explore library"
                              >
                                ↗
                              </button>
                            </div>
                          </SuggestedFollowCard>
                        ))}
                      </SuggestedFollowsGrid>
                    </DisciplineFollowsSection>
                  </QuickstartContainer>
                )}
                <EmptyStateActions>
                  {isFiltering ? (
                    <>
                      <PrimaryActionButton
                        onClick={() => {
                          setActiveFilter("all");
                          setActiveTag(null);
                        }}
                      >
                        <XIcon size={16} />
                        <span>Clear All Filters</span>
                      </PrimaryActionButton>
                      {openCompose && (
                        <SecondaryActionButton
                          onClick={() =>
                            openCompose({
                              defaultText: activeTag ? `#${activeTag} ` : "",
                            })
                          }
                        >
                          <PlusIcon size={16} />
                          <span>Post with #{activeTag || "Modelica"}</span>
                        </SecondaryActionButton>
                      )}
                    </>
                  ) : (
                    <>
                      <PrimaryActionButton onClick={() => navigate("/explore")}>
                        <SearchIcon size={16} />
                        <span>Explore Models</span>
                      </PrimaryActionButton>
                      {openCompose && (
                        <SecondaryActionButton onClick={() => openCompose()}>
                          <PlusIcon size={16} />
                          <span>Create First Post</span>
                        </SecondaryActionButton>
                      )}
                    </>
                  )}
                </EmptyStateActions>
              </EmptyStateContainer>
            )}
          </Box>
        )}
      </div>
    </Box>
  );
};

export default HomeFeedPage;
