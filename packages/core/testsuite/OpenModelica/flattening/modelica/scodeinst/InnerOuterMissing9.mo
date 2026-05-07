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
end P;

// Result:
// Error processing file: InnerOuterMissing9.mo
// Error: Failed to load package InnerOuterMissing9 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class InnerOuterMissing9 not found in scope <top>.
// Error: Error occurred while flattening model InnerOuterMissing9
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
