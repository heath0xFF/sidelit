import { afterEach, expect, it, vi } from "vitest";
import { RecoveryWriter, sessionSnapshot } from "../src/recovery";
import { Documents } from "../src/documents";
import type { Session } from "../src/api";

const session = (text: string): Session => ({ documents: [{ path: "/a.md", text, disk: { text: "base", hash: "base" }, mode: "source" }], workspace: "/", active: "/a.md" });
afterEach(() => vi.useRealTimers());

it("checkpoints continuous input and serializes writes", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const first = new Promise<void>((resolve) => { release = resolve; });
  const write = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
  const writer = new RecoveryWriter(write, () => {});
  writer.start();
  writer.queue(session("first"));
  await vi.advanceTimersByTimeAsync(300);
  writer.queue(session("latest before interval"));
  await vi.advanceTimersByTimeAsync(200);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][0].documents[0].text).toBe("latest before interval");
  writer.queue(session("second"));
  await vi.advanceTimersByTimeAsync(500);
  expect(write).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 20; i++) {
    writer.queue(session(`latest ${i}`));
    await vi.advanceTimersByTimeAsync(500);
  }
  release();
  await writer.flush();
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][0].documents[0].text).toBe("latest 19");
  await writer.stop();
});

it("turning recovery off cancels pending checkpoints", async () => {
  vi.useFakeTimers();
  const write = vi.fn().mockResolvedValue(undefined);
  const writer = new RecoveryWriter(write, () => {});
  writer.start(); writer.queue(session("private"));
  await writer.stop();
  writer.queue(session("must not return"));
  await vi.runAllTimersAsync();
  expect(write).not.toHaveBeenCalled();
});

it("reports failures and permits the next checkpoint", async () => {
  vi.useFakeTimers();
  const report = vi.fn();
  const write = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValue(undefined);
  const writer = new RecoveryWriter(write, report);
  writer.start(); writer.queue(session("first"));
  await vi.advanceTimersByTimeAsync(500);
  expect(report).toHaveBeenCalledOnce();
  await writer.flush(session("retry"));
  expect(write).toHaveBeenCalledTimes(2);
  await writer.stop();
});

it("does not restore explicitly discarded drafts after a normal quit", () => {
  const docs = new Documents({ read: async () => { throw new Error(); }, save: async () => { throw new Error(); } });
  docs.restore(session("discarded").documents[0]);
  const saved = sessionSnapshot(docs, "/", "/a.md", [{ path: "/a.md", revision: 1, discard: true }]);
  expect(saved.documents).toHaveLength(0);
  expect(saved.active).toBeNull();
});
