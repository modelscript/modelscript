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
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/RecursiveInst2.mo:8:3-8:19:writable] Error: Declaration of element r causes recursive definition of class A.
//
// Execution failed!
// endResult
