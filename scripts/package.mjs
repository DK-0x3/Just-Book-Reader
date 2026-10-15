import { copyFile, readFile, writeFile } from 'node:fs/promises';

const notices = await readFile('THIRD-PARTY-NOTICES.md', 'utf8');
const bundle = await readFile('dist/plugin/main.js', 'utf8');
await writeFile('dist/plugin/main.js', `/*!\n${notices.replaceAll('*/', '* /')}\n*/\n${bundle}`);

await copyFile('manifest.json', 'dist/plugin/manifest.json');
// The standard three files are also available at the project root for local installation.
for (const name of ['main.js', 'styles.css']) await copyFile(`dist/plugin/${name}`, name);
