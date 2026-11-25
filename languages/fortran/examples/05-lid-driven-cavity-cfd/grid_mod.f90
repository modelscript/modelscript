module grid_mod
  implicit none
  integer, parameter :: NX = 17
  integer, parameter :: NY = 17
  real(8), parameter :: DX = 1.0d0 / dble(NX - 1)
  real(8), parameter :: DY = 1.0d0 / dble(NY - 1)
end module grid_mod
