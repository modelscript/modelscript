// status: incorrect

model ExtObjError2
  class ExtObj
    extends ExternalObject;
    function constructor
      output ExtObj eo;
    external "C";
    end constructor;
    function destructor
      input ExtObj eo;
    external "C";
    end destructor;
  end ExtObj;

  function notConstructor
    output ExtObj eo = ExtObj(); // Invalid; non-constructors may not return external objects
  algorithm
  end notConstructor;

  ExtObj eo = notConstructor();
end ExtObjError2;

// Result:
// Error processing file: ExtObjError2.mo
// Error: Failed to load package notConstructor (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class notConstructor not found in scope <top>.
// Error: Error occurred while flattening model notConstructor
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
