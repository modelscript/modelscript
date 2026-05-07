// name:     DependsMutual
// keywords: scoping
// status:   correct
//
// Mutual dependence is supported since Modelica does not require
// declare before use.
//
// Here package A depends on the class DependsMutual and
// DependsMutual depends on the package A.
//
// Obviously a model cannot contain a model that contains itself
// since that leads to recursive models.

package A
 Real x;
 model B
   DependsMutual b;
 end B;
 model C
   Real x;
 end C;
end A;

class DependsMutual
  Real x;
  A.C a;
equation
  a.x=x;
  x=time;
end DependsMutual;

// Result:
// Error processing file: DependsMutual.mo
// [OpenModelica/flattening/modelica/scoping/DependsMutual.mo:15:2-15:8:writable] Error: Variable x in package A is not constant.
// [OpenModelica/flattening/modelica/scoping/DependsMutual.mo:26:3-26:8:writable] Error: Class A.C not found in scope DependsMutual.
// Error: Error occurred while flattening model DependsMutual
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
