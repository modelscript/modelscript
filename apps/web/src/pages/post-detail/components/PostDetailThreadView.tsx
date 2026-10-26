// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import ComposeBox from "../../../components/ComposeBox";
import Post from "../../../components/Post";
import type { PostItem } from "../../../types/api";
import { ReplyInputContainer } from "../styles";
import type { ActiveBotTypingState } from "../types";
import BotTypingBubble from "./BotTypingBubble";

export interface PostDetailThreadViewProps {
  post: PostItem;
  parents: PostItem[];
  replies: PostItem[];
  user: any;
  mainPostRef: React.RefObject<HTMLDivElement | null>;
  activeBotTyping: ActiveBotTypingState | null;
  onReplyCreated: (reply: PostItem) => void;
}

export const PostDetailThreadView: React.FC<PostDetailThreadViewProps> = ({
  post,
  parents,
  replies,
  user,
  mainPostRef,
  activeBotTyping,
  onReplyCreated,
}) => {
  return (
    <>
      {parents.map((parent) => (
        <Post key={parent.id} post={parent} isThread={true} />
      ))}

      <div ref={mainPostRef}>
        <Post post={post} isDetail={true} />
      </div>

      {user && (
        <ReplyInputContainer>
          <ComposeBox replyToPost={post} onPostCreated={onReplyCreated} />
        </ReplyInputContainer>
      )}

      {replies.length > 0 ? (
        <Box>
          {replies.map((reply) => (
            <Post key={reply.id} post={reply} />
          ))}
          {activeBotTyping && (
            <BotTypingBubble botUsername={activeBotTyping.botUsername} status={activeBotTyping.status} />
          )}
        </Box>
      ) : activeBotTyping ? (
        <BotTypingBubble botUsername={activeBotTyping.botUsername} status={activeBotTyping.status} />
      ) : (
        <Box p={4} textAlign="center">
          <Text color="var(--color-fg-muted)">No replies yet.</Text>
        </Box>
      )}
    </>
  );
};

export default PostDetailThreadView;
