/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { PlusIcon, RssIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { CircleIconButton, StickyHeader } from "../components/SharedStyles";
import { API_BASE_URL } from "../config";

const FeedItemWrapper = styled.div`
  display: flex;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }
`;

const Avatar = styled.div<{ $url?: string }>`
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background-color: var(--color-done-emphasis);
  background-image: ${(props) => (props.$url ? `url(${props.$url})` : "none")};
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 20px;
  flex-shrink: 0;
  margin-right: 16px;
`;

const InputSection = styled.form`
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--color-border);
  height: 56px;
  padding: 0 16px;
`;

const FeedInput = styled.input`
  flex: 1;
  height: 100%;
  border: none;
  background: transparent;
  font-size: 16px;
  color: var(--color-fg-default);
  outline: none;

  &::placeholder {
    color: var(--color-fg-muted);
    opacity: 0.5;
  }
`;

const SpinAnimation = styled.div`
  @keyframes spin {
    100% {
      transform: rotate(360deg);
    }
  }
  animation: spin 1s linear infinite;
  display: flex;
`;

const TrashIconButton = styled(CircleIconButton)`
  color: var(--color-fg-muted);
  &:hover:not(:disabled) {
    color: var(--color-danger-fg);
    background-color: var(--color-danger-subtle);
  }
`;

const MutedUrl = styled.a`
  display: block;
  font-size: 13px;
  color: var(--color-fg-muted);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    text-decoration: underline;
  }
`;

function formatRssHandle(urlStr: string) {
  try {
    const u = new URL(urlStr);
    let handle = `@${u.host}${u.pathname}`;
    handle = handle.replace(/\/$/, "");

    if (u.search || u.hash) {
      let hash = 0;
      for (let i = 0; i < urlStr.length; i++) {
        hash = (hash << 5) - hash + urlStr.charCodeAt(i);
        hash |= 0;
      }
      handle += `#${Math.abs(hash).toString(16).substring(0, 4)}`;
    }
    return handle;
  } catch {
    return `@unknown`;
  }
}

const FeedsPage: React.FC = () => {
  const { token } = useAuth();
  const [feeds, setFeeds] = useState<any[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFeeds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchFeeds = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/social/feeds`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFeeds(data.feeds);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/social/feeds/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: urlInput.trim() }),
      });

      let data;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || `HTTP Error ${res.status}` };
      }

      if (!res.ok) {
        setError(data.error || "Failed to subscribe to feed");
      } else {
        setUrlInput("");
        fetchFeeds();
      }
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnsubscribe = async (feedId: number) => {
    if (!window.confirm("Are you sure you want to unsubscribe from this feed?")) return;

    try {
      const res = await fetch(`${API_BASE_URL}/social/feeds/${feedId}/unsubscribe`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setFeeds(feeds.filter((f) => f.id !== feedId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <Box>
      <StickyHeader style={{ justifyContent: "space-between" }}>
        <Heading as="h2" style={{ fontSize: "20px", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
          <RssIcon size={24} />
          RSS Feeds
        </Heading>
        <Text color="var(--color-fg-muted)" fontSize="14px">
          {feeds.length} / 10
        </Text>
      </StickyHeader>

      <InputSection onSubmit={handleSubscribe}>
        <FeedInput
          type="text"
          placeholder="Enter an RSS feed URL, YouTube handle, or channel ID"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={isLoading}
          required
        />
        <CircleIconButton type="submit" disabled={isLoading || feeds.length >= 10}>
          {isLoading ? (
            <SpinAnimation>
              <SyncIcon size={16} />
            </SpinAnimation>
          ) : (
            <PlusIcon size={16} />
          )}
        </CircleIconButton>
      </InputSection>

      <Box px={3}>
        {error && (
          <Text color="var(--color-danger-fg)" style={{ marginTop: "12px", display: "block" }}>
            {error}
          </Text>
        )}
      </Box>

      {feeds.length === 0 ? (
        <Box p={5} display="flex" justifyContent="center">
          <Text color="var(--color-fg-muted)">You are not subscribed to any feeds.</Text>
        </Box>
      ) : (
        <Box display="flex" flexDirection="column">
          {feeds.map((feed) => (
            <FeedItemWrapper key={feed.id}>
              <Avatar $url={feed.avatar_url}>{!feed.avatar_url && (feed.title || "R").charAt(0).toUpperCase()}</Avatar>
              <Box
                flex={1}
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                }}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  <Link to={`/${feed.username}`} style={{ color: "var(--color-fg-default)", textDecoration: "none" }}>
                    <Text style={{ fontWeight: "bold", fontSize: "15px" }}>{feed.display_name}</Text>
                  </Link>
                  <Text color="var(--color-fg-muted)" fontSize="15px">
                    {formatRssHandle(feed.url)}
                  </Text>
                </Box>
                <MutedUrl href={feed.url} target="_blank" rel="noreferrer" title={feed.url}>
                  {feed.url}
                </MutedUrl>
              </Box>
              <TrashIconButton onClick={() => handleUnsubscribe(feed.id)} title="Unsubscribe">
                <TrashIcon size={16} />
              </TrashIconButton>
            </FeedItemWrapper>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default FeedsPage;
