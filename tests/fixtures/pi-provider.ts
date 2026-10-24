// Deterministic, offline model used only by the packaged integration test.
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function fixture(pi: ExtensionAPI) {
  pi.registerProvider('sidelit-test', {
    baseUrl: 'http://127.0.0.1', apiKey: 'fixture', api: 'sidelit-test-api',
    models: [{ id: 'fixture', name: 'Sidelit offline fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        const last = [...context.messages].reverse().find(m => m.role === 'user');
        const text = last && typeof last.content !== 'string' ? last.content.filter(c => c.type === 'text').map(c => c.text).join('\n') : last?.content || '';
        const document = /Document: (.+)/.exec(String(text))?.[1];
        const toolDone = context.messages.at(-1)?.role === 'toolResult';
        const content = document && !toolDone ? [{ type: 'toolCall' as const, id: 'sidelit-fixture-edit', name: 'edit', arguments: { path: JSON.parse(document).path, oldText: 'Build something great.', newText: 'Build useful things.' } }] : [{ type: 'text' as const, text: 'Fixture complete.' }];
        const output = { role: 'assistant' as const, content, api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: document && !toolDone ? 'toolUse' as const : 'stop' as const, timestamp: Date.now() };
        stream.push({ type: 'start', partial: output });
        await new Promise(resolve => setTimeout(resolve, document ? 150 : 2000));
        stream.push({ type: 'done', reason: output.stopReason, message: output }); stream.end();
      })();
      return stream;
    },
  });
}
