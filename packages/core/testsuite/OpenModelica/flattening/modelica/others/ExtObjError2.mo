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
// impure function ExtObjError2.ExtObj.constructor
//   output ExtObjError2.ExtObj eo;
//
//   external "C" eo = constructor();
// end ExtObjError2.ExtObj.constructor;
//
// impure function ExtObjError2.ExtObj.destructor
//   input ExtObjError2.ExtObj eo;
//
//   external "C" destructor(eo);
// end ExtObjError2.ExtObj.destructor;
//
// impure function ExtObjError2.notConstructor
//   output ExtObjError2.ExtObj eo = ExtObjError2.ExtObj.constructor();
// algorithm
// end ExtObjError2.notConstructor;
//
// class ExtObjError2
//   ExtObjError2.ExtObj eo = ExtObjError2.notConstructor();
// end ExtObjError2;
// [<interactive>:16:3-19:21:writable] Warning: Pure function 'ExtObjError2.notConstructor' contains a call to impure function 'ExtObjError2.ExtObj.constructor'.
// endResult
