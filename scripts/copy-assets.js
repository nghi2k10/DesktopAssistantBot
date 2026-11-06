const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distSrcDir = path.join(rootDir, 'dist', 'src');
const distStylesDir = path.join(distSrcDir, 'styles');

fs.mkdirSync(distStylesDir, { recursive: true });

fs.copyFileSync(
  path.join(srcDir, 'index.html'),
  path.join(distSrcDir, 'index.html')
);

fs.copyFileSync(
  path.join(srcDir, 'styles', 'main.css'),
  path.join(distStylesDir, 'main.css')
);

console.log('[assets] Copied index.html and styles/main.css to dist/src/');
