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


// MOTOR DE DESGLOSE DE CÓDIGO (Normalizado sin cero inicial)
function processBarcodeString(rawData) {
    // 1. Limpieza de caracteres: nos quedamos solo con los números
    let code = rawData.replace(/\D/g, '').trim();
    
    // 2. NORMALIZACIÓN: Si empieza con "0", se lo quitamos para que el año (YY) sea siempre la posición 0
    if (code.startsWith('0')) {
        code = code.substring(1);
    }

    // 3. Quitar el último dígito verificador/random del final
    code = code.slice(0, -1); 

    // Validación de longitud mínima (ahora que sacamos el 0 y el verificador, el bloque fijo mide 20 dígitos + nro cabezal)
    if (code.length < 21) {
        document.getElementById('field-obs').value = "Código incompleto o inválido";
        return false;
    }

    try {
        // NUEVA ESTRUCTURA DE POSICIONES ABSOLUTAS (Arrancando directo en el Año YY):
        // Ejemplo Tambor sin 0 y sin fin: [26][03][21] [16][14] [9402] [2410] [21] [6324]
        // Ejemplo Totem sin fin:         [26][04][03] [20][05] [7242] [1202] [02] [21378]
        //
        // Posiciones exactas del string:
        // [0-1]   -> Año (YY)
        // [2-3]   -> Mes (MM)
        // [4-5]   -> Día (DD)
        // [6-7]   -> Hora (HH)
        // [8-9]   -> Minutos (MM)
        // [10-13] -> Código Producto (4 dígitos)
        // [14-17] -> Peso Neto (4 dígitos)
        // [18-19] -> Tipo Cabezal (01 o 02)
        // [20 en adelante] -> Número de Cabezal (Variable)

        // Extracción de Fecha y Lote
        const yy = code.substring(0, 2);   // "26"
        const mm = code.substring(2, 4);   // "03" o "04"
        const dd = code.substring(4, 6);   // "21" o "03"
        
        const fechaFab = `${parseInt(dd)}/${parseInt(mm)}/20${yy}`;
        const lote = `${dd}${mm}${yy}`;   // Formato DDMMYY para el Lote

        // Extracción de Hora y Minutos
        const hr = code.substring(6, 8);   
        const min = code.substring(8, 10); 
        const hora = `${hr}:${min}`;

        // Extracción de Peso Neto (Siempre de la posición 14 a la 18 -> 4 dígitos)
        // Para el tambor cortará "2410". Al hacer el ajuste para que sea entero de tres dígitos reales en kilos (241):
        // Si el peso termina en cero y necesitas que figure 241, dividimos por 10.
        // Si tu balanza para Totem registra "1202" directo como 1202 kg enteros, evaluamos la longitud:
        const rawPeso = code.substring(14, 18); // Tambor: "2410" | Totem: "1202"
        
        let pesoNeto = parseInt(rawPeso);
        // Si el valor ronda los 2000 o menos pero sabemos que los tambores no pasan los 300kg, 
        // y el código de barra le agrega un cero al final (ej: 2410 significa 241 kg)
        if (pesoNeto > 2000) {
            // Es un valor de tambor con un cero extra al final (ej: 2410 -> 241)
            pesoNeto = Math.round(pesoNeto / 10);
        }

        // Extracción de Cabezal (Posición 18 y 19 -> 2 dígitos)
        // Tambor: "21" (el '02' viejo se corrió) -> Ahora con el desfase corregido va a leer "02" exacto.
        const tipoCabezal = code.substring(18, 20); 
        let letra = "X";
        if (tipoCabezal === "01" || tipoCabezal === "1") {
            letra = "A";
        } else if (tipoCabezal === "02" || tipoCabezal === "2") {
            letra = "B";
        }
        
        // El Número de Cabezal arranca siempre en la posición 20 hasta el final
        const nroCabezal = code.substring(20); 
        const cabezal = `${letra}${parseInt(nroCabezal)}`; 

        // 4. Inyección limpia en la pantalla
        document.getElementById('field-lote').value = lote;
        document.getElementById('field-cabezal').value = cabezal;
        document.getElementById('field-fecha').value = fechaFab;
        document.getElementById('field-hora').value = hora;
        document.getElementById('field-peso').value = pesoNeto; 
        document.getElementById('field-obs').value = "";
        return true;

    } catch (e) {
        document.getElementById('field-obs').value = "Error en normalización por año.";
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

    let html = "";
    for (let i = masterData.length - 1; i >= 0; i--) {
        const item = masterData[i];
        html += `
            <tr class="hover:bg-gray-100 border-b">
                <td class="p-2 font-bold text-blue-900">${item.pallet}</td>
                <td class="p-2 font-mono">${item.cabezal}</td>
                <td class="p-2 font-semibold">${item.pesoNeto} kg</td>
                <td class="p-2 text-center">
                    <button onclick="removeRow(${i})" class="text-red-500 font-bold px-2">✕</button>
                </td>
            </tr>
        `;
    }

    tbody.innerHTML = html;
}

function exportToExcel() {
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

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Planilla_Produccion_${dateStr}.xlsx`);
    focusMainInput();
}