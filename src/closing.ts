import { Documents, dirty, type Document } from "./documents";

export interface CloseApproval {
  path: string;
  revision: number;
  discard: boolean;
}

export async function approveClose(
  documents: Documents,
  path: string,
  choose: (doc: Document) => Promise<string>,
): Promise<CloseApproval | undefined> {
  const before = documents.get(path);
  if (!before) return;
  if (before.saving) throw new Error("Wait for the save to finish.");
  let discard = false;
  if (dirty(before)) {
    const choice = await choose(before);
    if (choice === "Cancel") return;
    discard = choice === "Discard";
    if (discard && documents.get(path)?.revision !== before.revision)
      throw new Error("The draft changed during confirmation. Try again.");
    if (!discard && !(await documents.save(path))) return;
  }
  const current = documents.get(path);
  if (!current || current.saving || (!discard && dirty(current))) return;
  return { path, revision: current.revision, discard };
}

export function approvalsCurrent(documents: Documents, approvals: CloseApproval[], all = false) {
  return (!all || documents.docs.length === approvals.length) && approvals.every(
    (approval) => {
      const doc = documents.get(approval.path);
      return doc && doc.revision === approval.revision && !doc.saving;
    },
  );
}
