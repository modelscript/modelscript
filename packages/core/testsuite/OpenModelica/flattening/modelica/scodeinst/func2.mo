// name: func2.mo
// keywords:
// status: incorrect
//


model A
  function f
  end f;

  Real x = f();
  Real y = min(2, 3);
end A;

model B
  A a;
  Real x = A.f();
end B;

// Result:
// Error processing file: func2.mo
// Error: Failed to load package func2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class func2.mo not found in scope <top>.
// Error: Error occurred while flattening model func2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
