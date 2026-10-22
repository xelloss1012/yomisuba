import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardPaste, X } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Makes the book of the text. Throws, with a message for the reader, when it cannot. */
  onSubmit: (text: string, title: string) => Promise<void>;
}

const fieldClass =
  'w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';

/** A text to read: pasted or typed, with an optional title. It becomes a book on the shelf. */
export const PasteTextModal: React.FC<Props> = ({ isOpen, onClose, onSubmit }) => {
  const t = useT();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const canReadClipboard = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText);

  useEffect(() => {
    if (!isOpen) return undefined;
    textArea.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  const pasteFromClipboard = async () => {
    try {
      const pasted = await navigator.clipboard.readText();
      if (pasted) setText((current) => (current ? `${current}\n${pasted}` : pasted));
    } catch {
      // Not allowed: the reader can still paste into the field by hand.
      textArea.current?.focus();
    }
  };

  const submit = async () => {
    if (!text.trim()) {
      setError(t('import.emptyText'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text, title);
      setText('');
      setTitle('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  // Drawn on the body, like the library: the home card blurs its background and would hold a fixed dialog.
  return createPortal(
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
      onClick={() => { if (!busy) onClose(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-title"
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white text-left shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 id="paste-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('import.pasteTitle')}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('import.pasteHint')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="tap-area shrink-0 rounded-full p-2 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
            aria-label={t('nav.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <textarea
            ref={textArea}
            value={text}
            onChange={(event) => { setText(event.target.value); setError(null); }}
            placeholder={t('import.textPlaceholder')}
            lang="ja"
            className={`${fieldClass} h-56 resize-y font-mincho sm:h-72`}
          />
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('import.titleLabel')}
            aria-label={t('import.titleLabel')}
            maxLength={80}
            className={fieldClass}
          />
          {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          {canReadClipboard ? (
            <button
              type="button"
              onClick={() => { void pasteFromClipboard(); }}
              disabled={busy}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <ClipboardPaste className="h-4 w-4" /> {t('import.fromClipboard')}
            </button>
          ) : <span />}
          <button
            type="button"
            onClick={() => { void submit(); }}
            disabled={busy || !text.trim()}
            className="inline-flex min-h-10 min-w-24 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('import.read')}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
};
