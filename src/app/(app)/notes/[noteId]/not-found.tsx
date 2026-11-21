import Link from "next/link";

/** Same page for "does not exist" and "another household's note", so neither is revealed. */
export default function NoteNotFound() {
  return (
    <>
      <h1 className="app-title">Note not found</h1>
      <p className="app-lede">
        This note doesn&apos;t exist, or it belongs to a household you are not part of.
      </p>
      <p className="mt-6">
        <Link href="/notes" className="app-link">
          Go to your household&apos;s notes
        </Link>
      </p>
    </>
  );
}
