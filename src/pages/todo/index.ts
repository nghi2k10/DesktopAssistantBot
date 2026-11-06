import { confirmDialog } from '../../components/confirm-dialog.js';
import { toast } from '../../components/toast.js';
import { ipcService } from '../../services/ipc.js';
import {
  TaskCategoryRow,
  TaskPriority,
  TaskRow,
  TaskStats,
  TaskStatus
} from '../../types.js';

export type TaskSortField = 'due_at' | 'created_at' | 'priority';

export class TodoPage {
  private readonly container: HTMLElement;
  private readonly onDataChanged?: () => void;

  private tasks: TaskRow[] = [];
  private categories: TaskCategoryRow[] = [];
  private stats: TaskStats = {
    total: 0,
    completed: 0,
    pending: 0,
    todo: 0,
    inProgress: 0,
    overdue: 0,
    completionPercentage: 0
  };

  private searchQuery = '';
  private filterStatus: 'all' | TaskStatus = 'all';
  private filterPriority: 'all' | TaskPriority = 'all';
  private filterCategoryId: 'all' | number = 'all';
  private sortBy: TaskSortField = 'due_at';

  private editingTaskId: number | null = null;

  constructor(container: HTMLElement, onDataChanged?: () => void) {
    this.container = container;
    this.onDataChanged = onDataChanged;
  }

  public setData(
    tasks: TaskRow[],
    categories: TaskCategoryRow[],
    stats: TaskStats
  ): void {
    this.tasks = tasks;
    this.categories = categories;
    this.stats = stats;
    this.render();
  }

  public async refresh(): Promise<void> {
    const data = await ipcService.getTasksData();
    this.tasks = data.tasks;
    this.categories = data.categories;
    this.stats = data.stats;
    this.render();
    this.onDataChanged?.();
  }

  public render(): void {
    this.container.innerHTML = `
      <div class="module-page todo-page">
        <!-- Todo Dashboard Summary Cards -->
        <section class="todo-stats-grid">
          <div class="card stat-box">
            <span class="stat-box-label">Total Tasks</span>
            <strong id="todo-stat-total" class="stat-box-value">${this.stats.total}</strong>
          </div>
          <div class="card stat-box">
            <span class="stat-box-label">Completed</span>
            <strong id="todo-stat-completed" class="stat-box-value text-emerald">${this.stats.completed}</strong>
          </div>
          <div class="card stat-box">
            <span class="stat-box-label">Pending</span>
            <strong id="todo-stat-pending" class="stat-box-value text-blue">${this.stats.pending}</strong>
          </div>
          <div class="card stat-box">
            <span class="stat-box-label">Overdue</span>
            <strong id="todo-stat-overdue" class="stat-box-value text-danger">${this.stats.overdue}</strong>
          </div>
          <div class="card stat-box stat-box-wide">
            <div class="stat-progress-top">
              <span class="stat-box-label">Completion Rate</span>
              <strong id="todo-stat-percent" class="stat-box-percent">${this.stats.completionPercentage}%</strong>
            </div>
            <div class="progress-bar-track">
              <div class="progress-bar-fill" style="width: ${this.stats.completionPercentage}%"></div>
            </div>
          </div>
        </section>

        <!-- Toolbar: Search, Filters, Sort & Add Task Button -->
        <section class="card module-toolbar">
          <div class="toolbar-row">
            <div class="search-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                id="todo-search-input"
                class="input-text"
                placeholder="Search tasks by title or description..."
                value="${this.escapeHtml(this.searchQuery)}"
              />
            </div>

            <button type="button" id="todo-open-add-btn" class="btn btn-primary">
              + Add Task
            </button>
          </div>

          <div class="toolbar-filters-row">
            <div class="filter-group">
              <label for="todo-filter-status">Status</label>
              <select id="todo-filter-status" class="select-input">
                <option value="all" ${this.filterStatus === 'all' ? 'selected' : ''}>All Statuses</option>
                <option value="todo" ${this.filterStatus === 'todo' ? 'selected' : ''}>Todo</option>
                <option value="in_progress" ${this.filterStatus === 'in_progress' ? 'selected' : ''}>In Progress</option>
                <option value="done" ${this.filterStatus === 'done' ? 'selected' : ''}>Done</option>
              </select>
            </div>

            <div class="filter-group">
              <label for="todo-filter-priority">Priority</label>
              <select id="todo-filter-priority" class="select-input">
                <option value="all" ${this.filterPriority === 'all' ? 'selected' : ''}>All Priorities</option>
                <option value="high" ${this.filterPriority === 'high' ? 'selected' : ''}>High</option>
                <option value="medium" ${this.filterPriority === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="low" ${this.filterPriority === 'low' ? 'selected' : ''}>Low</option>
              </select>
            </div>

            <div class="filter-group">
              <label for="todo-filter-category">Category</label>
              <select id="todo-filter-category" class="select-input">
                <option value="all" ${this.filterCategoryId === 'all' ? 'selected' : ''}>All Categories</option>
                ${this.categories
                  .map(
                    (cat) => `
                  <option value="${cat.id}" ${this.filterCategoryId === cat.id ? 'selected' : ''}>
                    ${this.escapeHtml(cat.name)}
                  </option>
                `
                  )
                  .join('')}
              </select>
            </div>

            <div class="filter-group">
              <label for="todo-sort-by">Sort By</label>
              <select id="todo-sort-by" class="select-input">
                <option value="due_at" ${this.sortBy === 'due_at' ? 'selected' : ''}>Due Date</option>
                <option value="priority" ${this.sortBy === 'priority' ? 'selected' : ''}>Priority (High &rarr; Low)</option>
                <option value="created_at" ${this.sortBy === 'created_at' ? 'selected' : ''}>Creation Date</option>
              </select>
            </div>
          </div>
        </section>

        <!-- Task List -->
        <section id="todo-list-container" class="todo-list-container">
          ${this.renderFilteredTaskList()}
        </section>

        <!-- Add / Edit Task Modal Dialog -->
        <div id="todo-form-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
          <div class="modal-dialog card">
            <div class="modal-header">
              <h3 id="todo-modal-title">Add New Task</h3>
              <button type="button" id="todo-modal-close" class="btn-icon" aria-label="Close">&times;</button>
            </div>
            <form id="todo-form" class="modal-body form-stack">
              <div class="form-field">
                <label for="todo-input-title" class="input-label">Task Title *</label>
                <input type="text" id="todo-input-title" class="input-text" required placeholder="Enter task title..." />
              </div>

              <div class="form-field">
                <label for="todo-input-desc" class="input-label">Description</label>
                <textarea id="todo-input-desc" class="input-textarea" rows="3" placeholder="Optional notes or checklist details..."></textarea>
              </div>

              <div class="form-row-2">
                <div class="form-field">
                  <label for="todo-input-status" class="input-label">Status</label>
                  <select id="todo-input-status" class="select-input">
                    <option value="todo">Todo</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>

                <div class="form-field">
                  <label for="todo-input-priority" class="input-label">Priority</label>
                  <select id="todo-input-priority" class="select-input">
                    <option value="low">Low</option>
                    <option value="medium" selected>Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <div class="form-row-2">
                <div class="form-field">
                  <label for="todo-input-category" class="input-label">Category</label>
                  <select id="todo-input-category" class="select-input">
                    ${this.categories
                      .map(
                        (c) => `<option value="${c.id}">${this.escapeHtml(c.name)}</option>`
                      )
                      .join('')}
                  </select>
                </div>

                <div class="form-field">
                  <label for="todo-input-due" class="input-label">Due Date & Time</label>
                  <input type="datetime-local" id="todo-input-due" class="input-text" />
                </div>
              </div>

              <div class="form-field">
                <label for="todo-new-category-input" class="input-label">Or Create New Category</label>
                <div class="inline-field-row">
                  <input type="text" id="todo-new-category-input" class="input-text" placeholder="New category name (optional)..." />
                  <button type="button" id="todo-add-category-btn" class="btn btn-secondary btn-sm">Add Category</button>
                </div>
              </div>

              <div class="modal-footer-actions">
                <button type="button" id="todo-modal-cancel" class="btn btn-ghost">Cancel</button>
                <button type="submit" id="todo-modal-submit" class="btn btn-primary">Save Task</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  public getFilteredAndSortedTasks(): TaskRow[] {
    const query = this.searchQuery.trim().toLowerCase();
    const filtered = this.tasks.filter((t) => {
      if (this.filterStatus !== 'all' && t.status !== this.filterStatus) {
        return false;
      }
      if (this.filterPriority !== 'all' && t.priority !== this.filterPriority) {
        return false;
      }
      if (this.filterCategoryId !== 'all' && t.category_id !== this.filterCategoryId) {
        return false;
      }
      if (query) {
        const matchesTitle = t.title.toLowerCase().includes(query);
        const matchesDesc = t.description.toLowerCase().includes(query);
        const matchesCat = t.category_name.toLowerCase().includes(query);
        if (!matchesTitle && !matchesDesc && !matchesCat) {
          return false;
        }
      }
      return true;
    });

    const priorityRank: Record<TaskPriority, number> = {
      high: 3,
      medium: 2,
      low: 1
    };

    filtered.sort((a, b) => {
      if (this.sortBy === 'priority') {
        const diff = priorityRank[b.priority] - priorityRank[a.priority];
        if (diff !== 0) return diff;
        return b.id - a.id;
      }
      if (this.sortBy === 'due_at') {
        if (!a.due_at && !b.due_at) return b.id - a.id;
        if (!a.due_at) return 1;
        if (!b.due_at) return -1;
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      }
      // created_at
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id;
    });

    return filtered;
  }

  private renderFilteredTaskList(): string {
    const list = this.getFilteredAndSortedTasks();
    if (list.length === 0) {
      return `
        <div class="card empty-state">
          <h4>No tasks match your current view</h4>
          <p>Click "+ Add Task" to create a task or adjust your search and filter criteria.</p>
        </div>
      `;
    }

    const nowMs = Date.now();
    return list
      .map((t) => {
        const isDone = t.status === 'done';
        const isOverdue =
          !isDone &&
          Boolean(t.due_at) &&
          !Number.isNaN(new Date(t.due_at!).getTime()) &&
          new Date(t.due_at!).getTime() < nowMs;

        return `
          <div class="card task-item-card ${isDone ? 'task-done' : ''} ${
            isOverdue ? 'task-overdue' : ''
          }" data-task-id="${t.id}">
            <div class="task-check-col">
              <input
                type="checkbox"
                class="task-complete-checkbox"
                data-toggle-done="${t.id}"
                ${isDone ? 'checked' : ''}
                title="Mark task as completed"
              />
            </div>

            <div class="task-main-col">
              <div class="task-header-row">
                <h4 class="task-title ${isDone ? 'strike' : ''}">${this.escapeHtml(t.title)}</h4>
                <div class="task-badges">
                  <span class="badge priority-badge-${t.priority}">
                    ${t.priority.toUpperCase()}
                  </span>
                  <span class="badge status-badge-${t.status}">
                    ${this.formatStatus(t.status)}
                  </span>
                  <span class="badge badge-neutral" style="border-left: 3px solid ${this.escapeHtml(
                    t.category_color
                  )}">
                    ${this.escapeHtml(t.category_name)}
                  </span>
                  ${
                    isOverdue
                      ? `<span class="badge badge-danger">Overdue</span>`
                      : ''
                  }
                </div>
              </div>

              ${
                t.description
                  ? `<p class="task-desc">${this.escapeHtml(t.description)}</p>`
                  : ''
              }

              <div class="task-meta-row">
                ${
                  t.due_at
                    ? `<span class="task-meta-item ${isOverdue ? 'text-danger' : ''}">
                        Due: <strong>${this.escapeHtml(this.formatDateTime(t.due_at))}</strong>
                       </span>`
                    : `<span class="task-meta-item">No due date</span>`
                }
                <span class="task-meta-item">Created: ${this.escapeHtml(t.created_at)}</span>
              </div>
            </div>

            <div class="task-actions-col">
              <select class="select-input select-sm" data-quick-status="${t.id}" title="Change task status">
                <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>Todo</option>
                <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
              </select>

              <button type="button" class="btn btn-secondary btn-sm" data-edit-task="${t.id}">
                Edit
              </button>
              <button type="button" class="btn btn-danger-ghost btn-sm" data-delete-task="${t.id}">
                Delete
              </button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  private bindEvents(): void {
    const searchInput = this.container.querySelector<HTMLInputElement>('#todo-search-input');
    searchInput?.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.refreshTaskListOnly();
    });

    const statusSelect = this.container.querySelector<HTMLSelectElement>('#todo-filter-status');
    statusSelect?.addEventListener('change', () => {
      this.filterStatus = statusSelect.value as 'all' | TaskStatus;
      this.refreshTaskListOnly();
    });

    const prioritySelect = this.container.querySelector<HTMLSelectElement>('#todo-filter-priority');
    prioritySelect?.addEventListener('change', () => {
      this.filterPriority = prioritySelect.value as 'all' | TaskPriority;
      this.refreshTaskListOnly();
    });

    const categorySelect = this.container.querySelector<HTMLSelectElement>('#todo-filter-category');
    categorySelect?.addEventListener('change', () => {
      this.filterCategoryId =
        categorySelect.value === 'all' ? 'all' : Number(categorySelect.value);
      this.refreshTaskListOnly();
    });

    const sortSelect = this.container.querySelector<HTMLSelectElement>('#todo-sort-by');
    sortSelect?.addEventListener('change', () => {
      this.sortBy = sortSelect.value as TaskSortField;
      this.refreshTaskListOnly();
    });

    const openAddBtn = this.container.querySelector('#todo-open-add-btn');
    openAddBtn?.addEventListener('click', () => {
      this.openTaskModal(null);
    });

    const modalClose = this.container.querySelector('#todo-modal-close');
    const modalCancel = this.container.querySelector('#todo-modal-cancel');
    modalClose?.addEventListener('click', () => this.closeTaskModal());
    modalCancel?.addEventListener('click', () => this.closeTaskModal());

    const addCatBtn = this.container.querySelector('#todo-add-category-btn');
    addCatBtn?.addEventListener('click', async () => {
      const catInput = this.container.querySelector<HTMLInputElement>('#todo-new-category-input');
      if (!catInput || !catInput.value.trim()) return;
      const res = await ipcService.createTaskCategory(catInput.value.trim());
      if (res.success && res.categories && res.category) {
        this.categories = res.categories;
        const catSelect = this.container.querySelector<HTMLSelectElement>('#todo-input-category');
        if (catSelect) {
          catSelect.innerHTML = this.categories
            .map(
              (c) =>
                `<option value="${c.id}" ${
                  c.id === res.category!.id ? 'selected' : ''
                }>${this.escapeHtml(c.name)}</option>`
            )
            .join('');
        }
        catInput.value = '';
        toast.show(`Category "${res.category.name}" added.`, 'success');
      }
    });

    const form = this.container.querySelector<HTMLFormElement>('#todo-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveTaskForm();
    });

    this.bindTaskRowActions();
  }

  private refreshTaskListOnly(): void {
    const listContainer = this.container.querySelector('#todo-list-container');
    if (listContainer) {
      listContainer.innerHTML = this.renderFilteredTaskList();
      this.bindTaskRowActions();
    }
  }

  private bindTaskRowActions(): void {
    const checkboxes = this.container.querySelectorAll<HTMLInputElement>('[data-toggle-done]');
    checkboxes.forEach((cb) => {
      cb.addEventListener('change', async () => {
        const id = Number(cb.getAttribute('data-toggle-done'));
        const nextStatus: TaskStatus = cb.checked ? 'done' : 'todo';
        const res = await ipcService.updateTask(id, { status: nextStatus });
        if (res.success) {
          toast.show(
            nextStatus === 'done' ? 'Task marked as completed.' : 'Task reopened.',
            'success'
          );
          await this.refresh();
        } else {
          toast.show(res.message, 'error');
        }
      });
    });

    const statusSelects = this.container.querySelectorAll<HTMLSelectElement>('[data-quick-status]');
    statusSelects.forEach((sel) => {
      sel.addEventListener('change', async () => {
        const id = Number(sel.getAttribute('data-quick-status'));
        const nextStatus = sel.value as TaskStatus;
        const res = await ipcService.updateTask(id, { status: nextStatus });
        if (res.success) {
          toast.show(`Task status updated to ${this.formatStatus(nextStatus)}.`, 'success');
          await this.refresh();
        } else {
          toast.show(res.message, 'error');
        }
      });
    });

    const editBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-edit-task]');
    editBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-edit-task'));
        const task = this.tasks.find((t) => t.id === id) || null;
        if (task) {
          this.openTaskModal(task);
        }
      });
    });

    const deleteBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-delete-task]');
    deleteBtns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-delete-task'));
        const task = this.tasks.find((t) => t.id === id);
        if (!task) return;

        const confirmed = await confirmDialog.ask({
          title: 'Delete Task',
          message: `Are you sure you want to permanently delete "${task.title}"?`,
          confirmLabel: 'Delete Task'
        });

        if (confirmed) {
          const res = await ipcService.deleteTask(id);
          if (res.success) {
            toast.show('Task deleted.', 'info');
            await this.refresh();
          } else {
            toast.show(res.message, 'error');
          }
        }
      });
    });
  }

  private openTaskModal(task: TaskRow | null): void {
    this.editingTaskId = task ? task.id : null;
    const modal = this.container.querySelector('#todo-form-modal');
    const modalTitle = this.container.querySelector('#todo-modal-title');
    const titleInput = this.container.querySelector<HTMLInputElement>('#todo-input-title');
    const descInput = this.container.querySelector<HTMLTextAreaElement>('#todo-input-desc');
    const statusInput = this.container.querySelector<HTMLSelectElement>('#todo-input-status');
    const priorityInput = this.container.querySelector<HTMLSelectElement>('#todo-input-priority');
    const categoryInput = this.container.querySelector<HTMLSelectElement>('#todo-input-category');
    const dueInput = this.container.querySelector<HTMLInputElement>('#todo-input-due');

    if (modalTitle) {
      modalTitle.textContent = task ? `Edit Task #${task.id}` : 'Add New Task';
    }
    if (titleInput) titleInput.value = task ? task.title : '';
    if (descInput) descInput.value = task ? task.description : '';
    if (statusInput) statusInput.value = task ? task.status : 'todo';
    if (priorityInput) priorityInput.value = task ? task.priority : 'medium';
    if (categoryInput) {
      categoryInput.value = String(task?.category_id || this.categories[0]?.id || 1);
    }
    if (dueInput) {
      dueInput.value = task?.due_at ? task.due_at.slice(0, 16) : '';
    }

    modal?.classList.remove('hidden');
    titleInput?.focus();
  }

  private closeTaskModal(): void {
    const modal = this.container.querySelector('#todo-form-modal');
    modal?.classList.add('hidden');
    this.editingTaskId = null;
  }

  private async handleSaveTaskForm(): Promise<void> {
    const titleInput = this.container.querySelector<HTMLInputElement>('#todo-input-title');
    const descInput = this.container.querySelector<HTMLTextAreaElement>('#todo-input-desc');
    const statusInput = this.container.querySelector<HTMLSelectElement>('#todo-input-status');
    const priorityInput = this.container.querySelector<HTMLSelectElement>('#todo-input-priority');
    const categoryInput = this.container.querySelector<HTMLSelectElement>('#todo-input-category');
    const dueInput = this.container.querySelector<HTMLInputElement>('#todo-input-due');

    const title = titleInput?.value.trim() || '';
    if (!title) {
      toast.show('Task title cannot be empty.', 'error');
      return;
    }

    const payload = {
      title,
      description: descInput?.value.trim() || '',
      status: (statusInput?.value || 'todo') as TaskStatus,
      priority: (priorityInput?.value || 'medium') as TaskPriority,
      category_id: categoryInput ? Number(categoryInput.value) : 1,
      due_at: dueInput?.value ? dueInput.value : null
    };

    if (this.editingTaskId !== null) {
      const res = await ipcService.updateTask(this.editingTaskId, payload);
      if (res.success) {
        toast.show('Task updated successfully.', 'success');
        this.closeTaskModal();
        await this.refresh();
      } else {
        toast.show(res.message, 'error');
      }
    } else {
      const res = await ipcService.createTask(payload);
      if (res.success) {
        toast.show('Task created successfully.', 'success');
        this.closeTaskModal();
        await this.refresh();
      } else {
        toast.show(res.message, 'error');
      }
    }
  }

  private formatStatus(status: TaskStatus): string {
    if (status === 'in_progress') return 'In Progress';
    if (status === 'done') return 'Done';
    return 'Todo';
  }

  private formatDateTime(iso: string): string {
    return iso.replace('T', ' ');
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
