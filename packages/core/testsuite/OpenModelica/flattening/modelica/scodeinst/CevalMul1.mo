// name: CevalMul1
// keywords:
// status: correct
//

model CevalSub1
  constant Integer i1 = 2 * 2;
  constant Integer i2[:] = {1, 2, 3} .* {3, 4, 5};
  constant Integer i3[:, :] = {{1, 2}, {3, 4}} .* {{5, 6}, {7, 8}};
  constant Integer i4[:] = 2 .* {1, 2, 3};
  constant Integer i5[:] = {1, 2, 3} .* 2;
  constant Integer i6[:] = zeros(0) .* zeros(0);

  constant Real r1 = 2 * 2;
  constant Real r2[:] = {1, 2, 3} .* {3, 4, 5};
  constant Real r3[:, :] = {{1, 2}, {3, 4}} .* {{5, 6}, {7, 8}};
  constant Real r4[:] = 2 .* {1, 2, 3};
  constant Real r5[:] = {1, 2, 3} .* 2;
  constant Integer r6[:] = zeros(0) .* zeros(0);
end CevalSub1;

// Result:
// Error processing file: CevalMul1.mo
// Error: Failed to load package CevalMul1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class CevalMul1 not found in scope <top>.
// Error: Error occurred while flattening model CevalMul1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
