// Runs kuromoji off the main thread.
//
// Building the tokenizer downloads, gunzips and indexes ~17 MB of dictionary.
// On the main thread that froze the reader for seconds the first time a word
// was selected (on a phone, long enough to look like a hang: no selection
// handles, no paging, no menu). In a worker it costs nothing the user can feel.

import * as kuromoji from 'kuromoji';

interface Scope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  XMLHttpRequest: typeof XMLHttpRequest;
}
const scope = self as unknown as Scope;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// Wraps raw bytes in a valid gzip container made of stored (uncompressed)
// deflate blocks.
const gzipStored = (raw: Uint8Array): Uint8Array => {
  const blockSize = 0xffff;
  const blocks = Math.max(1, Math.ceil(raw.length / blockSize));
  const out = new Uint8Array(10 + raw.length + blocks * 5 + 8);
  const view = new DataView(out.buffer);
  out.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff], 0);
  let position = 10;
  for (let start = 0, block = 0; block < blocks; block += 1, start += blockSize) {
    const length = Math.min(blockSize, raw.length - start);
    out[position] = block === blocks - 1 ? 1 : 0;
    view.setUint16(position + 1, length, true);
    view.setUint16(position + 3, ~length & 0xffff, true);
    out.set(raw.subarray(start, start + length), position + 5);
    position += 5 + length;
  }
  let crc = 0xffffffff;
  for (let index = 0; index < raw.length; index += 1) {
    crc = crcTable[(crc ^ raw[index]) & 0xff] ^ (crc >>> 8);
  }
  view.setUint32(position, (crc ^ 0xffffffff) >>> 0, true);
  view.setUint32(position + 4, raw.length >>> 0, true);
  return out;
};

// kuromoji downloads its *.dat.gz files and gunzips them itself. Many static
// servers (Vite dev/preview among them) serve a .gz with `Content-Encoding:
// gzip`, so the body arrives already decompressed and kuromoji's own gunzip
// throws "invalid file signature" inside xhr.onload, which leaves the build
// callback uncalled forever. Responses that are no longer gzip are re-wrapped
// so both kinds of server work.
//
// Hosts that have no dictionary (the published artifact) answer a missing file
// with the page itself. That must read as an error: wrapping a 16 MB HTML page
// as if it were a dictionary file twelve times would only burn memory.
const installDictionaryXhrShim = () => {
  const NativeXhr = scope.XMLHttpRequest;
  const responseGetter = Object.getOwnPropertyDescriptor(NativeXhr.prototype, 'response')?.get;
  if (!responseGetter) return;
  const nativeResponse: () => unknown = responseGetter;

  class DictionaryXhr extends NativeXhr {
    private dictionaryUrl = false;
    private wrapped: ArrayBuffer | null = null;

    open(method: string, url: string | URL, ...rest: unknown[]) {
      this.dictionaryUrl = String(url).includes('/dict/');
      return (super.open as (...args: unknown[]) => void)(method, url, ...rest);
    }

    private looksLikeHtml(): boolean {
      if ((this.getResponseHeader('content-type') || '').includes('text/html')) return true;
      const body = nativeResponse.call(this);
      return body instanceof ArrayBuffer && body.byteLength > 0 && new Uint8Array(body, 0, 1)[0] === 0x3c;
    }

    get status() {
      const status = super.status;
      return this.dictionaryUrl && status === 200 && this.looksLikeHtml() ? 404 : status;
    }

    get statusText() {
      return this.dictionaryUrl && super.status === 200 && this.looksLikeHtml()
        ? 'Dictionary file not found'
        : super.statusText;
    }

    get response() {
      const body = nativeResponse.call(this);
      if (!this.dictionaryUrl || !(body instanceof ArrayBuffer) || body.byteLength < 2) return body;
      const head = new Uint8Array(body, 0, 2);
      if (head[0] === 0x1f && head[1] === 0x8b) return body;
      if (!this.wrapped) {
        const wrapped = gzipStored(new Uint8Array(body));
        this.wrapped = wrapped.buffer.slice(wrapped.byteOffset, wrapped.byteOffset + wrapped.byteLength) as ArrayBuffer;
      }
      return this.wrapped;
    }
  }

  scope.XMLHttpRequest = DictionaryXhr as unknown as typeof XMLHttpRequest;
};

let tokenizer: kuromoji.KuromojiTokenizer | null = null;

scope.onmessage = (event: MessageEvent) => {
  const message = event.data as
    | { type: 'init'; dicPath: string }
    | { type: 'tokenize'; id: number; text: string };

  if (message.type === 'init') {
    try {
      installDictionaryXhrShim();
      kuromoji.builder({ dicPath: message.dicPath }).build((error, built) => {
        if (error || !built) {
          scope.postMessage({ type: 'init-error', message: String(error?.message || error || 'kuromoji') });
          return;
        }
        tokenizer = built;
        scope.postMessage({ type: 'ready' });
      });
    } catch (error) {
      scope.postMessage({ type: 'init-error', message: String((error as Error)?.message || error) });
    }
    return;
  }

  if (message.type === 'tokenize') {
    const tokens = tokenizer
      ? tokenizer.tokenize(message.text).map((token) => ({
          surface_form: token.surface_form,
          pos: token.pos,
          basic_form: token.basic_form,
        }))
      : [];
    scope.postMessage({ type: 'tokens', id: message.id, tokens });
  }
};
