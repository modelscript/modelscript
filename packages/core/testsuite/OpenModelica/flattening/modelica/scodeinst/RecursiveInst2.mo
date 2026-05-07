// name: RecursiveInst2
// keywords:
// status: incorrect
//
//

model A
  RecursiveInst2 r;
end A;

model RecursiveInst2
  A a;
end RecursiveInst2;

// Result:
// Error processing file: RecursiveInst2.mo
// [OpenModelica/flattening/modelica/scodeinst/RecursiveInst2.mo:8:3-8:19:writable] Error: Declaration of element r causes recursive definition of class A.
// Error: Error occurred while flattening model RecursiveInst2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
