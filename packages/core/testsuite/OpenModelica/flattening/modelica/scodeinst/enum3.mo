// name: enum3.mo
// keywords:
// status: correct
//


model M
  type E = enumeration(one, two, three);
  class A end A;
  E e[E];
end M;

// Result:
// Error processing file: enum3.mo
// Error: Failed to load package enum3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class enum3.mo not found in scope <top>.
// Error: Error occurred while flattening model enum3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
