// name:     RecursiveDefinition
// keywords: recursive definition
// status:   incorrect
//
// Checks that compiler gives an error for recursive definitions.
//

class A

  class B
    A x;
  end B;

  B b;
end A;

// Result:
// Error processing file: RecursiveDefinition.mo
// Error: Failed to load package RecursiveDefinition (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RecursiveDefinition not found in scope <top>.
// Error: Error occurred while flattening model RecursiveDefinition
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
