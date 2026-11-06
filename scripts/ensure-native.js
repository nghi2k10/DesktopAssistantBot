const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.join(__dirname, '..');

// 1. Ensure Electron binary is downloaded
const electronDir = path.join(rootDir, 'node_modules', 'electron');
const electronPathTxt = path.join(electronDir, 'path.txt');
if (fs.existsSync(electronDir) && !fs.existsSync(electronPathTxt)) {
  console.log('[ensure-native] Downloading Electron binary...');
  execFileSync(process.execPath, [path.join(electronDir, 'install.js')], {
    cwd: electronDir,
    stdio: 'inherit'
  });
}

// 2. Ensure better-sqlite3 prebuilt binary for Electron 33.3.1 is downloaded
const sqliteDir = path.join(rootDir, 'node_modules', 'better-sqlite3');
const sqliteNodeBinary = path.join(sqliteDir, 'build', 'Release', 'better_sqlite3.node');
const prebuildInstallBin = path.join(
  rootDir,
  'node_modules',
  'prebuild-install',
  'bin.js'
);

if (fs.existsSync(sqliteDir) && !fs.existsSync(sqliteNodeBinary)) {
  console.log('[ensure-native] Downloading better-sqlite3 prebuilt binary for Electron 33.3.1...');
  execFileSync(
    process.execPath,
    [
      prebuildInstallBin,
      '--runtime=electron',
      '--target=33.3.1',
      '--arch=x64',
      '--platform=win32'
    ],
    {
      cwd: sqliteDir,
      stdio: 'inherit'
    }
  );
}

// 3. Ensure electron-builder winCodeSign cache on Windows avoids macOS darwin symlink error
if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  const winCodeSignCacheDir = path.join(
    process.env.LOCALAPPDATA,
    'electron-builder',
    'Cache',
    'winCodeSign'
  );
  const targetDir = path.join(winCodeSignCacheDir, 'winCodeSign-2.6.0');
  if (fs.existsSync(winCodeSignCacheDir) && !fs.existsSync(targetDir)) {
    const entries = fs.readdirSync(winCodeSignCacheDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && /^\d+$/.test(entry.name)) {
        const candidateDir = path.join(winCodeSignCacheDir, entry.name);
        if (fs.existsSync(path.join(candidateDir, 'rcedit-x64.exe'))) {
          fs.renameSync(candidateDir, targetDir);
          console.log('[ensure-native] Prepared winCodeSign-2.6.0 cache for Windows NSIS packaging.');
          break;
        }
      }
    }
  }
}

console.log('[ensure-native] Electron and better-sqlite3 native binaries verified.');
