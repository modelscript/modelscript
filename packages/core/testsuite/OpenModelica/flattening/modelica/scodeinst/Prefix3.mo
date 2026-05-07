// name: Prefix3
// keywords:
// status: correct
// cflags: -i=P.P2.Prefix3
//

package P
  package P2
    model Prefix3
      function f
        input Real x;
        output Real y;
      algorithm
        y := x;
      end f;

      Real x = f(time);
    end Prefix3;
  end P2;
end P;

// Result:
// Error processing file: Prefix3.mo
// Error: Failed to load package Prefix3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Prefix3 not found in scope <top>.
// Error: Error occurred while flattening model Prefix3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
