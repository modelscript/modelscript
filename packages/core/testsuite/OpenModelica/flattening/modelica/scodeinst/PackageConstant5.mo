// name: PackageConstant5
// keywords:
// status: incorrect
//

model PackageConstant5
  Real x;

  model A
    Real y = x;
  end A;

  A a;
end PackageConstant5;

// Result:
// Error processing file: PackageConstant5.mo
// [OpenModelica/flattening/modelica/scodeinst/PackageConstant5.mo:7:3-7:9:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/PackageConstant5.mo:10:5-10:15:writable] Error: Component 'x' was found in an enclosing scope but is not a constant.
// Error: Error occurred while flattening model PackageConstant5
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
