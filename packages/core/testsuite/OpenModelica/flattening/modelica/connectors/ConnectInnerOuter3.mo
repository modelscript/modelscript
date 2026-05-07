// name:     ConnectInnerOuter3
// keywords: connect inner outer
// status:   correct
//
// Connect to inner outer references


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

model A2
  inner outer Pin world;
  A a;
  Pin a2Pin;
equation
  connect(world,a2Pin);
end A2;

model Top2
  inner Pin world;
  Pin topPin;
  A2 a1;
equation
  connect(world,topPin);
end Top2;

// Result:
// Error processing file: ConnectInnerOuter3.mo
// Error: Failed to load package ConnectInnerOuter3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ConnectInnerOuter3 not found in scope <top>.
// Error: Error occurred while flattening model ConnectInnerOuter3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
