program cavity_navier_stokes
  use grid_mod
  use poisson_mod
  use bc_mod
  implicit none

  real(8) :: u(289), v(289), p(289), rhs(289)
  real(8) :: dt, nu, inv_2dx, inv_dx2, inv_dt, u_center
  integer :: step, k

  dt = 0.002d0
  nu = 0.01d0
  inv_2dx = 8.0d0
  inv_dx2 = 256.0d0
  inv_dt = 500.0d0

  do k = 1, 289
    u(k) = 0.0d0
    v(k) = 0.0d0
    p(k) = 0.0d0
    rhs(k) = 0.0d0
  end do

  do step = 1, 20
    call apply_cavity_bc(u, v)
    do k = 19, 271
      rhs(k) = ((u(k + 1) - u(k - 1)) * inv_2dx + (v(k + 17) - v(k - 17)) * inv_2dx) * inv_dt
    end do
    call solve_pressure_poisson(p, rhs, 15)
    do k = 19, 271
      u(k) = u(k) - dt * (p(k + 1) - p(k - 1)) * inv_2dx + nu * dt * (u(k + 1) - 2.0d0 * u(k) + u(k - 1)) * inv_dx2
      v(k) = v(k) - dt * (p(k + 17) - p(k - 17)) * inv_2dx + nu * dt * (v(k + 17) - 2.0d0 * v(k) + v(k - 17)) * inv_dx2
    end do
  end do

  u_center = u(145)
end program cavity_navier_stokes
