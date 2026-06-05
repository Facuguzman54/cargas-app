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

// MOTOR DE DESGLOSE DE CÓDIGO (Estructura de posiciones fijas de Planta)
function processBarcodeString(rawData) {
    // 1. Limpieza de caracteres: nos quedamos solo con los números
    let code = rawData.replace(/\D/g, '').trim();
    
    // 2. Control de inicio: Aseguramos que empiece con "0"
    if (!code.startsWith('0')) {
        document.getElementById('field-obs').value = "Error: Debe empezar con 0";
        return false;
    }

    // 3. Quitar el último dígito verificador/random
    code = code.slice(0, -1); 

    // Validación de longitud mínima segura con el código ya recortado (21 fijos + nro cabezal)
    if (code.length < 22) {
        document.getElementById('field-obs').value = "Código corto tras recorte";
        return false;
    }

    try {
        // CORTE DE BLOQUES FIJOS:
        // Estructura: 0 [YY][MM][DD] [HH][MM] [PROD] [PESO] [CAB] [NRO_CABEZAL]
        // Ejemplo:    0  26  03  01   06  22   7242   1201   01   7917

        // Extracción de Fecha y Lote (Posiciones indexadas fijas)
        const yy = code.substring(1, 3);   // Año (ej: "26")
        const mm = code.substring(3, 5);   // Mes (ej: "03")
        const dd = code.substring(5, 7);   // Día (ej: "01")
        
        const fechaFab = `${parseInt(dd)}/${parseInt(mm)}/20${yy}`;
        const lote = `${dd}${mm}${yy}`;   // Formato DDMMYY para el Lote

        // Extracción de Hora y Minutos
        const hr = code.substring(7, 9);   // Hora (ej: "06")
        const min = code.substring(9, 11); // Minutos (ej: "22")
        const hora = `${hr}:${min}`;

        // Extracción de Peso Neto (Siempre ocupa 4 posiciones: de la 15 a la 19)
        const rawPeso = code.substring(15, 19); // ej: "1201" o "2400"
        const pesoNeto = (parseFloat(rawPeso) / 10).toFixed(1); // ej: "120.1" o "240.0"

        // Extracción de Cabezal e Identificador (Posiciones 19 y 20)
        const tipoCabezal = code.substring(19, 21); // "01" o "02" (o históricamente "1" o "2")
        let letra = "X";
        if (tipoCabezal === "01" || tipoCabezal === "1") {
            letra = "A";
        } else if (tipoCabezal === "02" || tipoCabezal === "2") {
            letra = "B";
        }
        
        // El Número de Cabezal arranca SIEMPRE en la posición 21 y se estira hasta el final
        const nroCabezal = code.substring(21); // Agarra "7917", "16324", etc.
        const cabezal = `${letra}${parseInt(nroCabezal)}`; // limpia ceros basura a la izquierda si los hubiera

        // 4. Inyección limpia y directa en los inputs de la pantalla
        document.getElementById('field-lote').value = lote;
        document.getElementById('field-cabezal').value = cabezal;
        document.getElementById('field-fecha').value = fechaFab;
        document.getElementById('field-hora').value = hora;
        document.getElementById('field-peso').value = pesoNeto;
        document.getElementById('field-obs').value = "";
        return true;

    } catch (e) {
        document.getElementById('field-obs').value = "Error en procesamiento rígido.";
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