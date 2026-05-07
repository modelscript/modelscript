// name: dim16
// keywords:
// status: correct
//

model B
  C c;
end B;

model C
  D d(widthDirection = {0, 1, 0});
end C;

model D
  parameter Types.Axis widthDirection = {0, 1, 0};
end D;

package Types
  type Axis = Real[3];
end Types;

model A
  B b;
end A;

// Result:
// Error processing file: dim16.mo
// Error: Failed to load package dim16 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class dim16 not found in scope <top>.
// Error: Error occurred while flattening model dim16
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
