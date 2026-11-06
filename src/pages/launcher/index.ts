import { LauncherItemInfo, QuickLaunchTarget } from '../../types.js';

export interface LauncherPageCallbacks {
  onQuickLaunch: (target: QuickLaunchTarget) => void;
}

export class LauncherPage {
  private readonly container: HTMLElement;
  private readonly callbacks: LauncherPageCallbacks;
  private items: LauncherItemInfo[] = [];
  private activeFilter: 'all' | 'folder' | 'application' = 'all';
  private searchQuery = '';

  constructor(container: HTMLElement, callbacks: LauncherPageCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public render(items: LauncherItemInfo[]): void {
    this.items = items;

    this.container.innerHTML = `
      <div class="launcher-page">
        <div class="card launcher-toolbar">
          <div class="search-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              id="launcher-search-input"
              class="input-text"
              placeholder="Filter folders or applications (e.g. Downloads, Notepad)..."
              value="${this.escapeHtml(this.searchQuery)}"
            />
          </div>
          <div class="filter-tabs" role="tablist">
            <button type="button" class="filter-tab ${this.activeFilter === 'all' ? 'active' : ''}" data-filter="all">All (6)</button>
            <button type="button" class="filter-tab ${this.activeFilter === 'folder' ? 'active' : ''}" data-filter="folder">Windows Folders (5)</button>
            <button type="button" class="filter-tab ${this.activeFilter === 'application' ? 'active' : ''}" data-filter="application">Applications (1)</button>
          </div>
        </div>

        <div id="launcher-cards-grid" class="launcher-cards-grid">
          ${this.renderFilteredCards()}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderFilteredCards(): string {
    const query = this.searchQuery.trim().toLowerCase();
    const filtered = this.items.filter((item) => {
      const matchesCategory =
        this.activeFilter === 'all' || item.category === this.activeFilter;
      const matchesSearch =
        !query ||
        item.label.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.resolvedPath.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });

    if (filtered.length === 0) {
      return `
        <div class="card empty-state">
          <p>No quick launcher items match your filter.</p>
        </div>
      `;
    }

    return filtered
      .map(
        (item) => `
        <div class="card launcher-detail-card">
          <div class="launcher-card-header">
            <div class="action-tile-icon ${
              item.category === 'application' ? 'icon-app' : 'icon-folder'
            }">
              ${this.getLauncherSvg(item.id)}
            </div>
            <div class="launcher-card-title-group">
              <div class="launcher-title-row">
                <h4 class="launcher-card-title">${this.escapeHtml(item.label)}</h4>
                <span class="badge ${
                  item.category === 'application' ? 'badge-accent' : 'badge-neutral'
                }">
                  ${item.category === 'application' ? 'Application' : 'User Directory'}
                </span>
              </div>
              <p class="launcher-card-desc">${this.escapeHtml(item.description)}</p>
            </div>
          </div>

          <div class="launcher-path-box" title="${this.escapeHtml(item.resolvedPath)}">
            <span class="path-label">Target Path:</span>
            <code class="path-code">${this.escapeHtml(item.resolvedPath)}</code>
          </div>

          <div class="launcher-card-actions">
            <button
              type="button"
              class="btn btn-primary btn-full"
              data-launch-id="${this.escapeHtml(item.id)}"
            >
              ${item.category === 'application' ? 'Launch Application' : 'Open in File Explorer'}
            </button>
          </div>
        </div>
      `
      )
      .join('');
  }

  private bindEvents(): void {
    const searchInput = this.container.querySelector<HTMLInputElement>('#launcher-search-input');
    searchInput?.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.refreshGridOnly();
    });

    const filterBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-filter]');
    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter') as 'all' | 'folder' | 'application' | null;
        if (filter) {
          this.activeFilter = filter;
          filterBtns.forEach((b) => b.classList.toggle('active', b === btn));
          this.refreshGridOnly();
        }
      });
    });

    this.bindCardLaunchButtons();
  }

  private refreshGridOnly(): void {
    const grid = this.container.querySelector('#launcher-cards-grid');
    if (grid) {
      grid.innerHTML = this.renderFilteredCards();
      this.bindCardLaunchButtons();
    }
  }

  private bindCardLaunchButtons(): void {
    const launchBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-launch-id]');
    launchBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-launch-id') as QuickLaunchTarget | null;
        if (target) {
          this.callbacks.onQuickLaunch(target);
        }
      });
    });
  }

  private getLauncherSvg(id: QuickLaunchTarget): string {
    switch (id) {
      case 'desktop':
        return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
      case 'downloads':
        return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
      case 'documents':
        return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
      case 'pictures':
        return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
      case 'home':
        return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
      case 'notepad':
        return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
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
