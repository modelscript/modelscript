// name: enum2.mo
// keywords:
// status: correct
//


model M
  type E1 = enumeration(one, two, three);
  type E2 = E1(start = E1.two);
  E2 e;
end M;

// Result:
// Error processing file: enum2.mo
// Error: Failed to load package enum2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class enum2.mo not found in scope <top>.
// Error: Error occurred while flattening model enum2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
