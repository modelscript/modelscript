// name: InnerOuterExtends1
// keywords:
// status: correct
//

model A
  outer model M = B;
  extends M;
end A;

model B
  Real x;
end B;

model C
  Real x = 1.0;
end C;

model InnerOuterExtends1
  A a;
  inner model M = C;
end InnerOuterExtends1;

// Result:
// Error processing file: InnerOuterExtends1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InnerOuterExtends1.mo:8:3-8:12:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/InnerOuterExtends1.mo:21:9-21:20:writable] Error: Found other base class for extends M after instantiating extends.
//
// Execution failed!
// endResult
