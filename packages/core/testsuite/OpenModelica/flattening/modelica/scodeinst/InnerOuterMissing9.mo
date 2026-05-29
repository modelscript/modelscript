// name: InnerOuterMissing9
// keywords:
// status: incorrect
// cflags: -i=P.InnerOuterMissing9
//
// Checks that only the instance tree is searched when looking for an inner
// element, and not the enclosing scopes of the class being instantiated.
//

package P
  inner Real x;

  model InnerOuterMissing9
    outer Real x;
  end InnerOuterMissing9;
  annotation(__OpenModelica_commandLineOptions="-i=P.InnerOuterMissing9");
end P;

// Result:
// Error processing file: InnerOuterMissing9.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InnerOuterMissing9.mo:10:1-17:6:writable] Error: Cannot instantiate P due to class specialization package.
//
// Execution failed!
// endResult
