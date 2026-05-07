// name: const13.mo
// keywords:
// status: incorrect
//

model A
  package D
    constant Real y;
  end D;

  package B
    extends D;
    constant Real x;
  end B;
end A;

model C
  A a(B(y = 3.0));
  Real y = a.B.y;
end C;

// Result:
// Error processing file: const13.mo
// Error: Failed to load package const13 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const13.mo not found in scope <top>.
// Error: Error occurred while flattening model const13.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
