import * as path from 'path';

const PROTECTED_SYSTEM_PREFIXES = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata\\microsoft',
  'c:\\system volume information',
  'c:\\$recycle.bin'
];

export interface PathValidationResult {
  valid: boolean;
  resolvedPath?: string;
  error?: string;
}

export class SecurityValidator {
  /**
   * Validate a local file or directory path, rejecting null bytes, relative traversal ('..'),
   * UNC network shares, and sensitive Windows system folders when writing/watching.
   */
  public static validateLocalPath(
    rawPath: unknown,
    options: { allowSystemReadOnly?: boolean } = {}
  ): PathValidationResult {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return { valid: false, error: 'Path cannot be empty.' };
    }

    const trimmed = rawPath.trim();
    if (trimmed.includes('\0')) {
      return { valid: false, error: 'Path contains illegal null byte.' };
    }

    // Reject explicit path traversal segments in raw input
    const segments = trimmed.split(/[\\/]+/);
    if (segments.includes('..')) {
      return {
        valid: false,
        error: 'Path traversal ("..") is prohibited for security.'
      };
    }

    // Reject UNC network paths (offline-only requirement)
    if (trimmed.startsWith('\\\\')) {
      return {
        valid: false,
        error: 'Network UNC paths are not allowed in offline automation.'
      };
    }

    if (!path.isAbsolute(trimmed)) {
      return {
        valid: false,
        error: 'Path must be an absolute local path (e.g. C:\\Users\\...).'
      };
    }

    const resolved = path.resolve(trimmed);
    const lower = resolved.toLowerCase();

    if (!options.allowSystemReadOnly) {
      for (const prefix of PROTECTED_SYSTEM_PREFIXES) {
        if (lower === prefix || lower.startsWith(`${prefix}\\`)) {
          return {
            valid: false,
            error: `Access to protected Windows system directory (${resolved}) is restricted.`
          };
        }
      }
    }

    return { valid: true, resolvedPath: resolved };
  }

  /**
   * Validate that an application executable is on the user's configured Trusted Application Paths list
   * and is not an arbitrary shell interpreter (cmd.exe, powershell.exe, pwsh.exe, wscript.exe, cscript.exe).
   */
  public static validateTrustedExecutable(
    rawExePath: unknown,
    trustedAppPaths: string[]
  ): PathValidationResult {
    if (typeof rawExePath !== 'string' || !rawExePath.trim()) {
      return { valid: false, error: 'Executable path is required.' };
    }

    const trimmed = rawExePath.trim();
    const segments = trimmed.split(/[\\/]+/);
    if (segments.includes('..') || trimmed.includes('\0')) {
      return { valid: false, error: 'Executable path contains invalid traversal or characters.' };
    }

    if (!path.isAbsolute(trimmed)) {
      return { valid: false, error: 'Executable path must be an absolute path.' };
    }

    const resolved = path.resolve(trimmed);
    const baseName = path.basename(resolved).toLowerCase();

    // Block arbitrary command shells per Section 13 ("do not implement arbitrary PowerShell or CMD execution")
    const forbiddenShells = new Set([
      'cmd.exe',
      'powershell.exe',
      'pwsh.exe',
      'wscript.exe',
      'cscript.exe',
      'mshta.exe',
      'regsvr32.exe',
      'rundll32.exe'
    ]);

    if (forbiddenShells.has(baseName)) {
      return {
        valid: false,
        error: `Execution of shell/script interpreter "${baseName}" is prohibited by security policy.`
      };
    }

    const normalizedTrusted = new Set(
      trustedAppPaths.map((p) => path.resolve(p.trim()).toLowerCase())
    );

    if (!normalizedTrusted.has(resolved.toLowerCase())) {
      return {
        valid: false,
        error: `Executable "${resolved}" is not in the Trusted Application Paths allowlist. Add it in Automation Settings first.`
      };
    }

    return { valid: true, resolvedPath: resolved };
  }

  /**
   * Validate URLs to permit strictly http:// and https:// protocols.
   */
  public static validateSafeUrl(rawUrl: unknown): {
    valid: boolean;
    normalizedUrl?: string;
    error?: string;
  } {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return { valid: false, error: 'URL cannot be empty.' };
    }

    try {
      const parsed = new URL(rawUrl.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          valid: false,
          error: `Unsafe URL protocol "${parsed.protocol}". Only http: and https: are permitted.`
        };
      }
      return { valid: true, normalizedUrl: parsed.toString() };
    } catch {
      return { valid: false, error: 'Malformed URL string.' };
    }
  }
}
