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
- **Aplicación Android opcional**: Capacitor carga el mismo `dist` dentro de un WebView nativo sin sustituir la versión web.

---

## 📂 Estructura de Archivos

```text
EReader/
├── index.html                 # HTML principal con meta tags para móvil y fuentes japonesas
├── vite.config.ts             # Configuración de Vite con viteSingleFile()
├── capacitor.config.ts        # Configuración de la distribución Android
├── android/                   # Proyecto nativo Android generado por Capacitor
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
        ├── TextSelectionMenu.tsx # Menú flotante sobre texto seleccionado (Copiar, Traducir, Diccionario, TTS, Buscar)
        ├── TranslationModal.tsx # Modal de traducción al español y consulta local de JMDict
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
- **Anclaje Vertical Determinista**: Aplica `position: absolute; top: 0; right: 0; writing-mode: vertical-rl; direction: ltr; text-orientation: mixed;`. Al anclar el inicio a la derecha (`right: 0`), la página 0 se alinea de forma determinista con el borde derecho de la pantalla y el texto fluye de derecha a izquierda hacia números negativos de X.
- **Tipografía Japonesa y Kinsoku Shori (JLReq / EPUB 3)**:
  - `text-orientation: mixed`: Crucial para la rotación correcta de la puntuación ideográfica (`。`, `、`, `「」`).
  - `line-break: strict`: Evita que signos de puntuación de cierre o kanas pequeños queden al inicio de una línea vertical.
  - `font-feature-settings: "vert" 1, "vrt2" 1, "palt" 1`: Activa las variantes de glifos verticales nativas de las fuentes OpenType.
  - `text-align: justify; text-justify: inter-ideograph`: Retícula justificada de caracteres kanji y kana.
- **Viewport Fijo (`fixed inset-0` y `100dvh`)**: Evita el desbordamiento de las barras de dirección dinámicas de Safari y Chrome en iOS/Android.
- **Cálculo de Páginas mediante DOM Range**: Mide el ancho total exacto del texto renderizado utilizando `Range.selectNodeContents(wrapper).getBoundingClientRect().width` junto con `scrollWidth`, garantizando un conteo fiable de páginas (`totalPages`).
- **Retícula de Columnas y Márgenes (horizontal)**: Una columna mide `100vw - 2 × margen lateral`; su `column-gap` mide exactamente `2 × margen lateral`. Por tanto, el paso de columna siempre es `100vw`, que es el mismo paso empleado por `translateX` y por el cálculo de páginas. El margen es de 16px en móvil y 44px en escritorio.
- **Paginación vertical por fragmentación**: en `vertical-rl` el eje *inline* es el vertical, así que las columnas CSS se apilan **hacia abajo** y `column-width` fija la **altura** de la columna, no el ancho de la página. Cada página es una columna: el `scroller` fija su tamaño de bloque a `100vw` (con `padding` lateral como margen), `column-width` es la altura de pantalla menos el relleno superior e inferior, y `column-gap` es ese relleno, de modo que el paso entre páginas es exactamente una altura de pantalla y se pasa página con `translateY`. Como es el navegador quien fragmenta, **nunca parte una línea entre dos páginas**. El diseño anterior hacía fluir el texto como una tira continua y paginaba con `translateX` por el ancho de pantalla; al no ser ese ancho múltiplo del paso de línea, una línea entera quedaba a caballo cada pocas páginas (medido: 28 de 40), que es lo que motivó los controles de ajuste lateral. `countScrollerPages` cuenta las páginas de ambos modos y lo usan tanto el lector como la medición del libro, para que no puedan divergir.
- **Navegación Táctil Coherente**:
  - Deslizar a la izquierda (*Swipe Left*) o usar el botón `[< Siguiente]` avanza hacia la página de la izquierda (progresión natural japonesa RTL).
  - Deslizar a la derecha (*Swipe Right*) o usar el botón `[Anterior >]` retrocede hacia la página de la derecha.
  - En Android, los toques simples dentro del EPUB no cambian de página para no interferir con la pulsación prolongada y los tiradores nativos de selección. Los *swipes* sin texto seleccionado siguen paginando; los controles de interfaz permiten toda la navegación alternativa.
  - En escritorio, tocar/hacer clic en el centro (con umbral de tolerancia de 25px para evitar falsos arrastres) o pulsar el botón flotante superior muestra/oculta el menú de navegación del libro.
- **Selección Continua entre Páginas**: La selección puede extenderse más allá de la página visible. El criterio de paginación **no es posicional** (una banda de píxeles junto al borde paginaba al seleccionar simplemente la última columna), sino de **agotamiento del texto visible**: se toma el carácter contiguo al `focus` en el orden del documento y sólo se considera que hay límite de página cuando el rectángulo de ese carácter queda completamente fuera del viewport. Alcanzar la última columna, por tanto, nunca pagina por sí solo.
  - **Confirmación por empuje lateral (ratón y arrastre táctil propio)**: una vez alcanzado el límite, hay que insistir ~34px más en la misma dirección para que se pase de página; invertir el movimiento ~14px reinicia el contador.
  - **Dos flujos de eventos con papeles distintos, y no se pueden intercambiar**: medido en un Android real, arrastrar un tirador de selección produce **`pointermove` y casi ningún `touchmove`** (57 frente a 6 en una misma prueba), así que el empuje lateral de la selección **debe** escuchar `pointermove` (`onSelectionPointerMove`); con `touchmove` nunca acumulaba (`push=0`) y la función era inalcanzable. Pero el gesto de paginación (*swipe*, *tap*, *nudge*) **debe** seguir en `touchmove`/`mousemove`: el navegador emite `pointercancel` en cuanto una pulsación larga se convierte en selección nativa, de modo que al llevar los *swipes* a *pointer events* dejaron de completarse. Cada flujo cubre lo que el otro no puede; no unificarlos. El arrastre puede además llegar **sin evento de inicio** (el tirador captura el gesto), así que el primer `pointermove` sólo fija la posición de referencia en lugar de medir un salto falso desde cero.
  - **Respaldo por espera**: se pagina también tras mantener la selección ~700ms en el límite. Este respaldo convive con el del empuje en lugar de excluirlo: cuando se excluían (el empuje desactivaba la espera al ver un solo `touchmove`) no quedaba ningún camino operativo. Soltar el gesto cancela la espera, de modo que terminar una selección al final de una página nunca la pasa.
  - **Una selección viva nunca es un *swipe***: un arrastre de tirador puede aparecer como un `pointerdown`/`pointerup` muy separados y sin movimientos intermedios, que es indistinguible de un *swipe* de paginación. Comprobar sólo el estado interno `selecting` no bastaba (se activa desde `onMove`, que en ese caso no corre); ahora se consulta la selección real antes de paginar por *swipe*. Sin esto, intentar extender la selección saltaba de página o de capítulo.
  - **Anclaje tras el cambio (evita el salto brusco)**: al pasar de página, el `focus` se fija en el punto por el que entra la lectura de la nueva página (`caretRangeFromPoint` **dentro** de la columna: un punto en el `column-gap` resolvería a la columna contigua, es decir a la página que se acaba de abandonar). Ese anclaje se mantiene ~650ms y se libera en cuanto el puntero vuelve ~24px hacia el interior; si se sigue empujando contra el borde, se encadena otra página con la selección igualmente anclada. Sin este anclaje la selección saltaría una columna entera de golpe, porque el puntero ya descansa en el extremo opuesto del texto nuevo.
  - **Bloqueo durante la transición**: mientras dura la animación de `transform` no se reevalúa el límite; a media animación la maquetación vuelve a señalar el borde y se saltarían varias páginas de una vez.
  - La paginación por selección no cruza de capítulo: cambiar de capítulo recarga el `iframe` y destruiría la selección.
  - **El menú de selección no debe ocupar el final de la página**: en móvil se acoplaba a lo ancho completo junto al borde inferior con `pointer-events: auto`, es decir justo sobre la esquina **inferior izquierda**, que es donde termina una página `vertical-rl` y por tanto donde hay que arrastrar los tiradores para alcanzar la página siguiente. El dedo aterrizaba en el menú y no en el texto: el caret no llegaba nunca al límite y no se pasaba de página. Ahora el menú se pliega (`opacity-0` + `pointer-events: none`) mientras se selecciona y **espera a que el dedo salga de la pantalla** más un margen corto. `pointerActiveRef` se alimenta de `touchstart`/`touchend`/`touchcancel` (y del ratón en escritorio), **nunca de `pointercancel`**: el navegador cancela el puntero al iniciarse la selección nativa, y tomar eso por "el dedo se ha levantado" descubría el menú justo al empezar a seleccionar. Un criterio sólo temporal no servía: descubría el menú en la pausa entre el *long-press* y agarrar un tirador, justo cuando estorba. Como un tirador no siempre entrega el `pointerup` emparejado, hay un límite de 2,5s tras el cual el menú se muestra igualmente. Se probó también acoplarlo arriba en modo vertical, pero estorbaba más (aparece sobre el inicio de la selección), así que se mantiene abajo: la posición es la de siempre y lo que cambia es *cuándo* se muestra. Al reposicionar este menú hay que preservar el plegado.
  - **El conteo de páginas en vivo no es de fiar; el offline sí**: `updatePagination` remide en cada llamada y, como advierte su propio comentario, en escritura vertical `scrollWidth` puede reportar menos mientras el contenido se maqueta. En móvil eso ocurre justo al seleccionar (la barra nativa cambia el viewport): `totalPages` colapsaba a 1, lo que a la vez **acotaba la página a 0** y hacía imposible paginar (`canTurnSelectionPage` daba `false`). Desde entonces el conteo de `measureBookPages` (medido offline con fuentes e imágenes cargadas y al tamaño real del visor) actúa de **suelo** del total, y es el único valor contra el que se acota. No sustituir ese suelo por la medición instantánea.
  - **Re-maquetar texto vertical multi-columna es carísimo**: cambiar la altura del visor con el capítulo cargado puede llegar a bloquear el renderer (reproducido dos veces en escritorio). Por eso el `ResizeObserver` va con *debounce* de 180ms y, pasada la ventana de carga, **ignora el vaivén de altura de las barras del navegador** (umbral de 120px): sólo un cambio de anchura o una rotación alteran de verdad la retícula. Esto mantiene además estable la posición de lectura mientras se selecciona.
  - **`ResizeObserver` no debe reaplicar la posición de lectura**: el observador del `scroller` llamaba a un `triggerUpdate` que reasignaba `currentPage` a la página inicial del capítulo. En móvil el `iframe` se redimensiona sin parar (barra de direcciones, barra nativa de selección, teclado), así que cada cambio de página hecho durante una selección se deshacía al instante y el lector volvía al principio del capítulo. La carga distingue ahora dos caminos: `applyTargetPosition` sólo durante los primeros 700ms tras cargar el capítulo, y `refreshLayout` (re-medir conservando la página, acotándola al rango válido) para cualquier cambio posterior.
  - **Diagnóstico en dispositivo**: una pulsación larga sobre el botón flotante `☰` (o `?debug` en la URL) muestra una traza en pantalla con los últimos eventos y contadores por tipo (`selchg`, `tstart`, `tmove`, `pmove`…). Los contadores son deliberados: en un teléfono el síntoma relevante suele ser que **no llega ningún evento**, y eso no se ve con un registro que sólo escribe cuando algo sucede. El volcado se acumula en un `ref` y se vuelca a estado con un intervalo, para no depender de un `setState` por evento.
  - El `contextmenu` del documento del iframe se cancela para no superponer el menú nativo al menú de selección de la aplicación.
- **Selección Móvil Tipo Kindle**: En teléfonos móviles, el menú de herramientas de selección se acopla a 85px del borde inferior (`max(env(safe-area-inset-bottom) + 85px, 92px)`), flotando nítidamente por encima de la barra de búsqueda y navegación del navegador móvil.

### 2.1. Caché de Paginación (`localStorage`)

Medir un libro real es caro: el EPUB de ejemplo (26 capítulos) tarda **~30 s** en la primera apertura, porque cada capítulo se renderiza completo en un iframe oculto esperando fuentes e imágenes. El resultado se cachea por libro en `${bookStorageKey}_pagination`, y en aperturas posteriores la paginación queda lista de inmediato.

La clave de caché es lo delicado, porque servir un conteo obsoleto es peor que recalcularlo. Se compone de:

- **Una firma del documento renderizado**: el hash del HTML que devuelve `buildChapterDocument('')`, es decir, todo el CSS del lector (fuentes, tamaños, interlineado, retícula de columnas, márgenes, ruby, límites de imagen). Cualquier cambio futuro en esos estilos **invalida la caché por sí solo**, sin que nadie tenga que acordarse de subir un número de versión. Los colores del tema se normalizan antes de hashear, porque no pueden mover el texto.
- **El viewport de la medición**, con la altura redondeada a 20px: los navegadores móviles la alteran unos píxeles al mostrar y ocultar sus barras, y eso no debe contar como otra maquetación.
- **El número de capítulos** del spine.
- **`PAGINATION_CACHE_VERSION`**, que sólo hay que subir si cambia el *algoritmo* de medición (no el CSS).

Se conservan las 6 entradas más recientes, de modo que rotar el dispositivo o cambiar el tamaño de la ventana no descarta la medición de la geometría anterior. La caché es opcional en todo momento: cualquier fallo de `localStorage` se ignora y se vuelve a medir.

### 3. Selección de Texto y Menú Contextual (`src/components/TextSelectionMenu.tsx` / `TranslationModal.tsx`)
- **Escucha Nativa**: Escucha `selectionchange` en el documento del iframe.
- **Posicionamiento**: Calcula la posición absoluta de las coordenadas del rango de selección (`range.getBoundingClientRect()`) y muestra la barra flotante.
- **Clic fantasma**: en modo de análisis, tocar una palabra hace aparecer el menú justo bajo el dedo (en móvil va anclado al borde inferior) y el navegador termina el gesto con su `mousedown`/`click` de compatibilidad en esas mismas coordenadas. El hit-test se relanza desde el documento principal, así que esos eventos dan en el menú que no existía al empezar el toque: el botón se iluminaba (`:active`) y abría el diccionario o la traducción sin querer. Se corta en el origen: el `touchend` del iframe no es pasivo y, cuando el toque ha seleccionado una palabra, llama a `preventDefault()`, con lo que el navegador no emite esos eventos de compatibilidad. El menú no necesita ninguna guardia temporal propia.
- **Herramientas de Selección**:
  - **Copiar**: Copia el texto al portapapeles.
  - **Traducir**: Llama a la API de traducción e integra la respuesta en un modal.
  - **JMDict local**: Muestra dentro del modal las entradas y definiciones en español e inglés, usando la forma base obtenida por Kuromoji para verbos conjugados. El orden sigue el idioma de traducción. Los dos van en `src/data/` comprimidos con gzip (`jmdict-es.json.gz`, `jmdict-en.json.gz`) e incrustados con `?inline`. Sólo se descomprimen e indexan en la primera consulta, así que no cuestan nada al arrancar.
  - **Diccionarios opcionales**: uno por idioma de la interfaz que no tiene diccionario incluido. Son japonés-japonés (国語辞典, con definiciones y sinónimos), francés y alemán (JMdict) y chino, coreano, italiano y vietnamita (Wiktionary). Tienen el mismo formato compacto que JMdict, más `y` (sinónimos) e `i` (palabra conjugable, porque cada Wiktionary nombra las categorías en su idioma). Se generan con `npm run dictionary:build:jmdict` y `npm run dictionary:build:wiktionary` y se publican en el repositorio público [ereader-dictionaries](https://github.com/xelloss1012/ereader-dictionaries). El registro, con archivo, versión, tamaño y fuente, está en `src/utils/optionalDictionaries.ts`. Se descargan desde Ajustes (`DownloadableDictionariesSection`) y se guardan tal cual en IndexedDB (`ereader_dictionaries`), que pertenece al origen de la app: sobreviven a las actualizaciones, se pide `navigator.storage.persist()` para que el navegador no los desaloje y no forman parte de la copia en Google Drive. `dictionary.ts` descomprime e indexa cada uno la primera vez que hace falta.
  - **Orden de las entradas**: primero todas las coincidencias exactas y después las parciales. Dentro de cada grupo, el orden de diccionarios es: japonés-japonés (sólo con la interfaz en japonés), el del idioma de traducción (si está descargado; si no, manda el inglés), inglés y español. Así, una entrada inglesa exacta va por delante de una parcial del diccionario propio.
  - **Pronunciación TTS**: Utiliza `window.speechSynthesis` con voz `ja-JP`.
  - **Buscar**: Búsqueda en Google.

---

### 3.1. Búsqueda en el libro (`src/utils/bookSearch.ts` / `BookSearchModal.tsx`)

- **Entradas**: botón de lupa en la barra superior, `Ctrl+F` y el botón «Buscar en el libro» del menú de selección (que rellena el cuadro con el texto seleccionado).
- **Índice**: texto «buscable» de cada capítulo, calculado bajo demanda al abrir el panel y cacheado en memoria mientras el libro está abierto. Descarta espacios, lecturas `rt`/`rp`, `script` y `style`, y pliega mayúsculas y formas de ancho completo (NFKC), de modo que `ＡＢＣ` encuentra `abc` y un salto de línea del EPUB no parte una frase.
- **Dirección de una coincidencia**: `{spineIndex, start, length}`, es decir, un desplazamiento en el texto buscable, **no una página** (las páginas dependen de fuente, tamaño y ventana). La misma extracción se aplica al HTML original (índice) y al capítulo ya maquetado (localización), por eso el desplazamiento significa lo mismo en ambos.
- **Navegar**: solo al pulsar una coincidencia. Si es otro capítulo, se maqueta en un iframe oculto (mismo `buildChapterDocument`, mismas puntuaciones verticales con `wrapVerticalPunctuation`) para saber su página, y luego se llama a `loadChapter(spine, página)`. La página se obtiene comparando el rect del texto con el del scroller, así que cualquier `transform` activo se cancela. Pasado ~1,3 s se revalida por si fuentes o imágenes movieron el maquetado.
- **Página de cada coincidencia**: se calcula con la maquetación real, no por proporción del texto. Las coincidencias se agrupan por capítulo, cada capítulo se maqueta una sola vez en el iframe oculto (`withHiddenChapter`) y `createSearchLocator` coloca todas sus coincidencias de golpe. Se muestra «p. N» (página del libro si la paginación ya está lista, o página del capítulo si no) y es la misma cuenta que usa la navegación, así que la etiqueta y la página de destino coinciden. Mientras se calcula aparece «p. …».
- **Resaltado**: CSS Custom Highlight API (`::highlight(search-hit)`), 8 s, sin tocar el DOM; si el navegador no la tiene, solo se navega.
- **Recientes**: hasta 20 por libro en `${bookStorageKey}_recent_searches`; se guardan al pulsar Intro o una coincidencia, no al teclear.
- Máximo 300 coincidencias mostradas. Los fragmentos se muestran sobre el texto normalizado (sin espacios).

### 3.2. Idiomas de la interfaz y de traducción (`src/utils/i18n.ts` / `src/i18n/`)

- **Textos**: una tabla por idioma en `src/i18n/<código>.ts` (es, en, fr, it, de, zh, ko, vi, ja), todas con las mismas claves y marcadores `{…}`. `npm run i18n:test` lo comprueba.
- **Componentes**: nunca pasan el idioma. `App` envuelve todo en `LanguageProvider`, y cada componente usa `const t = useT()` y llama a `t('clave')` o `t('clave', { param })`. La función es estable y lee siempre el idioma del último render, así que un `useCallback` que no la declare en sus dependencias tampoco se queda con el idioma antiguo. `useLanguage()` da el código cuando hace falta para otra cosa.
- **Código fuera de React**: usa `t(clave, idioma, params)` de `utils/i18n.ts`, con el idioma **obligatorio**. No hay valor por defecto, así que olvidarlo es un error de compilación.
- **Idioma de traducción**: es independiente de la interfaz (`settings.translationLanguage`). Si no se elige, sigue a la interfaz, y con la interfaz en japonés pasa a inglés (`resolveTranslationLanguage`). Lo usan la traducción (Google o IA), su caché, el orden de JMdict y el glosario. Se lee con `useTranslationLanguage()`. La explicación con IA se da en el idioma de la interfaz; en japonés es una paráfrasis y explicación en japonés sencillo.

### 3.3. Nivel de las palabras (`src/utils/wordLevels.ts` / `WordLevelBadge.tsx`)

- **Datos**: `src/data/word-levels.json.gz` (~245 KB), generado con `npm run word-levels:build` (`scripts/build_word_levels.py`) a partir de JMdict, las listas JLPT de J. Waller y KANJIDIC2. Para cada forma escrita guarda su nivel JLPT y su banda de frecuencia; para cada kanji, su nivel JLPT y su curso escolar. Las formas en kana heredan el nivel de su palabra, y las que la lista JLPT registra en kana (する) sólo se aplican a entradas que JMdict marca como «normalmente en kana», para no dar el N5 a 刷る. Se carga en la primera consulta, como los diccionarios.
- **Clasificación**: nivel JLPT si lo tiene (N5…N1) y, si no, una banda: *básica* (entre las ~3.000 más frecuentes de prensa), *común* (marcas de JMdict), *poco común* y *rara* (sin datos de frecuencia y con un kanji fuera de los *jōyō*). Una forma que no está en los datos sólo se clasifica cuando el llamante sabe que es una palabra suelta (los tokens del glosario); una frase no es «rara». Las entradas de diccionario se clasifican por sus formas en kanji, porque las de kana son compartidas por homófonos (かえる).
- **Mi nivel** (`settings.studyLevel`, N5…N1): una palabra está dentro del nivel si su JLPT es ese o más fácil, o, sin JLPT, si su banda se espera a ese nivel, y además todos sus kanji son de ese nivel JLPT o más fáciles.
- **Dónde se muestra**: glosario (etiqueta, orden «más útiles primero» y ocultar las de mi nivel), entradas del diccionario, vista previa del menú de selección, historial, favoritos y frecuentes.

### 3.4. Modos de furigana (`src/utils/furigana.ts`)

- **Modos** (`settings.furiganaMode`): *original* (el ruby del libro), *ocultar*, *siempre* (añade lectura a las palabras con kanji que no la traen) y *solo difíciles* (lectura sólo en palabras por encima de «Mi nivel», N5 si no se ha indicado, y oculta el ruby del libro en las fáciles). `showFurigana` se mantiene coherente con el modo (`furiganaModeSettings`), y los ajustes antiguos sin modo se interpretan con `resolveFuriganaMode`. El botón del ojo de la barra superior alterna entre *ocultar* y *original*; los otros modos están en Ajustes.
- **No toca la paginación**: el ruby del libro se oculta con `visibility: hidden`, que conserva su hueco, y las clases (`hide-furigana`, `furigana-difficult`) se aplican después de escribir el documento, fuera de la firma de la caché de páginas, así que cambiar de modo no obliga a volver a medir el libro. La lectura generada **no** es un `<ruby>`, porque un `<ruby>` ensancha su base cuando la lectura es más larga (志 → こころざし) y movería el texto. Es un `<span class="gf" data-gf="lectura">` cuyo `::after` tiene posición absoluta: no ocupa espacio en la línea. Comprobado en Chrome: ningún carácter cambia de columna, como mucho se desplaza 1 px por redondeo. Por eso la medición del libro completo sigue usando el HTML original, sin tokenizar.
- **Generación**: `loadChapter` pasa el capítulo por `annotateFurigana` antes de escribirlo (cuando todavía no existe ningún rango). Tokeniza el texto de cada bloque en una sola llamada a Kuromoji (usando `word_position`), reparte la lectura entre kanji y okurigana (`alignReading`: 食べる → 食(た)べる) y descarta las que no encajan con la grafía. Los capítulos anotados se guardan en memoria por capítulo, modo y nivel. Si algo falla, se muestra el capítulo original.
- **Qué es «difícil»**: el furigana trata de poder leer los kanji. Una palabra con nivel JLPT es difícil si está por encima del nivel o alguno de sus kanji lo está (今日 es N5 aunque sus kanji sueltos no se lean así). Una sin nivel JLPT (やって来る, nombres) se juzga sólo por sus kanji.
- **Aspecto y límites**: la lectura generada usa otro tono (`themeColors.generatedFurigana`) para distinguirla de la del libro. Kuromoji (IPADIC) falla en nombres propios, contadores (十里) y lecturas que dependen del contexto; los Ajustes lo avisan.

## 🔄 Estado Actual del Desarrollo

- ✅ Lectura completa de archivos `.epub`.
- ✅ Renderizado nativo de texto vertical japonés con furigana y *Tate-chū-yoko*.
- ✅ Alternancia instantánea a modo horizontal.
- ✅ Paginación multi-columna correcta con cálculo exacto de páginas totales.
- ✅ Selección de texto nativa con menú flotante contextual, traducción y diccionario JMDict local.
- ✅ Gestos táctiles (*Swipe*) y maquetación responsive para móviles (`100dvh`).
- ✅ Modos de color (Blanco, Papel, Sepia, Noche) y tipografías japonesas.
- ✅ Empaquetado Single-File (`dist/index.html`) ejecutable por doble clic.
- ✅ Distribución Android opcional mediante Capacitor usando el mismo build web.

---

## 🔮 Hoja de Ruta / Próximas Funcionalidades (Para futuras sesiones)

1. **Persistencia de Posición de Lectura**:
   - Guardar en `localStorage` o IndexedDB el último libro leído, el capítulo y el número de página actual.
2. **Resaltado y Marcadores (Highlights & Bookmarks)**:
   - Permitir guardar pasajes seleccionados con colores y consultar la lista de marcadores desde la barra lateral.
3. ~~Búsqueda de Texto en el Libro~~ (hecho, ver 3.1).
4. **Carga de Fuentes Personalizadas**:
   - Permitir al usuario subir o seleccionar archivos de fuentes tipográficas adicionales (`.ttf` / `.otf`).
