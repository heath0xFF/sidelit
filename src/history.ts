export type HistoryAction = "undo" | "redo";
export type EditorHistory = (action: HistoryAction) => void;
