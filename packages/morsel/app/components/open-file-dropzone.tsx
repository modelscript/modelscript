import { UploadIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import { useCallback } from "react";
import { useDropzone } from "react-dropzone";

interface OpenFileDropzoneProps {
  onFileContent: (content: string) => void;
  colorMode: string;
}

export default function OpenFileDropzone({ onFileContent, colorMode }: OpenFileDropzoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          if (content) {
            onFileContent(content);
          }
        };
        reader.readAsText(file);
      }
    },
    [onFileContent],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/x-modelica": [".mo"],
      "text/plain": [".mo", ".txt"],
    },
    maxFiles: 1,
  });

  return (
    <div
      {...getRootProps()}
      style={{
        border: "2px dashed",
        borderColor: isDragActive ? "#0969da" : colorMode === "dark" ? "#30363d" : "#d0d7de",
        borderRadius: 6,
        padding: 32,
        textAlign: "center",
        cursor: "pointer",
        backgroundColor: isDragActive
          ? colorMode === "dark"
            ? "rgba(56,139,253,0.1)"
            : "#ddf4ff"
          : colorMode === "dark"
            ? "#0d1117"
            : "#f6f8fa",
        transition: "all 0.2s",
      }}
    >
      <input {...getInputProps()} />
      <UploadIcon size={32} />
      <Heading as="h4" sx={{ mt: 2, mb: 1 }}>
        {isDragActive ? "Drop the file here" : "Drag & drop a Modelica file here"}
      </Heading>
      <Text color="fg.muted">or click to select a file</Text>
    </div>
  );
}
