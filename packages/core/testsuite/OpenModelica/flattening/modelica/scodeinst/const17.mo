// name: const17.mo
// keywords:
// status: correct
//
//

package A
  package B
    constant Integer i = A.B.c;

    package A
      package B
        constant Integer c = 2;
      end B;
    end A;
  end B;
end A;

model M
  Real x = A.B.i;
end M;

// Result:
// Error processing file: const17.mo
// Error: Failed to load package const17 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const17.mo not found in scope <top>.
// Error: Error occurred while flattening model const17.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
