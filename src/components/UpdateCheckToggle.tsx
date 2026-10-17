import React, { useState } from 'react';
import { useT } from '../i18n/LanguageContext';
import { isUpdateCheckEnabled, setUpdateCheckEnabled } from '../utils/updateCheck';

interface Props {
  /** `inline` for the footer of the home screen, `block` (with its explanation) for the settings. */
  variant: 'inline' | 'block';
  onChange?: (enabled: boolean) => void;
}

/** The reader's switch for the new-version notice. On by default; the choice is kept on this device. */
export const UpdateCheckToggle: React.FC<Props> = ({ variant, onChange }) => {
  const t = useT();
  const [enabled, setEnabled] = useState(isUpdateCheckEnabled);

  const input = (
    <input
      type="checkbox"
      checked={enabled}
      onChange={(event) => {
        setUpdateCheckEnabled(event.target.checked);
        setEnabled(event.target.checked);
        onChange?.(event.target.checked);
      }}
      className={variant === 'inline' ? 'h-3.5 w-3.5 accent-indigo-600' : 'mt-0.5 h-4 w-4 shrink-0 accent-indigo-600'}
    />
  );

  if (variant === 'inline') {
    return (
      <label className="inline-flex cursor-pointer items-center gap-1.5" title={t('update.checkHint')}>
        {input}
        {t('update.check')}
      </label>
    );
  }
  return (
    <label className="mt-3 flex cursor-pointer items-start gap-2">
      {input}
      <span>
        <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('update.check')}</span>
        <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">{t('update.checkHint')}</span>
      </span>
    </label>
  );
};
