// Synthetic Modelica preamble defining built-in types.
// This file is parsed at QueryEngine initialization time and its symbols
// are added to the index, so that predefined type names like "Real",
// "Integer", "Boolean", "String" resolve naturally via db.byName().
//
// Based on Modelica 3.6 Specification §4.8 and §4.9.

type Real
  "Built-in Real type"
  extends /* primitive */;
  parameter String unit = "" "Unit expression";
  parameter String displayUnit = "" "Default display unit";
  parameter Real min = -1e100 "Minimum value";
  parameter Real max = 1e100 "Maximum value";
  parameter Real start = 0.0 "Default start value";
  parameter Boolean fixed = false "Fixed during initialization";
  parameter Real nominal = 1.0 "Nominal value for scaling";
  parameter StateSelect stateSelect = StateSelect.default "Priority for state selection";
end Real;

type Integer
  "Built-in Integer type"
  extends /* primitive */;
  parameter Integer min = -2147483648 "Minimum value";
  parameter Integer max = 2147483647 "Maximum value";
  parameter Integer start = 0 "Default start value";
  parameter Boolean fixed = false "Fixed during initialization";
end Integer;

type Boolean
  "Built-in Boolean type"
  extends /* primitive */;
  parameter Boolean start = false "Default start value";
  parameter Boolean fixed = false "Fixed during initialization";
end Boolean;

type String
  "Built-in String type"
  extends /* primitive */;
  parameter String start = "" "Default start value";
end String;

type Clock
  "Built-in Clock type for synchronous language elements"
  extends /* primitive */;
end Clock;

type StateSelect = enumeration(
  never "Do not use as state",
  avoid "Use as state only if essential",
  default "Use default heuristic",
  prefer "Prefer as state",
  always "Always use as state"
) "Priority for state variable selection";

type AssertionLevel = enumeration(
  error "Raises a simulation error",
  warning "Produces a warning message"
) "Level for assert() and terminate()";
