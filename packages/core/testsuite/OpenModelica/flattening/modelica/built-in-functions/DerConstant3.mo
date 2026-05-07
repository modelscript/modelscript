// name:     DerConstant3
// keywords: derivative
// status:   incorrect
//
// Operator der cannot be applied to Integer expressions which are not constant or parametric
//

class A
  discrete Integer pa = 1;
  Real a = der(pa);
end A;
// Result:
// Error processing file: DerConstant3.mo
// [<interactive>:9:3-9:26:writable] Warning: Components are deprecated in class.
// [<interactive>:10:3-10:19:writable] Warning: Components are deprecated in class.
// [<interactive>:10:3-10:19:writable] Error: Argument 'pa' of der is not differentiable.
// Error: Error occurred while flattening model A
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
