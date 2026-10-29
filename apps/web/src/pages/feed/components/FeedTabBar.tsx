// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, ChevronDownIcon, GlobeIcon } from "@primer/octicons-react";
import React from "react";
import { SortMenu, Tab, TabBar, TabText } from "../styles";

export interface FeedTabBarProps {
  activeTab: "forYou" | "following" | "federated";
  setActiveTab: (tab: "forYou" | "following" | "federated") => void;
  followingSort: "popular" | "recent";
  setFollowingSort: (sort: "popular" | "recent") => void;
  showSortMenu: boolean;
  setShowSortMenu: (show: boolean) => void;
}

export const FeedTabBar: React.FC<FeedTabBarProps> = ({
  activeTab,
  setActiveTab,
  followingSort,
  setFollowingSort,
  showSortMenu,
  setShowSortMenu,
}) => {
  const [isScrolled, setIsScrolled] = React.useState(() => typeof window !== "undefined" && window.scrollY > 4);

  React.useEffect(() => {
    const onScroll = () => {
      const next = window.scrollY > 4;
      setIsScrolled((prev) => (prev === next ? prev : next));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleKeyDownTab = (e: React.KeyboardEvent, currentTab: "forYou" | "following" | "federated") => {
    const tabs: ("forYou" | "following" | "federated")[] = ["forYou", "following", "federated"];
    const idx = tabs.indexOf(currentTab);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextTab = tabs[(idx + 1) % tabs.length]!;
      setActiveTab(nextTab);
      document.getElementById(`feed-tab-${nextTab}`)?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevTab = tabs[(idx - 1 + tabs.length) % tabs.length]!;
      setActiveTab(prevTab);
      document.getElementById(`feed-tab-${prevTab}`)?.focus();
    }
  };

  return (
    <TabBar role="tablist" aria-label="Feed sections" $scrolled={isScrolled}>
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
      <div className="sort-menu-container" style={{ position: "relative", flex: 1, display: "flex" }}>
        <Tab
          id="feed-tab-following"
          role="tab"
          aria-selected={activeTab === "following"}
          aria-controls="feed-tabpanel"
          tabIndex={activeTab === "following" ? 0 : -1}
          $active={activeTab === "following"}
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
              <span style={{ marginLeft: "4px", padding: "2px", display: "inline-flex", alignItems: "center" }}>
                <ChevronDownIcon size={16} />
              </span>
            )}
          </TabText>
        </Tab>
        {activeTab === "following" && showSortMenu && (
          <SortMenu role="menu" aria-label="Sort following feed">
            <div className="menu-header">Sort by</div>
            <button
              type="button"
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
              type="button"
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
  );
};

export default FeedTabBar;
