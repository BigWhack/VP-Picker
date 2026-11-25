import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Find Health Auto Export's iCloud Drive folder under ~/Library/Mobile Documents. */
export function discoverHaeFolder(home: string): string | null {
  const root = join(home, 'Library', 'Mobile Documents');
  if (!existsSync(root)) return null;
  for (const name of readdirSync(root)) {
    const n = name.toLowerCase();
    if (n.includes('healthexport') || n.includes('health auto export') || n.includes('healthautoexport')) {
      const docs = join(root, name, 'Documents');
      return existsSync(docs) ? docs : join(root, name);
    }
  }
  return null;
}

/** All *.json files under a folder, recursively, oldest first. */
export function listJsonFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.')) continue;
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.toLowerCase().endsWith('.json')) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}
