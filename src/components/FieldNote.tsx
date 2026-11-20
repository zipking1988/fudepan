/** A short warning shown right under the field it is about. Icon plus text, not color alone. */
export function FieldNote({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-2 flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-lg text-amber">
      <span aria-hidden="true">⚠</span>
      <span>{children}</span>
    </p>
  );
}
