import readme from "../README.md?raw";
import { describe, expect, it, vi } from "vitest";
import { Documents, dirty, type Transport } from "../src/documents";
import { sourceReason, lineEndings, frontmatter, replaceBody } from "../src/fidelity";
import * as fidelity from "../src/fidelity";
import type { Snapshot, SaveResult } from "../src/api";
const snap = (text: string): Snapshot => ({ text, hash: text });
function setup(text = "# Original\r\n") {
  let disk = snap(text);
  const io: Transport = {
    read: async () => disk,
    save: async (_p, expected, text) =>
      expected === disk.hash
        ? { kind: "saved", snapshot: (disk = snap(text)) }
        : { kind: "conflict", snapshot: disk, error: null },
  };
  const store = new Documents(io);
  store.open({ path: "/a.md", parent: "/", snapshot: disk });
  return {
    store,
    io,
    disk: (text: string) => {
      disk = snap(text);
    },
  };
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
describe("canonical buffers", () => {
  it.each([
    "# Hello\r\n\r\n- one\r\n",
    "---\r\ntitle: Keep\r\n---\r\n# Hi\r\n",
    "<script>alert(1)</script>\n",
    "$$x^2$$\n",
    "```mermaid\ngraph LR; A-->B\n```\n",
  ])("preserves bytes during open, modes, and no-op save: %s", async (text) => {
    const { store } = setup(text);
    store.update("/a.md", { mode: "source" });
    store.update("/a.md", { mode: "rendered" });
    expect(dirty(store.get("/a.md")!)).toBe(false);
    await store.save("/a.md");
    expect(store.get("/a.md")!.text).toBe(text);
  });
  it("retains drafts across tabs and modes", async () => {
    const { store } = setup();
    store.edit("/a.md", "# Rich edit");
    store.update("/a.md", { mode: "source" });
    store.open({ path: "/b.md", parent: "/", snapshot: snap("# B") });
    expect(store.get("/a.md")!.text).toBe("# Rich edit");
    store.edit("/a.md", "# Source edit");
    store.update("/a.md", { mode: "rendered" });
    await store.save("/a.md");
    expect(store.get("/a.md")!.disk.text).toBe("# Source edit");
    expect(dirty(store.get("/a.md")!)).toBe(false);
  });
  it("refreshes clean buffers and preserves dirty buffers in conflicts", async () => {
    const { store, disk } = setup();
    disk("# Agent");
    await store.refresh("/a.md");
    expect(store.get("/a.md")!.text).toBe("# Agent");
    store.edit("/a.md", "# Draft");
    disk("# Agent two");
    await store.refresh("/a.md");
    expect(store.get("/a.md")!.text).toBe("# Draft");
    expect(store.get("/a.md")!.pending?.snapshot?.text).toBe("# Agent two");
    await store.refresh("/a.md", true);
    expect(store.get("/a.md")!.text).toBe("# Agent two");
  });
  it("detects disk changes before watcher delivery", async () => {
    const { store, disk } = setup();
    store.edit("/a.md", "draft");
    disk("unseen external write");
    expect(await store.save("/a.md")).toBe(false);
    expect(store.get("/a.md")!.text).toBe("draft");
    expect(store.get("/a.md")!.pending?.snapshot?.text).toBe(
      "unseen external write",
    );
  });
  it("rejects stale reads and treats edits made during read as dirty", async () => {
    const { store, io } = setup();
    const first = deferred<Snapshot>();
    const second = deferred<Snapshot>();
    io.read = () => first.promise;
    const p1 = store.refresh("/a.md");
    io.read = () => second.promise;
    const p2 = store.refresh("/a.md");
    second.resolve(snap("new"));
    await p2;
    first.resolve(snap("old"));
    await p1;
    expect(store.get("/a.md")!.text).toBe("new");
    const third = deferred<Snapshot>();
    io.read = () => third.promise;
    const p3 = store.refresh("/a.md");
    store.edit("/a.md", "typed");
    third.resolve(snap("external"));
    await p3;
    expect(store.get("/a.md")!.text).toBe("typed");
    expect(store.get("/a.md")!.pending?.snapshot?.text).toBe("external");
  });
  it("save acknowledgments cannot replace newer in-memory edits", async () => {
    const { store, io } = setup();
    store.edit("/a.md", "submitted");
    const saving = deferred<SaveResult>();
    io.save = () => saving.promise;
    io.read = async () => snap("submitted");
    const task = store.save("/a.md");
    store.edit("/a.md", "newer draft");
    saving.resolve({ kind: "saved", snapshot: snap("submitted") });
    await task;
    expect(store.get("/a.md")!.text).toBe("newer draft");
    expect(store.get("/a.md")!.disk.text).toBe("submitted");
    expect(dirty(store.get("/a.md")!)).toBe(true);
  });
  it("preserves the buffer on deletion and refreshes after recreation", async () => {
    const { store, io } = setup();
    const initial = store.get("/a.md")!.text;
    io.read = async () => {
      throw new Error("Not found");
    };
    await store.refresh("/a.md");
    expect(store.get("/a.md")!.text).toBe(initial);
    expect(store.get("/a.md")!.pending?.error).toContain("Not found");
    io.read = async () => snap("recreated");
    await store.refresh("/a.md");
    expect(store.get("/a.md")!.text).toBe("recreated");
    expect(store.get("/a.md")!.pending).toBeUndefined();
  });
  it("retains a pending external snapshot when that file becomes unavailable", async () => {
    const { store, io, disk } = setup();
    store.edit("/a.md", "draft");
    disk("external");
    await store.refresh("/a.md");
    io.read = async () => {
      throw new Error("Deleted");
    };
    await store.refresh("/a.md");
    expect(store.get("/a.md")!.pending?.snapshot?.text).toBe("external");
    expect(store.get("/a.md")!.text).toBe("draft");
  });
  it("does not create duplicate tabs or reset a draft on repeated CLI requests", () => {
    const { store } = setup();
    store.edit("/a.md", "draft");
    store.open({ path: "/a.md", parent: "/", snapshot: snap("disk") });
    expect(store.docs).toHaveLength(1);
    expect(store.get("/a.md")!.text).toBe("draft");
  });
  it("does not restore a closed document after a delayed read", async () => {
    const { store, io } = setup();
    const pending = deferred<Snapshot>();
    io.read = () => pending.promise;
    const task = store.refresh("/a.md");
    store.remove("/a.md");
    pending.resolve(snap("late"));
    await task;
    expect(store.docs).toHaveLength(0);
  });
});
describe("review and recovery", () => {
  it("retains only the previous external disk version, not own saves", async () => {
    const { store, disk } = setup("first");
    disk("second");
    await store.refresh("/a.md");
    expect(store.get("/a.md")!.review?.text).toBe("first");
    await store.save("/a.md");
    expect(store.get("/a.md")!.review?.text).toBe("first");
    disk("third");
    await store.refresh("/a.md");
    expect(store.get("/a.md")!.review?.text).toBe("second");
  });
  it("saves a merged draft only against the explicitly reviewed version", async () => {
    const { store, disk } = setup("base");
    store.edit("/a.md", "draft");
    disk("agent");
    await store.refresh("/a.md");
    const reviewed = store.get("/a.md")!.pending!.snapshot!;
    store.edit("/a.md", "merged");
    disk("agent changed again");
    expect(await store.save("/a.md", reviewed)).toBe(false);
    expect(store.get("/a.md")!.text).toBe("merged");
    expect(store.get("/a.md")!.disk.text).toBe("base");
    const latest = store.get("/a.md")!.pending!.snapshot!;
    expect(await store.save("/a.md", latest)).toBe(true);
    expect(store.get("/a.md")!.disk.text).toBe("merged");
  });
  it("keeps comparison available if an external writer restores the baseline", async () => {
    const { store, disk } = setup("base");
    store.edit("/a.md", "draft");
    disk("agent");
    await store.refresh("/a.md");
    disk("base");
    await store.refresh("/a.md");
    const reviewed = store.get("/a.md")!.pending!.snapshot!;
    expect(reviewed.text).toBe("base");
    expect(await store.save("/a.md", reviewed)).toBe(true);
    expect(store.get("/a.md")!.text).toBe("draft");
  });
  it("restores drafts against their saved baseline, not the current disk", async () => {
    const { store, disk } = setup("base");
    store.remove("/a.md");
    disk("changed while away");
    store.restore({ path: "/a.md", text: "recovered draft", disk: snap("base"), mode: "rendered" });
    await store.refresh("/a.md");
    expect(store.get("/a.md")!.text).toBe("recovered draft");
    expect(store.get("/a.md")!.pending?.snapshot?.text).toBe("changed while away");
    store.restore({ path: "/a.md", text: "older checkpoint", disk: snap("base"), mode: "source" });
    expect(store.get("/a.md")!.text).toBe("recovered draft");
  });
  it("keeps Source selected after unsupported syntax is removed", () => {
    const { store } = setup("Price $5");
    expect(store.get("/a.md")!.mode).toBe("source");
    store.edit("/a.md", "Price 5");
    expect(store.get("/a.md")!.mode).toBe("source");
    store.setMode("/a.md", "rendered");
    expect(store.get("/a.md")!.mode).toBe("rendered");
  });
  it("does not run the Markdown parser for typing or unrelated updates", () => {
    const check = vi.spyOn(fidelity, "sourceReason");
    const { store } = setup("hello");
    expect(check).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 100; i++) store.edit("/a.md", `edit ${i}`);
    store.update("/a.md", { notice: "status" });
    expect(check).toHaveBeenCalledTimes(1);
    store.setMode("/a.md", "source");
    store.setMode("/a.md", "rendered");
    expect(check).toHaveBeenCalledTimes(2);
    check.mockRestore();
  });
});

describe("frontmatter", () => {
  it.each([
    "---\ntitle: 'Keep $ and <html>'\n# comment\n---\n\n",
    "+++\r\ntitle = \"Test\"\r\n+++\r\n\r\n",
    "---\r\ntags: [one, two]\r\n...\r\n",
  ])("keeps metadata bytes during body edits: %s", (prefix) => {
    const original = prefix + "# Original\n";
    expect(frontmatter(original).prefix).toBe(prefix);
    expect(sourceReason(original)).toBeUndefined();
    expect(replaceBody(original, "# Edited\n").startsWith(prefix)).toBe(true);
    expect(frontmatter(replaceBody(original, "# Edited\n")).prefix).toBe(prefix);
  });
  it("handles metadata-only files, mixed body syntax, and malformed delimiters", () => {
    const original = "---\ntitle: Test\n---";
    expect(replaceBody(original, "Body\n")).toBe(original + "\nBody\n");
    expect(sourceReason("---\ntitle: Test\n")).toContain("Unclosed");
    expect(sourceReason(original + "\n<script>bad</script>\n")).toBeTruthy();
    expect(frontmatter("plain text").body).toBe("plain text");
    expect(sourceReason("x".repeat(300_000))).toContain("Large");
  });
});

describe("fidelity gate", () => {
  it.each([
    "---\ntitle: Unclosed\n",
    "<div>hello</div>",
    "[x][ref]\n\n[ref]: https://example.org",
    "```mermaid\ngraph LR; A-->B\n```",
    "$$x$$",
    "`$HOME` then $x$",
    "```sh\necho $HOME\n```\n\n\\(x\\)",
    "`example`\n\n\\[x\\]",
    "`example`\n\n:::note\nContent\n:::",
    "`example`\n\n[^note]: Footnote",
    "```html\n<script>example</script>\n```\n\n<script>real</script>",
    "```sh title=example\necho $HOME\n```",
    "[x](javascript:alert)",
  ])("routes unsupported syntax to source: %s", (text) =>
    expect(sourceReason(text)).toBeTruthy(),
  );
  it.each([
    "```sh\necho \"$HOME\" \"$PWD\"\nexport PATH=\"$HOME/.local/bin:$PATH\"\n```",
    "Use `$HOME`, `\\(x\\)`, `\\[x\\]`, `[^note]`, and `:::note` literally.",
    "~~~text\n$x$\n\\(x\\)\n:::note\n[^note]: example\n~~~",
    "    echo $HOME\n    \\(x\\)\n    :::note\n",
    "> ```sh\n> echo $HOME\n> ```",
    "- Example:\n\n  ```sh\n  echo $HOME\n  ```",
    "```html\n<script>example</script>\n```",
    "`example`:::literal text",
  ])("keeps literal code renderable: %s", (text) =>
    expect(sourceReason(text)).toBeUndefined(),
  );
  it("opens the project README rendered without changing its bytes", async () => {
    const text = readme;
    const { store } = setup(text);
    expect(store.get("/a.md")!.mode).toBe("rendered");
    store.setMode("/a.md", "source");
    store.setMode("/a.md", "rendered");
    expect(store.get("/a.md")!.mode).toBe("rendered");
    await store.save("/a.md");
    expect(store.get("/a.md")!.text).toBe(text);
    expect(store.get("/a.md")!.disk.text).toBe(text);
    expect(dirty(store.get("/a.md")!)).toBe(false);
  });
  it("supports ordinary GFM and restores CRLF", () => {
    expect(
      sourceReason(
        "# Hello\n\n- [x] done\n\n|a|b|\n|-|-|\n|c|d|\n\n~~old~~ ![image](assets/test.png)",
      ),
    ).toBeUndefined();
    expect(lineEndings("# Hello\n", "old\r\n")).toBe("# Hello\r\n");
  });
});
