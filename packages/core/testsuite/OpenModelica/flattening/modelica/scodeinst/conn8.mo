// name: conn8.mo
// keywords:
// status: incorrect
//

connector C = input Real;

model A
  C c1, c2;
  output C c3;
equation
  connect(c1, c2);
end A;
// Result:
// Error processing file: conn8.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/conn8.mo:10:3-10:14:writable] Error: Invalid type prefix 'input' on component c3, due to existing type prefix 'output'.
//
// Execution failed!
// endResult
