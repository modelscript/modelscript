FUNCTION_BLOCK FillerPressurePid
  VAR_INPUT
    Setpoint : REAL := 2.5;
    ProcessValue : REAL := 2.5;
    Kp : REAL := 1.8;
    Ki : REAL := 0.25;
  END_VAR
  VAR_OUTPUT
    ValveOutputPct : REAL := 0.0;
  END_VAR
  VAR
    Err : REAL := 0.0;
    IntAcc : REAL := 0.0;
  END_VAR

  Err := Setpoint - ProcessValue;
  IntAcc := IntAcc + (Ki * Err * 0.05);
  ValveOutputPct := (Kp * Err) + IntAcc;
  IF ValveOutputPct > 100.0 THEN
    ValveOutputPct := 100.0;
  ELSIF ValveOutputPct < 0.0 THEN
    ValveOutputPct := 0.0;
  END_IF;
END_FUNCTION_BLOCK
