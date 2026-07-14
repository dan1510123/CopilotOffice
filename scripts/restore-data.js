#!/usr/bin/env node
// Interactive restore CLI for `.data` snapshots created by the continuous
// backup feature (electron/dataBackup.ts). Lists available `.data-backup-*`
// versions and restores the one you pick, snapshotting the current `.data`
// first so the restore is reversible.
//
// Usage:
//   npm run restore-data            # interactive picker
//   npm run restore-data -- --list  # just list snapshots and exit
//   npm run restore-data -- <name>  # restore a specific backup by folder name

'use strict';

const path = require('path');
const readline = require('readline');

const cwd = process.cwd();
const backup = require(path.join(cwd, 'dist', 'electron', 'dataBackup.js'));

function formatDate(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function ageDays(d) {
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

function printList(backups) {
  if (backups.length === 0) {
    console.log('No .data backups found. They are created automatically when the app opens and closes.');
    return;
  }
  console.log('\nAvailable .data backups (newest first):\n');
  backups.forEach((b, i) => {
    console.log(`  [${String(i + 1).padStart(2)}] ${b.name}`);
    console.log(`       ${formatDate(b.createdAt)}  (${ageDays(b.createdAt)}d ago)  reason: ${b.reason}`);
  });
  console.log('');
}

function doRestore(name) {
  try {
    const result = backup.restoreDataBackup(name, { cwd });
    console.log(`\n✅ Restored .data from ${path.basename(result.restoredFrom)}`);
    if (result.safetyBackup) {
      console.log(`   Previous .data saved as ${path.basename(result.safetyBackup)} (in case you need to undo).`);
    }
  } catch (e) {
    console.error(`\n❌ Restore failed: ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  }
}

function main() {
  const args = process.argv.slice(2);
  const backups = backup.listBackups({ cwd });

  if (args.includes('--list') || args.includes('-l')) {
    printList(backups);
    return;
  }

  // Direct restore by explicit name (skips the prompt).
  const explicit = args.find((a) => !a.startsWith('-'));
  if (explicit) {
    doRestore(explicit);
    return;
  }

  printList(backups);
  if (backups.length === 0) return;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Enter the number to restore (or blank to cancel): ', (answer) => {
    rl.close();
    const trimmed = (answer || '').trim();
    if (!trimmed) {
      console.log('Cancelled — nothing restored.');
      return;
    }
    const idx = Number.parseInt(trimmed, 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= backups.length) {
      console.error('Invalid selection — nothing restored.');
      process.exitCode = 1;
      return;
    }
    doRestore(backups[idx].name);
  });
}

main();
