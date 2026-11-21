import { describe, expect, it } from "vitest";

import { buildNoteObjectPath, isNoteObjectPathFor, parseNoteObjectPath } from "./storage-path";

const HOUSEHOLD = "d0000000-0000-4000-8000-000000000001";
const OTHER_HOUSEHOLD = "e0000000-0000-4000-8000-000000000001";
const NOTE = "a1b2c3d4-0000-4000-8000-00000000abcd";
const NOW = new Date("2026-11-21T09:12:00.000Z");

describe("buildNoteObjectPath", () => {
  it("puts the file under its household and note, with a server-chosen name", () => {
    expect(buildNoteObjectPath(HOUSEHOLD, NOTE, "image/jpeg", NOW)).toBe(
      `${HOUSEHOLD}/${NOTE}/${NOW.getTime()}-note.jpg`,
    );
    expect(buildNoteObjectPath(HOUSEHOLD, NOTE, "image/png", NOW)).toMatch(/-note\.png$/);
    expect(buildNoteObjectPath(HOUSEHOLD, NOTE, "image/webp", NOW)).toMatch(/-note\.webp$/);
  });

  it("refuses anything that is not a canonical UUID", () => {
    expect(() => buildNoteObjectPath("../etc", NOTE, "image/jpeg", NOW)).toThrow();
    expect(() => buildNoteObjectPath(HOUSEHOLD, NOTE.toUpperCase(), "image/jpeg", NOW)).toThrow();
    expect(() => buildNoteObjectPath(`${HOUSEHOLD}/x`, NOTE, "image/jpeg", NOW)).toThrow();
  });
});

describe("parseNoteObjectPath and isNoteObjectPathFor", () => {
  const path = buildNoteObjectPath(HOUSEHOLD, NOTE, "image/png", NOW);

  it("round-trips a generated path", () => {
    expect(parseNoteObjectPath(path)).toEqual({
      householdId: HOUSEHOLD,
      noteId: NOTE,
      contentType: "image/png",
    });
    expect(isNoteObjectPathFor(path, HOUSEHOLD, NOTE)).toBe(true);
  });

  it("rejects another household's folder or another note", () => {
    expect(isNoteObjectPathFor(path, OTHER_HOUSEHOLD, NOTE)).toBe(false);
    expect(isNoteObjectPathFor(path, HOUSEHOLD, "a1b2c3d4-0000-4000-8000-00000000ffff")).toBe(
      false,
    );
  });

  it.each([
    `${HOUSEHOLD}/${NOTE}/../${OTHER_HOUSEHOLD}/x-note.jpg`,
    `${HOUSEHOLD}/${NOTE}/1763716320000-mom-insulin.jpg`,
    `${HOUSEHOLD}/${NOTE}/1763716320000-note.gif`,
    `/${HOUSEHOLD}/${NOTE}/1763716320000-note.jpg`,
    `${HOUSEHOLD}/${NOTE}/1763716320000-note.jpg?x=1`,
    `${HOUSEHOLD}/1763716320000-note.jpg`,
    "",
  ])("rejects malformed path %#", (bad) => {
    expect(parseNoteObjectPath(bad)).toBeNull();
    expect(isNoteObjectPathFor(bad, HOUSEHOLD, NOTE)).toBe(false);
  });
});
