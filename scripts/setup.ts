// Interactive first-run setup: checks Node, creates data/ and .env, stores Strava API keys, finds the Health Auto Export folder.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { discoverHaeFolder } from '../server/ingest/hae/folder.js';

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`Node.js 22 or newer is required (you have ${process.versions.node}).`);
  console.error('Install it with Homebrew:  brew install node@22   or download it from https://nodejs.org');
  process.exit(1);
}

const envPath = resolve('.env');
if (!existsSync(envPath)) copyFileSync(resolve('.env.example'), envPath);
mkdirSync(resolve('data'), { recursive: true });

function setEnv(key: string, value: string) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`; else lines.push(`${key}=${value}`);
  writeFileSync(envPath, lines.join('\n'));
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
let closed = false;
const whenClosed = new Promise<string>((res) => rl.once('close', () => { closed = true; res(''); }));
const ask = (q: string) => (closed ? Promise.resolve('') : Promise.race([rl.question(q), whenClosed]));
console.log('\nHealth dashboard setup\n======================\n');
console.log('Strava (optional — not needed; your Apple Watch data covers workouts. Press Enter twice to skip):');
console.log('  1. Go to https://www.strava.com/settings/api and create an application.');
console.log('  2. Set "Authorization Callback Domain" to: localhost');
console.log('  3. Copy the Client ID and Client Secret below (press Enter to skip).\n');
const id = (await ask('Strava Client ID: ')).trim();
if (id) setEnv('STRAVA_CLIENT_ID', id);
const secret = (await ask('Strava Client Secret: ')).trim();
if (secret) setEnv('STRAVA_CLIENT_SECRET', secret);
if (!closed) rl.close();

const folder = discoverHaeFolder(homedir());
console.log('\nHealth Auto Export:');
if (folder) console.log(`  Found its iCloud Drive folder: ${folder}`);
else console.log('  Its iCloud Drive folder is not on this Mac yet. Set up the iCloud Drive automations in the app (see README),\n  run an export once, and the folder will appear. You can also set the path in Settings.');

console.log('\nAll set. Next:');
console.log('  npm run build && npm start      then open http://localhost:4321');
console.log('  npm run install-service         (optional) start automatically when you log in\n');
