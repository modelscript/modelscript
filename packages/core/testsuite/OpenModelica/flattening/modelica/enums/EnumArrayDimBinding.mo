// name:     Enumeration1
// keywords: enumeration enum array
// status:   correct
//
// Checks that the enumeration dimension of the component is preserved, and not
// replaced with the dimension of the binding.
//

type E = enumeration(A, B, C);

model EnumerationArrayDimBinding
  Real x[E] = {1, 2, 3};
end EnumerationArrayDimBinding;

// Result:
// Error processing file: EnumArrayDimBinding.mo
// Error: Failed to load package Enumeration1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Enumeration1 not found in scope <top>.
// Error: Error occurred while flattening model Enumeration1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
