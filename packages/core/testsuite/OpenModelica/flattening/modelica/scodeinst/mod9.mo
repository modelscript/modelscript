// name: mod9.mo
// keywords:
// status: correct
//
// Class modifications not propagated.
//

model A
  type MyReal = Real;
  MyReal x;
end A;

model B
  extends A(MyReal(start = y));
  parameter Real y = 2.0;
end B;

// Result:
// Error processing file: mod9.mo
// Error: Failed to load package mod9 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class mod9.mo not found in scope <top>.
// Error: Error occurred while flattening model mod9.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
