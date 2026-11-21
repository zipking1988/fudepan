import { describe, expect, it } from "vitest";

import { readFirstBytes } from "./upload-store";

function chunked(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      // Left open on purpose: a real download would still be streaming.
    },
  });
}

describe("readFirstBytes", () => {
  it("reads only the requested bytes, across chunks", async () => {
    expect(await readFirstBytes(chunked([1, 2], [3, 4, 5], [6]), 4)).toEqual(
      Uint8Array.from([1, 2, 3, 4]),
    );
  });

  it("returns what exists when the object is shorter", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([9, 8]));
        controller.close();
      },
    });
    expect(await readFirstBytes(stream, 16)).toEqual(Uint8Array.from([9, 8]));
  });

  it("does not hang on a teed body (how Next.js wraps fetch responses)", async () => {
    const [mine] = chunked([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).tee();
    const result = await Promise.race([
      readFirstBytes(mine, 3),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1000)),
    ]);
    expect(result).toEqual(Uint8Array.from([0xff, 0xd8, 0xff]));
  });
});
