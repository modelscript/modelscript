// name: ProtectedAccess
// keywords: protected, access
// status: correct
//
// Tests that we give a warning when accessing protected elements of another class
//

model TestModel
protected
  Integer x = 2;
end TestModel;

model ProtectedAccess
  TestModel tm(x = 3);
end ProtectedAccess;


// Result:
// Error processing file: ProtectedAccess.mo
// [OpenModelica/flattening/modelica/others/ProtectedAccess.mo:14:16-14:21:writable] Notification: From here:
// [OpenModelica/flattening/modelica/others/ProtectedAccess.mo:10:3-10:16:writable] Error: Protected element 'x' may not be modified, got 'x = 3'.
// Error: Error occurred while flattening model ProtectedAccess
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
