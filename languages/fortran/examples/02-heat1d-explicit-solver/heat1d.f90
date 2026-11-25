subroutine heat1d_step(t_mid)
  implicit none
  real(8) :: t_mid
  real(8) :: u(41), u_new(41)
  real(8) :: r
  integer :: i, n

  r = 0.25d0

  do i = 1, 41
    u(i) = 20.0d0
    u_new(i) = 20.0d0
  end do
  u(1) = 100.0d0
  u(41) = 20.0d0

  do n = 1, 200
    u_new(1) = 100.0d0
    u_new(41) = 20.0d0
    do i = 2, 40
      u_new(i) = u(i) + r * (u(i + 1) - 2.0d0 * u(i) + u(i - 1))
    end do
    do i = 1, 41
      u(i) = u_new(i)
    end do
  end do

  t_mid = u(21)
end subroutine heat1d_step
