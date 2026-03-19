#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

function run() {
  let electronBinary;
  try {
    electronBinary = require('electron');
  } catch (error) {
    console.error('[copilotoffice] Electron is not available. Try reinstalling the package.');
    console.error(error);
    process.exit(1);
  }

  const appRoot = path.resolve(__dirname, '..');
  const child = spawn(electronBinary, [appRoot], {
    stdio: 'inherit',
    windowsHide: false,
    env: {
      ...process.env,
      COPILOT_OFFICE_ENABLE_WATCHER: '0',
      COPILOT_OFFICE_OPEN_DEVTOOLS: '0',
      COPILOT_OFFICE_CLI_MODE: '1',
    },
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error('[copilotoffice] Failed to launch Electron.');
    console.error(error);
    process.exit(1);
  });
}

run();
