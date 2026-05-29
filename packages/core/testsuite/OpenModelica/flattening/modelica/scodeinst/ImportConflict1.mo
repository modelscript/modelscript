// name:     ImportConflict1
// keywords: import conflict
// status:   incorrect
//
// Checks that an error is output for conflicting imports.
//

package P
  model M
    Real x;
  end M;

  model N
    Real x;
  end N;
end P;

model ImportConflict1
  import M = P.M;
  import M = P.N;
  M m;
end ImportConflict1;

// Result:
// Error processing file: ImportConflict1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/ImportConflict1.mo:19:3-19:17:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/ImportConflict1.mo:20:3-20:17:writable] Error: Qualified import name M already exists in this scope.
// [OpenModelica/flattening/modelica/scodeinst/ImportConflict1.mo:21:3-21:6:writable] Error: Class M not found in scope ImportConflict1.
//
// Execution failed!
// endResult
