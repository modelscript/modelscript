// name: enum4.mo
// keywords:
// status: correct
//
//

model M
  package P
    type E = enumeration(one, two, three);
  end P;

  P.E e = P.E.one;
end M;

// Result:
// Error processing file: enum4.mo
// Error: Failed to load package enum4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class enum4.mo not found in scope <top>.
// Error: Error occurred while flattening model enum4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
