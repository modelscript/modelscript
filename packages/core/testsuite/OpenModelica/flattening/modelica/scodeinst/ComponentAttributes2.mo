// name: ComponentAttributes2
// keywords:
// status: incorrect
//

model A
  input Real x;
end A;

model ComponentAttributes2
  input A a;
end ComponentAttributes2;

// Result:
// Error processing file: ComponentAttributes2.mo
// [OpenModelica/flattening/modelica/scodeinst/ComponentAttributes2.mo:7:3-7:15:writable] Error: Invalid type prefix 'input' on component x, due to existing type prefix 'input'.
// Error: Error occurred while flattening model ComponentAttributes2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
