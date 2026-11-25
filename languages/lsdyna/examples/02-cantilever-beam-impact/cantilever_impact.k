*KEYWORD
*TITLE
Cantilever Steel Beam Transverse Tip Impact Transient
*NODE
1, 0.00, 0.0, 0.0, 0, 0
2, 0.25, 0.0, 0.0, 0, 0
3, 0.50, 0.0, 0.0, 0, 0
4, 0.75, 0.0, 0.0, 0, 0
5, 1.00, 0.0, 0.0, 0, 0
*ELEMENT_BEAM
1, 1, 1, 2, 0
2, 1, 2, 3, 0
3, 1, 3, 4, 0
4, 1, 4, 5, 0
*PART
Cantilever Steel Beam
1, 1, 1, 0, 0, 0, 0, 0
*SECTION_BEAM
1, 1, 1.0
0.04, 0.04, 0.04, 0.04
*MAT_ELASTIC
1, 7850.0, 2.1e11, 0.3
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 1, 1, 1
*DEFINE_CURVE
1, 0, 1.0, 1.0, 0.0, 0.0
0.0, 0.0
0.002, 1.0
0.004, 0.0
0.02, 0.0
*LOAD_NODE_POINT
5, 2, 1, -15000.0
*CONTROL_TERMINATION
0.02, 0, 0.0, 0.0, 0.0
*CONTROL_TIMESTEP
0.0, 0.9, 0, 0.0, 0.0
*DATABASE_GLSTAT
0.0005
*END
