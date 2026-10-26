import { afterEach, describe, expect, it } from 'vitest';
import { createConnection } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { validFeedback, promptFor } from '../extensions/pi-sidelit/protocol';

let shutdown: (() => Promise<void>) | undefined;
afterEach(async () => { await shutdown?.(); shutdown = undefined; });
const message = () => ({ id: randomUUID(), source: 'sidelit' as const, projectRoot: '/tmp', document: { path: '/tmp/test.mdx', format: 'mdx' }, selection: { type: 'element', text: '导航', selector: 'nav.site-header', styles: { padding: '32px' } }, instruction: 'Reduce padding' });
async function exchange(path: string, value: unknown, fragmented = false): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path); let result = '';
    socket.setTimeout(3000, () => socket.destroy(Error('timeout'))); socket.on('error', reject);
    socket.on('connect', () => { const bytes = Buffer.from(JSON.stringify(value) + '\n'); if (fragmented) for (const byte of bytes) socket.write(Buffer.from([byte])); else socket.write(bytes); });
    socket.on('data', chunk => result += chunk.toString()); socket.on('end', () => { try { resolve(JSON.parse(result)); } catch (error) { reject(error); } });
  });
}
describe('Pi socket bridge', () => {
  it('bounds batches and rejects mixed projects, duplicate IDs, invalid notes and nested batches', () => {
    const batch = { id: 'batch', source: 'sidelit', projectRoot: '/tmp', notes: [message(), message()] };
    expect(validFeedback(batch, '/tmp')).toBe(true);
    expect(validFeedback({ ...batch, notes: [] }, '/tmp')).toBe(false);
    expect(validFeedback({ ...batch, notes: [batch] }, '/tmp')).toBe(false);
    expect(validFeedback({ ...batch, notes: [batch.notes[0], batch.notes[0]] }, '/tmp')).toBe(false);
    expect(validFeedback({ ...batch, notes: [{ ...message(), id: 'batch' }] }, '/tmp')).toBe(false);
    expect(validFeedback({ ...batch, notes: [message(), { ...message(), projectRoot: '/tmp/other' }] }, '/tmp')).toBe(false);
    expect(validFeedback({ ...batch, notes: [message(), { ...message(), selection: { type: 'bogus', text: '' } }] }, '/tmp')).toBe(false);
    expect(validFeedback({ ...batch, notes: Array.from({ length: 21 }, message) }, '/tmp')).toBe(false);
    expect(validFeedback({ ...batch, notes: Array.from({ length: 6 }, () => ({ ...message(), instruction: '語'.repeat(2000) })) }, '/tmp')).toBe(false);
  });
  it('validates structured context and includes the inspected styles in the instruction', () => {
    const feedback = message(); expect(validFeedback(feedback, '/tmp')).toBe(true);
    expect(validFeedback({ ...feedback, projectRoot: '/different' }, '/tmp')).toBe(false);
    expect(validFeedback({ ...feedback, selection: 'bad' }, '/tmp')).toBe(false);
    expect(promptFor(feedback)).toContain('32px');
  });
  it.each(['single', 'batch'])('queues busy %s feedback, waits for consumption, deduplicates, survives reload and cleans up', async kind => {
    const module = '../extensions/pi-sidelit/index.ts';
    const { default: extension, registryDirectory } = await import(/* @vite-ignore */ module);
    const hooks = new Map<string, Function>(); const sent: any[] = [], entries: any[] = [];
    const session = randomUUID();
    const ctx = { cwd: '/tmp', isIdle: () => false, ui: { notify: (text: string) => { throw Error(text); } }, sessionManager: { getSessionId: () => session, getEntries: () => entries } };
    extension({ on: (name: string, fn: Function) => hooks.set(name, fn), registerCommand: () => {}, sendUserMessage: (...args: any[]) => sent.push(args), appendEntry: (customType: string, data: unknown) => entries.push({ type: 'custom', customType, data }) });
    shutdown = async () => { await hooks.get('session_shutdown')!(); };
    await hooks.get('session_start')!({}, ctx);
    const id = createHash('sha256').update(`${process.pid}:${session}`).digest('hex').slice(0, 32);
    const path = `${registryDirectory()}/${id}.sock`;
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path + '.json', 'utf8')).busy).toBe(true);
    const feedback = kind === 'batch'
      ? { id: randomUUID(), source: 'sidelit' as const, projectRoot: '/private/tmp', notes: [message(), { ...message(), intent: 'explain' as const, instruction: 'Explain without editing files' }] }
      : { ...message(), projectRoot: '/private/tmp' };
    expect(await exchange(path, { op: 'ping', id: 'health' })).toMatchObject({ id: 'health', status: 'ready', protocol: 1 });
    expect(sent).toHaveLength(0); expect(entries).toHaveLength(0);
    // /tmp is canonicalized to /private/tmp on macOS.
    feedback.projectRoot = JSON.parse(await readFile(path + '.json', 'utf8')).projectRoot;
    if ('notes' in feedback) feedback.notes!.forEach(note => { note.projectRoot = feedback.projectRoot; });
    expect(await exchange(path, feedback, true)).toMatchObject({ status: 'received', delivery: 'queued' });
    expect(sent).toHaveLength(1); expect(sent[0][1]).toEqual({ deliverAs: 'followUp' });
    if (kind === 'batch') { expect(sent[0][0]).toContain('Review batch: 2 notes'); expect(sent[0][0]).toContain('Explain without editing files'); }
    await exchange(path, feedback); expect(sent).toHaveLength(1);
    expect(await exchange(path, { ...feedback, instruction: 'Different' })).toMatchObject({ status: 'error' });
    hooks.get('message_start')!({ message: { role: 'user', content: [{ type: 'text', text: sent[0][0] }] } });
    expect(await exchange(path, { op: 'status', id: feedback.id })).toMatchObject({ status: 'accepted', delivery: 'consumed' });
    await hooks.get('session_start')!({}, ctx);
    expect(await exchange(path, feedback)).toMatchObject({ status: 'duplicate' }); expect(sent).toHaveLength(1);
    const hanging = createConnection(path); await new Promise<void>(resolve => hanging.once('connect', resolve));
    await shutdown!(); shutdown = undefined;
    await expect(stat(path)).rejects.toThrow(); await expect(stat(path + '.json')).rejects.toThrow();
    await expect(exchange(path, feedback)).rejects.toThrow();
  });
});
