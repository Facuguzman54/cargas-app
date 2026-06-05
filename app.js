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