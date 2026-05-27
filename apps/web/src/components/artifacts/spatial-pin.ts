export interface SpatialPin {
  worldPosition: [number, number, number];
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  fieldName: string;
  scalarValue: number;
}
