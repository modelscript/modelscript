// name: GetInstanceName
// status: correct
// cflags: -i=O.N

function f
  output String s = getInstanceName();
end f;

package P
  constant String s = getInstanceName();
end P;

model M
  String s1 = getInstanceName();
  String s2 = f();
  String s3 = P.s;
end M;

model O
model P
  M m;
end P;
model N
  M m;
  P p;
end N;
end O;

// Result:
// Error processing file: GetInstanceName.mo
// Error: Failed to load package GetInstanceName (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class GetInstanceName not found in scope <top>.
// Error: Error occurred while flattening model GetInstanceName
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
