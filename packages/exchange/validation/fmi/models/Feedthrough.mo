model Feedthrough "A model to test different variable types, causalities, and variabilities"
  parameter Real Float64_fixed_parameter = 0.0;
  parameter Real Float64_tunable_parameter = 0.0;
  input Real Float64_continuous_input(start = 0.0);
  output Real Float64_continuous_output(start = 0.0);
  input Real Float64_discrete_input(start = 0.0);
  output Real Float64_discrete_output(start = 0.0);
  input Integer Int32_input(start = 0);
  output Integer Int32_output(start = 0);
  input Boolean Boolean_input(start = false);
  output Boolean Boolean_output(start = false);
  input Integer Enumeration_input(start = 1);
  output Integer Enumeration_output(start = 1);
equation
  Float64_continuous_output = Float64_continuous_input + Float64_fixed_parameter + Float64_tunable_parameter;
  Float64_discrete_output = Float64_discrete_input;
  Int32_output = Int32_input;
  Boolean_output = Boolean_input;
  Enumeration_output = Enumeration_input;
end Feedthrough;
