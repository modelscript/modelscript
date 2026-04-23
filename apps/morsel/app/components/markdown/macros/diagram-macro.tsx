import Diagram from "../../diagram.js";

interface DiagramMacroProps {
  model?: string;
  type?: string;
}

export function DiagramMacro(props: DiagramMacroProps) {
  // Integrate the existing Diagram component, parsing target string
  return (
    <div className="diagram-macro my-4 border rounded shadow-sm overflow-hidden" style={{ minHeight: "300px" }}>
      <Diagram />
    </div>
  );
}
