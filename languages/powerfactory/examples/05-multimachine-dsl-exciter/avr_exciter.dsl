! Automatic Voltage Regulator (IEEE ST1A) in DIgSILENT DSL
model AVR_ST1A
  input: v_meas, v_ref, v_pss
  output: efd
  parameter: Tr = 0.015, Ka = 210.0, Ta = 0.04, Vrmin = -4.5, Vrmax = 5.5
  internal: v_filt, v_err, vr

  s:v_filt = (v_meas - v_filt) / Tr
  v_err = v_ref - v_filt + v_pss
  s:vr = (Ka * v_err - vr) / Ta
  efd = lim(vr, Vrmin, Vrmax)
end
