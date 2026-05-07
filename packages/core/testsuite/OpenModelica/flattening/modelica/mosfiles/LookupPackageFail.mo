// name:     Lookup11
// keywords: scoping, lookup, bug1165
// status:   incorrect
//
// Checks that lookup fails to find P.B from A, since it is only allowed to look
// in the inner P package and not the outer.
//

package P
  model A
    P.B b;
  end A;

  model B
  end B;

  package P
  end P;
end P;

// Result:
// Error processing file: LookupPackageFail.mo
// Error: Failed to load package Lookup11 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Lookup11 not found in scope <top>.
// Error: Error occurred while flattening model Lookup11
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
