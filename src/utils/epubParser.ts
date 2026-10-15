import JSZip from 'jszip';
import { ManifestItem, ParsedEpub, SpineItem, TocItem } from '../types/epub';

// Helper to normalize path (handle ../ and ./)
function resolveRelativePath(basePath: string, relativePath: string): string {
  // Remove leading slash if any
  let cleanRelative = relativePath.replace(/^\//, '');
  
  // If base has a directory component, extract it
  const baseDir = basePath.includes('/') ? basePath.substring(0, basePath.lastIndexOf('/') + 1) : '';
  const fullPath = baseDir + cleanRelative;
  
  // Normalize segments
  const segments = fullPath.split('/');
  const resolvedSegments: string[] = [];
  
  for (const segment of segments) {
    if (segment === '.' || segment === '') {
      continue;
    } else if (segment === '..') {
      if (resolvedSegments.length > 0) {
        resolvedSegments.pop();
      }
    } else {
      resolvedSegments.push(segment);
    }
  }
  
  return resolvedSegments.join('/');
}

function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith('image/');
}

function findCoverManifestItem(
  opfDoc: Document,
  manifestMap: Record<string, ManifestItem>
): ManifestItem | undefined {
  const byProperty = Object.values(manifestMap).find((item) =>
    item.properties?.split(/\s+/).includes('cover-image')
  );
  if (byProperty) return byProperty;

  const coverMeta =
    opfDoc.querySelector('meta[name="cover"]') ||
    opfDoc.querySelector('meta[property="cover"]');
  const coverMetaId = coverMeta?.getAttribute('content')?.trim();
  if (coverMetaId && manifestMap[coverMetaId]) return manifestMap[coverMetaId];

  return Object.values(manifestMap).find((item) => {
    if (!isImageMediaType(item.mediaType)) return false;
    return /cover|titlepage/i.test(`${item.id} ${item.href}`);
  });
}

async function readCoverBlob(
  zip: JSZip,
  opfDoc: Document,
  rootPath: string,
  manifestMap: Record<string, ManifestItem>
): Promise<Blob | undefined> {
  const coverItem = findCoverManifestItem(opfDoc, manifestMap);
  if (!coverItem) return undefined;

  const coverPath = resolveRelativePath(rootPath, coverItem.href);
  const coverZipFile = zip.file(coverPath);
  if (!coverZipFile) return undefined;

  const coverBlob = await coverZipFile.async('blob');
  const mediaType = coverItem.mediaType || getMimeType(coverPath);
  return coverBlob.type ? coverBlob : new Blob([coverBlob], { type: mediaType });
}

async function loadOpfFromZip(zip: JSZip): Promise<{
  opfDoc: Document;
  rootPath: string;
  manifestMap: Record<string, ManifestItem>;
} | null> {
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) return null;

  const containerXml = await containerFile.async('text');
  const domParser = new DOMParser();
  const containerDoc = domParser.parseFromString(containerXml, 'application/xml');
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) return null;

  const opfFile = zip.file(opfPath);
  if (!opfFile) return null;

  const opfXml = await opfFile.async('text');
  const opfDoc = domParser.parseFromString(opfXml, 'application/xml');
  const rootPath = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifestMap: Record<string, ManifestItem> = {};
  opfDoc.querySelectorAll('manifest > item').forEach((item) => {
    const id = item.getAttribute('id') || '';
    const href = item.getAttribute('href') || '';
    const mediaType = item.getAttribute('media-type') || '';
    const properties = item.getAttribute('properties') || '';
    if (id && href) {
      manifestMap[id] = { id, href, mediaType, properties };
    }
  });

  return { opfDoc, rootPath, manifestMap };
}

export async function extractEpubCoverBlob(data: ArrayBuffer | Blob): Promise<Blob | undefined> {
  try {
    const zip = await JSZip.loadAsync(data);
    const opf = await loadOpfFromZip(zip);
    if (!opf) return undefined;
    return readCoverBlob(zip, opf.opfDoc, opf.rootPath, opf.manifestMap);
  } catch {
    return undefined;
  }
}

// Get mime type by extension
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html':
    case 'xhtml':
      return 'application/xhtml+xml';
    case 'css':
      return 'text/css';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    case 'ttf':
      return 'font/ttf';
    case 'otf':
      return 'font/otf';
    case 'woff':
      return 'font/woff';
    case 'woff2':
      return 'font/woff2';
    case 'js':
      return 'application/javascript';
    default:
      return 'application/octet-stream';
  }
}

export async function parseEpub(data: ArrayBuffer | Blob): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(data);
  const createdBlobUrls: string[] = [];

  // 1. Read container.xml
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    throw new Error('Archivo EPUB no válido: No se encontró META-INF/container.xml');
  }

  const containerXml = await containerFile.async('text');
  const domParser = new DOMParser();
  const containerDoc = domParser.parseFromString(containerXml, 'application/xml');
  const rootfileEl = containerDoc.querySelector('rootfile');
  const opfPath = rootfileEl?.getAttribute('full-path');

  if (!opfPath) {
    throw new Error('No se pudo determinar la ruta del archivo OPF');
  }

  const rootPath = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  // 2. Read OPF file
  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error(`No se encontró el archivo OPF en: ${opfPath}`);
  }

  const opfXml = await opfFile.async('text');
  const opfDoc = domParser.parseFromString(opfXml, 'application/xml');

  // Metadata
  const metadataEl = opfDoc.querySelector('metadata');
  const title = metadataEl?.querySelector('title')?.textContent || 'Sin título';
  const creator = metadataEl?.querySelector('creator')?.textContent || 'Autor desconocido';
  const language = metadataEl?.querySelector('language')?.textContent || 'ja';
  const description = metadataEl?.querySelector('description')?.textContent || '';
  const publisher = metadataEl?.querySelector('publisher')?.textContent || '';

  // Page progression direction (EPUB 3 spine page-progression-direction or EPUB 2 meta)
  const spineEl = opfDoc.querySelector('spine');
  let directionAttr = spineEl?.getAttribute('page-progression-direction');
  if (!directionAttr) {
    const metaProgression = opfDoc.querySelector('meta[property="page-progression-direction"]');
    directionAttr = metaProgression?.textContent || undefined;
  }
  
  const direction: 'rtl' | 'ltr' = directionAttr === 'rtl' ? 'rtl' : (language.toLowerCase().startsWith('ja') ? 'rtl' : 'ltr');

  // Manifest
  const manifestMap: Record<string, ManifestItem> = {};
  const manifestItems = opfDoc.querySelectorAll('manifest > item');

  manifestItems.forEach((item) => {
    const id = item.getAttribute('id') || '';
    const href = item.getAttribute('href') || '';
    const mediaType = item.getAttribute('media-type') || '';
    const properties = item.getAttribute('properties') || '';

    if (id && href) {
      manifestMap[id] = { id, href, mediaType, properties };
    }
  });

  // Spine
  const spine: SpineItem[] = [];
  const itemRefs = opfDoc.querySelectorAll('spine > itemref');
  itemRefs.forEach((itemRef) => {
    const idref = itemRef.getAttribute('idref');
    const linear = itemRef.getAttribute('linear') !== 'no';
    const properties = itemRef.getAttribute('properties') || '';
    
    if (idref && manifestMap[idref]) {
      spine.push({
        id: idref,
        href: manifestMap[idref].href,
        mediaType: manifestMap[idref].mediaType,
        linear,
        properties
      });
    }
  });

  const coverBlob = await readCoverBlob(zip, opfDoc, rootPath, manifestMap);
  const coverUrl = coverBlob ? URL.createObjectURL(coverBlob) : undefined;
  if (coverUrl) createdBlobUrls.push(coverUrl);

  // TOC (Table of Contents)
  let toc: TocItem[] = [];
  
  // Try EPUB 3 Navigation Document
  const navItem = Object.values(manifestMap).find((item) => item.properties?.includes('nav'));
  if (navItem) {
    const navPath = resolveRelativePath(rootPath, navItem.href);
    const navFile = zip.file(navPath);
    if (navFile) {
      const navXml = await navFile.async('text');
      const navDoc = domParser.parseFromString(navXml, 'application/xhtml+xml');
      const navToc = navDoc.querySelector('nav[*|type="toc"], nav#toc, nav');
      if (navToc) {
        const parseOl = (ol: Element): TocItem[] => {
          const items: TocItem[] = [];
          const lis = ol.querySelectorAll(':scope > li');
          lis.forEach((li, idx) => {
            const a = li.querySelector(':scope > a, :scope > span');
            if (a) {
              const label = a.textContent?.trim() || `Capítulo ${idx + 1}`;
              const href = a.getAttribute('href') || '';
              const subOl = li.querySelector(':scope > ol, :scope > ul');
              const subitems = subOl ? parseOl(subOl) : undefined;
              items.push({
                id: `nav-${idx}`,
                label,
                href: resolveRelativePath(navPath, href),
                subitems
              });
            }
          });
          return items;
        };
        const rootOl = navToc.querySelector('ol, ul');
        if (rootOl) {
          toc = parseOl(rootOl);
        }
      }
    }
  }

  // Fallback: EPUB 2 NCX
  if (toc.length === 0) {
    const ncxId = spineEl?.getAttribute('toc') || Object.keys(manifestMap).find(k => manifestMap[k].mediaType === 'application/x-dtbncx+xml');
    if (ncxId && manifestMap[ncxId]) {
      const ncxPath = resolveRelativePath(rootPath, manifestMap[ncxId].href);
      const ncxFile = zip.file(ncxPath);
      if (ncxFile) {
        const ncxXml = await ncxFile.async('text');
        const ncxDoc = domParser.parseFromString(ncxXml, 'application/xml');
        
        const parseNavPoints = (parentEl: Element): TocItem[] => {
          const items: TocItem[] = [];
          const points = parentEl.querySelectorAll(':scope > navPoint');
          points.forEach((point) => {
            const id = point.getAttribute('id') || '';
            const label = point.querySelector('navLabel > text')?.textContent?.trim() || '';
            const src = point.querySelector('content')?.getAttribute('src') || '';
            const subitems = parseNavPoints(point);
            items.push({
              id,
              label,
              href: resolveRelativePath(ncxPath, src),
              subitems: subitems.length > 0 ? subitems : undefined
            });
          });
          return items;
        };
        const navMap = ncxDoc.querySelector('navMap');
        if (navMap) {
          toc = parseNavPoints(navMap);
        }
      }
    }
  }

  // Fallback to spine items if no TOC
  if (toc.length === 0) {
    toc = spine.map((item, idx) => ({
      id: item.id,
      label: `Sección ${idx + 1}`,
      href: resolveRelativePath(rootPath, item.href)
    }));
  }

  // Resource blob resolver
  const getResourceBlobUrl = async (rawPath: string): Promise<string | null> => {
    // Strip hash or query params
    const cleanPath = rawPath.split('#')[0].split('?')[0];
    const file = zip.file(cleanPath);
    if (!file) return null;

    const mime = getMimeType(cleanPath);
    const arrayBuffer = await file.async('arraybuffer');
    const blob = new Blob([arrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    createdBlobUrls.push(url);
    return url;
  };

  // Chapter content processor (resolves images, styles, links inside the chapter)
  const getChapterContent = async (chapterHref: string): Promise<string> => {
    // Normalize path inside zip
    const chapterPath = resolveRelativePath(rootPath, chapterHref.split('#')[0]);
    const chapterFile = zip.file(chapterPath);
    if (!chapterFile) {
      throw new Error(`Capítulo no encontrado: ${chapterPath}`);
    }

    const htmlContent = await chapterFile.async('text');
    const chapterDoc = domParser.parseFromString(htmlContent, 'application/xhtml+xml');

    // Rewrite Images (img src & svg image xlink:href)
    const images = chapterDoc.querySelectorAll('img, image');
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const srcAttr = img.tagName.toLowerCase() === 'image' ? 'xlink:href' : 'src';
      const rawSrc = img.getAttribute(srcAttr) || img.getAttribute('src') || img.getAttribute('href');
      if (rawSrc && !rawSrc.startsWith('data:') && !rawSrc.startsWith('http')) {
        const resolvedPath = resolveRelativePath(chapterPath, rawSrc);
        const blobUrl = await getResourceBlobUrl(resolvedPath);
        if (blobUrl) {
          img.setAttribute(srcAttr, blobUrl);
          if (img.tagName.toLowerCase() === 'image') {
            img.setAttribute('href', blobUrl);
          }
        }
      }
    }

    // Calibre wraps covers in <svg width="100%" height="100%" preserveAspectRatio="none">,
    // which stretches the picture whenever the reader's size limits change the
    // box's proportions. Keep the image's own proportions instead.
    const svgs = chapterDoc.querySelectorAll('svg');
    for (let i = 0; i < svgs.length; i++) {
      const svg = svgs[i];
      if (svg.getAttribute('preserveAspectRatio')?.trim() === 'none' && svg.querySelector('image')) {
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      }
    }

    // Rewrite Stylesheets <link rel="stylesheet" href="...">
    const styleLinks = chapterDoc.querySelectorAll('link[rel="stylesheet"]');
    for (let i = 0; i < styleLinks.length; i++) {
      const link = styleLinks[i];
      const href = link.getAttribute('href');
      if (href && !href.startsWith('http')) {
        const resolvedPath = resolveRelativePath(chapterPath, href);
        const cssFile = zip.file(resolvedPath);
        if (cssFile) {
          let cssText = await cssFile.async('text');
          
          // Rewrite urls inside CSS (fonts, background images)
          const urlRegex = /url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
          const matches = [...cssText.matchAll(urlRegex)];
          for (const match of matches) {
            const fontRelPath = match[1];
            if (!fontRelPath.startsWith('data:') && !fontRelPath.startsWith('http')) {
              const fontFullPath = resolveRelativePath(resolvedPath, fontRelPath);
              const fontBlobUrl = await getResourceBlobUrl(fontFullPath);
              if (fontBlobUrl) {
                cssText = cssText.replace(match[0], `url("${fontBlobUrl}")`);
              }
            }
          }

          // Replace <link> with <style> to inline processed CSS
          const styleEl = chapterDoc.createElement('style');
          styleEl.textContent = cssText;
          link.parentNode?.replaceChild(styleEl, link);
        }
      }
    }

    // Return serialized HTML
    const serializer = new XMLSerializer();
    return serializer.serializeToString(chapterDoc);
  };

  const close = () => {
    createdBlobUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    });
    createdBlobUrls.length = 0;
  };

  return {
    metadata: {
      title,
      creator,
      language,
      direction,
      description,
      publisher,
      coverUrl,
    },
    spine,
    toc,
    manifest: manifestMap,
    rootPath,
    coverBlob,
    getChapterContent,
    getResourceBlobUrl,
    close,
  };
}
