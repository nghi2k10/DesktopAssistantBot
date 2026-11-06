import { NavigationPage } from '../types.js';

export interface SidebarCallbacks {
  onNavigate: (page: NavigationPage) => void;
  onHideToTray: () => void;
  onExitApp: () => void;
}

export class SidebarComponent {
  private activePage: NavigationPage = 'dashboard';
  private readonly callbacks: SidebarCallbacks;

  constructor(callbacks: SidebarCallbacks) {
    this.callbacks = callbacks;
  }

  public init(): void {
    const navButtons = document.querySelectorAll<HTMLButtonElement>('[data-nav-page]');
    navButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const page = btn.getAttribute('data-nav-page') as NavigationPage | null;
        if (page) {
          this.setActivePage(page);
          this.callbacks.onNavigate(page);
        }
      });
    });

    const hideBtn = document.getElementById('sidebar-hide-btn');
    hideBtn?.addEventListener('click', () => {
      this.callbacks.onHideToTray();
    });

    const exitBtn = document.getElementById('sidebar-exit-btn');
    exitBtn?.addEventListener('click', () => {
      this.callbacks.onExitApp();
    });
  }

  public setActivePage(page: NavigationPage): void {
    this.activePage = page;
    const navButtons = document.querySelectorAll<HTMLButtonElement>('[data-nav-page]');
    navButtons.forEach((btn) => {
      const target = btn.getAttribute('data-nav-page');
      if (target === page) {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.classList.remove('active');
        btn.removeAttribute('aria-current');
      }
    });
  }

  public getActivePage(): NavigationPage {
    return this.activePage;
  }

  public updateHotkeyBadge(displayHotkey: string): void {
    const sidebarHotkey = document.getElementById('sidebar-hotkey-badge');
    if (sidebarHotkey) {
      sidebarHotkey.textContent = displayHotkey;
    }
  }
}
