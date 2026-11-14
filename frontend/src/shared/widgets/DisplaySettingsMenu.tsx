import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, Filter, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type DisplaySettingsOption = { value: string; label: string };
export type DisplaySettingsSection = {
  title: string; value: string; options: DisplaySettingsOption[]; onChange: (value: string) => void;
};
type Props = {
  open: boolean; onOpenChange: (open: boolean) => void; sections: DisplaySettingsSection[];
  className?: string; buttonLabel?: string; sheetLabel?: string;
};
export default function DisplaySettingsMenu({ open, onOpenChange, sections, className = '', buttonLabel, sheetLabel }: Props) {
  const { t } = useTranslation();
  const label = buttonLabel ?? t('displaySettings.buttonLabel');
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const change = useRef(onOpenChange);
  useEffect(() => { change.current = onOpenChange; }, [onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('button')?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); change.current(false); }
      if (event.key !== 'Tab') return;
      const buttons = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [open]);
  return <div className={`relative min-w-0 ${className}`}>
    <button type="button" className="reader-display-trigger" aria-label={label}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => onOpenChange(!open)}>
      <Filter size={18} /><span>{label}</span>
    </button>
    {open && createPortal(<div className="reader-filter-overlay" onClick={() => onOpenChange(false)}>
      <div ref={panel} className="reader-filter-sheet" role="dialog" aria-modal="true"
        aria-labelledby={titleId} aria-label={sheetLabel} onClick={event => event.stopPropagation()}>
        <header className="reader-filter-sheet-header">
          <h2 id={titleId}>{label}</h2>
          <button type="button" className="reader-icon-button" aria-label={t('common.close')} onClick={() => onOpenChange(false)}><X size={20} /></button>
        </header>
        {sections.map(section => <section key={section.title} className="reader-display-group">
          <h3>{section.title}</h3>
          <div className="reader-display-options">
            {section.options.map(option => <button key={option.value} type="button" aria-pressed={section.value === option.value}
              onClick={() => { section.onChange(option.value); onOpenChange(false); }}>
              <span>{option.label}</span>{section.value === option.value && <Check size={14} />}
            </button>)}
          </div>
        </section>)}
      </div>
    </div>, document.body)}
  </div>;
}
