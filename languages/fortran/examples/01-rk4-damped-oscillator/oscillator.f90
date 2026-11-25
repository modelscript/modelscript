subroutine damped_oscillator_rk4(x_in, v_in, x_out, v_out, energy)
  implicit none
  real(8) :: x_in, v_in, x_out, v_out, energy
  real(8) :: m, c, k, dt, inv_m
  real(8) :: k1x, k1v, k2x, k2v, k3x, k3v, k4x, k4v
  real(8) :: xm2, vm2, xm3, vm3, xm4, vm4

  m = 2.0d0
  c = 0.4d0
  k = 18.0d0
  dt = 0.01d0
  inv_m = 0.5d0

  k1x = v_in
  k1v = -(c * v_in + k * x_in) * inv_m

  xm2 = x_in + 0.5d0 * dt * k1x
  vm2 = v_in + 0.5d0 * dt * k1v
  k2x = vm2
  k2v = -(c * vm2 + k * xm2) * inv_m

  xm3 = x_in + 0.5d0 * dt * k2x
  vm3 = v_in + 0.5d0 * dt * k2v
  k3x = vm3
  k3v = -(c * vm3 + k * xm3) * inv_m

  xm4 = x_in + dt * k3x
  vm4 = v_in + dt * k3v
  k4x = vm4
  k4v = -(c * vm4 + k * xm4) * inv_m

  x_out = x_in + (dt * 0.1666666666666667d0) * (k1x + 2.0d0 * k2x + 2.0d0 * k3x + k4x)
  v_out = v_in + (dt * 0.1666666666666667d0) * (k1v + 2.0d0 * k2v + 2.0d0 * k3v + k4v)
  energy = 0.5d0 * m * v_out * v_out + 0.5d0 * k * x_out * x_out
end subroutine damped_oscillator_rk4
