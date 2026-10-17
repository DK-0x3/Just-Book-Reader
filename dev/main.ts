import { createApp, h, ref, shallowRef } from 'vue';
import GalleryApp from '../src/ui/GalleryApp.vue';
import { createLocalization, resolveLocale } from '../src/i18n';
import './styles.scss';
import { LibraryService } from '../src/app/library-service';
import { BrowserVault } from './browser-vault';

const localization = createLocalization('ru');
const { locale, t } = localization.global;
const vault = new BrowserVault();
const service = shallowRef<LibraryService | null>(new LibraryService(vault));
const upload = ref<HTMLInputElement>();
let viewId = 0;
function toggleView(): void {
  if (service.value) {
    service.value.destroy();
    service.value = null;
  } else {
    service.value = new LibraryService(vault);
    viewId++;
  }
}
const app = createApp({
  setup() {
    return () => h('div', { class: 'dev-shell' }, [
      h('div', { class: 'dev-toolbar' }, [
        h('span', t('development.title')),
        h('button', { onClick: () => upload.value?.click() }, t('development.chooseFiles')),
        h('input', {
          ref: upload, type: 'file', accept: '.epub', multiple: true, hidden: true,
          'aria-label': t('development.chooseFiles'),
          onChange: (event: Event) => {
            const input = event.target as HTMLInputElement;
            vault.add(Array.from(input.files || []));
            input.value = '';
          },
        }),
        h('button', { onClick: () => vault.clear() }, t('development.clearFiles')),
        h('label', [
          `${t('development.language')} `,
          h('select', {
            value: locale.value,
            onChange: (event: Event) => {
              locale.value = resolveLocale((event.target as HTMLSelectElement).value);
            },
          }, [h('option', { value: 'ru' }, 'Русский'), h('option', { value: 'en' }, 'English')]),
        ]),
        h('button', { onClick: toggleView },
          t(service.value ? 'development.closeView' : 'development.openView')),
      ]),
      service.value ? h(GalleryApp, { key: viewId, service: service.value }) : null,
    ]);
  },
});
app.use(localization);
app.mount('#app');

let disposed = false;
function dispose(): void {
  if (disposed) return;
  disposed = true;
  window.removeEventListener('pagehide', dispose);
  app.unmount();
  service.value?.destroy();
  vault.clear();
}
window.addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
