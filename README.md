# 📖 Yomisuba

> **読みの素晴らしい世界に祝福を！**
>
> *Yomisuba* es la abreviatura de este nombre largo: «¡Bendiciones a este maravilloso mundo de la lectura!».

**Aplicación web:** <https://xelloss1012.github.io/yomisuba/> · **Android:** [descargar el APK](https://github.com/xelloss1012/yomisuba/releases/latest/download/yomisuba.apk) · **Política de privacidad:** <https://xelloss1012.github.io/yomisuba/privacy.html>

> El APK se instala fuera de Google Play: Android pedirá permiso para instalar aplicaciones desconocidas y Play Protect puede advertir de que no reconoce la aplicación.

Lector EPUB con soporte de japonés vertical (縦書き). Una aplicación web moderna tipo Kindle desarrollada en **React + TypeScript + Vite + Tailwind CSS**, optimizada para la lectura de libros EPUB tanto en formato horizontal occidental como en **formato vertical tradicional japonés (`vertical-rl` / 縦書き)** con soporte completo de **furigana (`<ruby>`)**, ilustraciones, estilos e índice de contenidos.

> **Nota sobre el proyecto**: Esta aplicación ha sido diseñada para uso personal, adaptada a las necesidades y preferencias del autor, y se publica en GitHub de forma totalmente libre y gratuita por si a alguien le resulta útil o desea crear su propia versión (fork). Ha sido desarrollada prácticamente en su totalidad con la asistencia de Inteligencia Artificial (Claude, GitHub Copilot, Gemini, Antigravity, Cline y Aider).

---

## 🌟 Características Implementadas

1. **Soporte Japonés Vertical (`縦書き`) & Furigana**:
   - Orientación `vertical-rl` con progreso de lectura de derecha a izquierda (RTL).
   - Renderizado nativo de etiquetas `<ruby>` y `<rt>` (furigana/lecturas kana).
   - Soporte para números y siglas horizontales en texto vertical (*Tate-chū-yoko* / `text-combine-upright`).
   - Selección de fuentes japonesas tipográficas (**Mincho / 明朝体**, **Gothic / ゴシック体**, Serif y Sans).

2. **Paginación Fluida Estilo Kindle**:
   - Paginación multi-columna sin cortes raros de texto ni desbordamientos.
   - Navegación táctil / ratón por zonas (Izquierda = avanzar en RTL, Derecha = retroceder en RTL, Centro = abrir/ocultar barra de herramientas).
   - Navegación por teclado (Flechas ←/→, Barra espaciadora, RePág/AvPág, teclas `J`/`K`).
   - Indicador de página actual, total de páginas y porcentaje del libro.

3. **Compatibilidad EPUB (EPUB2 y EPUB3)**:
   - Extracción y renderizado client-side directo en el navegador con `JSZip`.
   - Resolución automática de recursos locales (imágenes, hojas de estilo CSS, fuentes, portadas).
   - Tabla de contenidos interactiva (TOC) para saltar rápidamente entre capítulos.
   - La biblioteca y los datos se guardan en local. Solo se envía una copia a Google Drive cuando el usuario inicia sesión y la solicita.

**Subrayados y notas**: al seleccionar un texto se puede subrayar y añadirle una nota (botón «Nota»; también subraya la selección si todavía no lo estaba). El subrayado lleva una línea de 2 px a la izquierda del texto vertical (donde no hay furigana) o debajo del horizontal, dibujada en una capa superpuesta que no ocupa espacio y por tanto no altera la paginación. Un punto junto al subrayado indica que tiene nota; al pulsarlo se abre para leerla o editarla. La lista «Marcadores y Subrayados» muestra las notas, se puede filtrar por texto, nota o capítulo, y copia o guarda como archivo Markdown (por capítulos) lo que muestra. El buscador del libro busca también en las notas (sección «Notas» de los resultados). En «Historial y Favoritos», la pestaña de favoritos exporta las palabras guardadas a Markdown (con la respuesta completa) o a CSV (palabra, lectura, significado, tipo, fecha y fuente; UTF-8 con BOM, listo para Anki o una hoja de cálculo; las celdas que empezarían por `=`, `+`, `-` o `@` se neutralizan). En la web el archivo se descarga; en Android se escribe en la caché de la app y se ofrece a la hoja de compartir del sistema (Drive, Archivos, correo…) mediante `@capacitor/share`, sin pedir ningún permiso de almacenamiento. Las notas viajan con el resto de los datos de lectura (copia de Drive y copia del almacenamiento de la app).

**Vocabulario y notas de todos los libros**: el botón «Vocabulario y notas» de la pantalla de inicio abre un panel que reúne lo guardado en todos los libros de este dispositivo, incluidos los que se quitaron de la estantería conservando sus datos. No guarda una copia aparte: se calcula al abrirlo a partir de los datos de cada libro (`src/utils/studyData.ts`), así que siempre coincide con ellos y no añade nada que sincronizar. Pestañas:
- **Resumen**: libros, palabras guardadas, notas y consultas; palabras nuevas por mes (último año); y, por libro, su progreso, favoritos, notas, subrayados y consultas, con «Abrir» o, si ya no está en la estantería, «Borrar sus datos».
- **Vocabulario**: los favoritos de todos los libros unidos por palabra (forma base y lectura): la misma palabra guardada en varios libros aparece una vez, con los libros en que se guardó y cuántas veces se consultó en total. Se ordena por fecha, por consultas, por número de libros o por lectura, y se exporta a Anki (`.txt` con cabeceras `#separator`/`#html`: palabra delante; lectura, significado y libros detrás), CSV o Markdown.
- **Notas**: subrayados y notas de todos los libros (opcionalmente solo los que tienen nota), exportables a Markdown por libro y capítulo.
- **Historial** (exportable a CSV) y **Más consultadas**: las consultas al diccionario más frecuentes sumadas entre libros, con su significado (el de la última consulta guardada en el historial o, si no lo hay, el del diccionario al pulsarla), y las búsquedas en el texto.

Todas las pestañas se filtran por texto y por libro, y lo exportado es lo que se muestra.

Desde el panel se actúa como en el libro: la estrella del historial y de las más consultadas guarda o quita el favorito en el libro correspondiente (las palabras del vocabulario se quitan de todos los libros en que estén, preguntando si son varios); «Ver en el libro» abre el libro con esa búsqueda ya hecha (vocabulario, notas, historial, consultas, búsquedas y la tarjeta del repaso), y en el repaso también se puede marcar una palabra como sabida o ignorarla sin responderla. Las notas se exportan además a Anki (el pasaje delante; la nota, el libro y el capítulo detrás). Los cambios hechos con el libro cerrado van a Drive como los del lector: se envía el libro completo (`src/utils/bookSnapshot.ts`) por la misma cola y con el mismo control de dispositivo, y al abrir un libro con cambios aún sin subir, se suben en lugar de sustituirlos por la copia de Drive.

**Libros que solo están en Drive**: con la sesión de Google iniciada, «Incluir Drive» (en el Resumen) añade al panel los libros leídos en otros dispositivos o quitados de este. Una consulta lista los ficheros de datos de todas las carpetas de libros de `.yomisuba` (por bloques de carpetas, no una por carpeta); se descargan solo los de las carpetas que no corresponden a libros de este dispositivo, cada fichero se valida con su `bookKey` (que da el título y el autor) y se pasan al mismo formato que el almacenamiento local. Solo se leen: se guardan en memoria mientras dura la sesión y no se escribe nada en el dispositivo ni en Drive.

**Frase de contexto**: al guardar un favorito mientras se lee, se guarda también la frase del libro de la que viene (`context`, hasta 200 caracteres; `src/utils/contextSentence.ts`): la de la selección si contiene la palabra o, si no (por ejemplo desde el glosario de página), la primera del capítulo que la contiene. El texto se lee sin las lecturas de los `<ruby>` (`<rt>`, `<rp>`), y la frase va de un `。！？…` o salto de línea al siguiente, con las comillas de cierre incluidas; una frase larga se recorta alrededor de la palabra. El panel la muestra bajo el significado, con la palabra en negrita, y se exporta: columna «Contexto» en el CSV (también en el de favoritos de cada libro), en cursiva en el reverso de las tarjetas de Anki y como cita en Markdown. Los favoritos guardados antes no tienen frase.

**Glosario de capítulo y de libro**: el glosario tiene tres ámbitos, «Página · Capítulo · Libro», para preparar la lectura conociendo antes las palabras que van a salir. Capítulo y Libro (`src/utils/bookGlossary.ts`, `BookGlossaryModal`) analizan el texto de los capítulos sin las lecturas de los `<ruby>`, con el mismo kuromoji y la misma unión de tokens que el glosario de página, uno a uno y mostrando el progreso (un libro de 26 capítulos y 100.000 caracteres tarda menos de un segundo en un ordenador); el análisis se guarda mientras el libro está abierto. Se quedan los sustantivos, verbos, adjetivos y adverbios de contenido, por su forma base (走った → 走る; los verbos con する, por su sustantivo: 激怒した → 激怒), y se descartan números, pronombres, nombres propios y las palabras que kuromoji no conoce (casi siempre los nombres de los personajes). Cada palabra lleva cuántas veces aparece, en qué capítulos, la frase en que aparece por primera vez y su lectura en el texto (街 es まち, no がい). Filtros: por encima de «Mi nivel (JLPT)», que se elige también desde el propio glosario; apariciones mínimas (en el libro, 2 por defecto); y ocultar las palabras ya sabidas o ignoradas en el repaso. El libro se ordena por frecuencia (las que más se repiten son las que más rinden) y el capítulo por orden de aparición, marcando las que salen por primera vez en el libro; las palabras escritas en kana en el libro se clasifican también por su forma en kana. El significado se busca solo para las palabras que se muestran, de 50 en 50. Cada palabra se puede guardar con la estrella (con su frase de contexto), buscar en el libro, marcar como sabida o ignorar; «Añadir 20 al vocabulario» guarda de una vez las primeras de la lista para estudiarlas en el repaso.

**Palabras que kuromoji corta mal**: los kanji en su forma tradicional (摑む, 啞然, 噓; el 印刷標準字体 que usan muchas editoriales) se analizan con su forma corriente (掴む, 唖然, 嘘), que es la que kuromoji conoce, sin cambiar el texto del libro (`src/utils/kanjiVariants.ts`). Un prefijo que solo matiza una cantidad es una palabra aparte: 約一名 son 約 y 一名 (第三章 sigue siendo una). Y una expresión hecha de sustantivo, partícula y verbo o adjetivo que el diccionario recoge tal cual (身に着ける, 気に入る, 目を覚ます) se toca como una sola palabra en el análisis de la página; si el diccionario no la recoge (学校に行く), se queda en tres.

**Consultas repetidas**: una palabra consultada desde el texto cuenta una vez por frase. Volver a consultarla en la misma frase (al releer la página o volver atrás, aunque sea días después) es la misma aparición: no suma en las más consultadas y en el historial sube la entrada que ya había. En otra frase es una aparición nueva y suma al momento, que es lo que mide cuánto sale la palabra en el libro. Cada consulta del historial guarda su frase (se ve en el panel y pasa al favorito si se guarda desde el historial); de las más consultadas se guardan solo huellas de las últimas cinco frases, no el texto. Las consultas sin frase (escritas en el diccionario) cuentan de nuevo pasados 10 minutos.

**Repaso del vocabulario**: la pestaña «Repasar» del panel repasa las palabras guardadas con repetición espaciada al estilo de Anki (SM-2, `src/utils/studyProgress.ts`). Cada tarjeta muestra la palabra (con su frase de contexto y botón para escucharla) y, al pedir la respuesta, la lectura, el significado y los libros; se responde «Otra vez» (vuelve en 10 minutos y se repite al final de la sesión), «Difícil», «Bien» o «Fácil», cada botón con el intervalo que daría. Los intervalos se cuentan en días naturales (una palabra para mañana vuelve a medianoche) y una palabra con un intervalo de 21 días o más se considera sabida. Primero salen las palabras pendientes (las más atrasadas antes) y después las nuevas, de la más antigua a la más reciente, hasta el límite de palabras nuevas al día (5–50 o sin límite; 20 por defecto). En «Vocabulario» cada palabra muestra su estado («Nueva», «Aprendiendo · repaso mañana», «Sabida», «Ignorada»), se filtra por estado y se puede marcar como sabida, ignorar o empezar de cero. El botón del inicio indica cuántas hay para repasar. En la web, espacio muestra la respuesta y 1–4 responden.

**Repaso de pasajes subrayados**: además de las palabras, se pueden repasar los pasajes que se elijan (no todos: muchos subrayados son solo marcas de lectura). Se eligen con «Repasar este pasaje» al escribir la nota en el lector o con «Repasar» en la pestaña Notas del panel (con el filtro «Solo en repaso»); la marca va con el subrayado (`review` en `annotations.json`) y llega a Drive como el resto de las notas. Un pasaje con nota muestra el pasaje en su frase y pregunta qué se anotó; uno sin nota oculta el pasaje entre el texto de alrededor y pregunta cuál era. Detrás van la nota, el libro y el capítulo, con «Ya la sé», «Ignorar» y «Ver en el libro». Siguen la misma programación que las palabras (`note:<id>` en el estado de estudio) y se mezclan con ellas por fecha, o se repasan por separado con «Todo · Palabras · Pasajes».

El estado de estudio es común a todos los libros: se identifica cada palabra por su forma base y lectura y se guarda en `yomisuba_study_v1` (solo el estado: la palabra y su significado siguen en los favoritos de cada libro). En Drive va en `.yomisuba/vocabulary.json` y sigue el control de dispositivo: tras decidir, «Cargar los datos de Drive» une el de Drive con el local palabra por palabra (gana el repaso más reciente de cada palabra; empezar de cero también se propaga) y «Mantener los de este dispositivo» lo deja de lado; después, cada cambio se sube a los tres segundos, comprobando antes que este dispositivo sigue siendo el último que escribió.

**Quitar un libro**: por defecto se quita solo el libro y se conservan su progreso, marcadores, notas, favoritos e historial: siguen en el panel y vuelven si se añade de nuevo el mismo libro (se identifica por título y autor). Si tiene copia en Drive, se puede borrar también; con los datos conservados solo se borra el EPUB y su carpeta de datos se queda en Drive. Desmarcando «Conservar…» se borran también sus datos, de este dispositivo y, si se elige, de Drive.

4. **Personalización y Temas**:
   - **Modo Blanco** (estándar limpio).
   - **Modo Papel** (tono cálido agradable para lectura prolongada).
   - **Modo Sepia** (tono clásico pergamino).
   - **Modo Noche / Oscuro** (fondo oscuro para descanso visual).
   - Control de tamaño de fuente (12px – 50px) e interlineado.
   - Conmutador rápido entre modo Vertical (縦書き) y Horizontal (横書き).
   - El giro automático del dispositivo está desactivado por defecto y se puede habilitar desde Ajustes de Lectura.

5. **Libro de Muestra Integrado**:
   - Incluye un botón para generar y cargar al instante un libro de prueba japonés (*走れメロス - Dazai Osamu*) con portada, ilustraciones, furigana y varios capítulos sin necesidad de buscar un archivo local.

6. **Diccionario JMDict japonés-español/inglés**:
   - Prioriza las entradas españolas y completa los resultados que faltan con la edición inglesa oficial de JMdict.
   - El complemento inglés se distribuye comprimido y se carga solo cuando hacen falta resultados adicionales.
   - Para actualizarlo a la última versión oficial (Python 3.8 o superior): `npm run dictionary:update`.
   - Los datos JMdict/EDICT son © Electronic Dictionary Research and Development Group (EDRDG), bajo licencia [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html). Consulta también la [fuente y documentación de JMdict](https://www.edrdg.org/wiki/JMdict-EDICT_Dictionary_Project.html).

7. **Biblioteca gratuita de libros japoneses**:
   - Obras de dominio público de [Aozora Bunko](https://www.aozora.gr.jp/) que se descargan solo si el usuario las elige (botón «Biblioteca gratuita» de la pantalla de inicio). Cada libro muestra carátula, descripción, géneros, tamaño, páginas aproximadas, una dificultad estimada de 1 a 5 y su fuente y licencia. Se puede buscar por título, autor o descripción (también por la lectura en kana), filtrar por género, licencia y dificultad, ordenar por dificultad o extensión, y la lista se muestra de 12 en 12 con «Mostrar más».
   - El catálogo y los EPUB se publican en el repositorio [yomisuba-library](https://github.com/xelloss1012/yomisuba-library), generados con `npm run library:build -- <ruta-del-repositorio>` y validados con `npm run library:check -- <ruta-del-repositorio>`. Hay dos tipos de obra: de **dominio público** (autores fallecidos en 1945 o antes, de modo que no tienen derechos en Japón, EE. UU., la UE y España; algunos países tienen plazos más largos) y con **licencia Creative Commons** (traducciones modernas de clásicos y obras de autores actuales publicadas en Aozora Bunko con CC BY o CC BY-SA). No se aceptan licencias NC ni ND. Cada libro muestra su licencia y el crédito de traducción o autoría, y se puede filtrar por licencia.
   - La descarga se comprueba con una suma SHA-256, el libro se guarda como cualquier EPUB importado y no se copia a Google Drive. Una bifurcación (fork) puede publicar su propia biblioteca y apuntar a ella con `VITE_LIBRARY_BASE_URL`.

---

## 🚀 Cómo ejecutar la aplicación

Clona el repositorio, abre un terminal en su carpeta y ejecuta:

```bash
# 0. Clonar el repositorio
git clone https://github.com/xelloss1012/yomisuba.git
cd yomisuba

# 1. Instalar dependencias
npm install

# 2. Iniciar el servidor de desarrollo
npm run dev
```

La aplicación se abrirá automáticamente en tu navegador (por defecto en `http://localhost:3000`).

### Aplicación Android

La misma aplicación puede empaquetarse como una aplicación Android mediante
Capacitor. La versión web publicada sigue siendo independiente y conserva su
build actual.

Requisitos para compilar localmente:

- Node.js 22 o superior.
- Android Studio con un JDK 21 o superior (el JDK incluido por Android Studio
  suele ser válido).
- Android SDK Platform 36 y Build-Tools 36 instalados desde el SDK Manager.

```bash
# Generar/sincronizar el proyecto Android
npm run android:sync

# Abrirlo en Android Studio
npm run android:open

# Generar un APK release desde la raíz del proyecto
npm run android:build:release
```

El APK se copia siempre en
`dist/android/yomisuba.apk`. `dist/` está excluido de
Git, por lo que el binario no se sube al repositorio. El `dist/index.html` de
la versión web se mantiene en paralelo.

También se puede abrir `android/` directamente en Android Studio y ejecutar el
módulo `app`.

La aplicación Android carga el build React local dentro de un WebView, por lo
que mantiene la persistencia de libros recientes, posiciones, marcadores y
caché de traducciones. Las traducciones IA siguen necesitando conexión a
Internet. El workflow `.github/workflows/build.yml` es opcional y solo sirve
para automatización; no es necesario para compilar ni usar la aplicación
localmente.

#### Firma del APK release

Sin configuración, el APK release se firma con la clave de depuración del equipo
que compila. Para firmarlo siempre con la misma clave (la que autoriza el cliente
OAuth Android de Google), crea un almacén de claves propio fuera del repositorio:

```bash
keytool -genkeypair -v -keystore yomisuba-release.jks -alias yomisuba -keyalg RSA -keysize 4096 -validity 10000
```

Para compilar en local, indica la clave en `.env.local` (excluido de Git):

```env
ANDROID_KEYSTORE_PATH=C:/ruta/a/yomisuba-release.jks
ANDROID_KEYSTORE_PASSWORD=...
ANDROID_KEY_ALIAS=yomisuba
ANDROID_KEY_PASSWORD=...
```

En GitHub Actions se configura en *Settings → Secrets and variables → Actions*:

- Secretos `ANDROID_KEYSTORE_BASE64` (el `.jks` en base64), `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`.
- Variable `VITE_GOOGLE_WEB_CLIENT_ID` (el ID de cliente web no es secreto: va
  dentro de la aplicación).

Con los secretos, el workflow genera `yomisuba.apk` firmado; sin ellos
(por ejemplo, en pull requests desde forks) genera `yomisuba-debug.apk`. El SHA-1
que hay que registrar en Google Cloud se obtiene con
`keytool -list -v -keystore yomisuba-release.jks -alias yomisuba`.

#### Publicar una versión

La versión de la app sale de `version` en `package.json` (el `versionCode` de
Android se calcula a partir de ella). Para publicar una nueva:

```bash
npm version 1.1.0 -m "Versión %s"   # actualiza package.json y crea la etiqueta v1.1.0
git push origin main --follow-tags
```

Al subir la etiqueta, el workflow compila el APK firmado y crea la release en
GitHub con el archivo adjunto. El enlace
<https://github.com/xelloss1012/yomisuba/releases/latest/download/yomisuba.apk>
descarga siempre la última, y es el que usa el botón «Descargar para Android» de
la versión web.

#### Aviso de nuevas versiones (solo Android)

La app Android consulta la API pública de GitHub (`releases/latest`) como mucho una vez al día. Si la última release es más nueva que la instalada (la versión sale de `package.json`), la pantalla de inicio muestra un aviso con los botones «Actualizar», «Novedades» y «Ahora no». «Actualizar» descarga el APK de esa release dentro de la app (con su progreso) y abre con él el instalador de Android, que pide confirmación (`AppUpdaterPlugin.java`, `UpdateInstallButton`). La primera vez, Android pide permitir que Yomisuba instale aplicaciones (permiso `REQUEST_INSTALL_PACKAGES`; la app abre ese ajuste y sigue al volver). El plugin solo descarga APK de las releases de este repositorio y comprueba que el archivo sea de esta app antes de instalarlo; si algo falla, queda el enlace para descargarlo con el navegador, como antes. Si algún día se publica en Google Play, esa versión tendría que quitar el permiso y usar las actualizaciones de la tienda. Se puede desactivar con «Avisar de nuevas versiones» al pie de la pantalla de inicio, y no se activa en la versión web, que se publica de nuevo con cada cambio.

Android solo instala una actualización si el APK nuevo está firmado con **la misma clave** que el instalado; por eso conviene firmar siempre con la clave de release (ver [Firma del APK release](#firma-del-apk-release)). Un APK firmado con una clave de depuración distinta obliga a desinstalar la app antes.

---

### Copia de seguridad en Google Drive

La aplicación continúa funcionando y guardando datos localmente sin iniciar
sesión. Al conectar Google, los ajustes (incluidas las claves IA) se guardan
automáticamente cuando cambian, y los datos de lectura cuando el usuario
avanza, añade/elimina marcadores o anotaciones, o modifica el historial. Los
ajustes, incluida la preferencia de giro automático, se restauran
automáticamente al conectar una cuenta, y también pueden restaurarse
manualmente. Cada libro tiene un archivo de lectura independiente.
Los EPUB no se suben solos: el usuario elige cada libro que quiere guardar o
descargar. Su estado se restaura al abrirlo si hay una copia. Para actualizar el
progreso de un EPUB ya guardado localmente, usa la acción **Actualizar** junto
al libro en la lista de Google Drive. No hay base de datos compartida entre
usuarios ni archivo ZIP. Los ajustes y los datos de lectura se guardan en
`.yomisuba`; los EPUB se guardan con su nombre original en `.yomisuba/books`.
Desde la lista de Drive se puede eliminar la copia EPUB y sus datos de lectura.
Al quitar un libro de recientes, si existe una copia en Drive, se puede elegir
si conservarla o borrarla también.
En Android, el botón habitual «Seleccionar archivo EPUB» abre el selector del
sistema, desde el que se puede elegir un libro del dispositivo o de un proveedor
como Google Drive. El libro se abre y se guarda localmente; para copiarlo a
Drive, usa después «Subir a Drive» en la lista de libros de este dispositivo.
La lista de Drive contiene los libros guardados por Yomisuba; los archivos
añadidos manualmente a Drive no se enumeran.
La lectura y la biblioteca local no esperan a que Drive responda. Sin conexión,
los datos locales siguen disponibles y los cambios de lectura quedan en cola
para sincronizarse al recuperar la conexión; las peticiones a Drive tienen un
límite de espera.

**Varios dispositivos.** Drive guarda en `.yomisuba/device.json` qué dispositivo
escribió por última vez (un identificador aleatorio de la instalación y un nombre
legible, como «Android · Pixel 7»). Antes de cualquier carga o guardado automático
de los datos de Drive (al abrir la app, al iniciar sesión, al volver a ella y, como
mucho cada dos minutos, antes de guardar) se comprueba ese indicador:
- Si lo escribió este mismo dispositivo, todo sigue como siempre.
- Si lo escribió otro (o una versión anterior que no lo indicaba), se pregunta
  antes de nada, indicando qué dispositivo guardó, cuándo y dónde quedaría el libro
  que se está leyendo: una tabla compara la posición de este dispositivo con la de
  Drive en cada sistema de paginación (páginas de este dispositivo, páginas
  impresas, porcentaje y capítulo), con el que se usa resaltado y en primer lugar.
  «Cargar los datos de Drive» aplica los ajustes, el
  progreso, los marcadores y las notas de Drive; «Mantener los de este dispositivo»
  no carga nada y lo que se guarde en Drive desde entonces será lo de este
  dispositivo. En ambos casos el dispositivo pasa a ser el último que escribió.
- Un dispositivo recién instalado carga los datos de Drive sin preguntar: no tiene
  nada propio que perder.

### Fuentes de lectura distintas de EPUB

**Hecho (fase 1):** texto pegado (botón «Pegar texto») y archivos `.txt`. Cada entrada se convierte al importarla en un EPUB (`src/utils/textToEpub.ts`), de modo que el lector, «Mis libros», Drive y los datos de lectura funcionan sin cambios. Se detecta la codificación (UTF-8, Shift_JIS, EUC-JP, UTF-16) y el idioma (el japonés se abre en vertical). Los textos con notación de Aozora Bunko se convierten: `漢字《かんじ》` pasa a furigana, las notas `［＃…］` se interpretan (encabezados, puntos de énfasis) o se quitan, y la nota de `底本` queda como última sección. Los textos largos se dividen en secciones, por encabezados o por tamaño.

**Hecho (fase 2):** archivos HTML (`.html`, `.htm`, `.xhtml`; `src/utils/htmlToEpub.ts`). Se respeta el juego de caracteres que declara la página, se extrae el artículo (con la biblioteca [Readability](https://github.com/mozilla/readability), la del modo lectura de Firefox) y se limpia todo lo que pudiera ejecutarse o cargarse de fuera: scripts, estilos, formularios, atributos y enlaces. Se conservan el furigana (`<ruby>`), los puntos de énfasis y las imágenes incrustadas en el propio archivo (hasta 4 MB); las imágenes que no están dentro del archivo no se pueden recuperar y se sustituyen por su descripción (los gaiji de Aozora salen como texto). Los capítulos se cortan por el primer nivel de encabezado que aparece al menos dos veces. Las páginas de Aozora Bunko guardadas desde el navegador se leen con su texto y su furigana intactos.

**Hecho (fase 3):** páginas por dirección web (botón «Desde una web»; `src/utils/urlImport.ts`). La página se descarga y se convierte como un HTML guardado, y además se descargan sus imágenes (hasta 20, 1 MB cada una y 4 MB en total). Si la dirección es un EPUB o un TXT, se toma como ese archivo. Una dirección `http://` se prueba primero como `https://`. Se conserva la dirección en el EPUB (`dc:source`), de modo que volver a abrir la misma dirección da el mismo libro.

- **Android:** la descarga usa el cliente HTTP nativo de Capacitor (`CapacitorHttp`, sin plugin ni permiso nuevos), que no está sujeto a CORS: funciona con casi cualquier página pública.
- **Web:** el navegador solo deja leer los sitios que lo permiten con CORS; en el resto la app explica que no se pudo y propone guardar la página como HTML (y abrirla como archivo) o pegar el texto.
- **Límites:** páginas de hasta 10 MB; no funcionan las que generan su texto con JavaScript, ni las que exigen iniciar sesión o pagar. Es para uso personal y conviene respetar los derechos del sitio.
- **Compartir → Yomisuba (Android):** la app recibe texto, direcciones web y archivos `.epub`, `.txt` y `.html` desde la hoja de compartir de otras apps, desde «Abrir con» de un gestor de archivos y desde el menú de texto seleccionado (`PROCESS_TEXT`). Una dirección se descarga como en «Desde una web»; un texto (con el asunto como título, si lo hay) se convierte como en «Pegar texto»; un archivo se importa como al abrirlo. Lo recibe `ShareTargetPlugin` (Java) y lo recoge `src/utils/sharedContent.ts`.

El lector está acoplado actualmente a la estructura de un EPUB, pero no sería
necesario rehacer sus funciones para admitir otros tipos de entrada. Una
evolución posible es normalizar cada fuente como un documento con metadatos,
secciones y contenido HTML, y entregarlo al mismo motor de lectura. Así se
podrían reutilizar la paginación, los temas, el cambio de orientación del
texto, la búsqueda, el diccionario, la traducción, los marcadores y los
subrayados.

| Entrada | Esfuerzo orientativo | Consideraciones |
| --- | --- | --- |
| Texto pegado | Bajo | Crear un documento con formato básico y secciones navegables. |
| Fichero TXT | Bajo | Elegir cómo interpretar saltos de línea y dividir textos largos en secciones. |
| Fichero HTML local | Bajo–medio | Aprovechar encabezados para el índice y resolver imágenes, estilos y otros recursos locales. |
| Página web por URL | Medio–alto o superior | CORS, inicios de sesión, contenido generado por JavaScript y protecciones de los sitios pueden impedir extraer o reconstruir la página. |

Para que el comportamiento sea consistente, cada entrada debería tener un
identificador estable y propio: el progreso, los marcadores y las anotaciones
deben permanecer separados entre documentos aunque tengan títulos iguales. La
adaptación también tendría que definir cómo resolver los recursos del documento
y cómo obtener una tabla de contenidos cuando la fuente no la proporciona.

Una implementación gradual empezó por texto pegado y TXT y siguió con HTML
local (hecho); las URL quedan para una fase posterior con un alcance explícito
(por ejemplo, páginas públicas compatibles, sin garantizar sitios con login,
paywall o restricciones anti-extracción). Como orden de magnitud inicial,
texto pegado, TXT y HTML local podrían requerir 1–3 días incluyendo integración
y pruebas; las URL podrían añadir 2–5 días o más, según los sitios que se
pretendan soportar. Son estimaciones preliminares, no un compromiso de entrega.

Para habilitar y configurar Google Drive y la autenticación OAuth:

1. **Google Cloud Console**:
   - Crea un proyecto en [Google Cloud Console](https://console.cloud.google.com/).
   - Activa la **Google Drive API**.
   - Configura la pantalla de consentimiento OAuth indicando la **Página principal de la aplicación** (ej. `https://<tu-usuario>.github.io/<tu-repositorio>/`) y la **URL de política de privacidad** (ej. `https://<tu-usuario>.github.io/<tu-repositorio>/privacy.html`).
   - Añade el ámbito de permiso OAuth: `https://www.googleapis.com/auth/drive.file` (acceso exclusivo a archivos creados o abiertos por la aplicación).
   - Si la aplicación permanece en modo **Testing**, añade las cuentas de correo autorizadas como usuarios de prueba.

2. **Credenciales de Cliente OAuth**:
   - Crea un cliente OAuth de tipo **Aplicación web** (Web application) y anota su Client ID (`...apps.googleusercontent.com`).
   - Configura los orígenes JavaScript autorizados (ej. `http://localhost:3000` y tu URL de GitHub Pages).

3. **Configuración en el código (API Key / Client ID)**:
   - Por motivos de seguridad, el archivo `.env` con las credenciales reales no se incluye en el repositorio público de GitHub. La versión distribuida oficial utiliza la clave configurada por el autor.
   - Si clonas o creas tu propia versión (fork) a partir de este repositorio, copia `.env.example` a `.env.local` (o `.env`) y asigna tu propio Client ID a `VITE_GOOGLE_WEB_CLIENT_ID`:
     ```env
     VITE_GOOGLE_WEB_CLIENT_ID=tu-cliente-id.apps.googleusercontent.com
     ```
   - No se requiere Firebase ni un archivo `google-services.json`.

4. **Compilación en Android (opcional)**:
   - Para Android, puedes crear un cliente OAuth Android en Google Cloud Console utilizando el ID de paquete `io.github.xelloss1012.yomisuba` y la huella SHA-1 de tu certificado (el de depuración o tu clave release, ver [Firma del APK release](#firma-del-apk-release)).
   - Ejecuta `npm run android:sync` y compila la aplicación (`npm run android:build`).

Google pedirá autorización para crear, listar, leer y actualizar los archivos creados por Yomisuba usando únicamente `drive.file`. La app no accede a otros archivos de Drive ni lista EPUB copiados manualmente. Los EPUB importados desde el selector del sistema se abren y se guardan localmente; se pueden copiar a Drive con la acción «Subir a Drive». Esos libros aparecen junto con los guardados previamente desde la app. Los EPUB guardados en Drive conservan su nombre original. La app usa el ID de cliente web también en Android; el cliente OAuth Android autoriza el paquete y certificado de firma. En Android se restaura la sesión nativa y se renueva el token al volver a la app; Google puede volver a pedir autorización si la cuenta revoca el acceso o caducan las credenciales de inicio de sesión. Los ajustes y datos de lectura son JSON, y los EPUB son archivos individuales; no están cifrados por la app. La configuración incluye cualquier clave IA guardada y queda sujeta a la seguridad de la cuenta Google y Drive.

---

## 📁 Estructura del Proyecto

- `src/types/epub.ts`: Interfaces y tipos de datos del libro, metadatos y ajustes.
- `src/utils/epubParser.ts`: Parser de archivos EPUB (container.xml, OPF, TOC, manifiesto, resolución de imágenes y estilos a Blob URLs).
- `src/utils/sampleBook.ts`: Generador del libro de prueba en japonés con ruby y texto vertical.
- `src/components/EpubReader.tsx`: Visor principal del libro con paginación columnar, iframe aislado y control de eventos.
- `src/components/ReaderNavbar.tsx`: Barra superior con metadatos, modo vertical/horizontal, índice y ajustes.
- `src/components/ReaderFooter.tsx`: Barra inferior con paginador y scrubber de capítulos.
- `src/components/ReaderSettings.tsx`: Panel flotante de ajustes (fuentes, tamaño, temas, interlineado).
- `src/components/ReaderToc.tsx`: Drawer lateral con la tabla de contenidos / capítulos.
- `src/components/FileDropZone.tsx`: Pantalla de bienvenida con Drag & Drop y botón de muestra.
- `src/components/BookLibraryModal.tsx` y `src/utils/libraryCatalog.ts`: Biblioteca gratuita (catálogo, filtros por género, descarga verificada).
- `scripts/build-library.mjs` y `scripts/check-library.mjs`: Generan y validan el repositorio de la biblioteca.

---

## 📄 Licencia

El código de Yomisuba se distribuye bajo la [licencia MIT](LICENSE).

Los datos de diccionario mantienen su propia licencia, que no es la del código:

- **JMdict/EDICT** (`src/data/`): © Electronic Dictionary Research and Development Group (EDRDG), [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html).
- **Diccionarios opcionales** (descarga desde [yomisuba-dictionaries](https://github.com/xelloss1012/yomisuba-dictionaries)): francés y alemán derivados de JMdict (CC BY-SA 4.0, EDRDG); japonés-japonés, chino, coreano, italiano y vietnamita adaptados de las ediciones correspondientes de Wiktionary ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)).

- **Niveles de vocabulario** (`src/data/word-levels.json.gz`): marcas de frecuencia de JMdict (EDRDG, CC BY-SA 4.0), listas de vocabulario y kanji del JLPT de Jonathan Waller ([tanos.co.uk](http://www.tanos.co.uk/jlpt/), CC BY, en la versión de [Bluskyo/JLPT_Vocabulary](https://github.com/Bluskyo/JLPT_Vocabulary)) y KANJIDIC2 (EDRDG, CC BY-SA 4.0). Las listas JLPT no son oficiales.

- **Libros de la biblioteca gratuita** (repositorio [yomisuba-library](https://github.com/xelloss1012/yomisuba-library)): obras de dominio público y obras con licencia Creative Commons (CC BY o CC BY-SA, cuyo nombre y enlace muestra cada libro) de [Aozora Bunko](https://www.aozora.gr.jp/) (青空文庫), con los créditos de la edición, de quien transcribió y de quien revisó cada texto, y la licencia y el crédito de traducción de cada obra, en [ATTRIBUTION.md](https://github.com/xelloss1012/yomisuba-library/blob/main/ATTRIBUTION.md). El catálogo, las descripciones y las carátulas están bajo [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- **Análisis morfológico** (`public/dict/`): diccionario de [kuromoji.js](https://github.com/takuyaa/kuromoji.js) (Apache 2.0), derivado de mecab-ipadic-2.7.0 (© Nara Institute of Science and Technology). Su aviso de licencia completo está en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Libro de muestra**: *走れメロス*, de Dazai Osamu, obra de dominio público.

Las dependencias de npm conservan sus licencias respectivas.
