import { createServer, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { validFeedback, promptFor, type Feedback } from './protocol';

export type Receipt = { id: string; status: 'received' | 'accepted' | 'duplicate'; delivery: 'submitted' | 'queued' | 'consumed' };
type Record = { digest: string; receipt: Receipt };
export const registryDirectory = () => `/tmp/sidelit-pi-${process.getuid?.()}`;

export default function sidelit(pi: ExtensionAPI) {
  let server: ReturnType<typeof createServer> | undefined;
  let registration: { id: string; socketPath: string; projectRoot: string; sessionId?: string; blockId?: string; label: string; process: string; busy: boolean; pid: number; piSessionId: string } | undefined;
  let context: ExtensionContext;
  let seen = new Map<string, Record>();
  const sockets = new Set<Socket>();
  let writes = Promise.resolve();
  const publish = (busy: boolean) => {
    if (!registration) return writes;
    registration.busy = busy;
    const file = registration.socketPath + '.json', json = JSON.stringify(registration);
    writes = writes.then(async () => {
      await writeFile(file + '.tmp', json, { mode: 0o600 });
      await rename(file + '.tmp', file);
    });
    return writes;
  };
  const stop = async () => {
    const current = registration; registration = undefined;
    for (const socket of sockets) socket.destroy();
    if (server) { const closing = server; server = undefined; await new Promise<void>(resolve => closing.close(() => resolve())); }
    await writes.catch(() => {}); writes = Promise.resolve();
    if (current) await Promise.all([current.socketPath, current.socketPath + '.json', current.socketPath + '.json.tmp'].map(p => unlink(p).catch(() => {})));
    seen.clear();
  };
  const saveRecord = (id: string, record: Record) => {
    seen.set(id, record);
    pi.appendEntry('sidelit_feedback_receipt', { id, ...record });
  };
  const accept = (value: unknown) => {
    if (!context || !registration) throw new Error('Pi session is closing');
    if (value && typeof value === 'object' && 'op' in value && value.op === 'ping') return { id: (value as { id?: string }).id, status: 'ready', protocol: 1, busy: !context.isIdle(), pid: process.pid };
    if (value && typeof value === 'object' && 'op' in value && value.op === 'status') {
      const record = seen.get(String((value as { id?: string }).id));
      if (!record) throw new Error('No receipt for that message in this Pi session');
      return record.receipt;
    }
    if (!validFeedback(value, registration.projectRoot)) throw new Error('Invalid feedback or different project');
    const message: Feedback = value;
    const digest = createHash('sha256').update(JSON.stringify(message)).digest('hex');
    const previous = seen.get(message.id);
    if (previous) {
      if (previous.digest !== digest) throw new Error('Message ID was already used with different content');
      return { ...previous.receipt, status: previous.receipt.status === 'accepted' ? 'duplicate' : 'received' };
    }
    if (seen.size >= 2000) throw new Error('Session feedback limit reached; start a new Pi session');
    const receipt: Receipt = { id: message.id, status: 'received', delivery: context.isIdle() ? 'submitted' : 'queued' };
    saveRecord(message.id, { digest, receipt });
    // The API is void: only message_start below proves Pi consumed the instruction.
    pi.sendUserMessage(promptFor(message), { deliverAs: 'followUp' });
    return receipt;
  };
  const start = async (ctx: ExtensionContext) => {
    await stop(); context = ctx;
    if (!process.getuid) throw new Error('Sidelit currently requires macOS or Linux');
    const directory = registryDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid() || (metadata.mode & 0o077)) throw new Error('Unsafe Sidelit registry directory');
    const session = ctx.sessionManager.getSessionId();
    const id = createHash('sha256').update(`${process.pid}:${session}`).digest('hex').slice(0, 32);
    registration = { id, socketPath: join(directory, id + '.sock'), projectRoot: await realpath(ctx.cwd), sessionId: process.env.REX_SESSION, blockId: process.env.REX_BLOCK, label: `Pi · ${basename(ctx.cwd)} · ${session.slice(0, 8)}`, process: 'pi', pid: process.pid, piSessionId: session, busy: !ctx.isIdle() };
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === 'custom' && entry.customType === 'sidelit_feedback_receipt') {
        const data = entry.data as { id?: string; digest?: string; receipt?: Receipt };
        if (data?.id && data.digest && data.receipt) seen.set(data.id, { digest: data.digest, receipt: data.receipt });
      }
    }
    server = createServer(socket => {
      sockets.add(socket); socket.setTimeout(3000, () => socket.destroy());
      let bytes = 0, buffer = '', handled = false; const decoder = new StringDecoder('utf8');
      socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
      socket.on('data', chunk => {
        if (handled) return;
        bytes += chunk.length; if (bytes > 32 * 1024) { socket.destroy(); return; }
        buffer += decoder.write(chunk);
        const newline = buffer.indexOf('\n'); if (newline < 0) return;
        handled = true;
        let id = '';
        try {
          const value = JSON.parse(buffer.slice(0, newline)); id = typeof value.id === 'string' ? value.id.slice(0, 128) : '';
          socket.end(JSON.stringify(accept(value)) + '\n');
        } catch (error) { socket.end(JSON.stringify({ id, status: 'error', error: String(error) }) + '\n'); }
      });
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(registration!.socketPath, resolve); });
    await chmod(registration.socketPath, 0o600); await publish(!ctx.isIdle());
  };
  pi.on('session_start', async (_event, ctx) => { try { await start(ctx); } catch (error) { await stop(); ctx.ui.notify(`Sidelit bridge: ${String(error)}`, 'error'); } });
  pi.on('session_shutdown', stop);
  pi.on('agent_start', () => publish(true));
  pi.on('agent_settled', () => publish(false));
  pi.on('message_start', event => {
    if (event.message.role !== 'user') return;
    const content = event.message.content;
    const text = typeof content === 'string' ? content : content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    const id = /^Sidelit feedback \[([a-zA-Z0-9_.:-]+)\]/.exec(text)?.[1];
    const record = id && seen.get(id);
    if (id && record) saveRecord(id, { ...record, receipt: { id, status: 'accepted', delivery: 'consumed' } });
  });
  pi.registerCommand('sidelit-status', { description: 'Show the Sidelit feedback bridge status', handler: async (_args, ctx) => { ctx.ui.notify(registration ? `Sidelit connected for ${registration.projectRoot}` : 'Sidelit bridge is not running', 'info'); } });
}
