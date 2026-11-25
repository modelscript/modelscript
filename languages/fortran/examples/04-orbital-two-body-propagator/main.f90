program orbital_propagator
  use constants_mod
  use rk4_mod
  implicit none

  real(8) :: state(6), dt, t, r_orbit, v_circ
  integer :: step

  r_orbit = 6.778137d6
  v_circ = 7668.55d0
  state(1) = r_orbit
  state(2) = 0.0d0
  state(3) = 0.0d0
  state(4) = 0.0d0
  state(5) = v_circ
  state(6) = 0.0d0

  dt = 10.0d0
  t = 0.0d0

  do step = 1, 540
    call rk4_orbit_step(state, dt)
    t = t + dt
  end do
end program orbital_propagator
