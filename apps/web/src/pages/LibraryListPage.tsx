// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, PlusIcon, SearchIcon, SyncIcon } from "@primer/octicons-react";
import { Button, Heading, Label, Text } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { LibraryListItem, PendingPackageTransfer } from "../api";
import { acceptPackageTransfer, cancelPackageTransfer, getLibraries, getPendingPackageTransfers } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import PublishPackageModal from "../components/PublishPackageModal";
import { filterAndSortLibraries, type SortOption } from "../util/package-helpers";
import { usePageTitle } from "../util/title";
import { CardList, LibraryFilterBar, PackageCardItem, PendingTransfersBanner, Tab, TabBar } from "./libraries";

const LibraryListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [libraries, setLibraries] = useState<LibraryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = searchParams.get("q") || "";
  const [searchInput, setSearchInput] = useState(query);
  const [activeTab, setActiveTab] = useState<"all" | "my">("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("downloads");
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [copiedPkg, setCopiedPkg] = useState<string | null>(null);

  // Pending ownership transfers state
  const [pendingTransfers, setPendingTransfers] = useState<PendingPackageTransfer[]>([]);
  const [transferBusyId, setTransferBusyId] = useState<number | null>(null);
  const [transferFeedback, setTransferFeedback] = useState<{ type: "success" | "danger"; message: string } | null>(
    null,
  );

  usePageTitle("Packages");

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchInput.trim() !== query) {
        if (searchInput.trim()) {
          setSearchParams({ q: searchInput.trim() });
        } else {
          setSearchParams({});
        }
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [searchInput, query, setSearchParams]);

  const fetchLibraries = useCallback(async () => {
    const libs = await getLibraries(query);
    setLibraries(libs);
    return libs;
  }, [query]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const libs = await fetchLibraries();

        // If any library is processing, poll again after 2 seconds
        const isProcessing = libs.some(
          (lib) => lib.jobStatus?.status === "pending" || lib.jobStatus?.status === "processing",
        );
        if (isProcessing) {
          timeoutId = setTimeout(load, 2000);
        }
      } catch (err) {
        setError("Failed to load libraries");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    setLoading(true);
    const initialDelay = setTimeout(load, 300);

    return () => {
      clearTimeout(initialDelay);
      clearTimeout(timeoutId);
    };
  }, [fetchLibraries]);

  const fetchPendingTransfers = useCallback(async () => {
    if (!user) {
      setPendingTransfers([]);
      return;
    }
    try {
      const transfers = await getPendingPackageTransfers();
      setPendingTransfers(transfers);
    } catch {
      // Ignore unauthenticated or transient errors
    }
  }, [user]);

  useEffect(() => {
    fetchPendingTransfers();
  }, [fetchPendingTransfers]);

  const handleAcceptTransfer = async (transfer: PendingPackageTransfer) => {
    setTransferBusyId(transfer.id);
    setTransferFeedback(null);
    try {
      await acceptPackageTransfer(transfer.package_name, transfer.id);
      setTransferFeedback({
        type: "success",
        message: `You are now the owner of ${transfer.package_name}.`,
      });
      await Promise.all([fetchPendingTransfers(), fetchLibraries()]);
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setTransferFeedback({
        type: "danger",
        message: e.response?.data?.error || e.message || "Failed to accept ownership transfer.",
      });
    } finally {
      setTransferBusyId(null);
    }
  };

  const handleCancelTransfer = async (transfer: PendingPackageTransfer) => {
    setTransferBusyId(transfer.id);
    setTransferFeedback(null);
    try {
      await cancelPackageTransfer(transfer.package_name, transfer.id);
      setTransferFeedback({
        type: "success",
        message: `Ownership transfer for ${transfer.package_name} has been cancelled.`,
      });
      await fetchPendingTransfers();
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setTransferFeedback({
        type: "danger",
        message: e.response?.data?.error || e.message || "Failed to cancel ownership transfer.",
      });
    } finally {
      setTransferBusyId(null);
    }
  };

  const displayedLibraries = useMemo(
    () =>
      filterAndSortLibraries(libraries, {
        activeTab,
        username: user?.username,
        domainFilter,
        sortBy,
      }),
    [libraries, activeTab, user?.username, domainFilter, sortBy],
  );

  const handleCopyInstall = (pkgName: string) => {
    navigator.clipboard.writeText(`msx install ${pkgName}`);
    setCopiedPkg(pkgName);
    setTimeout(() => setCopiedPkg(null), 2000);
  };

  return (
    <Box>
      <TabBar>
        <Tab $active={activeTab === "all"} onClick={() => setActiveTab("all")}>
          All Packages
        </Tab>
        {user && (
          <Tab $active={activeTab === "my"} onClick={() => setActiveTab("my")}>
            My Packages
            {pendingTransfers.length > 0 && (
              <Label variant="attention" style={{ marginLeft: 8, fontSize: 11 }}>
                {pendingTransfers.length}
              </Label>
            )}
          </Tab>
        )}
      </TabBar>

      <Box p={4}>
        <PendingTransfersBanner
          pendingTransfers={pendingTransfers}
          transferBusyId={transferBusyId}
          transferFeedback={transferFeedback}
          onDismissFeedback={() => setTransferFeedback(null)}
          onAcceptTransfer={handleAcceptTransfer}
          onCancelTransfer={handleCancelTransfer}
          currentUserId={user?.id}
          currentUsername={user?.username}
        />

        <LibraryFilterBar
          displayedCount={displayedLibraries.length}
          loading={loading}
          onOpenPublishModal={() => {
            if (!user) {
              navigate("/login");
            } else {
              setPublishModalOpen(true);
            }
          }}
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          onClearSearch={() => {
            setSearchInput("");
            setSearchParams({});
          }}
          sortBy={sortBy}
          onSortChange={setSortBy}
          domainFilter={domainFilter}
          onDomainFilterChange={setDomainFilter}
        />

        {/* Content */}
        {loading && libraries.length === 0 ? (
          <Box display="flex" justifyContent="center" p={12}>
            <SyncIcon size={32} className="spinner-spin" fill="var(--color-text-muted)" />
          </Box>
        ) : error ? (
          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 60,
              textAlign: "center",
            }}
          >
            <AlertIcon size={48} fill="var(--color-error)" />
            <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 20, margin: 0 }}>
              Failed to load libraries
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              The server may be unavailable. Please try again later.
            </Text>
          </Box>
        ) : activeTab === "my" && !user ? (
          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 60,
              textAlign: "center",
            }}
          >
            <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 20, margin: 0 }}>
              Sign in to view your packages
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              Sign in to view and manage packages published under your username.
            </Text>
            <Button variant="primary" onClick={() => navigate("/login")}>
              Sign In
            </Button>
          </Box>
        ) : displayedLibraries.length === 0 ? (
          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 60,
              textAlign: "center",
            }}
          >
            <SearchIcon size={48} fill="var(--color-text-muted)" />
            <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 20, margin: 0 }}>
              No packages found
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              {activeTab === "my"
                ? "You haven't published any matching packages yet."
                : query || domainFilter !== "all"
                  ? "No results matching your filter criteria."
                  : "No libraries have been published yet."}
            </Text>
            {activeTab === "my" && user && (
              <Button variant="primary" leadingVisual={PlusIcon} onClick={() => setPublishModalOpen(true)}>
                Publish Your First Package
              </Button>
            )}
          </Box>
        ) : (
          <CardList>
            {displayedLibraries.map((lib) => (
              <PackageCardItem key={lib.name} lib={lib} copiedPkg={copiedPkg} onCopyInstall={handleCopyInstall} />
            ))}
          </CardList>
        )}
      </Box>

      <PublishPackageModal
        isOpen={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        onPublished={() => {
          fetchLibraries();
        }}
      />
    </Box>
  );
};

export default LibraryListPage;
