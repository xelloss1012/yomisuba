# 📖 Lector EPUB con Soporte de Japonés Vertical (縦書き)

Una aplicación web moderna tipo Kindle desarrollada en **React + TypeScript + Vite + Tailwind CSS**, optimizada para la lectura de libros EPUB tanto en formato horizontal occidental como en **formato vertical tradicional japonés (`vertical-rl` / 縦書き)** con soporte completo de **furigana (`<ruby>`)**, ilustraciones, estilos e índice de contenidos.

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

4. **Personalización y Temas**:
   - **Modo Blanco** (estándar limpio).
   - **Modo Papel** (tono cálido agradable para lectura prolongada).
   - **Modo Sepia** (tono clásico pergamino).
   - **Modo Noche / Oscuro** (fondo oscuro para descanso visual).
   - Control de tamaño de fuente (12px – 50px) e interlineado.
   - Conmutador rápido entre modo Vertical (縦書き) y Horizontal (横書き).

5. **Libro de Muestra Integrado**:
   - Incluye un botón para generar y cargar al instante un libro de prueba japonés (*走れメロス - Dazai Osamu*) con portada, ilustraciones, furigana y varios capítulos sin necesidad de buscar un archivo local.

6. **Diccionario JMDict japonés-español/inglés**:
   - Prioriza las entradas españolas y completa los resultados que faltan con la edición inglesa oficial de JMdict.
   - El complemento inglés se distribuye comprimido y se carga solo cuando hacen falta resultados adicionales.
   - Para actualizarlo a la última versión oficial (Python 3.8 o superior): `npm run dictionary:update`.
   - Los datos JMdict/EDICT son © Electronic Dictionary Research and Development Group (EDRDG), bajo licencia [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html). Consulta también la [fuente y documentación de JMdict](https://www.edrdg.org/wiki/JMdict-EDICT_Dictionary_Project.html).

---

## 🚀 Cómo ejecutar la aplicación

Abre un terminal en esta carpeta (`D:\Manolo\Proyectos\EReader`) y ejecuta:

```bash
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
`dist/android/ereader-japanese-vertical-release.apk`. `dist/` está excluido de
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

---

### Copia de seguridad en Google Drive

La aplicación continúa funcionando y guardando datos localmente sin iniciar
sesión. Al conectar Google, los ajustes (incluidas las claves IA) se guardan
automáticamente cuando cambian, y los datos de lectura cuando el usuario
avanza, añade/elimina marcadores o anotaciones, o modifica el historial. Cada
libro tiene un archivo de lectura independiente. Los EPUB no se suben solos:
el usuario elige cada libro que quiere guardar o descargar. La restauración de
ajustes también es manual; al descargar un libro se restaura su estado si hay
una copia. Para actualizar el progreso de un EPUB ya guardado localmente, usa
la acción **Actualizar** junto al libro en la lista de Google Drive. No hay
base de datos compartida entre usuarios ni archivo ZIP. Todo se guarda en el
Drive de la cuenta conectada.

Para habilitar Drive:

1. En Google Cloud Console crea un proyecto, activa **Google Drive API** y
   configura la pantalla de consentimiento OAuth. Si permanece en modo
   **Testing**, añade las cuentas que probarán la app como usuarios de prueba.
2. Crea un cliente OAuth de tipo **Web application**. En web, añade los
   orígenes autorizados de la aplicación. Para Android, crea además un cliente
   OAuth Android con el ID de paquete `com.ereader.japanesevertical` y la
   huella SHA-1 del certificado que firma la APK (debug y release si usarás
   ambos).
3. Copia `.env.example` a `.env.local` y asigna a
   `VITE_GOOGLE_WEB_CLIENT_ID` el ID del cliente web (`...apps.googleusercontent.com`).
   No se necesita Firebase ni un `google-services.json`.
4. Ejecuta `npm run android:sync` y vuelve a compilar la aplicación.

Google pedirá autorización para acceder a los archivos creados por EReader.
El permiso `drive.file` permite crear y actualizar archivos de EReader. La app
usa el ID de cliente web también en Android; el cliente OAuth Android autoriza
el paquete y certificado de firma. El token se mantiene solo en memoria y
puede ser necesario volver a conectar Google si caduca. Los ajustes y datos de
lectura son JSON, y los EPUB son archivos individuales; no están cifrados por
la app. La configuración incluye cualquier clave IA guardada y queda sujeta a
la seguridad de la cuenta Google y Drive.

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
