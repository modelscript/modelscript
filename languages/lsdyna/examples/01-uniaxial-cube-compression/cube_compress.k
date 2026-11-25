*KEYWORD
*TITLE
Uniaxial Elastic Compression of 100mm Steel Cube
$ Units: m, kg, s, N, Pa
*NODE
1, 0.0, 0.0, 0.0, 0, 0
2, 0.1, 0.0, 0.0, 0, 0
3, 0.1, 0.1, 0.0, 0, 0
4, 0.0, 0.1, 0.0, 0, 0
5, 0.0, 0.0, 0.1, 0, 0
6, 0.1, 0.0, 0.1, 0, 0
7, 0.1, 0.1, 0.1, 0, 0
8, 0.0, 0.1, 0.1, 0, 0
*ELEMENT_SOLID
1, 1, 1, 2, 3, 4, 5, 6, 7, 8
*PART
Steel Cube
1, 1, 1, 0, 0, 0, 0, 0
*SECTION_SOLID
1, 1
*MAT_ELASTIC
1, 7850.0, 2.1e11, 0.3
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 0, 0, 0
2, 0, 0, 1, 1, 0, 0, 0
3, 0, 0, 0, 1, 0, 0, 0
4, 0, 1, 0, 1, 0, 0, 0
*DEFINE_CURVE
1, 0, 1.0, 1.0, 0.0, 0.0
0.0, 0.0
0.002, 1.0
0.01, 1.0
*LOAD_NODE_POINT
5, 3, 1, -25000.0
6, 3, 1, -25000.0
7, 3, 1, -25000.0
8, 3, 1, -25000.0
*CONTROL_TERMINATION
0.01, 0, 0.0, 0.0, 0.0
*CONTROL_TIMESTEP
0.0, 0.9, 0, 0.0, 0.0
*DATABASE_GLSTAT
0.0005
*END
