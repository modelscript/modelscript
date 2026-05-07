// name: const14.mo
// keywords:
// status: correct
//

package B
  package A
    package B
      constant Integer j = 2;
    end B;
  end A;
end B;

package A
  package B
    package A
      package B
        constant Integer i = .B.A.B.j;
      end B;
    end A;
  end B;
end A;

model M
  Integer x = A.B.A.B.i;
end M;

// Result:
// Error processing file: const14.mo
// Error: Failed to load package const14 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const14.mo not found in scope <top>.
// Error: Error occurred while flattening model const14.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
