! External Fortran 90 P-f and Q-V Droop Controller for BESS_Droop_Inverter
subroutine bess_droop_ctrl(p_meas, q_meas, p_ref, q_ref, mp, nq, f_nom, v_nom, f_cmd, v_cmd)
  implicit none
  double precision, intent(in)  :: p_meas, q_meas, p_ref, q_ref
  double precision, intent(in)  :: mp, nq, f_nom, v_nom
  double precision, intent(out) :: f_cmd, v_cmd

  ! Linear primary frequency and voltage droop laws
  f_cmd = f_nom - mp * (p_meas - p_ref) * f_nom
  v_cmd = v_nom - nq * (q_meas - q_ref) * v_nom

  ! Clamp frequency and voltage references to IEEE 1547 safe operating band
  if (f_cmd < 0.95d0 * f_nom) f_cmd = 0.95d0 * f_nom
  if (f_cmd > 1.05d0 * f_nom) f_cmd = 1.05d0 * f_nom
  if (v_cmd < 0.90d0 * v_nom) v_cmd = 0.90d0 * v_nom
  if (v_cmd > 1.10d0 * v_nom) v_cmd = 1.10d0 * v_nom
end subroutine bess_droop_ctrl
