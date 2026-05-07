// name:     SimplePeriodicSampler
// keywords: sample
// status:   correct
//
// <insert description here>
//
// Drmodelica: 13.2  Sampled Systems (p. 429)
//
model Sampler
  parameter Real sample_interval = 0.1        "Sample period";
  Real x(start=5);
  Real y;
equation
  der(x) = -x;
  when sample(0, sample_interval) then
    y = x;
  end when;
end Sampler;


// Result:
// Error processing file: SimplePeriodicSampler.mo
// Error: Failed to load package SimplePeriodicSampler (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class SimplePeriodicSampler not found in scope <top>.
// Error: Error occurred while flattening model SimplePeriodicSampler
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
