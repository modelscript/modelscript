// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useMemo, useState } from "react";
import { getTrending, getUserFollowers, resolveFederatedActor } from "../../api";
import type { NotebookCell } from "../../util/notebook";

export interface UseComposeAutocompleteParams {
  user: any;
  token: string | null;
  content: string;
  setContent: (val: string) => void;
  replyToPost?: any;
  isNotebookMode: boolean;
  activeCellId: string | null;
  notebookCells: NotebookCell[];
  updateMarkdownCell: (cellId: string, newText: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useComposeAutocomplete({
  user,
  token,
  content,
  setContent,
  replyToPost,
  isNotebookMode,
  activeCellId,
  notebookCells,
  updateMarkdownCell,
  textareaRef,
}: UseComposeAutocompleteParams) {
  const [followers, setFollowers] = useState<any[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ query: string; index: number } | null>(null);
  const [hashtagQuery, setHashtagQuery] = useState<{ query: string; index: number } | null>(null);
  const [trendingTopics, setTrendingTopics] = useState<any[]>([]);
  const [remoteActorSuggestions, setRemoteActorSuggestions] = useState<Map<string, any>>(new Map());

  const allMentionedUsers = useMemo(() => {
    if (!replyToPost) return [];
    const matches = (replyToPost.content?.match(/@([a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?)/g) || []).map((m: string) =>
      m.slice(1),
    );
    const unique = Array.from(new Set([replyToPost.username, ...matches])).filter((u: string) => u !== user?.username);
    return unique;
  }, [replyToPost, user?.username]);

  useEffect(() => {
    if (user?.username && token) {
      getUserFollowers(user.username)
        .then((d) => {
          if (d.followers) setFollowers(d.followers);
        })
        .catch(console.error);
    }
    getTrending(20)
      .then((d) => {
        if (d.topics) setTrendingTopics(d.topics);
      })
      .catch(console.error);
  }, [user, token]);

  useEffect(() => {
    if (!mentionQuery || !mentionQuery.query.includes("@")) return;
    const handle = mentionQuery.query;
    const parts = handle.split("@");
    if (parts.length < 2 || !parts[0] || parts[1]!.length < 2) return;

    const timer = setTimeout(() => {
      resolveFederatedActor(handle)
        .then((res) => {
          if (res?.user) {
            setRemoteActorSuggestions((prev) => new Map(prev).set(res.user.username.toLowerCase(), res.user));
          }
        })
        .catch(() => {});
    }, 350);

    return () => clearTimeout(timer);
  }, [mentionQuery]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return [];
    const matches = (content.match(/@([a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?)/g) || []).map((m: string) => m.slice(1));
    const allUsers = new Map<string, any>();

    followers.forEach((f) => allUsers.set(f.username.toLowerCase(), f));
    allMentionedUsers.forEach((u: string) => {
      if (!allUsers.has(u.toLowerCase())) allUsers.set(u.toLowerCase(), { username: u });
    });
    matches.forEach((u: string) => {
      if (!allUsers.has(u.toLowerCase())) allUsers.set(u.toLowerCase(), { username: u });
    });
    remoteActorSuggestions.forEach((u, k) => {
      allUsers.set(k, u);
    });

    const q = mentionQuery.query.toLowerCase();
    return Array.from(allUsers.values())
      .filter((u) => u.username.toLowerCase().includes(q) || u.display_name?.toLowerCase().includes(q))
      .slice(0, 15);
  }, [mentionQuery, followers, allMentionedUsers, content, remoteActorSuggestions]);

  const hashtagSuggestions = useMemo(() => {
    if (!hashtagQuery) return [];
    const q = hashtagQuery.query.toLowerCase();
    return trendingTopics
      .filter((t) => (t.display_name || t.displayName || t.concept || "").toLowerCase().includes(q))
      .slice(0, 10);
  }, [hashtagQuery, trendingTopics]);

  const updateTokenState = (val: string, cursor: number) => {
    const textBeforeCursor = val.slice(0, cursor);
    const mentionMatch = textBeforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]*)?)$/);
    if (mentionMatch) {
      const atIndex = textBeforeCursor.lastIndexOf("@");
      setMentionQuery({ query: mentionMatch[1]!, index: atIndex });
      setHashtagQuery(null);
      return;
    } else {
      setMentionQuery(null);
    }

    const hashMatch = textBeforeCursor.match(/(?:^|\s)#([a-zA-Z0-9_-]*)$/);
    if (hashMatch) {
      const hashIndex = textBeforeCursor.lastIndexOf("#");
      setHashtagQuery({ query: hashMatch[1]!, index: hashIndex });
    } else {
      setHashtagQuery(null);
    }
  };

  const insertMention = (username: string) => {
    if (!mentionQuery) return;
    if (isNotebookMode && activeCellId) {
      const targetCell = notebookCells.find((c) => c.id === activeCellId);
      if (targetCell && targetCell.type === "markdown") {
        const before = targetCell.content.slice(0, mentionQuery.index);
        const after = targetCell.content.slice(mentionQuery.index + mentionQuery.query.length + 1);
        updateMarkdownCell(activeCellId, `${before}@${username} ${after}`);
        setMentionQuery(null);
        return;
      }
    }
    const before = content.slice(0, mentionQuery.index);
    const after = content.slice(textareaRef.current?.selectionStart || content.length);
    const newContent = `${before}@${username} ${after}`;
    setContent(newContent);
    setMentionQuery(null);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursor = before.length + username.length + 2;
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 0);
  };

  const insertHashtag = (tag: string) => {
    if (!hashtagQuery) return;
    if (isNotebookMode && activeCellId) {
      const targetCell = notebookCells.find((c) => c.id === activeCellId);
      if (targetCell && targetCell.type === "markdown") {
        const before = targetCell.content.slice(0, hashtagQuery.index);
        const after = targetCell.content.slice(hashtagQuery.index + hashtagQuery.query.length + 1);
        updateMarkdownCell(activeCellId, `${before}#${tag} ${after}`);
        setHashtagQuery(null);
        return;
      }
    }
    const before = content.slice(0, hashtagQuery.index);
    const after = content.slice(textareaRef.current?.selectionStart || content.length);
    const newContent = `${before}#${tag} ${after}`;
    setContent(newContent);
    setHashtagQuery(null);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursor = before.length + tag.length + 2;
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 0);
  };

  return {
    mentionQuery,
    setMentionQuery,
    hashtagQuery,
    setHashtagQuery,
    allMentionedUsers,
    mentionSuggestions,
    hashtagSuggestions,
    updateTokenState,
    insertMention,
    insertHashtag,
  };
}
