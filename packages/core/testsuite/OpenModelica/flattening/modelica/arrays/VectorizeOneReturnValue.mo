// name:     VectorizeOneReturnValue
// keywords: Array
// status:   correct
//

class OneReturnValue
  Real a = 1, b = 0, c = 1;

  Real s1[3] = sin({a, b, c});
                // Vector argument, result: {sin(a), sin(b), sin(c)}
  Real s2[2, 2] = sin([1, 2; 3, 4]);
                // Matrix argument, result: [sin(1), sin(2); sin(3), sin(4)]
end OneReturnValue;

// Result:
// Error processing file: VectorizeOneReturnValue.mo
// Error: Failed to load package VectorizeOneReturnValue (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class VectorizeOneReturnValue not found in scope <top>.
// Error: Error occurred while flattening model VectorizeOneReturnValue
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
