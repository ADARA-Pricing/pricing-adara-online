"use client";
import { useEffect, useRef } from 'react';
export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  const callback = useRef(close);
  useEffect(() => { callback.current = close; }, [close]);
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')).filter(node => node.getClientRects().length);
    (focusable()[0] || dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); callback.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return ref;
}
