// name:     MyPointsInst2
// keywords: class declaration
// status:   correct
//
//
// Drmodelica: 2.2  Declaring Instances of Classes (p. 26)
//

class Point                "Point in a three-dimensional space"
  public
    parameter Real x;
    parameter Real y;
    parameter Real z;
end Point;

class MyPoints
  Point point1(x = 1, y = 2, z = 3);
  Point point2;
  Point point3;
end MyPoints;

class MyPointsInst2
  MyPoints pts(point1.x = 1, point1.y = 2, point1.z = 3);
  Real x=pts.point1.x;
  Real y=pts.point1.y;
  Real z=pts.point1.z;
end MyPointsInst2;



// insert expected flat file here. Can be done by issuing the command
// ./omc XXX.mo >> XXX.mo and then comment the inserted class.
//
// Result:
// Error processing file: MyPointsInst2.mo
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:11:5-11:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:12:5-12:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:13:5-13:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:11:5-11:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:12:5-12:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:13:5-13:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:11:5-11:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:12:5-12:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:13:5-13:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:17:3-17:36:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:18:3-18:15:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:19:3-19:15:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:23:3-23:57:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:24:3-24:22:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:25:3-25:22:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:26:3-26:22:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst2.mo:11:5-11:21:writable] Error: Parameter pts.point2.x has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model MyPointsInst2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
