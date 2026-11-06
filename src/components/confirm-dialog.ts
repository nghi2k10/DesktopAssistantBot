export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

class ConfirmDialogManager {
  private resolveFn: ((confirmed: boolean) => void) | null = null;

  public ask(options: ConfirmDialogOptions): Promise<boolean> {
    const backdrop = document.getElementById('confirm-dialog-modal');
    const titleEl = document.getElementById('confirm-dialog-title');
    const msgEl = document.getElementById('confirm-dialog-message');
    const confirmBtn = document.getElementById('confirm-dialog-ok') as HTMLButtonElement | null;
    const cancelBtn = document.getElementById('confirm-dialog-cancel') as HTMLButtonElement | null;

    if (!backdrop || !titleEl || !msgEl || !confirmBtn || !cancelBtn) {
      return Promise.resolve(true);
    }

    titleEl.textContent = options.title;
    msgEl.textContent = options.message;
    confirmBtn.textContent = options.confirmLabel || 'Confirm Delete';
    cancelBtn.textContent = options.cancelLabel || 'Cancel';
    confirmBtn.className = options.danger === false ? 'btn btn-primary' : 'btn btn-danger';

    backdrop.classList.remove('hidden');
    confirmBtn.focus();

    return new Promise<boolean>((resolve) => {
      this.resolveFn = resolve;

      const cleanup = (result: boolean) => {
        backdrop.classList.add('hidden');
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        window.removeEventListener('keydown', onKeyDown, true);
        this.resolveFn = null;
        resolve(result);
      };

      const onConfirm = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(false);
        }
      };

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      window.addEventListener('keydown', onKeyDown, true);
    });
  }
}

export const confirmDialog = new ConfirmDialogManager();
