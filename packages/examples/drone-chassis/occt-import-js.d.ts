// SPDX-License-Identifier: AGPL-3.0-or-later
declare module "occt-import-js" {
  export interface OcctMesh {
    attributes: {
      position: {
        array: number[] | Float32Array;
      };
    };
    index: {
      array: number[] | Uint32Array | Uint16Array;
    };
  }

  export interface OcctResult {
    meshes?: OcctMesh[];
  }

  export interface OcctInstance {
    ReadStepFile(buffer: Uint8Array, params: unknown): OcctResult;
  }

  export default function initOcct(): Promise<OcctInstance>;
}
