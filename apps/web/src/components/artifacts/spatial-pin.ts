// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SpatialPin {
  worldPosition: [number, number, number];
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  fieldName: string;
  scalarValue: number;
}

export interface SpatialPin2D {
  coord: [number, number]; // normalized coordinates [0, 1] or plot coordinates [x, y]
  label: string;
  fieldName?: string;
  value?: number | string;
  comment?: string;
  metadata?: Record<string, unknown>;
}

export type AnySpatialPin = SpatialPin | SpatialPin2D;
