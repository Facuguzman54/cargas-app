let masterData = [];
let currentItemCount = 0;
let barcodeInput = null;
let barcodeInputDebounceId = null;

function triggerBarcodeProcessing(immediate = false) {
    if (!barcodeInput) return;

    const rawValue = barcodeInput.value;
    const sanitizedLength = rawValue.replace(/\D/g, '').trim().length;

    if (sanitizedLength < 20) return;

    if (!immediate) {
        clearTimeout(barcodeInputDebounceId);
        barcodeInputDebounceId = setTimeout(() => {
            processBarcodeString(barcodeInput.value);
        }, 180);
        return;
    }

    clearTimeout(barcodeInputDebounceId);
    processBarcodeString(rawValue);
}

window.addEventListener('DOMContentLoaded', () => {
    barcodeInput = document.getElementById('barcode-input');

    if (localStorage.getItem('arcor_production_data')) {
        masterData = JSON.parse(localStorage.getItem('arcor_production_data'));
        updateUI();
    }

    handleModeChange();
    focusMainInput();

    barcodeInput.addEventListener('input', function () {
        triggerBarcodeProcessing(false);
    });

    barcodeInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            triggerBarcodeProcessing(true);
        }
    });

    barcodeInput.addEventListener('blur', function () {
        triggerBarcodeProcessing(true);
    });

    // Register service worker for PWA installability
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js').catch(() => { /* fail silently */ });
    }
});

function focusMainInput() {
    if (barcodeInput) barcodeInput.focus();
}

function clearBarcodeField() {
    if (barcodeInput) {
        barcodeInput.value = "";
        focusMainInput();
    }
}

function handleModeChange() {
    const mode = document.getElementById('packaging-mode').value;
    const indicator = document.getElementById('item-slot-indicator');

    if (mode === 'totem') {
        currentItemCount = 0;
        indicator.innerText = "Modo: Tótem Único";
        indicator.className = "text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded";
    } else {
        indicator.innerText = `Tambor ${currentItemCount + 1} de 4`;
        indicator.className = "text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded";
    }

    focusMainInput();
}


// MOTOR DE DESGLOSE DE CÓDIGO (Lógica elástica basada en el largo del peso)
function processBarcodeString(rawData) {
    // 1. Limpieza de caracteres: nos quedamos solo con los números
    let code = rawData.replace(/\D/g, '').trim();

    // 2. NORMALIZACIÓN: Si NO empieza con "0", se lo agregamos obligatoriamente
    if (!code.startsWith('0')) {
        code = '0' + code;
    }

    // 3. Quitar el último dígito verificador/random del final
    code = code.slice(0, -1);

    // Validación de longitud mínima de seguridad
    if (code.length < 22) {
        document.getElementById('field-obs').value = "Código corto o inválido";
        return false;
    }

    try {
        // ESTRUCTURA DESDE EL INICIO (Siempre fija hasta la posición 15)
        // 0 (0) | YY (1-2) | MM (3-4) | DD (5-6) | HH (7-8) | MM (9-10) | PROD (11-14)
        const yy = code.substring(1, 3);   // "26"
        const mm = code.substring(3, 5);   // "03" o "04"
        const dd = code.substring(5, 7);   // "21" o "03"

        const fechaFab = `${parseInt(dd)}/${parseInt(mm)}/20${yy}`;
        const lote = `${dd}${mm}${yy}`;   // Formato DDMMYY para el Lote

        const hr = code.substring(7, 9);   // Hora
        const min = code.substring(9, 11); // Minutos
        const hora = `${hr}:${min}`;

        // ESTRUCTURA DESDE EL FINAL (Para absorber la diferencia de dígitos del peso)
        // Los últimos 5 dígitos son SIEMPRE el número de cabezal (ej: "21378" o "16324")
        const nroCabezal = code.slice(-5);

        // Los 2 dígitos anteriores a esos 5 son SIEMPRE el tipo de cabezal (ej: "02")
        const tipoCabezal = code.slice(-7, -5);

        let letra = "X";
        if (tipoCabezal === "01") {
            letra = "A";
        } else if (tipoCabezal === "02") {
            letra = "B";
        }
        const cabezal = `${letra}${parseInt(nroCabezal)}`;

        // EL PESO NETO ES LO QUE QUEDA EN EL MEDIO:
        // Arranca en la posición fija 15 (donde termina el código de producto) 
        // y llega hasta donde empieza el tipo de cabezal (7 dígitos antes del final).
        const rawPeso = code.substring(15, code.length - 7);
        const pesoNeto = parseInt(rawPeso); // Devuelve 1202 o 241 directo como entero puro

        // 4. Inyección limpia en la pantalla
        document.getElementById('field-lote').value = lote;
        document.getElementById('field-cabezal').value = cabezal;
        document.getElementById('field-fecha').value = fechaFab;
        document.getElementById('field-hora').value = hora;
        document.getElementById('field-peso').value = pesoNeto;
        document.getElementById('field-obs').value = "";
        return true;

    } catch (e) {
        document.getElementById('field-obs').value = "Error en desglose mixto.";
        return false;
    }
}

function commitCurrentItem() {
    const palletNum = document.getElementById('pallet-number').value;
    const mode = document.getElementById('packaging-mode').value;
    const cabezalVal = document.getElementById('field-cabezal').value;

    if (!cabezalVal || cabezalVal === "-") {
        alert("Primero tenés que escanear un código válido o verificar el desglose.");
        return;
    }

    const newItem = {
        pallet: palletNum,
        lote: document.getElementById('field-lote').value || "-",
        cabezal: cabezalVal,
        fechaFab: document.getElementById('field-fecha').value || "-",
        hora: document.getElementById('field-hora').value || "-",
        pesoNeto: document.getElementById('field-peso').value || "0",
        observaciones: document.getElementById('field-obs').value || ""
    };

    masterData.push(newItem);
    localStorage.setItem('arcor_production_data', JSON.stringify(masterData));

    if (mode === 'tambor') {
        currentItemCount++;
        if (currentItemCount >= 4) {
            document.getElementById('pallet-number').value = parseInt(palletNum) + 1;
            currentItemCount = 0;
        }
    } else {
        document.getElementById('pallet-number').value = parseInt(palletNum) + 1;
    }

    barcodeInput.value = "";
    document.getElementById('field-lote').value = "";
    document.getElementById('field-cabezal').value = "";
    document.getElementById('field-fecha').value = "";
    document.getElementById('field-hora').value = "";
    document.getElementById('field-peso').value = "";
    document.getElementById('field-obs').value = "";

    handleModeChange();
    updateUI();
    focusMainInput();
}

function removeRow(index) {
    masterData.splice(index, 1);
    localStorage.setItem('arcor_production_data', JSON.stringify(masterData));
    updateUI();
    focusMainInput();
}

function clearAllData() {
    if (confirm("¿Limpiar por completo el historial guardado?")) {
        masterData = [];
        localStorage.removeItem('arcor_production_data');
        document.getElementById('pallet-number').value = 1;
        currentItemCount = 0;
        barcodeInput.value = "";
        handleModeChange();
        updateUI();
    }
}

function vibrateDevice() {
    if (navigator.vibrate) navigator.vibrate(120);
}

function updateUI() {
    document.getElementById('global-counter').innerText = masterData.length;
    const tbody = document.getElementById('table-body');

    if (masterData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-gray-400 italic">No hay registros cargados.</td></tr>`;
        return;
    }

    const cabezalOccurrences = {};
    const secondOccurrenceIndexes = new Set();
    masterData.forEach((item, index) => {
        const cabezalKey = item.cabezal || "";
        cabezalOccurrences[cabezalKey] = (cabezalOccurrences[cabezalKey] || 0) + 1;
        if (cabezalOccurrences[cabezalKey] === 2) {
            secondOccurrenceIndexes.add(index);
        }
    });

    let html = "";
    for (let i = masterData.length - 1; i >= 0; i--) {
        const item = masterData[i];
        const isSecondOccurrence = secondOccurrenceIndexes.has(i);
        const rowClass = isSecondOccurrence ? "bg-red-100 hover:bg-red-200 border-b border-red-300" : "hover:bg-gray-100 border-b";
        html += `
            <tr class="${rowClass}">
                <td class="p-2 font-bold text-blue-900">${item.pallet}</td>
                <td class="p-2 font-mono ${isSecondOccurrence ? "font-bold text-red-800" : ""}">${item.cabezal}</td>
                <td class="p-2 font-semibold">${item.pesoNeto} kg</td>
                <td class="p-2 text-center">
                    <button onclick="removeRow(${i})" class="text-red-500 font-bold px-2">✕</button>
                </td>
            </tr>
        `;
    }

    tbody.innerHTML = html;
}

/**
 * Genera el .xlsx en memoria (sin tocarlo aún) y lo guarda en la PWA
 * (OPFS + IndexedDB) en lugar de forzar la descarga clásica al sistema
 * de archivos del celular. El usuario después lo gestiona desde
 * "Mis Reportes" y decide ahí cuándo exportarlo/compartirlo.
 */
async function exportToExcel() {
    if (masterData.length === 0) {
        alert("No hay registros cargados.");
        return;
    }

    const rowsForExcel = masterData.map(item => ({
        "PALLET": parseInt(item.pallet),
        "LOTE": item.lote,
        "CABEZAL": item.cabezal,
        "FECHA FAB": item.fechaFab,
        "HORA": item.hora,
        "PESO NETO": parseFloat(item.pesoNeto),
        "OBSERVACIONES": item.observaciones
    }));

    const worksheet = XLSX.utils.json_to_sheet(rowsForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Producción");

    worksheet["!cols"] = [
        { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 24 }
    ];

    // "array" nos da un ArrayBuffer, que envolvemos en un Blob con el MIME
    // correcto de xlsx (no lo escribimos a disco: se queda en memoria).
    const wbArray = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbArray], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `reporte_produccion_${dateStr}.xlsx`;

    const packagingMode = document.getElementById('packaging-mode').value;
    const palletCount = new Set(masterData.map(i => i.pallet)).size;
    const totalWeight = masterData.reduce((sum, i) => sum + (parseFloat(i.pesoNeto) || 0), 0);

    // Preview liviano para la card de "Mis Reportes": no guardamos todo el
    // detalle acá (eso vive en el .xlsx dentro de OPFS), solo un puñado de
    // filas representativas. Nota: la app no tiene un campo "Producto"
    // propio, así que usamos Cabezal como identificador de producto/línea,
    // y Peso Neto como "cantidad" de esa fila.
    const itemsPreview = masterData.slice(0, 6).map(i => ({
        lote: i.lote,
        cabezal: i.cabezal,
        pesoNeto: i.pesoNeto
    }));

    try {
        await ReportsStorage.saveReport(blob, {
            fileName,
            date: dateStr,
            packagingMode,
            items: itemsPreview,
            palletCount,
            totalWeight
        });

        showToast(`Reporte guardado en "Mis Reportes" ✓`);

        // Si la vista de reportes está abierta, la refrescamos al toque.
        if (!document.getElementById('reports-view').classList.contains('hidden')) {
            refreshReportsList();
        }
    } catch (err) {
        console.error(err);
        alert("No se pudo guardar el reporte localmente: " + err.message);
    }

    focusMainInput();
}

/**
 * Pequeño toast no bloqueante (a diferencia de alert()) para confirmar
 * acciones sin interrumpir el flujo de escaneo del operario.
 */
function showToast(message) {
    const existing = document.getElementById('app-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('app-toast-visible'));
    setTimeout(() => {
        toast.classList.remove('app-toast-visible');
        setTimeout(() => toast.remove(), 300);
    }, 2400);
}

/* =========================================================================
 * SECCIÓN "MIS REPORTES"
 * Vista de historial que lee IndexedDB (rápido) y solo toca el OPFS cuando
 * el usuario aprieta "Exportar / Compartir" en una card puntual.
 * ========================================================================= */

let reportsSearchDebounceId = null;

function switchView(viewName) {
    const captureView = document.getElementById('capture-view');
    const reportsView = document.getElementById('reports-view');
    const navCapture = document.getElementById('nav-btn-capture');
    const navReports = document.getElementById('nav-btn-reports');

    const goingToReports = viewName === 'reports';

    captureView.classList.toggle('hidden', goingToReports);
    reportsView.classList.toggle('hidden', !goingToReports);

    navCapture.classList.toggle('nav-btn-active', !goingToReports);
    navReports.classList.toggle('nav-btn-active', goingToReports);

    if (goingToReports) {
        refreshReportsList();
    } else {
        focusMainInput();
    }
}

async function refreshReportsList() {
    const listEl = document.getElementById('reports-list');
    const searchText = document.getElementById('reports-search').value;

    listEl.setAttribute('aria-busy', 'true');

    try {
        const reports = await ReportsStorage.listReports({
            searchText,
            sortOrder: 'desc' // más reciente primero
        });
        renderReportsList(reports);
    } catch (err) {
        console.error(err);
        listEl.innerHTML = `<p class="text-center text-red-500 text-sm p-4">Error al leer los reportes guardados: ${err.message}</p>`;
    } finally {
        listEl.setAttribute('aria-busy', 'false');
    }
}

// Debounce del buscador para no relanzar la consulta a IndexedDB en cada tecla
function onReportsSearchInput() {
    clearTimeout(reportsSearchDebounceId);
    reportsSearchDebounceId = setTimeout(refreshReportsList, 200);
}

function renderReportsList(reports) {
    const listEl = document.getElementById('reports-list');

    if (reports.length === 0) {
        listEl.innerHTML = `
            <p class="text-center text-gray-400 italic text-sm p-6">
                No se encontraron reportes guardados.
            </p>`;
        return;
    }

    listEl.innerHTML = reports.map(reportToCardHTML).join('');
}

function reportToCardHTML(report) {
    const isTotem = report.packagingMode === 'totem';
    const badgeLabel = isTotem ? 'Tótem' : 'Tambores';
    const badgeClass = isTotem
        ? 'bg-amber-100 text-amber-700'
        : 'bg-blue-100 text-blue-700';

    const previewRows = report.items.slice(0, 3).map(item => `
        <tr class="text-[11px] text-gray-600">
            <td class="py-0.5 pr-2 font-mono">${escapeHTML(item.lote || '-')}</td>
            <td class="py-0.5 pr-2 font-mono">${escapeHTML(item.cabezal || '-')}</td>
            <td class="py-0.5 text-right">${escapeHTML(String(item.pesoNeto ?? '-'))} kg</td>
        </tr>
    `).join('');

    const sizeKb = report.sizeBytes ? (report.sizeBytes / 1024).toFixed(0) + ' KB' : '';

    // fileName se usa como identificador único (data-file-name) para no
    // tener que exponer un id numérico extra: ya es único por diseño.
    return `
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-3" data-file-name="${escapeHTML(report.fileName)}">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <p class="text-sm font-bold text-gray-800">${escapeHTML(report.date)}</p>
                    <p class="text-[11px] text-gray-400 font-mono truncate max-w-[180px]">${escapeHTML(report.fileName)}</p>
                </div>
                <span class="text-xs font-bold px-2 py-1 rounded-lg ${badgeClass}">${badgeLabel}</span>
            </div>

            <div class="grid grid-cols-3 gap-2 text-center bg-gray-50 rounded-lg py-2 mb-2">
                <div>
                    <p class="text-[10px] text-gray-400 uppercase font-semibold">Pallets</p>
                    <p class="text-sm font-bold text-blue-900">${report.palletCount}</p>
                </div>
                <div>
                    <p class="text-[10px] text-gray-400 uppercase font-semibold">Peso Total</p>
                    <p class="text-sm font-bold text-blue-900">${report.totalWeight.toFixed(1)} kg</p>
                </div>
                <div>
                    <p class="text-[10px] text-gray-400 uppercase font-semibold">Tamaño</p>
                    <p class="text-sm font-bold text-blue-900">${sizeKb}</p>
                </div>
            </div>

            ${previewRows ? `
            <table class="w-full mb-3">
                <thead>
                    <tr class="text-[10px] text-gray-400 uppercase font-semibold">
                        <td class="pr-2">Lote</td>
                        <td class="pr-2">Cabezal</td>
                        <td class="text-right">Peso</td>
                    </tr>
                </thead>
                <tbody>${previewRows}</tbody>
            </table>` : ''}

            <div class="flex gap-2">
                <button onclick="handleShareReport('${escapeJS(report.fileName)}')"
                    class="flex-1 bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold py-2.5 rounded-lg shadow transition-colors">
                    Exportar / Compartir
                </button>
                <button onclick="handleDeleteReport('${escapeJS(report.fileName)}')"
                    class="px-3 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold py-2.5 rounded-lg border border-red-200 transition-colors">
                    Borrar
                </button>
            </div>
        </div>
    `;
}

async function handleShareReport(fileName) {
    try {
        const result = await ReportsStorage.shareReport(fileName);
        if (result.cancelled) return; // el usuario cerró el share sheet, no mostramos error
        if (result.method === 'download') {
            const motivo = result.shareFailed
                ? `no se pudo compartir: ${result.diagnosticHint}`
                : 'tu navegador no soporta compartir archivos';
            showToast(`Descargado (${motivo}) ✓`);
        } else {
            showToast('Reporte compartido ✓');
        }
    } catch (err) {
        console.error(err);
        alert('No se pudo exportar el reporte: ' + err.message);
    }
}

async function handleDeleteReport(fileName) {
    if (!confirm(`¿Borrar el reporte "${fileName}"? Esta acción no se puede deshacer.`)) return;

    try {
        await ReportsStorage.deleteReport(fileName);
        showToast('Reporte borrado ✓');
        refreshReportsList();
    } catch (err) {
        console.error(err);
        alert('No se pudo borrar el reporte: ' + err.message);
    }
}

// Sanitización básica para evitar inyectar HTML/JS al armar las cards
// dinámicamente a partir de datos guardados por el propio usuario.
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeJS(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}