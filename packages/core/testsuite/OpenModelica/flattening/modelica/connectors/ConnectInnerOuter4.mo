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
// [<interactive>:31:3-31:38:writable] Error: world.subWorld.pin is not a valid form for a connector, connectors must be either c1.c2...cn or m.c (where c is a connector and m is a non-connector).
// Error: Error occurred while flattening model Top
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
