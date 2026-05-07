// name:     UnknownDimensionMod.mo
// keywords: deduce unknown dimensions from modifier
// status:   correct
//
// check that we can deduce dimensions from array/matrix modifiers
//

model UnknownDimensionMod "check that we can deduce unknown dimensions from array/matrix modifier"
  type T = Real[:, :];
  parameter T matrix = [ 1,  2;  3,  4;  5,  6;
                             7,  8;  9, 10; 11, 12;
                            13, 14; 15, 16; 17, 18;
                            19, 20; 21, 22; 23, 24;
                            25, 26];

  parameter Real arr[:] = zeros(10);

  model A
    parameter T b;
  end A;

  A a(b = matrix);
end UnknownDimensionMod;

// Result:
// Error processing file: UnknownDimensionMod.mo
// Error: Class UnknownDimensionMod.mo not found in scope <top>.
// Error: Error occurred while flattening model UnknownDimensionMod.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
