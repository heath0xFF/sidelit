import { useLayoutEffect, useRef, useState } from 'react';
import type { FeedbackIntent, SelectionContext } from './inspection';

export default function SelectionActions({ selection, onAction }: { selection: SelectionContext; onAction: (intent: FeedbackIntent) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 24, top: 120 });
  useLayoutEffect(() => {
    const place = () => {
      const rect = selection.rect, height = ref.current?.offsetHeight ?? 34;
      setPosition({ left: Math.max(12, Math.min(innerWidth - 240, rect?.x ?? 24)), top: Math.max(100, Math.min(innerHeight - height - 32, (rect?.y ?? 100) + (rect?.height ?? 0) + 8)) });
    };
    place(); addEventListener('resize', place); return () => removeEventListener('resize', place);
  }, [selection]);
  return <div ref={ref} className="selection-actions" style={position} role="group" aria-label="Ask about selection" onMouseDown={event => event.preventDefault()}>
    {(['explain', 'review', 'edit'] as const).map(intent => <button key={intent} onClick={() => onAction(intent)}>{intent[0].toUpperCase() + intent.slice(1)}</button>)}
  </div>;
}
