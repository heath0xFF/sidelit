import type { Heading } from "./headings";

export default function Outline({ items, onPick }: { items: Heading[]; onPick: (heading: Heading) => void }) {
  if (!items.length) return <div className="tree-empty">No headings in this document</div>;
  const top = Math.min(...items.map((item) => item.level));
  return <ul className="tree-list outline-list">
    {items.map((item) => <li key={item.index}>
      <button className="tree-row" style={{ paddingLeft: 12 + (item.level - top) * 14 }} title={item.text} onClick={() => onPick(item)}>
        <span>{item.text || "Untitled heading"}</span>
      </button>
    </li>)}
  </ul>;
}
