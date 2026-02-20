// SPDX-License-Identifier: AGPL-3.0-or-later

export const ANNOTATION = `
class Annotation

  // 18.5 Documentation

  // 18.5.1 Class Description and Revision History

  record Documentation
    String info;
    String revisions;
  end Documentation;

  // 18.9 Graphical Objects
  
  type DrawingUnit = Real(final unit="mm");
  type Point = DrawingUnit[2] "{x, y}";
  type Extent = Point[2] "Defines a rectangular area {{x1, y1}, {x2, y2}}";

  record GraphicItem
    Boolean visible = true;
    Point origin = {0, 0};
    Real rotation(quantity="angle", unit="deg")=0;
  end GraphicItem;

  // 18.9.1.1 Coordinate Systems

  record CoordinateSystem
    /*literal*/ Extent extent;
    /*literal*/ Boolean preserveAspectRatio = true;
    /*literal*/ Real initialScale = 0.1;
    /*literal*/ DrawingUnit grid[2];
  end CoordinateSystem;

  record Icon "Representation of the icon layer"
    CoordinateSystem coordinateSystem(extent = {{-100, -100}, {100, 100}});
    GraphicItem[:] graphics;
  end Icon;

  record Diagram "Representation of the diagram layer"
    CoordinateSystem coordinateSystem(extent = {{-100, -100}, {100, 100}});
    GraphicItem[:] graphics;
  end Diagram;

  // 18.9.1.2 Graphical Properties

  type Color = Integer[3](min = 0, max = 255) "RGB representation";
  Color Black = {0, 0, 0};
  type LinePattern = enumeration(None, Solid, Dash, Dot, DashDot, DashDotDot);
  type FillPattern = enumeration(None, Solid, Horizontal, Vertical,
                                Cross, Forward, Backward, CrossDiag,
                                HorizontalCylinder, VerticalCylinder, Sphere);
  type BorderPattern = enumeration(None, Raised, Sunken, Engraved);
  type Smooth = enumeration(None, Bezier);
  type EllipseClosure = enumeration(None, Chord, Radial, Automatic);

  type Arrow = enumeration(None, Open, Filled, Half);
  type TextStyle = enumeration(Bold, Italic, UnderLine);
  type TextAlignment = enumeration(Left, Center, Right);

  record FilledShape "Style attributes for filled shapes"
    Color lineColor = Black "Color of border line";
    Color fillColor = Black "Interior fill color";
    LinePattern pattern = LinePattern.Solid "Border line pattern";
    FillPattern fillPattern = FillPattern.None "Interior fill pattern";
    DrawingUnit lineThickness = 0.25 "Line thickness";
  end FilledShape;

  // 18.9.2 Component Instance

  record Transformation
    Extent extent;
    Real rotation(quantity = "angle", unit = "deg") = 0;
    Point origin = {0, 0};
  end Transformation;

  record Placement
    Boolean visible = true;
    Transformation transformation "Placement in the diagram layer";
    Boolean iconVisible "Visible in icon layer; for public connector";
    Transformation iconTransformation
      "Placement in the icon layer; for public connector";
  end Placement;

  // 18.9.3 Extends-Clause

  record IconMap
    /*literal*/ Extent extent = {{0, 0}, {0, 0}};
    /*literal*/ Boolean primitivesVisible = true;
  end IconMap;

  record DiagramMap
    /*literal*/ Extent extent = {{0, 0}, {0, 0}};
    /*literal*/ Boolean primitivesVisible = true;
  end DiagramMap;

  // 18.9.5 Graphical Primitives

  record Line
    extends GraphicItem;
    Point points[:];
    Color color = Black;
    LinePattern pattern = LinePattern.Solid;
    DrawingUnit thickness = 0.25;
    Arrow arrow[2] = {Arrow.None, Arrow.None} "{start arrow, end arrow}";
    DrawingUnit arrowSize = 3;
    Smooth smooth = Smooth.None "Spline";
  end Line;

  record Polygon
    extends GraphicItem;
    extends FilledShape;
    Point points[:];
    Smooth smooth = Smooth.None "Spline outline";
  end Polygon;

  record Rectangle
    extends GraphicItem;
    extends FilledShape;
    BorderPattern borderPattern = BorderPattern.None;
    Extent extent;
    DrawingUnit radius = 0 "Corner radius";
  end Rectangle;

  record Ellipse
    extends GraphicItem;
    extends FilledShape;
    Extent extent;
    Real startAngle(quantity = "angle", unit = "deg") = 0;
    Real endAngle(quantity = "angle", unit = "deg") = 360;
    EllipseClosure closure = EllipseClosure.Automatic;
  end Ellipse;

  record Text
    extends GraphicItem;
    Extent extent;
    String textString;
    Real fontSize = 0 "unit pt";
    String fontName;
    TextStyle textStyle[:];
    Color textColor = Black;
    TextAlignment horizontalAlignment = TextAlignment.Center;
  end Text;

  // 18.9.5.6 Bitmap

  record Bitmap
    extends GraphicItem;
    Extent extent;
    String fileName "Name of bitmap file";
    String imageSource "Base64 representation of bitmap";
  end Bitmap;

end Annotation;
`;
