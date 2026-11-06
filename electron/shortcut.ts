import { globalShortcut } from 'electron';

export interface ShortcutRegistrationResult {
  success: boolean;
  accelerator: string;
  displayHotkey: string;
  message: string;
}

const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: 'CommandOrControl',
  control: 'CommandOrControl',
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super'
};

const VALID_MAIN_KEY_PATTERN = /^([A-Za-z0-9]|F[1-9]|F1[0-9]|F2[0-4]|Space|Tab|Enter|Return|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Minus|Equal|Comma|Period|Slash|Backslash|Semicolon|Quote|Backquote|BracketLeft|BracketRight)$/i;

const KEY_NORMALIZATION: Record<string, string> = {
  space: 'Space',
  spacebar: 'Space',
  tab: 'Tab',
  enter: 'Return',
  return: 'Return',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  ins: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pgup: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  up: 'Up',
  arrowup: 'Up',
  down: 'Down',
  arrowdown: 'Down',
  left: 'Left',
  arrowleft: 'Left',
  right: 'Right',
  arrowright: 'Right',
  plus: 'Plus',
  minus: 'Minus',
  '-': 'Minus',
  '=': 'Equal',
  equal: 'Equal',
  ',': 'Comma',
  comma: 'Comma',
  '.': 'Period',
  period: 'Period',
  '/': 'Slash',
  slash: 'Slash',
  '\\': 'Backslash',
  backslash: 'Backslash',
  ';': 'Semicolon',
  semicolon: 'Semicolon',
  "'": 'Quote',
  quote: 'Quote',
  '`': 'Backquote',
  backquote: 'Backquote',
  '[': 'BracketLeft',
  bracketleft: 'BracketLeft',
  ']': 'BracketRight',
  bracketright: 'BracketRight'
};

export class ShortcutManager {
  private currentAccelerator: string = 'CommandOrControl+Shift+Space';
  private readonly onTrigger: () => void;

  constructor(onTrigger: () => void, initialAccelerator?: string) {
    this.onTrigger = onTrigger;
    if (initialAccelerator) {
      this.currentAccelerator = initialAccelerator;
    }
  }

  public static formatForDisplay(accelerator: string): string {
    return accelerator
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        if (
          part.toLowerCase() === 'commandorcontrol' ||
          part.toLowerCase() === 'cmdorctrl' ||
          part.toLowerCase() === 'control'
        ) {
          return 'Ctrl';
        }
        return part;
      })
      .join(' + ');
  }

  public static parseAndValidate(rawInput: string): {
    valid: boolean;
    accelerator?: string;
    error?: string;
  } {
    if (typeof rawInput !== 'string' || !rawInput.trim()) {
      return { valid: false, error: 'Shortcut cannot be empty.' };
    }

    const tokens = rawInput
      .split('+')
      .map((t) => t.trim())
      .filter(Boolean);

    if (tokens.length < 2) {
      return {
        valid: false,
        error: 'Shortcut must include at least one modifier key (Ctrl, Alt, Shift) and one action key.'
      };
    }

    const modifiers: string[] = [];
    const mainKeys: string[] = [];

    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (MODIFIER_ALIASES[lower]) {
        const mod = MODIFIER_ALIASES[lower];
        if (!modifiers.includes(mod)) {
          modifiers.push(mod);
        }
      } else {
        let normalizedKey = KEY_NORMALIZATION[lower] || token;
        if (normalizedKey.length === 1) {
          normalizedKey = normalizedKey.toUpperCase();
        } else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(normalizedKey)) {
          normalizedKey = normalizedKey.toUpperCase();
        }

        if (!VALID_MAIN_KEY_PATTERN.test(normalizedKey)) {
          return {
            valid: false,
            error: `Unsupported key "${token}" in shortcut.`
          };
        }
        mainKeys.push(normalizedKey);
      }
    }

    if (modifiers.length === 0) {
      return {
        valid: false,
        error: 'Shortcut must contain at least one modifier (Ctrl, Alt, Shift, or Super).'
      };
    }

    if (mainKeys.length !== 1) {
      return {
        valid: false,
        error: 'Shortcut must contain exactly one non-modifier key (e.g., Space, K, F1).'
      };
    }

    // Order modifiers consistently: CommandOrControl, Alt, Shift, Super
    const orderedMods: string[] = [];
    for (const m of ['CommandOrControl', 'Alt', 'Shift', 'Super']) {
      if (modifiers.includes(m)) {
        orderedMods.push(m);
      }
    }

    const accelerator = [...orderedMods, mainKeys[0]].join('+');
    return { valid: true, accelerator };
  }

  public getCurrentAccelerator(): string {
    return this.currentAccelerator;
  }

  public getCurrentDisplayHotkey(): string {
    return ShortcutManager.formatForDisplay(this.currentAccelerator);
  }

  public registerInitial(acceleratorToTry?: string): ShortcutRegistrationResult {
    const candidate = acceleratorToTry || this.currentAccelerator;
    const result = this.registerShortcut(candidate);
    if (result.success) {
      return result;
    }

    // Fallback to default CommandOrControl+Shift+Space if custom initial failed
    if (candidate !== 'CommandOrControl+Shift+Space') {
      const fallback = this.registerShortcut('CommandOrControl+Shift+Space');
      if (fallback.success) {
        return {
          ...fallback,
          message: `Saved shortcut "${ShortcutManager.formatForDisplay(candidate)}" was unavailable. Restored default "${fallback.displayHotkey}".`
        };
      }
    }

    return result;
  }

  public updateShortcut(rawInput: string): ShortcutRegistrationResult {
    const validation = ShortcutManager.parseAndValidate(rawInput);
    if (!validation.valid || !validation.accelerator) {
      return {
        success: false,
        accelerator: this.currentAccelerator,
        displayHotkey: this.getCurrentDisplayHotkey(),
        message: validation.error || 'Invalid shortcut format.'
      };
    }

    const newAccelerator = validation.accelerator;
    const previousAccelerator = this.currentAccelerator;

    if (
      newAccelerator === previousAccelerator &&
      globalShortcut.isRegistered(previousAccelerator)
    ) {
      return {
        success: true,
        accelerator: this.currentAccelerator,
        displayHotkey: this.getCurrentDisplayHotkey(),
        message: `Global hotkey is already set to ${this.getCurrentDisplayHotkey()}.`
      };
    }

    // Unregister previous shortcut before attempting new registration
    if (previousAccelerator && globalShortcut.isRegistered(previousAccelerator)) {
      try {
        globalShortcut.unregister(previousAccelerator);
      } catch {
        // Ignore unregister error
      }
    }

    const attempt = this.registerShortcut(newAccelerator);
    if (attempt.success) {
      return attempt;
    }

    // Registration failed: restore previous working shortcut
    if (previousAccelerator) {
      try {
        globalShortcut.register(previousAccelerator, this.onTrigger);
        this.currentAccelerator = previousAccelerator;
      } catch (restoreErr) {
        console.error('[ShortcutManager] Failed to restore previous shortcut:', restoreErr);
      }
    }

    return {
      success: false,
      accelerator: this.currentAccelerator,
      displayHotkey: this.getCurrentDisplayHotkey(),
      message: `${attempt.message} Restored previous shortcut (${this.getCurrentDisplayHotkey()}).`
    };
  }

  private registerShortcut(accelerator: string): ShortcutRegistrationResult {
    try {
      const ok = globalShortcut.register(accelerator, () => {
        this.onTrigger();
      });

      if (!ok || !globalShortcut.isRegistered(accelerator)) {
        return {
          success: false,
          accelerator: this.currentAccelerator,
          displayHotkey: this.getCurrentDisplayHotkey(),
          message: `Unable to register "${ShortcutManager.formatForDisplay(accelerator)}". It may be in use by another application or reserved by Windows.`
        };
      }

      this.currentAccelerator = accelerator;
      return {
        success: true,
        accelerator: this.currentAccelerator,
        displayHotkey: this.getCurrentDisplayHotkey(),
        message: `Global hotkey updated to ${this.getCurrentDisplayHotkey()}.`
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        accelerator: this.currentAccelerator,
        displayHotkey: this.getCurrentDisplayHotkey(),
        message: `Error registering shortcut "${ShortcutManager.formatForDisplay(accelerator)}": ${msg}.`
      };
    }
  }

  public dispose(): void {
    try {
      globalShortcut.unregisterAll();
    } catch (error) {
      console.error('[ShortcutManager] Error unregistering shortcuts:', error);
    }
  }
}
