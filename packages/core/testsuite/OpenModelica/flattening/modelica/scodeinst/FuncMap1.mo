// name: FuncMap1
// keywords: function map array reduction
// status: correct
//
// checks mapping functions are typed correctly.


model C
  function F
    input Integer a;
    input Integer b;
    output Integer c = a;
  end F;

  Integer b[3];
  Integer c[3];
  Integer d[3];
equation 
  b = {1,2,3};
  c = array(F(b[i],b[i]) for i in 1:size(b,1));
  d = {F(b[i],i) for i in 1:size(b,1)};
end C;


// Result:
// Error processing file: FuncMap1.mo
// Error: Failed to load package FuncMap1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class FuncMap1 not found in scope <top>.
// Error: Error occurred while flattening model FuncMap1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
