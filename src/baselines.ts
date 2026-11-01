import type { Snapshot } from "./api";
import type { Documents } from "./documents";

export interface BaselineStore {
  loadBaseline(path: string): Promise<Snapshot | null>;
  storeBaseline(path: string, text: string | null): Promise<void>;
}
const LOADING = Symbol("loading");
// Keeps "what you last reviewed" across closed tabs and restarts. Commit comparisons are not
// kept: the Changed list can always make them again, and HEAD may have moved by then.
export class Baselines {
  private known = new Map<string, string | null | typeof LOADING>();
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private documents: Documents, private store: BaselineStore, private report: (error: unknown) => void) {}
  sync() {
    const open = new Set<string>();
    for (const doc of this.documents.docs) {
      open.add(doc.path);
      const known = this.known.get(doc.path);
      if (known === LOADING) continue;
      if (known === undefined) { this.load(doc.path); continue; }
      const wanted = doc.reviewFrom === "disk" ? doc.review ?? null : null;
      if ((wanted?.hash ?? null) === known) continue;
      this.known.set(doc.path, wanted?.hash ?? null);
      this.write(doc.path, wanted?.text ?? null);
    }
    // A closed tab keeps its saved marks; reopening it reads them again.
    for (const path of this.known.keys()) if (!open.has(path)) this.known.delete(path);
  }
  private load(path: string) {
    this.known.set(path, LOADING);
    void this.store.loadBaseline(path).then((saved) => {
      if (!this.known.has(path)) return;
      this.known.set(path, saved?.hash ?? null);
      // A saved baseline is older than anything seen since this tab opened, so it wins.
      if (saved && this.documents.get(path)) this.documents.update(path, { review: saved, reviewFrom: "disk" });
      else this.sync();
    }).catch((error) => {
      this.known.set(path, null);
      this.report(error);
    });
  }
  private write(path: string, text: string | null) {
    this.writes = this.writes.then(() => this.store.storeBaseline(path, text)).catch((error) => {
      if (this.documents.get(path)) this.report(error);
    });
  }
  flush() { this.sync(); return this.writes; }
}
