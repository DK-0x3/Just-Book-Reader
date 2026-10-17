import { TFile, type App } from 'obsidian';
import { isEpubPath, type BookFile, type BookVault, type VaultChange } from '../domain/library';

function describe(file: TFile): BookFile {
  return { path: file.path, name: file.basename, size: file.stat.size, mtime: file.stat.mtime };
}

export function createObsidianVault(app: App): BookVault {
  return {
    async list() {
      return app.vault.getFiles().filter(file => isEpubPath(file.path)).map(describe);
    },
    subscribe(listener: (change: VaultChange) => void) {
      const changed = (file: TFile) => {
        if (isEpubPath(file.path)) listener({ type: 'upsert', file: describe(file) });
      };
      const refs = [
        app.vault.on('create', file => { if (file instanceof TFile) changed(file); }),
        app.vault.on('modify', file => { if (file instanceof TFile) changed(file); }),
        app.vault.on('delete', file => {
          if (file instanceof TFile) listener({ type: 'remove', path: file.path });
          else listener({ type: 'reset' });
        }),
        app.vault.on('rename', (file, oldPath) => {
          if (!(file instanceof TFile)) listener({ type: 'reset' });
          else if (isEpubPath(file.path)) listener({ type: 'rename', oldPath, file: describe(file) });
          else listener({ type: 'remove', path: oldPath });
        }),
      ];
      return () => { for (const ref of refs) app.vault.offref(ref); };
    },
  };
}
