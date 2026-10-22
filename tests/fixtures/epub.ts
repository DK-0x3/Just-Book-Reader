import JSZip from 'jszip';

export const coverPng = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=', 'base64',
));

export interface EpubOptions {
  title?: string;
  authors?: string[];
  legacy?: boolean;
  coverHref?: string | null;
  coverPath?: string;
  cover?: Uint8Array | string;
  container?: string;
  opf?: string;
  extraEntries?: number;
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Synthetic archives only: no copyrighted book fixtures or filesystem paths. */
export async function makeEpub(options: EpubOptions = {}): Promise<Buffer> {
  const zip = new JSZip();
  const href = options.coverHref === undefined ? 'Images/cover%20one.png' : options.coverHref;
  const coverItem = href ? `<item id="cover" href="${xml(href)}" media-type="image/png" ${options.legacy ? '' : 'properties="nav cover-image"'}/>` : '';
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', options.container ?? `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book%20info.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OPS/book info.opf', options.opf ?? `<package xmlns="http://www.idpf.org/2007/opf" version="${options.legacy ? '2.0' : '3.0'}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(options.title ?? 'Настоящее название')}</dc:title>${(options.authors ?? ['Первый автор', 'Второй автор']).map(author => `<dc:creator>${xml(author)}</dc:creator>`).join('')}${options.legacy ? '<meta name="cover" content="cover"/>' : ''}</metadata><manifest>${coverItem}</manifest></package>`);
  zip.file(options.coverPath ?? 'OPS/Images/cover one.png', options.cover ?? coverPng);
  for (let i = 0; i < (options.extraEntries ?? 0); i++) zip.file(`unused/${i}`, '');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
