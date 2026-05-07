// name: enum7.mo
// keywords:
// status: correct
//

model M
  type E = enumeration(one, two, three);

  type E2
    extends E;
  end E2;

  E2 e = E2.one;
end M;

// Result:
// Error processing file: enum7.mo
// Error: Failed to load package enum7 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class enum7.mo not found in scope <top>.
// Error: Error occurred while flattening model enum7.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
