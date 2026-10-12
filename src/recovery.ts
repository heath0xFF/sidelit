import type { Session } from "./api";
import type { Documents } from "./documents";
import type { CloseApproval } from "./closing";

export function sessionSnapshot(documents: Documents, workspace: string, active: string, approvals: CloseApproval[] = []): Session {
  const discarded = new Set(approvals.filter((a) => a.discard).map((a) => a.path));
  const saved = documents.docs.filter((d) => !discarded.has(d.path)).map(({ path, text, disk, mode }) => ({ path, text, disk, mode }));
  return { documents: saved, workspace: workspace || null, active: saved.some((d) => d.path === active) ? active : saved.at(-1)?.path ?? null };
}

export class RecoveryWriter {
  private running = false;
  private pending?: Session;
  private timer?: ReturnType<typeof setTimeout>;
  private writes?: Promise<void>;
  constructor(private write: (session: Session) => Promise<void>, private report: (error: unknown) => void) {}
  start() { this.running = true; }
  queue(session: Session) {
    if (!this.running) return;
    this.pending = session;
    // A fixed interval also checkpoints continuous typing, not only idle drafts.
    if (!this.writes) this.timer ??= setTimeout(() => { void this.flush().catch(this.report); }, 500);
  }
  flush(session?: Session): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (session && this.running) this.pending = session;
    if (!this.writes && this.running && this.pending) {
      this.writes = Promise.resolve().then(async () => {
        while (this.running && this.pending) {
          const next = this.pending;
          this.pending = undefined;
          await this.write(next);
        }
      }).finally(() => {
        this.writes = undefined;
        if (this.pending && this.running) this.queue(this.pending);
      });
    }
    return this.writes ?? Promise.resolve();
  }
  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    await this.writes?.catch(() => {});
  }
}
