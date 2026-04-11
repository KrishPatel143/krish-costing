/**
 * Windows: stop a running packaged app, wait for handles to drop, then remove
 * dist\win-unpacked (or all of dist with --full) so electron-builder avoids
 * EBUSY on Krish-CRM.exe.
 *
 * Usage: node scripts/prebuild-win.js [--full]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const winUnpacked = path.join(distDir, 'win-unpacked');
const exePath = path.join(winUnpacked, 'Krish-CRM.exe');
const fullClean = process.argv.includes('--full');

function winSleepSeconds(seconds) {
  if (process.platform !== 'win32') return;
  try {
    const n = Math.max(2, Math.floor(seconds) + 1);
    execSync(`ping 127.0.0.1 -n ${n} >nul`, { shell: true, stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}

function rmPathWithRetry(target, label) {
  if (!fs.existsSync(target)) return;
  const attempts = fullClean ? 8 : 6;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      winSleepSeconds(1);
    }
  }
}

if (process.platform === 'win32') {
  try {
    execSync('taskkill /F /IM Krish-CRM.exe /T', { stdio: 'ignore' });
  } catch {
    /* not running */
  }
  winSleepSeconds(2);
}

if (fs.existsSync(exePath)) {
  for (let i = 0; i < 4; i++) {
    try {
      fs.unlinkSync(exePath);
      break;
    } catch {
      winSleepSeconds(1);
    }
  }
}

try {
  if (fullClean && fs.existsSync(distDir)) {
    rmPathWithRetry(distDir, 'dist');
  } else {
    rmPathWithRetry(winUnpacked, 'dist\\win-unpacked');
  }
} catch (err) {
  console.error(
    fullClean
      ? 'Could not remove dist\\. Try:\n'
      : 'Could not remove dist\\win-unpacked. Try:\n',
    '• Quit Krish-CRM (system tray too).\n',
    '• Close Explorer windows under dist\\.\n',
    '• Close extra VS Code / Cursor windows (they can lock tools under dist\\).\n',
    '• Pause antivirus for this folder, or run: npm run build:win:clean\n',
    err.message
  );
  process.exit(1);
}
