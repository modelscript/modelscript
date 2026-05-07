// name:     ArrayAddEmpty
// keywords: <insert keywords here>
// status:   correct
//
// MORE WORK HAS TO BE DONE ON THIS FILE!
//

class AddEmpty
  Real[3, 0] A, B;
  Real[0, 0] C;
  Real ab[3, 0] = A + B; // Fine, the result is an empty matrix of type Real[3, 0]
  //Real ac = A + C; // Error,incompatible types Real[3, 0] and Real[0, 0]
end AddEmpty;

// Result:
// Error processing file: ArrayAddEmpty.mo
// Error: Failed to load package ArrayAddEmpty (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ArrayAddEmpty not found in scope <top>.
// Error: Error occurred while flattening model ArrayAddEmpty
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
