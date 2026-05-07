// name: const16.mo
// keywords:
// status: correct
//

package P
  package P
    constant Integer j = 2;

    package P
      constant Integer i = j;
    end P;
  end P;

  model M
    Real x = P.P.i;
  end M;
end P;

model M
  extends P.M;
end M;

// Result:
// Error processing file: const16.mo
// Error: Failed to load package const16 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const16.mo not found in scope <top>.
// Error: Error occurred while flattening model const16.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
