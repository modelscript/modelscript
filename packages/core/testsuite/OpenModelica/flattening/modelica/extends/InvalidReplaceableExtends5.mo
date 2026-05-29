// name:     InvalidReplaceableExtends5
// keywords: extends replaceable
// status:   incorrect
//
// Checks that an error is issued if any part of the base class name is
// replaceable.
//

model InvalidReplaceableExtends5
  replaceable model A
    model B
      Real x;
    end B;
  end A;

  extends A.B;
end InvalidReplaceableExtends5;

// Result:
// Error processing file: InvalidReplaceableExtends5.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/extends/InvalidReplaceableExtends5.mo:10:15-14:8:writable] Notification: From here:
// [OpenModelica/flattening/modelica/extends/InvalidReplaceableExtends5.mo:16:3-16:14:writable] Error: Class 'A' in 'extends <A>.B' is replaceable, the base class name must be transitively non-replaceable.
//
// Execution failed!
// endResult
