import { ItemView, Notice, Plugin, moment, type WorkspaceLeaf } from 'obsidian';
import { createApp, type App as VueApp } from 'vue';
import GalleryApp from '../ui/GalleryApp.vue';
import { createLocalization, type Localization } from '../i18n';
import './styles.scss';

const VIEW_TYPE = 'just-book-reader-library';

class GalleryView extends ItemView {
  private vue?: VueApp;

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return 'Just Book Reader'; }
  getIcon(): string { return 'book-open'; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('jbr-view-content');
    this.vue = createApp(GalleryApp);
    this.vue.use(createLocalization(moment.locale()));
    this.vue.mount(this.contentEl);
  }

  async onClose(): Promise<void> {
    this.vue?.unmount();
    this.vue = undefined;
    this.contentEl.removeClass('jbr-view-content');
    this.contentEl.empty();
  }
}

export default class JustBookReader extends Plugin {
  private galleryOpening?: Promise<void>;
  private localization?: Localization;

  async onload(): Promise<void> {
    const localization = this.localization = createLocalization(moment.locale());
    this.registerView(VIEW_TYPE, leaf => new GalleryView(leaf));
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
    this.localization?.dispose();
    this.localization = undefined;
  }
}
