// name:     ImportSubPackage1
// keywords: import
// status:   incorrect
//
//

package P1
  package P2
    model A
      Real x;
    end A;
  end P2;

  import P1.P2.A;
end P1;

model M
  P1.A a;
end M;

// Result:
// Error processing file: ImportSubPackage1.mo
// Error: Failed to load package ImportSubPackage1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ImportSubPackage1 not found in scope <top>.
// Error: Error occurred while flattening model ImportSubPackage1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
