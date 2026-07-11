/**
 * reports-storage.js
 * ---------------------------------------------------------------------------
 * Arquitectura híbrida de almacenamiento local para "Mis Reportes":
 *
 *   - OPFS (Origin Private File System) guarda el binario .xlsx real.
 *     Es rápido, no pide permisos al usuario y no ensucia el almacenamiento
 *     "visible" del celular (a diferencia de una descarga clásica).
 *
 *   - IndexedDB guarda solo los METADATOS (nombre, fecha, tipo de envase,
 *     preview de cabezales, peso total, tamaño del archivo). Esto permite que
 *     la vista de historial ("Mis Reportes") se pinte al instante, sin tener
 *     que abrir/leer archivos del OPFS hasta que el usuario realmente
 *     necesita compartir o exportar uno.
 *
 * Todas las funciones son async y devuelven Promesas. Ninguna función
 * lanza errores "silenciosos": todo error real se re-lanza envuelto en un
 * Error con un prefijo identificable (OPFS_*, IDB_*, SHARE_*) para que quien
 * llame pueda decidir cómo mostrarlo en la UI.
 *
 * Todo queda expuesto bajo el namespace global `ReportsStorage` para
 * mantener el mismo estilo "script clásico" (sin módulos ES) que el resto
 * de la app.
 * ---------------------------------------------------------------------------
 */

(function (global) {
    'use strict';

    const DB_NAME = 'pallets_reports_db';
    const DB_VERSION = 1;
    const STORE_NAME = 'reports';
    const OPFS_DIR = 'reportes';

    // -------------------------------------------------------------------
    // Detección de soporte (Safari/iOS viejos o navegadores de escritorio
    // sin OPFS todavía pueden no tener createWritable, por ejemplo)
    // -------------------------------------------------------------------
    function isOPFSSupported() {
        return !!(navigator.storage && navigator.storage.getDirectory);
    }

    function isIndexedDBSupported() {
        return !!global.indexedDB;
    }

    function isWebShareFilesSupported() {
        return !!(navigator.canShare && navigator.share);
    }

    // -------------------------------------------------------------------
    // IndexedDB: apertura de la base con manejo de upgrade
    // -------------------------------------------------------------------
    function openDB() {
        return new Promise((resolve, reject) => {
            if (!isIndexedDBSupported()) {
                reject(new Error('IDB_UNSUPPORTED: Este navegador no soporta IndexedDB.'));
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    // keyPath = fileName: como todos los reportes comparten
                    // prefijo y solo cambian por fecha, el nombre de archivo
                    // ya es único de forma natural.
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'fileName' });
                    store.createIndex('byDate', 'date', { unique: false });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error('IDB_OPEN_FAILED: ' + request.error?.message));
        });
    }

    // Helper genérico para correr una transacción y devolver una Promesa
    function runTransaction(db, mode, fn) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, mode);
            const store = tx.objectStore(STORE_NAME);
            let result;

            try {
                result = fn(store);
            } catch (err) {
                reject(new Error('IDB_TX_FAILED: ' + err.message));
                return;
            }

            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(new Error('IDB_TX_FAILED: ' + tx.error?.message));
            tx.onabort = () => reject(new Error('IDB_TX_ABORTED: ' + tx.error?.message));
        });
    }

    // -------------------------------------------------------------------
    // OPFS: helpers de bajo nivel
    // -------------------------------------------------------------------
    async function getReportsDirHandle({ create = true } = {}) {
        if (!isOPFSSupported()) {
            throw new Error('OPFS_UNSUPPORTED: Este navegador no soporta Origin Private File System.');
        }
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle(OPFS_DIR, { create });
    }

    async function writeBlobToOPFS(fileName, blob) {
        try {
            const dirHandle = await getReportsDirHandle({ create: true });
            const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
        } catch (err) {
            throw new Error('OPFS_WRITE_FAILED: ' + err.message);
        }
    }

    async function readFileFromOPFS(fileName) {
        try {
            const dirHandle = await getReportsDirHandle({ create: false });
            const fileHandle = await dirHandle.getFileHandle(fileName, { create: false });
            return await fileHandle.getFile();
        } catch (err) {
            throw new Error('OPFS_READ_FAILED: No se encontró "' + fileName + '" en OPFS (' + err.message + ')');
        }
    }

    async function deleteFileFromOPFS(fileName) {
        try {
            const dirHandle = await getReportsDirHandle({ create: false });
            await dirHandle.removeEntry(fileName);
        } catch (err) {
            // Si ya no existe, no es un error fatal para el flujo de borrado.
            if (err.name !== 'NotFoundError') {
                throw new Error('OPFS_DELETE_FAILED: ' + err.message);
            }
        }
    }

    // -------------------------------------------------------------------
    // API PÚBLICA 1: guardar un reporte (blob .xlsx + metadatos)
    // -------------------------------------------------------------------
    /**
     * @param {Blob} blob - El binario .xlsx generado por SheetJS.
     * @param {Object} metadata
     * @param {string} metadata.fileName - Nombre único, ej: "reporte_produccion_2026-07-11.xlsx"
     * @param {string} metadata.date - Fecha en formato ISO (YYYY-MM-DD) usada para ordenar.
     * @param {'tambor'|'totem'} metadata.packagingMode - Tipo de envase del reporte.
     * @param {Array<{lote:string, cabezal:string, pesoNeto:string|number}>} metadata.items - Preview de filas.
     * @param {number} metadata.palletCount - Cantidad de pallets incluidos.
     * @param {number} metadata.totalWeight - Peso total en kg.
     * @returns {Promise<Object>} El registro guardado en IndexedDB.
     */
    async function saveReport(blob, metadata) {
        if (!blob || !(blob instanceof Blob)) {
            throw new Error('SAVE_INVALID_ARGS: Se esperaba un Blob válido.');
        }
        if (!metadata || !metadata.fileName || !metadata.date) {
            throw new Error('SAVE_INVALID_ARGS: metadata.fileName y metadata.date son obligatorios.');
        }

        // 1. Escribimos el binario primero. Si esto falla, no queremos dejar
        //    un metadato "huérfano" en IndexedDB apuntando a un archivo que
        //    no existe.
        await writeBlobToOPFS(metadata.fileName, blob);

        // 2. Recién si el archivo quedó bien guardado, persistimos el metadato.
        const record = {
            fileName: metadata.fileName,
            date: metadata.date,
            packagingMode: metadata.packagingMode || 'tambor',
            items: Array.isArray(metadata.items) ? metadata.items : [],
            palletCount: metadata.palletCount ?? 0,
            totalWeight: metadata.totalWeight ?? 0,
            sizeBytes: blob.size,
            createdAt: new Date().toISOString()
        };

        try {
            const db = await openDB();
            try {
                await runTransaction(db, 'readwrite', (store) => store.put(record));
            } finally {
                db.close();
            }
        } catch (err) {
            // Si falla IndexedDB después de haber escrito el archivo,
            // limpiamos el OPFS para no dejar basura sin metadatos asociados.
            await deleteFileFromOPFS(metadata.fileName).catch(() => {});
            throw err;
        }

        return record;
    }

    // -------------------------------------------------------------------
    // API PÚBLICA 2: listar / filtrar / ordenar reportes desde IndexedDB
    // -------------------------------------------------------------------
    /**
     * @param {Object} [options]
     * @param {string} [options.searchText] - Filtra por nombre/fecha (case-insensitive).
     * @param {'desc'|'asc'} [options.sortOrder] - Orden por fecha. Default: 'desc' (más reciente primero).
     * @param {'todos'|'tambor'|'totem'} [options.packagingMode] - Filtro opcional por tipo de envase.
     * @returns {Promise<Array<Object>>}
     */
    async function listReports(options = {}) {
        const { searchText = '', sortOrder = 'desc', packagingMode = 'todos' } = options;

        const db = await openDB();
        let records;
        try {
            records = await runTransaction(db, 'readonly', (store) => {
                return new Promise((resolve, reject) => {
                    const req = store.getAll();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            });
        } finally {
            db.close();
        }

        let filtered = records;

        if (packagingMode !== 'todos') {
            filtered = filtered.filter((r) => r.packagingMode === packagingMode);
        }

        const q = searchText.trim().toLowerCase();
        if (q) {
            filtered = filtered.filter((r) => {
                const haystack = (r.fileName + ' ' + r.date).toLowerCase();
                return haystack.includes(q);
            });
        }

        filtered.sort((a, b) => {
            // Comparación por string ISO funciona porque el formato es YYYY-MM-DD
            return sortOrder === 'desc'
                ? b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
                : a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
        });

        return filtered;
    }

    // -------------------------------------------------------------------
    // API PÚBLICA 3: recuperar el archivo binario desde OPFS (solo bajo demanda)
    // -------------------------------------------------------------------
    async function getReportFile(fileName) {
        return readFileFromOPFS(fileName);
    }

    // -------------------------------------------------------------------
    // API PÚBLICA 4: borrar un reporte (archivo + metadato)
    // -------------------------------------------------------------------
    async function deleteReport(fileName) {
        await deleteFileFromOPFS(fileName);

        const db = await openDB();
        try {
            await runTransaction(db, 'readwrite', (store) => store.delete(fileName));
        } finally {
            db.close();
        }
    }

    // -------------------------------------------------------------------
    // API PÚBLICA 5: exportar / compartir vía Web Share API con fallback
    // -------------------------------------------------------------------
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    // Caché en memoria para "precalentar" el archivo ANTES del click real.
    // El motivo: navigator.share() exige que el gesto del usuario siga
    // "activo" en el momento exacto de la llamada. Si entre el click y el
    // share() hay que ir a buscar el archivo al OPFS (3 handles async
    // encadenados: directorio → archivo → File), ese viaje de ida y vuelta
    // consume tiempo real de IPC y el gesto se pierde ANTES de llegar al
    // share(). Precargando en pointerdown (que dispara antes que click)
    // el archivo ya está en memoria cuando el click realmente ocurre, y
    // share() se puede invocar sin ningún await previo.
    const fileCache = new Map();

    /**
     * Llamar en pointerdown/touchstart del botón de compartir, ANTES del
     * click, para que el archivo esté listo en memoria cuando llegue el
     * click real. No consume el gesto del usuario porque no llama a
     * ninguna API que lo requiera (solo lee del OPFS).
     */
    async function prefetchReportFile(fileName) {
        if (fileCache.has(fileName)) return;
        try {
            const file = await readFileFromOPFS(fileName);
            fileCache.set(fileName, file);
        } catch (err) {
            // Si falla el prefetch no pasa nada grave: shareReport() va a
            // intentar leerlo de nuevo igual, solo que sin la ventaja de
            // la caché (mismo comportamiento que antes de este cambio).
        }
    }

    /**
     * Intenta compartir el archivo con navigator.share (apps nativas).
     * Si el navegador no soporta compartir archivos, cae en una descarga
     * clásica como fallback (mismo comportamiento que la app tenía antes).
     * @returns {Promise<{success:boolean, method:'share'|'download', cancelled?:boolean}>}
     */
    async function shareReport(fileName) {
        // Si ya está precargado por prefetchReportFile(), lo usamos directo
        // sin ningún await de por medio (gesto del click intacto).
        let file = fileCache.get(fileName);
        fileCache.delete(fileName);
        if (!file) {
            file = await getReportFile(fileName); // fallback si no hubo prefetch a tiempo
        }
        const shareableFile = new File([file], fileName, {
            type: file.type || XLSX_MIME
        });

        if (isWebShareFilesSupported()) {
            try {
                if (navigator.canShare({ files: [shareableFile] })) {
                    await navigator.share({
                        files: [shareableFile],
                        title: fileName,
                        text: 'Reporte de producción: ' + fileName
                    });
                    return { success: true, method: 'share' };
                }
            } catch (err) {
                // El usuario canceló el share sheet: no es un error real.
                if (err.name === 'AbortError') {
                    return { success: false, method: 'share', cancelled: true };
                }
                // Cualquier otra falla (gesto perdido, política del dispositivo,
                // iframe sin permiso, etc.) no debe dejar al operario sin poder
                // sacar el reporte: caemos a descarga clásica en vez de tirar error,
                // pero armamos un diagnóstico corto para mostrar en el toast y
                // no depender de conectar el equipo a devtools en planta.
                const gestureLost = !(navigator.userActivation && navigator.userActivation.isActive);
                const inIframe = window.self !== window.top;
                const diagnosticHint = gestureLost
                    ? 'gesto de click perdido'
                    : inIframe
                        ? 'bloqueado por iframe/política'
                        : 'bloqueado por el dispositivo (posible política MDM)';
                console.warn('ReportsStorage: share() falló → fallback descarga.', err.name, err.message, diagnosticHint);
                downloadFileFallback(shareableFile);
                return { success: true, method: 'download', shareFailed: true, diagnosticHint };
            }
        }

        // Fallback: descarga clásica del archivo (por ejemplo en desktop,
        // donde navigator.share de archivos no está disponible).
        downloadFileFallback(shareableFile);
        return { success: true, method: 'download' };
    }

    function downloadFileFallback(file) {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // -------------------------------------------------------------------
    // API PÚBLICA 6: uso total aproximado (útil para mostrar en la UI)
    // -------------------------------------------------------------------
    async function getStorageEstimate() {
        if (navigator.storage && navigator.storage.estimate) {
            try {
                return await navigator.storage.estimate(); // { usage, quota }
            } catch (err) {
                return null;
            }
        }
        return null;
    }

    // -------------------------------------------------------------------
    // Export del namespace global
    // -------------------------------------------------------------------
    global.ReportsStorage = {
        isOPFSSupported,
        isIndexedDBSupported,
        isWebShareFilesSupported,
        saveReport,
        listReports,
        getReportFile,
        prefetchReportFile,
        deleteReport,
        shareReport,
        getStorageEstimate
    };

})(window);
