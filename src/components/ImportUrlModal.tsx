import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardPaste, X } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';
import { canReadClipboard, readClipboardText } from '../utils/readerClipboard';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Downloads the address and opens it. Throws, with a message for the reader, when it cannot. */
  onSubmit: (address: string) => Promise<void>;
}

const fieldClass =
  'w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';

/** A web address to read: a page, a text or an EPUB. It becomes a book on the shelf. */
export const ImportUrlModal: React.FC<Props> = ({ isOpen, onClose, onSubmit }) => {
  const t = useT();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  const pasteFromClipboard = async () => {
    setClipboardBusy(true);
    setError(null);
    try {
      const pasted = (await readClipboardText()).trim();
      if (pasted) {
        setAddress(pasted);
      } else {
        setError(t('import.clipboardEmpty'));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('import.clipboardUnavailable'));
    } finally {
      setClipboardBusy(false);
      input.current?.focus();
    }
  };

  const submit = async () => {
    if (!address.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(address);
      setAddress('');
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
        aria-labelledby="url-title"
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white text-left shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 id="url-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('import.urlTitle')}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('import.urlHint')}</p>
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

        <form
          noValidate
          className="space-y-3 px-4 py-3"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          <input
            ref={input}
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={address}
            onChange={(event) => { setAddress(event.target.value); setError(null); }}
            placeholder={t('import.urlPlaceholder')}
            aria-label={t('import.urlTitle')}
            className={fieldClass}
          />
          {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {canReadClipboard() ? (
              <button
                type="button"
                onClick={() => { void pasteFromClipboard(); }}
                disabled={busy || clipboardBusy}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <ClipboardPaste className="h-4 w-4" /> {clipboardBusy ? t('common.loading') : t('import.fromClipboard')}
              </button>
            ) : <span />}
            <button
              type="submit"
              disabled={busy || !address.trim()}
              className="inline-flex min-h-10 min-w-32 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t('import.urlReading') : t('import.urlRead')}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
};
