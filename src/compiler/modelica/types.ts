// SPDX-License-Identifier: AGPL-3.0-or-later

export enum Arrow {
  NONE = "None",
  OPEN = "Open",
  FILLED = "Filled",
  HALF = "Half",
}

export interface IBitmap extends IGraphicItem {
  "@type": "Bitmap";
  extent?: IExtent;
  fileName?: string;
  imageSource?: string;
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
  extent?: IExtent;
  grid?: [IDrawingUnit, IDrawingUnit];
  initialScale?: number;
  preserveAspectRatio?: boolean;
}

export interface IDiagram<T extends IGraphicItem = IGraphicItem> {
  "@type": "Diagram";
  coordinateSystem?: ICoordinateSystem;
  graphics?: T[];
}

export type IDrawingUnit = number;

export interface IEllipse extends IFilledShape, IGraphicItem {
  "@type": "Ellipse";
  closure?: EllipseClosure;
  endAngle?: number;
  extent?: IExtent;
  startAngle?: number;
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
  fillColor?: IColor;
  fillPattern?: FillPattern;
  lineColor?: IColor;
  lineThickness?: IDrawingUnit;
  pattern?: LinePattern;
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
  origin?: IPoint;
  rotation?: number;
  visible?: boolean;
}

export interface IIcon<T extends IGraphicItem = IGraphicItem> {
  "@type": "Icon";
  coordinateSystem?: ICoordinateSystem;
  graphics?: T[];
}

export interface ILine extends IGraphicItem {
  "@type": "Line";
  arrow?: [Arrow, Arrow];
  arrowSize?: IDrawingUnit;
  color?: IColor;
  thickness?: IDrawingUnit;
  pattern?: LinePattern;
  points?: IPoint[];
  smooth?: Smooth;
}

export enum LinePattern {
  NONE = "None",
  SOLID = "Solid",
  DASH = "Dash",
  DOT = "Dot",
  DASH_DOT = "DashDot",
  DASH_DOT_DOT = "DashDotDot",
}

export type IPoint = [IDrawingUnit, IDrawingUnit];

export interface IPolygon extends IFilledShape, IGraphicItem {
  "@type": "Polygon";
  points?: IPoint[];
  smooth?: Smooth;
}

export interface IRectangle extends IFilledShape, IGraphicItem {
  "@type": "Rectangle";
  borderPattern?: BorderPattern;
  extent?: IExtent;
  radius?: IDrawingUnit;
}

export enum Smooth {
  NONE = "None",
  BEZIER = "Bezier",
}

export interface IText extends IGraphicItem {
  "@type": "Text";
  extent?: IExtent;
  fontName?: string;
  fontSize?: number;
  horizontalAlignment?: TextAlignment;
  index?: number;
  string?: string;
  textColor?: IColor;
  textString?: string;
  textStyle?: TextStyle[];
}

export enum TextAlignment {
  LEFT = "Left",
  CENTER = "Center",
  RIGHT = "Right",
}

export enum TextStyle {
  BOLD = "Bold",
  ITALIC = "Italic",
  UNDERLINE = "UnderLine",
}
