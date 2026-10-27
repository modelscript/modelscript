// SPDX-License-Identifier: AGPL-3.0-or-later

declare module "occt-import-js" {
  interface OcctMesh {
    name?: string;
    color?: [number, number, number];
    attributes?: {
      position?: { array: ArrayLike<number> };
      normal?: { array: ArrayLike<number> };
    };
    index?: { array: ArrayLike<number> };
  }

  interface OcctResult {
    success?: boolean;
    meshes: OcctMesh[];
  }

  interface OcctInstance {
    ReadStepFile(content: Uint8Array, params: null): OcctResult;
    ReadIgesFile(content: Uint8Array, params: null): OcctResult;
    ReadBrepFile(content: Uint8Array, params: null): OcctResult;
  }

  export default function occtimportjs(): Promise<OcctInstance>;
}
