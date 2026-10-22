/**
 * Opens a web address as a book: the page is downloaded and made into an EPUB like a saved HTML file
 * (htmlToEpub.ts), with its pictures when it has any; a link to an EPUB or a text file is taken as that
 * file. The Android app downloads with Capacitor's native HTTP client, which is not held back by CORS;
 * the web version can only read the sites that allow it.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { decodeHtml, htmlToEpub, RemoteImage } from './htmlToEpub';
import { decodeText, textToEpub } from './textToEpub';

export type UrlImportErrorCode = 'invalid' | 'blocked' | 'status' | 'type' | 'size' | 'empty' | 'failed';

export class UrlImportError extends Error {
  constructor(readonly code: UrlImportErrorCode, readonly detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'UrlImportError';
  }
}

export interface HttpResult {
  /** The address after redirects. */
  url: string;
  status: number;
  contentType: string;
  bytes: Uint8Array;
}

export interface HttpPort {
  get(url: string, options: { accept: string; maxBytes: number }): Promise<HttpResult>;
}

const MAX_PAGE_BYTES = 10_000_000;
const MAX_IMAGE_BYTES = 1_000_000;
const MAX_IMAGES = 20;
const MAX_IMAGES_TOTAL_BYTES = 4_000_000;
const TIMEOUT_MS = 20_000;
const PAGE_ACCEPT = 'text/html,application/xhtml+xml,application/epub+zip,text/plain;q=0.9,*/*;q=0.1';
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,*/*;q=0.1';

/** An address typed or pasted by the reader: http(s) only, and "example.com/page" is read as https. */
export function normalizeUrl(input: string): string {
  const text = input.trim();
  if (!text || /\s/.test(text)) throw new UrlImportError('invalid');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UrlImportError('invalid');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.') && url.hostname !== 'localhost') {
    throw new UrlImportError('invalid');
  }
  url.hash = '';
  return url.href;
}

const header = (headers: Record<string, unknown>, name: string): string => {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? String(headers[key]) : '';
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/** The real port: native HTTP in the Android app, fetch in the browser. */
export function createHttpPort(): HttpPort {
  if (Capacitor.isNativePlatform()) {
    return {
      async get(url, { accept, maxBytes }) {
        let response;
        try {
          response = await CapacitorHttp.get({
            url,
            headers: { Accept: accept },
            responseType: 'arraybuffer',
            connectTimeout: 15_000,
            readTimeout: TIMEOUT_MS,
          });
        } catch (error) {
          throw new UrlImportError('failed', error instanceof Error ? error.message : String(error));
        }
        if (response.status >= 400) throw new UrlImportError('status', String(response.status));
        const data = typeof response.data === 'string' ? response.data : '';
        // Base64 is a third longer than the bytes it carries.
        if (data.length > maxBytes * 1.4) throw new UrlImportError('size');
        const bytes = base64ToBytes(data);
        if (bytes.length > maxBytes) throw new UrlImportError('size');
        return { url: response.url || url, status: response.status, contentType: header(response.headers ?? {}, 'content-type'), bytes };
      },
    };
  }
  return {
    async get(url, { accept, maxBytes }) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(url, { headers: { Accept: accept }, signal: controller.signal, credentials: 'omit' });
        if (!response.ok) throw new UrlImportError('status', String(response.status));
        const length = Number(response.headers.get('content-length') || 0);
        if (length > maxBytes) throw new UrlImportError('size');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > maxBytes) throw new UrlImportError('size');
        return { url: response.url || url, status: response.status, contentType: response.headers.get('content-type') || '', bytes };
      } catch (error) {
        if (error instanceof UrlImportError) throw error;
        // A page that does not allow other sites to read it, or no connection: the browser does not say which.
        throw new UrlImportError('blocked');
      } finally {
        window.clearTimeout(timer);
      }
    },
  };
}

const sniffMediaType = (bytes: Uint8Array): string | null => {
  const at = (index: number) => bytes[index];
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'image/gif';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45) return 'image/webp';
  return null;
};

export interface UrlImportLabels {
  /** Used as the author when the page names nobody and has no host. */
  fallbackAuthor: string;
}

export interface UrlImportDependencies {
  port?: HttpPort;
  /** Builds a document from HTML. The browser's DOMParser unless a test supplies another. */
  parse?: (html: string) => Document;
}

/** The pictures of a page, fetched within limits, and the page's HTML with their addresses made absolute. */
async function fetchImages(
  html: string,
  base: string,
  port: HttpPort,
  parse: (html: string) => Document,
): Promise<{ html: string; images: Map<string, RemoteImage> }> {
  const images = new Map<string, RemoteImage>();
  const doc = parse(html);
  const elements = Array.from(doc.querySelectorAll('img'));
  const addresses: string[] = [];
  for (const element of elements) {
    const raw = element.getAttribute('src') || element.getAttribute('data-src') || element.getAttribute('data-original') || '';
    if (!raw || raw.startsWith('data:')) continue;
    try {
      const absolute = new URL(raw, base);
      if (absolute.protocol !== 'https:' && absolute.protocol !== 'http:') continue;
      element.setAttribute('src', absolute.href);
      if (!addresses.includes(absolute.href)) addresses.push(absolute.href);
    } catch {
      // an address that cannot be read: the picture stays an description
    }
  }

  let total = 0;
  const wanted = addresses.slice(0, MAX_IMAGES);
  for (let start = 0; start < wanted.length; start += 4) {
    await Promise.all(wanted.slice(start, start + 4).map(async (address) => {
      try {
        const result = await port.get(address, { accept: IMAGE_ACCEPT, maxBytes: MAX_IMAGE_BYTES });
        const declared = result.contentType.toLowerCase().split(';')[0].trim();
        const mediaType = /^image\/(png|jpeg|gif|webp)$/.test(declared) ? declared : sniffMediaType(result.bytes);
        if (!mediaType || total + result.bytes.length > MAX_IMAGES_TOTAL_BYTES) return;
        total += result.bytes.length;
        images.set(address, { mediaType, data: result.bytes });
      } catch {
        // a picture that cannot be had is left as its description
      }
    }));
  }
  return { html: doc.documentElement.outerHTML, images };
}

const lastSegment = (url: string): string => {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1] || '';
  try {
    return decodeURIComponent(last).replace(/\.[^.]+$/, '');
  } catch {
    return last.replace(/\.[^.]+$/, '');
  }
};

/** Downloads an address and returns it as an EPUB file the reader opens. */
export async function importUrlAsEpub(
  input: string,
  labels: UrlImportLabels,
  { port = createHttpPort(), parse }: UrlImportDependencies = {},
): Promise<File> {
  const url = normalizeUrl(input);
  const host = new URL(url).hostname.replace(/^www\./, '') || labels.fallbackAuthor;
  // Android refuses plain http: the secure address is tried first (most sites answer on both).
  const candidates = url.startsWith('http:') && new URL(url).hostname !== 'localhost' ? [url.replace(/^http:/, 'https:'), url] : [url];
  let page: HttpResult | null = null;
  for (const [index, candidate] of candidates.entries()) {
    try {
      page = await port.get(candidate, { accept: PAGE_ACCEPT, maxBytes: MAX_PAGE_BYTES });
      break;
    } catch (error) {
      const moreToTry = index < candidates.length - 1;
      if (!moreToTry || !(error instanceof UrlImportError) || (error.code !== 'failed' && error.code !== 'blocked')) throw error;
    }
  }
  if (!page) throw new UrlImportError('failed');
  const finalUrl = page.url || url;
  const type = page.contentType.toLowerCase().split(';')[0].trim();
  const charset = page.contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
  const buffer = page.bytes.buffer.slice(page.bytes.byteOffset, page.bytes.byteOffset + page.bytes.byteLength) as ArrayBuffer;
  const epubFile = (name: string) => new File([buffer], `${name}.epub`, { type: 'application/epub+zip' });

  const isZip = page.bytes[0] === 0x50 && page.bytes[1] === 0x4b;
  if (type === 'application/epub+zip' || (isZip && /\.epub$/i.test(new URL(finalUrl).pathname))) {
    return epubFile(lastSegment(finalUrl) || host);
  }

  let converted;
  try {
    if (type === 'text/plain') {
      const text = charset ? new TextDecoder(charset).decode(page.bytes) : decodeText(buffer);
      converted = await textToEpub(text, { fallbackTitle: lastSegment(finalUrl) || host, author: host, source: finalUrl });
    } else {
      const html = decodeHtml(buffer, decodeText, charset);
      const looksLikeHtml = type === 'text/html' || type === 'application/xhtml+xml' || /<(html|body|!doctype)/i.test(html.slice(0, 2000));
      if (!looksLikeHtml) throw new UrlImportError('type', type);
      const parser = parse ?? ((source: string) => new DOMParser().parseFromString(source, 'text/html'));
      const prepared = await fetchImages(html, finalUrl, port, parser);
      converted = await htmlToEpub(prepared.html, {
        author: host,
        fallbackTitle: host,
        source: finalUrl,
        parse: parser,
        resolveImage: (src) => prepared.images.get(src) ?? null,
      });
    }
  } catch (error) {
    if (error instanceof UrlImportError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new UrlImportError(/no text|empty/i.test(message) ? 'empty' : 'failed', message);
  }
  return new File([converted.blob], `${converted.title}.epub`, { type: 'application/epub+zip' });
}
