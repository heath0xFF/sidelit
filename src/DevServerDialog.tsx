import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import { localServerUrl } from './preview-security';

export default function DevServerDialog({
  value, onOpen, onClose,
}: {
  value: string;
  onOpen: (url: string) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(value || "http://localhost:3000");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const open = () => {
    try {
      onOpen(localServerUrl(url));
    } catch (reason) {
      setError(String(reason));
    }
  };
  return (
    <Dialog title="Open development server" onClose={onClose} className="server-dialog">
      <p>Connect Sidelit to a local server started from Rex. Hot reload remains owned by the development server.</p>
      <label className="field-label" htmlFor="dev-server-url">URL</label>
      <input ref={input} id="dev-server-url" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") open(); }} placeholder="http://localhost:5173" />
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={open}>Open preview</button></div>
    </Dialog>
  );
}
