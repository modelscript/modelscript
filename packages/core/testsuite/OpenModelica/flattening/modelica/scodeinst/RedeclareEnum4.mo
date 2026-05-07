// name: RedeclareEnum4
// keywords:
// status: incorrect
//

model A
  replaceable type E = enumeration(:);
  E e;
end A;

model RedeclareEnum1
  extends A(redeclare type E = Real);
end RedeclareEnum1;


// Result:
// Error processing file: RedeclareEnum4.mo
// Error: Failed to load package RedeclareEnum4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RedeclareEnum4 not found in scope <top>.
// Error: Error occurred while flattening model RedeclareEnum4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
