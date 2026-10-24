import type { Opened, Snapshot, SaveResult, SavedDocument } from "./api";
import { sourceReason } from "./fidelity";
import { formatForPath, type DocumentFormat } from "./formats";
export type Mode = "rendered" | "source";
export interface Document {
  path: string;
  format: DocumentFormat;
  text: string;
  disk: Snapshot;
  revision: number;
  mode: Mode;
  reason?: string;
  previewOnly?: boolean;
  review?: Snapshot;
  pending?: { snapshot: Snapshot | null; error: string | null };
  saving: boolean;
  notice: string;
}
export const dirty = (doc: Document) => doc.text !== doc.disk.text;
function rendering(path: string, text: string, mode: Mode) {
  const editReason = mode === "rendered" && formatForPath(path) === "markdown"
    ? sourceReason(text)
    : undefined;
  // Mermaid can be read in the sandbox, but must not enter the rich editor.
  const reason = editReason ? sourceReason(text, true) : undefined;
  return { mode: reason ? "source" as const : mode, reason, previewOnly: !!editReason && !reason };
}
export interface Transport {
  read(path: string): Promise<Snapshot>;
  save(path: string, expected: string, text: string): Promise<SaveResult>;
}

export class Documents {
  docs: Document[] = [];
  private listeners = new Set<() => void>();
  private reads = new Map<string, number>();
  constructor(private transport: Transport) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.docs;
  get = (path: string) => this.docs.find((d) => d.path === path);
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  update(path: string, change: Partial<Document>) {
    this.docs = this.docs.map((d) =>
      d.path === path ? { ...d, ...change } : d,
    );
    this.emit();
  }
  open(file: Opened, mode: Mode = "rendered") {
    if (this.get(file.path)) return;
    this.docs = [
      ...this.docs,
      {
        path: file.path,
        format: formatForPath(file.path) ?? "markdown",
        text: file.snapshot.text,
        disk: file.snapshot,
        revision: 0,
        ...rendering(file.path, file.snapshot.text, mode),
        saving: false,
        notice: "",
      },
    ];
    this.emit();
  }
  setMode(path: string, mode: Mode) {
    const doc = this.get(path);
    if (doc) this.update(path, rendering(path, doc.text, mode));
  }
  restore(saved: SavedDocument) {
    if (this.get(saved.path)) return;
    this.open({ path: saved.path, parent: "", snapshot: saved.disk }, "source");
    this.edit(saved.path, saved.text);
    this.setMode(saved.path, saved.mode);
    this.update(saved.path, { notice: "Restored session" });
  }
  edit(path: string, text: string) {
    const doc = this.get(path);
    if (!doc || doc.text === text) return;
    this.update(path, { text, revision: doc.revision + 1, notice: "", reason: undefined });
  }
  remove(path: string) {
    this.bump(path);
    this.docs = this.docs.filter((d) => d.path !== path);
    this.emit();
  }
  private bump(path: string) {
    const n = (this.reads.get(path) ?? 0) + 1;
    this.reads.set(path, n);
    return n;
  }
  async refresh(path: string, discard = false) {
    const before = this.get(path);
    if (!before) return;
    const token = this.bump(path);
    try {
      const disk = await this.transport.read(path);
      const doc = this.get(path);
      if (
        !doc ||
        token !== this.reads.get(path) ||
        doc.disk.hash !== before.disk.hash
      )
        return;
      if (discard && doc.revision !== before.revision)
        throw new Error("The draft changed during reload. Try again.");
      if (disk.hash === doc.disk.hash && !discard && !doc.pending) return;
      if (discard || !dirty(doc) || disk.text === doc.text) {
        this.update(path, {
          disk,
          text: disk.text,
          ...rendering(path, disk.text, doc.mode),
          review: !discard && disk.hash !== doc.disk.hash ? doc.disk : doc.review,
          pending: undefined,
          revision: doc.revision + (doc.text === disk.text ? 0 : 1),
          notice: disk.hash !== doc.disk.hash ? "Updated from disk" : "",
        });
      } else {
        this.update(path, {
          pending: { snapshot: disk, error: null },
          notice: "",
        });
      }
    } catch (e) {
      if (token === this.reads.get(path) && this.get(path))
        this.update(path, {
          pending: {
            snapshot: this.get(path)?.pending?.snapshot ?? null,
            error: String(e),
          },
        });
      if (discard) throw e;
    }
  }
  async save(path: string, reviewed?: Snapshot): Promise<boolean> {
    const before = this.get(path);
    if (!before || before.saving) return false;
    this.bump(path);
    this.update(path, { saving: true });
    try {
      const result = await this.transport.save(
        path,
        reviewed?.hash ?? before.disk.hash,
        before.text,
      );
      const doc = this.get(path);
      if (!doc) return false;
      this.bump(path);
      if (result.kind === "conflict") {
        this.update(path, {
          pending: {
            snapshot: result.snapshot ?? doc.pending?.snapshot ?? null,
            error: result.error,
          },
          notice: "",
        });
        return false;
      }
      this.update(path, {
        disk: result.snapshot,
        pending: undefined,
        notice:
          doc.text === before.text
            ? "Saved"
            : "Earlier revision saved; draft has newer edits",
      });
      await this.refresh(path);
      const current = this.get(path);
      return !!current && !dirty(current) && !current.pending;
    } finally {
      if (this.get(path)) this.update(path, { saving: false });
    }
  }
}
