// Installs or removes a macOS launchd agent that starts the dashboard at login and keeps it running.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const LABEL = 'com.local.health-dashboard';
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const action = process.argv[2] ?? 'install';

if (process.platform !== 'darwin') {
  console.error('Start-at-login uses macOS launchd and only works on a Mac.');
  process.exit(1);
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

if (action === 'uninstall') {
  if (existsSync(plistPath)) {
    try { execFileSync('launchctl', ['unload', plistPath]); } catch { /* not loaded */ }
    unlinkSync(plistPath);
  }
  console.log('Start-at-login removed.');
  process.exit(0);
}

const repo = resolve('.');
const logs = join(repo, 'data', 'logs');
mkdirSync(logs, { recursive: true });
mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(process.execPath)}</string><string>${xml(join(repo, 'dist', 'server', 'server', 'index.js'))}</string></array>
  <key>WorkingDirectory</key><string>${xml(repo)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(join(logs, 'out.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logs, 'err.log'))}</string>
</dict>
</plist>
`;
if (!existsSync(join(repo, 'dist', 'server', 'server', 'index.js'))) {
  console.error('Build the app first: npm run build');
  process.exit(1);
}
if (existsSync(plistPath)) { try { execFileSync('launchctl', ['unload', plistPath]); } catch { /* not loaded */ } }
writeFileSync(plistPath, plist);
execFileSync('launchctl', ['load', plistPath]);
console.log(`Installed. The dashboard now starts when you log in: http://localhost:4321\nLogs: ${logs}`);
