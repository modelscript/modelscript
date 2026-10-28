// SPDX-License-Identifier: AGPL-3.0-or-later

export enum Arrow {
  NONE = "None",
  OPEN = "Open",
  FILLED = "Filled",
  HALF = "Half",
}

export interface IBitmap extends IGraphicItem {
  "@type": "Bitmap";
  extent?: IExtent | undefined;
  fileName?: string | undefined;
  imageSource?: string | undefined;
}

export enum BorderPattern {
  NONE = "None",
  RAISED = "Raised",
  SUNKEN = "Sunken",
  ENGRAVED = "Engraved",
}

export type IColor = [number, number, number];

export interface ICoordinateSystem {
  "@type": "CoordinateSystem";
  extent?: IExtent | undefined;
  grid?: [IDrawingUnit, IDrawingUnit] | undefined;
  initialScale?: number | undefined;
  preserveAspectRatio?: boolean | undefined;
}

export interface IDiagram<T extends IGraphicItem = IGraphicItem> {
  "@type": "Diagram";
  coordinateSystem?: ICoordinateSystem | undefined;
  graphics?: T[] | undefined;
}

export type IDrawingUnit = number;

export interface IEllipse extends IFilledShape, IGraphicItem {
  "@type": "Ellipse";
  closure?: EllipseClosure | undefined;
  endAngle?: number | undefined;
  extent?: IExtent | undefined;
  startAngle?: number | undefined;
}

export enum EllipseClosure {
  NONE = "None",
  CHORD = "Chord",
  RADIAL = "Radial",
  AUTOMATIC = "Automatic",
}

export type IExtent = [IPoint, IPoint];

export interface IFilledShape {
  "@type": string;
  fillColor?: IColor | undefined;
  fillPattern?: FillPattern | undefined;
  lineColor?: IColor | undefined;
  lineThickness?: IDrawingUnit | undefined;
  pattern?: LinePattern | undefined;
}

export enum FillPattern {
  NONE = "None",
  SOLID = "Solid",
  HORIZONTAL = "Horizontal",
  VERTICAL = "Vertical",
  CROSS = "Cross",
  FORWARD = "Forward",
  BACKWARD = "Backward",
  CROSS_DIAG = "CrossDiag",
  HORIZONTAL_CYLINDER = "HorizontalCylinder",
  VERTICAL_CYLINDER = "VerticalCylinder",
  SPHERE = "Sphere",
}

export interface IGraphicItem {
  "@type": string;
  origin?: IPoint | undefined;
  rotation?: number | undefined;
  visible?: boolean | undefined;
}

export interface IIcon<T extends IGraphicItem = IGraphicItem> {
  "@type": "Icon";
  coordinateSystem?: ICoordinateSystem | undefined;
  graphics?: T[] | undefined;
}

export interface ILine extends IGraphicItem {
  "@type": "Line";
  arrow?: [Arrow, Arrow] | undefined;
  arrowSize?: IDrawingUnit | undefined;
  color?: IColor | undefined;
  thickness?: IDrawingUnit | undefined;
  pattern?: LinePattern | undefined;
  points?: IPoint[] | undefined;
  smooth?: Smooth | undefined;
}

export enum LinePattern {
  NONE = "None",
  SOLID = "Solid",
  DASH = "Dash",
  DOT = "Dot",
  DASH_DOT = "DashDot",
  DASH_DOT_DOT = "DashDotDot",
}

export interface IPlacement {
  "@type": "Placement";
  icon?: ITransformation | undefined;
  transformation?: ITransformation | undefined;
  visible?: boolean | undefined;
}

export type IPoint = [number, number];

export interface IPolygon extends IFilledShape, IGraphicItem {
  "@type": "Polygon";
  points?: IPoint[] | undefined;
  smooth?: Smooth | undefined;
}

export interface IRectangle extends IFilledShape, IGraphicItem {
  "@type": "Rectangle";
  borderPattern?: BorderPattern | undefined;
  extent?: IExtent | undefined;
  radius?: IDrawingUnit | undefined;
}

export enum Smooth {
  NONE = "None",
  BEZIER = "Bezier",
}

export interface IText extends IFilledShape, IGraphicItem {
  "@type": "Text";
  extent?: IExtent | undefined;
  fontName?: string | undefined;
  fontSize?: IDrawingUnit | undefined;
  horizontalAlignment?: TextAlignment | undefined;
  style?: TextStyle[] | undefined;
  string?: string | undefined;
  textString?: string | undefined;
  textStyle?: TextStyle[] | undefined;
}

export enum TextAlignment {
  LEFT = "Left",
  CENTER = "Center",
  RIGHT = "Right",
}

export enum TextStyle {
  BOLD = "Bold",
  ITALIC = "Italic",
  UNDER_LINE = "UnderLine",
}

export interface ITransformation {
  "@type": "Transformation";
  extent?: IExtent | undefined;
  origin?: IPoint | undefined;
  rotation?: number | undefined;
}

export interface ModelicaComponentInstance {
  name: string;
  declaration?: any;
  classInstance?: ModelicaClassInstance | null | undefined;
  annotation?: ((key?: string, ...args: any[]) => any) | undefined;
  annotations?: any[] | undefined;
  [key: string]: any;
}

export interface ModelicaClassInstance {
  id?: number | undefined;
  db?: any;
  name?: string | undefined;
  kind?: string | undefined;
  components?: ModelicaComponentInstance[] | undefined;
  extendsClassInstances?: ModelicaClassInstance[] | undefined;
  annotation?: ((key?: string, ...args: any[]) => any) | undefined;
  annotations?: any[] | undefined;
  declaredElements?: any[] | undefined;
  [key: string]: any;
}
