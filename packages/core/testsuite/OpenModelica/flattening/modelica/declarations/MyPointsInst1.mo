// name:     MyPointsInst1
// keywords: class declaration
// status:   correct
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

class MyPointsInst1
  MyPoints pts(point1(x= 1, y = 2, z = 3));
  Real x=pts.point1.x;
  Real y=pts.point1.y;
  Real z=pts.point1.z;
end MyPointsInst1;



// insert expected flat file here. Can be done by issuing the command
// ./omc XXX.mo >> XXX.mo and then comment the inserted class.
//
// Result:
// Error processing file: MyPointsInst1.mo
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:10:5-10:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:11:5-11:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:12:5-12:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:10:5-10:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:11:5-11:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:12:5-12:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:10:5-10:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:11:5-11:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:12:5-12:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:16:3-16:36:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:17:3-17:15:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:18:3-18:15:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:22:3-22:43:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:23:3-23:22:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:24:3-24:22:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:25:3-25:22:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/MyPointsInst1.mo:10:5-10:21:writable] Error: Parameter pts.point2.x has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model MyPointsInst1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
