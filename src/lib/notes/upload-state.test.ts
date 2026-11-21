import { describe, expect, it } from "vitest";

import {
  NO_FILE_ERROR,
  initialUploadState,
  isUploadBusy,
  uploadReducer,
  type UploadEvent,
  type UploadState,
} from "./upload-state";

type F = { name: string };
const photo: F = { name: "note.jpg" };
const other: F = { name: "other.png" };
const problem = { code: "too_large", message: "This photo is 12 MB." };

function run(events: UploadEvent<F>[], from: UploadState<F> = initialUploadState<F>()) {
  return events.reduce(uploadReducer<F>, from);
}

describe("upload state", () => {
  it("starts idle with no file", () => {
    expect(initialUploadState()).toEqual({ status: "idle", file: null });
  });

  it("goes idle → validating → uploading → uploaded", () => {
    const states = [
      run([{ type: "select", file: photo }]),
      run([{ type: "select", file: photo }, { type: "submit" }]),
      run([{ type: "select", file: photo }, { type: "submit" }, { type: "validated" }]),
      run([
        { type: "select", file: photo },
        { type: "submit" },
        { type: "validated" },
        { type: "succeeded", noteId: "n1" },
      ]),
    ];
    expect(states.map((s) => s.status)).toEqual(["idle", "validating", "uploading", "uploaded"]);
    expect(states[3]).toEqual({ status: "uploaded", file: null, noteId: "n1" });
  });

  it("asks for a file when submitted without one", () => {
    expect(run([{ type: "submit" }])).toEqual({
      status: "failed",
      file: null,
      error: NO_FILE_ERROR,
    });
  });

  it("keeps the selected file when validation fails", () => {
    const state = run([
      { type: "select", file: photo },
      { type: "submit" },
      { type: "failed", error: problem },
    ]);
    expect(state).toEqual({ status: "failed", file: photo, error: problem });
  });

  it("keeps the selected file when the upload fails, and retries with it", () => {
    const failed = run([
      { type: "select", file: photo },
      { type: "submit" },
      { type: "validated" },
      { type: "failed", error: problem },
    ]);
    expect(failed).toMatchObject({ status: "failed", file: photo });

    const retried = uploadReducer(failed, { type: "submit" });
    expect(retried).toEqual({ status: "validating", file: photo });
  });

  it("lets the person pick a different file after a failure", () => {
    const state = run([
      { type: "select", file: photo },
      { type: "submit" },
      { type: "failed", error: problem },
      { type: "select", file: other },
    ]);
    expect(state).toEqual({ status: "idle", file: other });
  });

  it("is busy (submit disabled) only while validating or uploading", () => {
    const busy = (events: UploadEvent<F>[]) => isUploadBusy(run(events));
    expect(busy([])).toBe(false);
    expect(busy([{ type: "select", file: photo }, { type: "submit" }])).toBe(true);
    expect(busy([{ type: "select", file: photo }, { type: "submit" }, { type: "validated" }])).toBe(
      true,
    );
    expect(busy([{ type: "submit" }])).toBe(false);
  });

  it("ignores a second submit, a new file, or a reset while uploading", () => {
    const uploading = run([
      { type: "select", file: photo },
      { type: "submit" },
      { type: "validated" },
    ]);
    expect(uploadReducer(uploading, { type: "submit" })).toBe(uploading);
    expect(uploadReducer(uploading, { type: "select", file: other })).toBe(uploading);
    expect(uploadReducer(uploading, { type: "reset" })).toBe(uploading);
  });

  it("ignores events that do not fit the current state", () => {
    const idle = run([{ type: "select", file: photo }]);
    expect(uploadReducer(idle, { type: "validated" })).toBe(idle);
    expect(uploadReducer(idle, { type: "succeeded", noteId: "n1" })).toBe(idle);
    expect(uploadReducer(idle, { type: "failed", error: problem })).toBe(idle);
    const validating = run([{ type: "select", file: photo }, { type: "submit" }]);
    expect(uploadReducer(validating, { type: "succeeded", noteId: "n1" })).toBe(validating);
  });

  it("starts over after a successful upload", () => {
    const uploaded = run([
      { type: "select", file: photo },
      { type: "submit" },
      { type: "validated" },
      { type: "succeeded", noteId: "n1" },
    ]);
    expect(uploadReducer(uploaded, { type: "submit" })).toBe(uploaded);
    expect(uploadReducer(uploaded, { type: "reset" })).toEqual({ status: "idle", file: null });
  });
});
