// name: RecursiveInst3
// keywords:
// status: incorrect
//
//

model A
  A a;
end A;

model RecursiveInst3
  A a;
end RecursiveInst3;

// Result:
// Error processing file: RecursiveInst3.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/RecursiveInst3.mo:8:3-8:6:writable] Error: Declaration of element a causes recursive definition of class A.
//
// Execution failed!
// endResult
