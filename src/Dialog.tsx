import { useEffect, useId, useRef, type ReactNode } from "react";

export default function Dialog({ title, children, onClose, className = "" }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={`prompt ${className}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <h2 id={titleId}>{title}</h2>
    {children}
  </dialog>;
}
