# 📖 EReader - Arquitectura y Guía del Proyecto

Este documento resume la arquitectura, decisiones de diseño, estructura del código y hoja de ruta para la aplicación de lectura de libros EPUB orientada a texto vertical en japonés (**縦書き / Tate-gaki**).

---

## 🎯 Objetivo del Proyecto

Crear una aplicación web tipo Kindle moderna, rápida y local que permita:
1. Abrir libros en formato EPUB (EPUB2 y EPUB3).
2. Renderizar texto vertical en japonés (`writing-mode: vertical-rl`) con soporte nativo de **Furigana (`<ruby>`)** y números horizontales (*Tate-chū-yoko*).
3. Permitir la alternancia a formato horizontal estándar (`horizontal-tb`).
4. Ofrecer una experiencia táctil y fluida en dispositivos móviles y de escritorio (paginación multi-columna, gestos *swipe*, selección de texto nativa con menú contextual de traducción y diccionario).
5. Funcionar como aplicación web estática o como **un único archivo `.html` autocontenido** (ejecutable directamente con doble clic sin servidor backend).

---

## 🛠️ Stack Tecnológico

- **Frontend Framework**: React 18 + TypeScript + Vite 6.
- **Estilos**: Tailwind CSS + CSS Multi-column / CSS Vertical Writing Mode.
- **Parser de EPUB**: `JSZip` (descompresión client-side) + DOMParser de navegador.
- **Iconos**: `lucide-react`.
- **Bundler Single-File**: `vite-plugin-singlefile` (empaqueta todo el JS, CSS y recursos en un único `dist/index.html`).

---

## 📂 Estructura de Archivos

```text
EReader/
├── index.html                 # HTML principal con meta tags para móvil y fuentes japonesas
├── vite.config.ts             # Configuración de Vite con viteSingleFile()
├── tailwind.config.js         # Temas, fuentes japonesas (Mincho, Gothic) y colores
├── package.json               # Dependencias del proyecto
├── README.md                  # Instrucciones de uso e instalación
├── ARCHITECTURE.md            # Este documento de arquitectura
└── src/
    ├── main.tsx               # Punto de entrada React
    ├── App.tsx                # Estado global (libro activo, ajustes, lectura de localStorage)
    ├── index.css              # Estilos globales y reset
    ├── types/
    │   └── epub.ts            # Interfaces TypeScript (Metadata, TocItem, SpineItem, ReaderSettingsState)
    ├── utils/
    │   ├── epubParser.ts      # Descompresor y parser de EPUB (OPF, TOC NCX/Nav, Blob URLs de imágenes/CSS)
    │   └── sampleBook.ts      # Generador del libro de prueba japonés ("走れメロス")
    └── components/
        ├── EpubReader.tsx     # Visor principal (IFrame aislado, paginación 100dvh, gestos táctiles, selección)
        ├── TextSelectionMenu.tsx # Menú flotante sobre texto seleccionado (Copiar, Traducir, Jisho, TTS, Buscar)
        ├── TranslationModal.tsx # Modal de traducción al español y enlace al diccionario Jisho
        ├── ReaderNavbar.tsx   # Barra superior (Título, selector modo V/H, Índice, Ajustes)
        ├── ReaderFooter.tsx   # Barra inferior (Progreso de página, capítulos, navegación)
        ├── ReaderSettings.tsx # Drawer de ajustes (Fuentes, tamaño, interlineado, temas de color)
        ├── ReaderToc.tsx      # Drawer lateral de la Tabla de Contenidos / Capítulos
        └── FileDropZone.tsx   # Pantalla inicial (Drag & Drop de EPUB y botón de prueba)
```

---

## 🏗️ Componentes y Arquitectura Interna

### 1. Parser EPUB (`src/utils/epubParser.ts`)
- **Descompresión**: Utiliza `JSZip` para leer el archivo `.epub` en memoria.
- **Contenedor**: Lee `META-INF/container.xml` para ubicar el archivo `.opf`.
- **Manifiesto y Spine**: Parsea el XML `.opf` extrayendo metadatos, orden de capítulos (`spine`), assets (imágenes, CSS, fuentes) e idioma/orientación nativa (`page-progression-direction="rtl"`).
- **Resolución de Recursos**: Convierte imágenes y hojas de estilo locales del ZIP en `Blob URLs` (`URL.createObjectURL`), reescribiendo enlaces internos dentro del HTML y CSS.
- **TOC**: Soporta tanto la navegación EPUB3 (`nav.xhtml`) como la clásica EPUB2 (`toc.ncx`).

### 2. Motor de Lectura e IFrame (`src/components/EpubReader.tsx`)
- **Aislamiento**: Renderiza el capítulo actual dentro de un `<iframe>` para aislar completamente los estilos del libro de la interfaz global.
- **Anclaje Vertical Determinista**: Aplica `position: absolute; top: 0; right: 0; writing-mode: vertical-rl; direction: rtl; text-orientation: mixed;`. Al anclar el inicio a la derecha (`right: 0`), la página 0 se alinea de forma determinista con el borde derecho de la pantalla y el texto fluye de derecha a izquierda hacia números negativos de X.
- **Tipografía Japonesa y Kinsoku Shori (JLReq / EPUB 3)**:
  - `text-orientation: mixed`: Crucial para la rotación correcta de la puntuación ideográfica (`。`, `、`, `「」`).
  - `line-break: strict`: Evita que signos de puntuación de cierre o kanas pequeños queden al inicio de una línea vertical.
  - `font-feature-settings: "vert" 1, "vrt2" 1, "palt" 1`: Activa las variantes de glifos verticales nativas de las fuentes OpenType.
  - `text-align: justify; text-justify: inter-ideograph`: Retícula justificada de caracteres kanji y kana.
- **Viewport Fijo (`fixed inset-0` y `100dvh`)**: Evita el desbordamiento de las barras de dirección dinámicas de Safari y Chrome en iOS/Android.
- **Cálculo de Páginas mediante DOM Range**: Mide el ancho total exacto del texto renderizado utilizando `Range.selectNodeContents(wrapper).getBoundingClientRect().width` junto con `scrollWidth`, garantizando un conteo fiable de páginas (`totalPages`).
- **Navegación Táctil Coherente**:
  - Deslizar a la izquierda (*Swipe Left*) o pulsar en la zona izquierda / botón `[< Siguiente]` avanza hacia la página de la izquierda (progresión natural japonesa RTL).
  - Deslizar a la derecha (*Swipe Right*) o pulsar en la zona derecha / botón `[Anterior >]` retrocede hacia la página de la derecha.
  - Tocar en el centro (con umbral de tolerancia de 25px para evitar falsos arrastres) o pulsar el botón flotante superior muestra/oculta el menú de navegación del libro.
- **Selección Móvil Tipo Kindle**: En teléfonos móviles, el menú de herramientas de selección se acopla a 85px del borde inferior (`max(env(safe-area-inset-bottom) + 85px, 92px)`), flotando nítidamente por encima de la barra de búsqueda y navegación del navegador móvil.

### 3. Selección de Texto y Menú Contextual (`src/components/TextSelectionMenu.tsx` / `TranslationModal.tsx`)
- **Escucha Nativa**: Escucha `selectionchange` en el documento del iframe.
- **Posicionamiento**: Calcula la posición absoluta de las coordenadas del rango de selección (`range.getBoundingClientRect()`) y muestra la barra flotante.
- **Herramientas de Selección**:
  - **Copiar**: Copia el texto al portapapeles.
  - **Traducir**: Llama a la API de traducción e integra la respuesta en un modal.
  - **Jisho**: Abre la búsqueda en el diccionario de kanjis Jisho.org.
  - **Pronunciación TTS**: Utiliza `window.speechSynthesis` con voz `ja-JP`.
  - **Buscar**: Búsqueda en Google.

---

## 🔄 Estado Actual del Desarrollo

- ✅ Lectura completa de archivos `.epub`.
- ✅ Renderizado nativo de texto vertical japonés con furigana y *Tate-chū-yoko*.
- ✅ Alternancia instantánea a modo horizontal.
- ✅ Paginación multi-columna correcta con cálculo exacto de páginas totales.
- ✅ Selección de texto nativa con menú flotante contextual y traducción.
- ✅ Gestos táctiles (*Swipe*) y maquetación responsive para móviles (`100dvh`).
- ✅ Modos de color (Blanco, Papel, Sepia, Noche) y tipografías japonesas.
- ✅ Empaquetado Single-File (`dist/index.html`) ejecutable por doble clic.

---

## 🔮 Hoja de Ruta / Próximas Funcionalidades (Para futuras sesiones)

1. **Persistencia de Posición de Lectura**:
   - Guardar en `localStorage` o IndexedDB el último libro leído, el capítulo y el número de página actual.
2. **Resaltado y Marcadores (Highlights & Bookmarks)**:
   - Permitir guardar pasajes seleccionados con colores y consultar la lista de marcadores desde la barra lateral.
3. **Búsqueda de Texto en el Libro**:
   - Implementar un buscador global para localizar palabras o frases a lo largo de todos los capítulos del EPUB.
4. **Carga de Fuentes Personalizadas**:
   - Permitir al usuario subir o seleccionar archivos de fuentes tipográficas adicionales (`.ttf` / `.otf`).
