// name:     ConnectInnerOuter2
// keywords: connect inner outer
// status:   correct
//
// Connect to inner outer references


connector Pin
  flow Real i;
  Real v;
end Pin;

model Resistor
  Pin p;
  Pin n;
end Resistor;

model A
  outer Resistor world;
  Pin aPin;
equation
  connect(world.p,aPin);
end A;

model Top
  inner Resistor world;
  Pin topPin;
  A a1,a2;
equation
  connect(world.p,topPin);
end Top;

// Result:
// Error processing file: ConnectInnerOuter2.mo
// Error: Failed to load package ConnectInnerOuter2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ConnectInnerOuter2 not found in scope <top>.
// Error: Error occurred while flattening model ConnectInnerOuter2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
