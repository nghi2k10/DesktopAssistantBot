export type ToastVariant = 'success' | 'error' | 'info';

export class ToastManager {
  private container: HTMLElement | null = null;

  public init(): void {
    this.container = document.getElementById('toast-container');
  }

  public show(message: string, variant: ToastVariant = 'info', durationMs = 3600): void {
    if (!this.container) {
      this.container = document.getElementById('toast-container');
    }
    if (!this.container) {
      return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${variant}`;

    const iconSvg = this.getIconSvg(variant);
    toast.innerHTML = `
      <span class="toast-icon">${iconSvg}</span>
      <span class="toast-message"></span>
      <button type="button" class="toast-close" aria-label="Dismiss notification">&times;</button>
    `;

    const msgEl = toast.querySelector('.toast-message');
    if (msgEl) {
      msgEl.textContent = message;
    }

    const closeBtn = toast.querySelector('.toast-close');
    const removeToast = () => {
      toast.classList.add('toast-hiding');
      setTimeout(() => {
        toast.remove();
      }, 220);
    };

    closeBtn?.addEventListener('click', removeToast);
    this.container.appendChild(toast);

    setTimeout(removeToast, durationMs);
  }

  private getIconSvg(variant: ToastVariant): string {
    if (variant === 'success') {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
    }
    if (variant === 'error') {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    }
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
}

export const toast = new ToastManager();
