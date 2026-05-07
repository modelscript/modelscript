// name: enum1.mo
// keywords:
// status: correct
//


model M
  type E = enumeration(one, two, three);
  E e = E.one;
end M;

// Result:
// Error processing file: enum1.mo
// Error: Failed to load package enum1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class enum1.mo not found in scope <top>.
// Error: Error occurred while flattening model enum1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
