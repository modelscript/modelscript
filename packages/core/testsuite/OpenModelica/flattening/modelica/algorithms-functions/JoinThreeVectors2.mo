// name:     joinThreeVectors2
// keywords: external functions
// status:   correct
//
// External C function with column-major arrays
// Drmodelica: 11.1 Function Annotations (p. 372)
//


function joinThreeVectors2
  input Real v1[:],v2[:],v3[:];
  output Real vres[size(v1,1)+size(v2,1)+size(v3,1)];
external "C"
  join3vec(v1,v2,v3,vres,size(v1,1),size(v2,1),size(v3,1));
  annotation(arrayLayout = "columnMajor");
end joinThreeVectors2;

model joinThreeVectors
  Real a[2]={1,2};
  Real b[3]={3,4,5};
  Real c[4]={6,7,8,9};
  Real x[9];
algorithm
  x:=joinThreeVectors2(a,b,c);
end joinThreeVectors;

// Result:
// Error processing file: JoinThreeVectors2.mo
// [OpenModelica/flattening/modelica/algorithms-functions/JoinThreeVectors2.mo:10:1-16:22:writable] Error: Cannot instantiate joinThreeVectors2 due to class specialization function.
// Error: Error occurred while flattening model joinThreeVectors2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
