// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { Suspense } from "react";

const HpcArtifactPickerModal = React.lazy(() => import("../HpcArtifactPickerModal"));
const MorselComposeModal = React.lazy(() => import("../MorselComposeModal"));
const PackageRepoPickerModal = React.lazy(() => import("../PackageRepoPickerModal"));

export interface ComposeLazyModalsProps {
  showHpcPicker: boolean;
  onCloseHpcPicker: () => void;
  showMorselModal: boolean;
  onCloseMorselModal: () => void;
  showPackageRepoPicker: boolean;
  onClosePackageRepoPicker: () => void;
  onAttachArtifact: (artifactId: number, title?: string) => void;
}

export const ComposeLazyModals: React.FC<ComposeLazyModalsProps> = ({
  showHpcPicker,
  onCloseHpcPicker,
  showMorselModal,
  onCloseMorselModal,
  showPackageRepoPicker,
  onClosePackageRepoPicker,
  onAttachArtifact,
}) => {
  return (
    <Suspense fallback={null}>
      {showHpcPicker && (
        <HpcArtifactPickerModal
          onClose={onCloseHpcPicker}
          onSelect={(art: any) => {
            onAttachArtifact(art.id, art.title);
            onCloseHpcPicker();
          }}
        />
      )}

      {showMorselModal && (
        <MorselComposeModal
          onClose={onCloseMorselModal}
          onAttach={(art: any) => {
            onAttachArtifact(art.id, art.title);
            onCloseMorselModal();
          }}
        />
      )}

      {showPackageRepoPicker && (
        <PackageRepoPickerModal
          onClose={onClosePackageRepoPicker}
          onSelect={(art: any) => {
            onAttachArtifact(art.id, art.title);
            onClosePackageRepoPicker();
          }}
        />
      )}
    </Suspense>
  );
};
