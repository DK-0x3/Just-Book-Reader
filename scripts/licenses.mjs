import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const additionalNotices = JSON.parse(await readFile('scripts/license-notices.json', 'utf8'));
const sections = ['# Third-party notices\n\nNotices for installed production dependencies. Some development-only compiler paths may be tree-shaken from the final plugin.'];
for (const [directory, record] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!directory || record.dev) continue;
  const info = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const files = await readdir(directory);
  const licenses = files.filter(file => /^(license|copying)([.-].*)?$/i.test(file));
  let notices = await Promise.all(licenses.map(async file => await readFile(path.join(directory, file), 'utf8')));
  if (!notices.length) {
    const readme = files.find(file => /^readme([.-].*)?$/i.test(file));
    const text = readme ? await readFile(path.join(directory, readme), 'utf8') : '';
    const licenseSection = text.match(/^##? License\b[\s\S]*/im)?.[0];
    const notice = licenseSection || additionalNotices[info.name];
    if (!notice) throw new Error(`Missing license notice for ${info.name}`);
    notices = [notice];
  }
  sections.push(`## ${info.name} ${info.version}\n\n${notices.join('\n\n')}`);
}
await writeFile('THIRD-PARTY-NOTICES.md', sections.join('\n\n') + '\n');
