/**
 * Shown while a page waits for the session. The member's language is not known yet, so both
 * languages are written out. Pure and static.
 */
export function LoadingStatus() {
  return (
    <p role="status">
      <span lang="en">Loading…</span> <span lang="ja">読み込み中…</span>
    </p>
  );
}
