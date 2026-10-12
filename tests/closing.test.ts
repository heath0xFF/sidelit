import { expect, it } from "vitest";
import { Documents } from "../src/documents";
import { approveClose, approvalsCurrent, type CloseApproval } from "../src/closing";

function setup() {
  const store = new Documents({ read: async () => ({ text: "base", hash: "base" }), save: async () => { throw new Error("Not used"); } });
  for (const path of ["/a.md", "/b.md"]) store.open({ path, parent: "/", snapshot: { text: "base", hash: "base" } });
  return store;
}

it("checks live tab state after an earlier confirmation", async () => {
  const store = setup();
  store.edit("/a.md", "draft a");
  const asked: string[] = [];
  const approvals: CloseApproval[] = [];
  for (const old of [...store.docs]) {
    const approved = await approveClose(store, old.path, async (current) => {
      asked.push(current.path);
      if (current.path === "/a.md") store.edit("/b.md", "new draft b");
      return current.path === "/a.md" ? "Discard" : "Cancel";
    });
    if (!approved) break;
    approvals.push(approved);
  }
  expect(asked).toEqual(["/a.md", "/b.md"]);
  expect(approvalsCurrent(store, approvals, true)).toBe(false);
  expect(store.get("/b.md")!.text).toBe("new draft b");
});

it("rejects edits and new tabs after approval, including during a final checkpoint", async () => {
  const store = setup();
  const approvals = (await Promise.all(store.docs.map((d) => approveClose(store, d.path, async () => "Cancel")))) as CloseApproval[];
  expect(approvalsCurrent(store, approvals, true)).toBe(true);
  store.edit("/a.md", "late draft");
  expect(approvalsCurrent(store, approvals, true)).toBe(false);
  const other = setup();
  other.open({ path: "/c.md", parent: "/", snapshot: { text: "base", hash: "base" } });
  expect(approvalsCurrent(other, approvals, true)).toBe(false);
});

it("does not discard edits newer than the displayed prompt", async () => {
  const store = setup();
  store.edit("/a.md", "first draft");
  await expect(approveClose(store, "/a.md", async () => {
    store.edit("/a.md", "newer draft");
    return "Discard";
  })).rejects.toThrow("changed during confirmation");
  expect(store.get("/a.md")!.text).toBe("newer draft");
});

it("does not close a document with a save in progress", async () => {
  const store = setup();
  store.update("/a.md", { saving: true });
  await expect(approveClose(store, "/a.md", async () => "Discard")).rejects.toThrow("save to finish");
});
