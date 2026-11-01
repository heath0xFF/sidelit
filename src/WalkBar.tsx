import type { Walk } from "./walk";

export default function WalkBar({ walk, onStep, onDone }: { walk: Walk; onStep: (delta: number) => void; onDone: () => void }) {
  const stop = walk.stops[walk.index];
  return <section className="changes-banner walk-bar" aria-label="Walkthrough from your agent">
    <div className="walk-stop" role="status">
      <span className="walk-place"><strong>Stop {walk.index + 1} of {walk.stops.length}</strong> · {stop.path.split("/").pop()}</span>
      {stop.note && <p>{stop.note}</p>}
    </div>
    <button disabled={walk.index === 0} title="Previous stop (⇧F9)" onClick={() => onStep(-1)}>Previous</button>
    <button disabled={walk.index === walk.stops.length - 1} title="Next stop (F9)" onClick={() => onStep(1)}>Next</button>
    <button onClick={onDone}>Done</button>
  </section>;
}
