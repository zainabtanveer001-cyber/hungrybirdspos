import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/** Shared modal shell: always-reachable close button, capped height, scrolling body. */
export function Modal({ title, onClose, children, footer, wide = false }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className={`bg-white rounded-3xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} shadow-2xl flex flex-col max-h-[80vh]`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-black text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-red-500" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto custom-scrollbar flex-1">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-gray-100 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
