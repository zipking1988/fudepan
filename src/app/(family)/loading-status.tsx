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

/**
 * Paper placeholder shown while a family page loads. Both languages are written out because the
 * member's language is not known yet. The pulse stops when the person asks for less motion.
 */
export function PaperLoading() {
  return (
    <div className="pb-loading" role="status" aria-live="polite">
      <div className="pb-loading__sheet" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>
        <span lang="ja">ご家族のメモを準備しています…</span> <span lang="en">Getting your family&apos;s notes ready…</span>
      </p>
    </div>
  );
}
