import { ItemView, Notice, Platform, Plugin, moment, type WorkspaceLeaf } from 'obsidian';
import { createApp, type App as VueApp } from 'vue';
import GalleryApp from '../ui/GalleryApp.vue';
import { createLocalization, type Localization } from '../i18n';
import './styles.scss';
import { LibraryService } from '../app/library-service';
import { createObsidianVault } from './vault';
import { readEpubMetadata } from '../infrastructure/epub/metadata';
import { PersistentLibraryCache } from '../infrastructure/cache/library-cache';
import { createObsidianCacheStorage } from './cache';
import { LibraryWorkBudget } from '../app/library-work-budget';
import { PreferencesService } from '../app/preferences-service';
import { createObsidianPreferencesStorage } from './preferences';

const VIEW_TYPE = 'just-book-reader-library';

class GalleryView extends ItemView {
  private vue?: VueApp;
  private service?: LibraryService;

  constructor(leaf: WorkspaceLeaf, private cache: PersistentLibraryCache, private budget: LibraryWorkBudget,
    private preferences: PreferencesService) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

getDisplayText(): string {
    return 'Just Book Reader';
  }

getIcon(): string {
    return 'book-open';
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('jbr-view-content');
    this.service = new LibraryService(createObsidianVault(this.app), readEpubMetadata, this.cache, this.budget);
    this.vue = createApp(GalleryApp, { service: this.service, preferences: this.preferences });
    this.vue.use(createLocalization(moment.locale()));
    this.vue.mount(this.contentEl);
  }

  async onClose(): Promise<void> {
    this.service?.destroy();
    this.vue?.unmount();
    this.vue = undefined;
    this.service = undefined;
    this.contentEl.removeClass('jbr-view-content');
    this.contentEl.empty();
  }
}

export default class JustBookReader extends Plugin {
  private cache?: PersistentLibraryCache;
  private budget = new LibraryWorkBudget();
  private galleryOpening?: Promise<void>;
  private localization?: Localization;
  private preferences?: PreferencesService;

  async onload(): Promise<void> {
    const localization = this.localization = createLocalization(moment.locale());
    const directory = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const cache = this.cache = new PersistentLibraryCache(createObsidianCacheStorage(this.app.vault.adapter, directory));
    const preferences = this.preferences = new PreferencesService(createObsidianPreferencesStorage(this.app.vault.adapter, directory),
      Platform.isMobile ? 'mobile' : 'desktop');
    await preferences.load();
    this.registerView(VIEW_TYPE, leaf => new GalleryView(leaf, cache, this.budget, preferences));
    const open = () => {
      void this.openGallery().catch(error => {
        console.error('Just Book Reader: unable to open library', error);
        new Notice(localization.global.t('errors.openLibrary'));
      });
    };
    this.addRibbonIcon('book-open', 'Just Book Reader', open);
    this.addCommand({
      id: 'open-library',
      name: localization.global.t('commands.openLibrary'),
      callback: open,
    });
  }

  async openGallery(): Promise<void> {
    if (this.galleryOpening) return this.galleryOpening;
    this.galleryOpening = this.activateGallery();
    try {
      await this.galleryOpening;
    } finally {
      this.galleryOpening = undefined;
    }
  }

  private async activateGallery(): Promise<void> {
    let leaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    void this.cache?.flush();
    this.preferences?.dispose();
    this.localization?.dispose();
    this.localization = undefined;
  }
}
