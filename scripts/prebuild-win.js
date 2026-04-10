/**
 * Windows: stop a running packaged app and remove win-unpacked so
 * electron-builder is not blocked by EBUSY on Krish-CRM.exe.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const winUnpacked = path.join(root, 'dist', 'win-unpacked');

if (process.platform === 'win32') {
  try {
    execSync('taskkill /F /IM Krish-CRM.exe', { stdio: 'ignore' });
  } catch {
    /* not running */
  }
}

if (fs.existsSync(winUnpacked)) {
  try {
    fs.rmSync(winUnpacked, { recursive: true, force: true });
  } catch (err) {
    console.error(
      'Could not remove dist\\win-unpacked. Close Krish-CRM, close any Explorer window on that folder, then run build again.\n',
      err.message
    );
    process.exit(1);
  }
}
