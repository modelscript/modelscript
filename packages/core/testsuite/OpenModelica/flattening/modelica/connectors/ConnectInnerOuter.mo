// name:     ConnectInnerOuter
// keywords: connect inner outer
// status:   correct
//
// Connections to inner outer references


connector Pin
  flow Real i;
  Real v;
end Pin;

model A
  outer Pin world;
  Pin aPin;
equation
  connect(world,aPin);
end A;

model Top
  inner Pin world;
  Pin topPin;
  A a1,a2;
equation
  connect(world,topPin);
end Top;

// Result:
// Error processing file: ConnectInnerOuter.mo
// Error: Failed to load package ConnectInnerOuter (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ConnectInnerOuter not found in scope <top>.
// Error: Error occurred while flattening model ConnectInnerOuter
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
