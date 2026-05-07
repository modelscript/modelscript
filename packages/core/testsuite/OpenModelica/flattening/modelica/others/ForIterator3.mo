// name: ForIterator3
// status: correct
class ForIterator3
  constant String s1[4,3] = {i+j for i in {"a","b","c"}, j in {"d","e","f","g"}};
  constant String s2 = sum(i+j for i in {"a","b","c"}, j in {"d","e","f","g"});
  constant String s3[:,:,:,:] = {i+j+k+l for i in {"a","b","c"}, j in {"d","e","f","g"}, k in {"h"}, l in {"1","2","3","4"}};
end ForIterator3;

// Result:
// Error processing file: ForIterator3.mo
// [OpenModelica/flattening/modelica/others/ForIterator3.mo:4:3-4:81:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/others/ForIterator3.mo:5:3-5:79:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/others/ForIterator3.mo:6:3-6:125:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/others/ForIterator3.mo:5:3-5:79:writable] Error: Invalid expression 'i + j' of type String in sum reduction, expected Integer or Real, or operator record.
// Error: Error occurred while flattening model ForIterator3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
