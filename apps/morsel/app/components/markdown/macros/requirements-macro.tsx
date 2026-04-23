interface RequirementsMacroProps {
  target?: string;
}

export function RequirementsMacro(props: RequirementsMacroProps) {
  return (
    <div className="requirements-macro my-2 p-4 border rounded bg-gray-50 text-sm">
      <h4 className="font-semibold mb-2">Requirements: {props.target || "All"}</h4>
      <table className="w-full text-left">
        <thead>
          <tr>
            <th className="border-b px-2 py-1">ID</th>
            <th className="border-b px-2 py-1">Text</th>
            <th className="border-b px-2 py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-2 py-1 text-gray-500 italic" colSpan={3}>
              Verification data will be populated by the backend...
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
