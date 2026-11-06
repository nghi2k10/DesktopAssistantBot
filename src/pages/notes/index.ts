import { confirmDialog } from '../../components/confirm-dialog.js';
import { toast } from '../../components/toast.js';
import { ipcService } from '../../services/ipc.js';
import { NoteColor, NoteRow } from '../../types.js';

const NOTE_COLORS: Array<{ id: NoteColor; label: string; swatch: string }> = [
  { id: 'slate', label: 'Slate', swatch: '#64748b' },
  { id: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { id: 'emerald', label: 'Emerald', swatch: '#10b981' },
  { id: 'amber', label: 'Amber', swatch: '#f59e0b' },
  { id: 'rose', label: 'Rose', swatch: '#f43f5e' },
  { id: 'purple', label: 'Purple', swatch: '#8b5cf6' }
];

export class NotesPage {
  private readonly container: HTMLElement;
  private readonly onDataChanged?: () => void;

  private notes: NoteRow[] = [];
  private activeNoteId: number | null = null;
  private searchQuery = '';
  private debounceTimer: number | null = null;
  private pendingChanges: { id: number; title: string; content: string } | null = null;
  private saveStateText = 'Saved locally in SQLite';

  constructor(container: HTMLElement, onDataChanged?: () => void) {
    this.container = container;
    this.onDataChanged = onDataChanged;
  }

  public setData(notes: NoteRow[]): void {
    this.notes = notes;
    if (this.activeNoteId === null && this.notes.length > 0) {
      this.activeNoteId = this.notes[0].id;
    } else if (
      this.activeNoteId !== null &&
      !this.notes.some((n) => n.id === this.activeNoteId)
    ) {
      this.activeNoteId = this.notes[0]?.id ?? null;
    }
    this.render();
  }

  public async refresh(): Promise<void> {
    await this.flushPendingSave();
    const { notes } = await ipcService.getNotes();
    this.setData(notes);
    this.onDataChanged?.();
  }

  /**
   * Immediately flush any pending debounced edits to SQLite so switching notes or pages never loses data.
   */
  public async flushPendingSave(): Promise<void> {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (!this.pendingChanges) {
      return;
    }

    const toSave = this.pendingChanges;
    this.pendingChanges = null;
    this.updateSaveStatusUI('Saving...');

    const res = await ipcService.updateNote(toSave.id, {
      title: toSave.title,
      content: toSave.content
    });

    if (res.success && res.note) {
      const idx = this.notes.findIndex((n) => n.id === res.note!.id);
      if (idx !== -1) {
        this.notes[idx] = res.note;
      }
      this.sortNotesInPlace();
      this.updateSaveStatusUI(`Saved • ${res.note.updated_at}`);
      this.refreshNotesListPaneOnly();
      this.onDataChanged?.();
    } else {
      this.updateSaveStatusUI('Error saving note');
    }
  }

  private sortNotesInPlace(): void {
    this.notes.sort((a, b) => {
      if (b.is_pinned !== a.is_pinned) {
        return b.is_pinned - a.is_pinned;
      }
      return (
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime() ||
        b.id - a.id
      );
    });
  }

  public render(): void {
    const activeNote = this.notes.find((n) => n.id === this.activeNoteId) || null;

    this.container.innerHTML = `
      <div class="notes-workspace">
        <!-- Left Sidebar: Search & Notes List -->
        <aside class="card notes-sidebar-pane">
          <div class="notes-sidebar-top">
            <button type="button" id="notes-create-btn" class="btn btn-primary btn-full">
              + New Quick Note
            </button>
            <div class="search-box">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                id="notes-search-input"
                class="input-text"
                placeholder="Search note title or content..."
                value="${this.escapeHtml(this.searchQuery)}"
              />
            </div>
          </div>

          <div id="notes-list-scroll" class="notes-list-scroll">
            ${this.renderNotesListItems()}
          </div>
        </aside>

        <!-- Right Pane: Active Note Editor -->
        <section id="notes-editor-pane" class="card notes-editor-pane ${
          activeNote ? `note-accent-${activeNote.color}` : ''
        }">
          ${this.renderEditorContent(activeNote)}
        </section>
      </div>
    `;

    this.bindEvents();
  }

  private renderNotesListItems(): string {
    const query = this.searchQuery.trim().toLowerCase();
    const filtered = this.notes.filter((n) => {
      if (!query) return true;
      return (
        n.title.toLowerCase().includes(query) ||
        n.content.toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      return `
        <div class="empty-notes-list">
          <p>${query ? 'No matching notes found.' : 'No notes yet. Click "+ New Quick Note" to start.'}</p>
        </div>
      `;
    }

    return filtered
      .map((n) => {
        const isSelected = n.id === this.activeNoteId;
        const snippet =
          n.content.trim().slice(0, 75) || 'Empty note content...';
        return `
          <button
            type="button"
            class="note-list-item ${isSelected ? 'active' : ''} note-border-${n.color}"
            data-select-note="${n.id}"
          >
            <div class="note-list-item-top">
              <span class="note-list-title">${this.escapeHtml(n.title)}</span>
              ${
                n.is_pinned
                  ? `<span class="pin-badge" title="Pinned Note">📌</span>`
                  : ''
              }
            </div>
            <p class="note-list-snippet">${this.escapeHtml(snippet)}</p>
            <span class="note-list-date">Modified: ${this.escapeHtml(n.updated_at)}</span>
          </button>
        `;
      })
      .join('');
  }

  private renderEditorContent(note: NoteRow | null): string {
    if (!note) {
      return `
        <div class="empty-state editor-empty">
          <h4>Select or Create a Note</h4>
          <p>All notes are automatically saved to your local SQLite database as you type.</p>
        </div>
      `;
    }

    return `
      <div class="note-editor-header">
        <div class="note-editor-meta">
          <span id="note-save-status" class="save-status-pill">${this.escapeHtml(
            this.saveStateText
          )}</span>
          <span class="note-modified-label">Last modified: <strong id="note-updated-at">${this.escapeHtml(
            note.updated_at
          )}</strong></span>
        </div>

        <div class="note-editor-actions">
          <div class="color-swatches" role="group" aria-label="Note color">
            ${NOTE_COLORS.map(
              (c) => `
              <button
                type="button"
                class="color-dot ${note.color === c.id ? 'selected' : ''}"
                style="background-color: ${c.swatch}"
                data-note-color="${c.id}"
                title="Color: ${c.label}"
              ></button>
            `
            ).join('')}
          </div>

          <button
            type="button"
            id="note-pin-btn"
            class="btn ${note.is_pinned ? 'btn-primary' : 'btn-secondary'} btn-sm"
            title="Pin or unpin note"
          >
            ${note.is_pinned ? '📌 Pinned' : 'Pin Note'}
          </button>

          <button
            type="button"
            id="note-copy-btn"
            class="btn btn-secondary btn-sm"
            title="Copy note content to clipboard"
          >
            Copy Content
          </button>

          <button
            type="button"
            id="note-delete-btn"
            class="btn btn-danger-ghost btn-sm"
            title="Delete this note"
          >
            Delete
          </button>
        </div>
      </div>

      <div class="note-editor-body">
        <input
          type="text"
          id="note-title-input"
          class="note-title-input"
          value="${this.escapeHtml(note.title)}"
          placeholder="Note title..."
        />
        <textarea
          id="note-content-textarea"
          class="note-content-textarea"
          placeholder="Write your thoughts, snippets, or meeting notes here... Changes autosave automatically."
        >${this.escapeHtml(note.content)}</textarea>
      </div>
    `;
  }

  private bindEvents(): void {
    const createBtn = this.container.querySelector('#notes-create-btn');
    createBtn?.addEventListener('click', async () => {
      await this.flushPendingSave();
      const res = await ipcService.createNote({
        title: 'Untitled Note',
        content: '',
        color: 'slate',
        is_pinned: false
      });
      if (res.success && res.note) {
        this.notes.unshift(res.note);
        this.sortNotesInPlace();
        this.activeNoteId = res.note.id;
        this.saveStateText = 'Created & saved';
        this.render();
        const titleInput = this.container.querySelector<HTMLInputElement>('#note-title-input');
        titleInput?.focus();
        titleInput?.select();
        this.onDataChanged?.();
      }
    });

    const searchInput = this.container.querySelector<HTMLInputElement>('#notes-search-input');
    searchInput?.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.refreshNotesListPaneOnly();
    });

    this.bindListSelectionEvents();
    this.bindEditorEvents();
  }

  private bindListSelectionEvents(): void {
    const items = this.container.querySelectorAll<HTMLButtonElement>('[data-select-note]');
    items.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const nextId = Number(btn.getAttribute('data-select-note'));
        if (nextId === this.activeNoteId) return;
        await this.flushPendingSave();
        this.activeNoteId = nextId;
        this.saveStateText = 'Saved locally in SQLite';
        this.render();
      });
    });
  }

  private bindEditorEvents(): void {
    const activeNote = this.notes.find((n) => n.id === this.activeNoteId);
    if (!activeNote) return;

    const titleInput = this.container.querySelector<HTMLInputElement>('#note-title-input');
    const contentArea = this.container.querySelector<HTMLTextAreaElement>('#note-content-textarea');

    const scheduleAutosave = () => {
      if (!activeNote) return;
      const newTitle = titleInput?.value ?? activeNote.title;
      const newContent = contentArea?.value ?? activeNote.content;

      activeNote.title = newTitle.trim() || 'Untitled Note';
      activeNote.content = newContent;

      this.pendingChanges = {
        id: activeNote.id,
        title: activeNote.title,
        content: activeNote.content
      };

      this.updateSaveStatusUI('Saving changes...');
      this.refreshNotesListPaneOnly();

      if (this.debounceTimer !== null) {
        window.clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = window.setTimeout(() => {
        this.flushPendingSave();
      }, 400);
    };

    titleInput?.addEventListener('input', scheduleAutosave);
    contentArea?.addEventListener('input', scheduleAutosave);

    const colorBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-note-color]');
    colorBtns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const color = btn.getAttribute('data-note-color') as NoteColor | null;
        if (!color || !activeNote) return;
        await this.flushPendingSave();
        const res = await ipcService.updateNote(activeNote.id, { color });
        if (res.success && res.note) {
          Object.assign(activeNote, res.note);
          this.render();
          toast.show(`Note color changed to ${color}.`, 'info');
        }
      });
    });

    const pinBtn = this.container.querySelector('#note-pin-btn');
    pinBtn?.addEventListener('click', async () => {
      if (!activeNote) return;
      await this.flushPendingSave();
      const nextPinned = !Boolean(activeNote.is_pinned);
      const res = await ipcService.updateNote(activeNote.id, { is_pinned: nextPinned });
      if (res.success && res.note) {
        Object.assign(activeNote, res.note);
        this.sortNotesInPlace();
        this.render();
        toast.show(nextPinned ? 'Note pinned to top.' : 'Note unpinned.', 'success');
      }
    });

    const copyBtn = this.container.querySelector('#note-copy-btn');
    copyBtn?.addEventListener('click', async () => {
      if (!activeNote) return;
      try {
        await navigator.clipboard.writeText(activeNote.content);
        toast.show('Note content copied to clipboard.', 'success');
      } catch {
        toast.show('Failed to copy content to clipboard.', 'error');
      }
    });

    const deleteBtn = this.container.querySelector('#note-delete-btn');
    deleteBtn?.addEventListener('click', async () => {
      if (!activeNote) return;
      await this.flushPendingSave();
      const confirmed = await confirmDialog.ask({
        title: 'Delete Note',
        message: `Are you sure you want to delete "${activeNote.title}"?`,
        confirmLabel: 'Delete Note'
      });
      if (confirmed) {
        const res = await ipcService.deleteNote(activeNote.id);
        if (res.success) {
          this.notes = this.notes.filter((n) => n.id !== activeNote.id);
          this.activeNoteId = this.notes[0]?.id ?? null;
          this.render();
          toast.show('Note deleted.', 'info');
          this.onDataChanged?.();
        }
      }
    });
  }

  private refreshNotesListPaneOnly(): void {
    const listScroll = this.container.querySelector('#notes-list-scroll');
    if (listScroll) {
      listScroll.innerHTML = this.renderNotesListItems();
      this.bindListSelectionEvents();
    }
  }

  private updateSaveStatusUI(statusText: string): void {
    this.saveStateText = statusText;
    const statusEl = this.container.querySelector('#note-save-status');
    if (statusEl) {
      statusEl.textContent = statusText;
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
