import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Shared accessible modal shell (docs/DESIGN.md: Esc close, aria-labelledby, focus trap & restoration). */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
  closeDisabled = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [onClose, closeDisabled]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    // Move focus into the dialog unless a child input already claimed autoFocus.
    if (panel && !panel.contains(document.activeElement)) {
      const autoFocused = panel.querySelector<HTMLElement>('[autofocus]');
      if (autoFocused) autoFocused.focus();
      else panel.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (!closeDisabledRef.current) {
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-[#000524]/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`bg-white rounded-2xl border border-[#e0edff] w-full ${
          wide ? 'max-w-2xl' : 'max-w-md'
        } shadow-[0_24px_60px_rgba(0,5,36,0.45)] flex flex-col max-h-[85vh] outline-none`}
      >
        <div className="flex items-center justify-between gap-2 px-5 sm:px-6 py-4 border-b border-[#e0edff] shrink-0">
          <h2 id={titleId} className="font-display font-semibold text-lg text-[#000000] tracking-normal truncate">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            className="w-9 h-9 rounded-[8px] flex items-center justify-center text-[#526066] hover:bg-[#eff6ff] hover:text-[#2941e0] disabled:opacity-40 transition-colors shrink-0"
            aria-label={`Close ${title}`}
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
        <div className="p-5 sm:p-6 overflow-y-auto custom-scrollbar flex-1">{children}</div>
        {footer && <div className="px-5 sm:px-6 py-4 border-t border-[#e0edff] shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
