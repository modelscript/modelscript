// name: EngineSAAB95Total
// keywords: record
// status: correct
//
// Tests the built-in cos function
//
package EngineModel
  model Engine
  public
    EngineModel.EngineGeometry data;
    Real displacement;
    constant Real pi=3.1415956;
  equation
    displacement=pi/4*data.bore^2*data.stroke;
  end Engine;

  record EngineGeometry
  public
    parameter Real bore;
    parameter Real stroke;
  end EngineGeometry;

  record SAAB95i
    extends EngineModel.EngineGeometry(bore=0.09, stroke=0.09);
  end SAAB95i;
end EngineModel;

model EngineSAAB95
  EngineModel.Engine engine(data=EngineModel.SAAB95i());
  EngineModel.Engine engine2(data=EngineModel.SAAB95i(bore=3,stroke=5));
end EngineSAAB95;

// Result:
// Error processing file: EngineSAAB95Total.mo
// Error: Failed to load package EngineSAAB95Total (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class EngineSAAB95Total not found in scope <top>.
// Error: Error occurred while flattening model EngineSAAB95Total
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
