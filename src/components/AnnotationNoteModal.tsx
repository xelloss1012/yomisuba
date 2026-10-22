import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';
import { MAX_NOTE_LENGTH } from '../utils/textAnnotations';

interface Props {
  isOpen: boolean;
  /** The underlined passage the note is about. */
  quote: string;
  /** The note as it is now; empty when there is none yet. */
  note: string;
  onSave: (note: string) => void;
  onClose: () => void;
}

/** Writes, edits or removes the note of an underlined passage. */
export const AnnotationNoteModal: React.FC<Props> = ({ isOpen, quote, note, onSave, onClose }) => {
  const t = useT();
  const [text, setText] = useState(note);
  const area = useRef<HTMLTextAreaElement>(null);

  // The parent hands over fresh callbacks on every render; the effect must not
  // re-run for them, or the field is reset to the saved note while typing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const noteRef = useRef(note);
  noteRef.current = note;

  useEffect(() => {
    if (!isOpen) return undefined;
    setText(noteRef.current);
    const focus = window.setTimeout(() => {
      const field = area.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }, 50);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focus);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white text-left shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 id="note-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('notes.title')}</h2>
            <p lang="ja" className="mt-1 line-clamp-3 border-l-2 border-indigo-400 pl-2 text-xs text-zinc-500 dark:text-zinc-400">{quote}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-area shrink-0 rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t('nav.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 px-4 py-3">
          <textarea
            ref={area}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={MAX_NOTE_LENGTH}
            placeholder={t('notes.placeholder')}
            aria-label={t('notes.title')}
            className="h-40 w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 sm:h-48"
          />
          <p className="mt-1 text-right text-[10px] text-zinc-400">{text.length}/{MAX_NOTE_LENGTH}</p>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          {note ? (
            <button
              type="button"
              onClick={() => onSave('')}
              className="inline-flex min-h-10 items-center rounded-xl px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              {t('notes.remove')}
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-10 items-center rounded-xl border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => onSave(text)}
              className="inline-flex min-h-10 min-w-20 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md hover:bg-indigo-700 active:scale-95"
            >
              {t('notes.save')}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
};
