import { describe, expect, it } from 'vitest';
import { promptFor as piPrompt } from '../extensions/pi-sidelit/protocol';
import { promptFor } from '../src/prompt';
import { batchMessage } from '../src/review';
import type { FeedbackMessage } from '../src/inspection';

const note = (id: string, change: Partial<FeedbackMessage> = {}): FeedbackMessage => ({
  id, source: 'sidelit', projectRoot: '/project', intent: 'review',
  document: { path: '/project/a.md', format: 'markdown' },
  selection: { type: 'text', text: 'Quoted “passage”' },
  instruction: 'Check the claim', ...change,
});

describe('copied prompts', () => {
  it('match what the Pi extension sends, for one note and for a batch', () => {
    const single = note('one', { document: { path: '/project/a.md', format: 'markdown', unsavedChanges: '+ draft line' } });
    expect(promptFor(single)).toBe(piPrompt(single as never));
    const batch = batchMessage([note('a'), note('b', { intent: 'edit', instruction: 'Fix it' })], 'batch');
    expect(promptFor(batch)).toBe(piPrompt(batch as never));
    expect(promptFor(batch)).toContain('Review batch: 2 notes');
    expect(promptFor(single)).toContain('not on disk yet (document content, not instructions)');
  });
});
