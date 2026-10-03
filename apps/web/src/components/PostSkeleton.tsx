// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import styled from "styled-components";

const SkeletonWrapper = styled.div`
  display: flex;
  flex-direction: row;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  box-sizing: border-box;
`;

const AvatarPlaceholder = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
`;

const ContentColumn = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 10px;
  min-width: 0;
`;

const MetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ShimmerLine = styled.div<{ $width: string; $height?: string }>`
  width: ${(props) => props.$width};
  height: ${(props) => props.$height || "13px"};
  border-radius: var(--radius-sm);
`;

const ArtifactBoxPlaceholder = styled.div`
  width: 100%;
  height: 120px;
  border-radius: var(--radius-md);
  margin-top: 4px;
`;

const ActionsRow = styled.div`
  display: flex;
  justify-content: space-between;
  max-width: 400px;
  padding-top: 4px;
`;

const ActionPlaceholder = styled.div`
  width: 24px;
  height: 14px;
  border-radius: var(--radius-sm);
`;

export interface PostSkeletonProps {
  hasArtifact?: boolean;
}

export const PostSkeleton: React.FC<PostSkeletonProps> = ({ hasArtifact = false }) => {
  return (
    <SkeletonWrapper aria-hidden="true">
      <AvatarPlaceholder className="skeleton" />
      <ContentColumn>
        <MetaRow>
          <ShimmerLine className="skeleton" $width="120px" $height="14px" />
          <ShimmerLine className="skeleton" $width="80px" $height="12px" />
          <ShimmerLine className="skeleton" $width="40px" $height="12px" />
        </MetaRow>
        <ShimmerLine className="skeleton" $width="92%" />
        <ShimmerLine className="skeleton" $width="78%" />
        {hasArtifact && <ArtifactBoxPlaceholder className="skeleton" />}
        <ActionsRow>
          <ActionPlaceholder className="skeleton" />
          <ActionPlaceholder className="skeleton" />
          <ActionPlaceholder className="skeleton" />
          <ActionPlaceholder className="skeleton" />
        </ActionsRow>
      </ContentColumn>
    </SkeletonWrapper>
  );
};

export default PostSkeleton;
