import React from 'react';
import { AlertTriangle, X, Check } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  isDestructive = false,
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-[var(--modal-bg)] border border-[var(--modal-border)] w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden transform transition-all scale-100">
        
        {/* Header */}
        <div className="p-5 flex items-center gap-3 border-b border-[var(--modal-border)]">
          <div className={`p-2.5 rounded-full ${isDestructive ? 'bg-rose-500/15 text-rose-500' : 'bg-[var(--accent-color)]/10 text-[var(--accent-color)]'}`}>
            {isDestructive ? <AlertTriangle size={24} /> : <Check size={24} />}
          </div>
          <h3 className="text-xl font-bold text-[var(--modal-text-main)] font-bebas uppercase tracking-wide">
            {title}
          </h3>
          <button onClick={onCancel} className="ml-auto text-[var(--modal-text-muted)] hover:text-[var(--modal-text-main)] transition">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-[var(--modal-text-muted)] text-sm leading-relaxed font-medium">
            {message}
          </p>
        </div>

        {/* Footer */}
        <div className="bg-[var(--modal-bg)] p-4 flex gap-3 justify-end border-t border-[var(--modal-border)]">
          <button
            onClick={onCancel}
            className="px-5 py-3 rounded-xl text-sm font-bold text-[var(--modal-text-muted)] hover:bg-[var(--btn-glass-bg)] hover:text-[var(--modal-text-main)] transition"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-6 py-3 rounded-xl text-sm font-bold shadow-lg transition transform active:scale-95 ${
              isDestructive 
                ? 'bg-rose-600 hover:bg-rose-500 text-white' 
                : 'bg-[var(--accent-color)] hover:opacity-90 text-[var(--accent-text)]'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};