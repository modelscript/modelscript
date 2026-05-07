// name: CheckInstantiationLimit
// status: correct

model CheckInstantiationLimit
  extends M(i=1);

package P
  constant Integer limit=10;
end P;

model N
  parameter Integer i;
  M m(i=i+1) if i <P.limit;
end N;

model M
  parameter Integer i;
  N n(i=i+1) if i<P.limit;
end M;
end CheckInstantiationLimit;
// Result:
// Error processing file: CheckInstantiationLimit.mo
// [OpenModelica/flattening/modelica/others/CheckInstantiationLimit.mo:12:3-12:22:writable] Error: Recursion limit reached while instantiating 'n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.m.n.i'.
// Error: Error occurred while flattening model CheckInstantiationLimit
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
