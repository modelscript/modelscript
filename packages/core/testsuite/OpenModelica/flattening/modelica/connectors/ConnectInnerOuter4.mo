// name:     ConnectInnerOuter4
// keywords: connect inner outer
// status:   correct
//
// Connect to references in outer class

connector Pin
  flow Real i;
  Real v;
end Pin;

model World
  model SubWorld
    Pin pin;
  end SubWorld;
  SubWorld subWorld;
end World;

model A
  outer World world;
  Pin aPin;
equation
  connect(world.subWorld.pin, aPin);
end A;

model Top
  inner World world;
  Pin topPin;
  A a1,a2;
equation
  connect(world.subWorld.pin, topPin);
end Top;

// Result:
// Error processing file: ConnectInnerOuter4.mo
// Error: Failed to load package ConnectInnerOuter4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ConnectInnerOuter4 not found in scope <top>.
// Error: Error occurred while flattening model ConnectInnerOuter4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
