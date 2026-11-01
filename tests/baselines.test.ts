import { describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../src/api';
import { Baselines } from '../src/baselines';
import { Documents } from '../src/documents';

const snapshot = (text: string): Snapshot => ({ text, hash: 'hash:' + text });
const tick = () => new Promise(resolve => setTimeout(resolve));
function setup(saved: Record<string, Snapshot> = {}) {
  let disk = snapshot('disk');
  const documents = new Documents({ read: async () => disk, save: async () => { throw Error('unused'); } });
  const store = {
    loadBaseline: vi.fn(async (path: string) => saved[path] ?? null),
    storeBaseline: vi.fn(async (path: string, text: string | null) => {
      if (text === null) delete saved[path]; else saved[path] = snapshot(text);
    }),
  };
  const errors: unknown[] = [];
  const baselines = new Baselines(documents, store, error => errors.push(error));
  documents.subscribe(() => baselines.sync());
  const open = async (path = '/a.md') => {
    documents.open({ path, parent: '/', snapshot: disk });
    await tick();
  };
  return { documents, store, baselines, errors, saved, open, setDisk: (text: string) => { disk = snapshot(text); } };
}

describe('saved review baselines', () => {
  it('restores marks when a document opens, without touching its text', async () => {
    const { documents, open, store } = setup({ '/a.md': snapshot('older') });
    await open();
    const doc = documents.get('/a.md')!;
    expect(doc.review?.text).toBe('older');
    expect(doc.reviewFrom).toBe('disk');
    expect(doc.text).toBe('disk');
    expect(doc.revision).toBe(0);
    expect(store.storeBaseline).not.toHaveBeenCalled();
  });
  it('saves once when a change arrives, keeps the first version, and deletes on review', async () => {
    const { documents, open, store, setDisk, saved } = setup();
    await open();
    expect(store.storeBaseline).not.toHaveBeenCalled();
    setDisk('second'); await documents.refresh('/a.md'); await tick();
    expect(saved['/a.md'].text).toBe('disk');
    setDisk('third'); await documents.refresh('/a.md'); await tick();
    expect(store.storeBaseline).toHaveBeenCalledTimes(1);
    documents.update('/a.md', { review: undefined, reviewFrom: undefined }); await tick();
    expect(saved['/a.md']).toBeUndefined();
  });
  it('keeps saved marks when a tab closes, and reads them again on reopen', async () => {
    const { documents, open, store, saved } = setup({ '/a.md': snapshot('older') });
    await open();
    documents.remove('/a.md'); await tick();
    expect(saved['/a.md'].text).toBe('older');
    await open();
    expect(store.loadBaseline).toHaveBeenCalledTimes(2);
    expect(documents.get('/a.md')?.review?.text).toBe('older');
  });
  it('does not keep a commit comparison, which can go stale', async () => {
    const { documents, open, store } = setup();
    await open();
    documents.compareWithCommit('/a.md', snapshot('committed')); await tick();
    expect(documents.get('/a.md')?.review?.text).toBe('committed');
    expect(store.storeBaseline).not.toHaveBeenCalled();
  });
  it('an older saved baseline replaces one set while it was loading', async () => {
    const { documents, store } = setup({ '/a.md': snapshot('older') });
    documents.open({ path: '/a.md', parent: '/', snapshot: snapshot('disk') });
    documents.compareWithCommit('/a.md', snapshot('committed'));
    await tick();
    expect(documents.get('/a.md')?.review?.text).toBe('older');
    expect(store.storeBaseline).not.toHaveBeenCalled();
  });
  it('reports a failed save for an open document and lets flush finish', async () => {
    const { documents, open, store, errors, baselines, setDisk } = setup();
    store.storeBaseline.mockRejectedValueOnce(Error('disk full'));
    await open();
    setDisk('second'); await documents.refresh('/a.md');
    await baselines.flush();
    expect(String(errors[0])).toContain('disk full');
  });
});
