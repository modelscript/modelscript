// name: PropagateExtends.mo
// keywords:
// status: correct
//

model A
  Real x;
  Real y;
end A;

model B
  extends A;
end B;

model C
  extends B;
end C;

model D
  extends C(x(unit="kg"));
end D;

model E
  extends D(x(start = 1), y(start=1));
end E;

model F
 E e;
 D d;
end F;

// Result:
// Error processing file: PropagateExtends.mo
// Error: Failed to load package PropagateExtends (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class PropagateExtends.mo not found in scope <top>.
// Error: Error occurred while flattening model PropagateExtends.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
