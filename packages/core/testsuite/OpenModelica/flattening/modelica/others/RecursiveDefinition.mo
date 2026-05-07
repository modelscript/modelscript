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
// [<interactive>:6:3-6:30:writable] Warning: Components are deprecated in class.
// [<interactive>:7:3-7:38:writable] Warning: Components are deprecated in class.
// [<interactive>:7:3-7:38:writable] Error: Function q not found in scope IfExpCombiTable1.
// Error: Error occurred while flattening model A
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
