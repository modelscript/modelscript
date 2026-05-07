// name:     DoubleClassDeclaration2.mo
// status:   incorrect
//
// Checks that duplicate classes are detected.
//

model M
  model A
    Real x;
  end A;

  model A
    Real y;
  end A;

  A a;
end M;

// Result:
// Error processing file: DoubleClassDeclaration2.mo
// Error: Failed to load package DoubleClassDeclaration2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class DoubleClassDeclaration2.mo not found in scope <top>.
// Error: Error occurred while flattening model DoubleClassDeclaration2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
