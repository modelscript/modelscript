// SPDX-License-Identifier: AGPL-3.0-or-later

declare module "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow" {
  const vtkFullScreenRenderWindow: {
    newInstance(opts?: Record<string, unknown>): Record<string, unknown>;
  };
  export default vtkFullScreenRenderWindow;
}

declare module "@kitware/vtk.js/Rendering/Core/Actor" {
  const vtkActor: {
    newInstance(opts?: Record<string, unknown>): Record<string, unknown>;
  };
  export default vtkActor;
}

declare module "@kitware/vtk.js/Rendering/Core/Mapper" {
  const vtkMapper: {
    newInstance(opts?: Record<string, unknown>): Record<string, unknown>;
  };
  export default vtkMapper;
}

declare module "@kitware/vtk.js/IO/XML/XMLImageDataReader" {
  const vtkXMLImageDataReader: {
    newInstance(opts?: Record<string, unknown>): Record<string, unknown>;
  };
  export default vtkXMLImageDataReader;
}

declare module "@kitware/vtk.js/Filters/General/ImageMarchingCubes" {
  const vtkImageMarchingCubes: {
    newInstance(opts?: Record<string, unknown>): Record<string, unknown>;
  };
  export default vtkImageMarchingCubes;
}

declare module "@kitware/vtk.js/Rendering/Core/ColorTransferFunction" {
  const vtkColorTransferFunction: {
    newInstance(opts?: Record<string, unknown>): Record<string, unknown>;
  };
  export default vtkColorTransferFunction;
}
