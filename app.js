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

// MOTOR DE DESGLOSE DE CÓDIGO (Interleaved 2 of 5 - 23 dígitos)
function processBarcodeString(rawData) {
    const code = rawData.replace(/\D/g, '').trim();

    if (code.length < 20) {
        document.getElementById('field-obs').value = "Código corto (" + code.length + " dígs)";
        return false;
    }

    try {
        const yy = code.substring(1, 3);
        const mm = code.substring(3, 5);
        const dd = code.substring(5, 7);
        const hr = code.substring(7, 9);
        const min = code.substring(9, 11);

        const fechaFab = `${parseInt(dd)}/${parseInt(mm)}/20${yy}`;
        const lote = `${dd}${mm}${yy}`;
        const hora = `${hr}:${min}`;

        const codigoSinVerificador = code.slice(0, -1);

        let pesoNeto = "0.0";
        let cabezal = "-";

        const indiceB = codigoSinVerificador.lastIndexOf("02");
        const indiceA = codigoSinVerificador.lastIndexOf("01");

        if (indiceB !== -1 && indiceB > indiceA && indiceB > 11) {
            const nroCabezal = codigoSinVerificador.substring(indiceB + 2);
            cabezal = `B${parseInt(nroCabezal)}`;

            const bloquePeso = codigoSinVerificador.substring(15, indiceB);
            pesoNeto = bloquePeso.length === 3 ? (parseFloat(bloquePeso)).toFixed(1) : (parseFloat(bloquePeso) / 10).toFixed(1);
        } else if (indiceA !== -1 && indiceA > 11) {
            const nroCabezal = codigoSinVerificador.substring(indiceA + 2);
            cabezal = `A${parseInt(nroCabezal)}`;

            const bloquePeso = codigoSinVerificador.substring(15, indiceA);
            pesoNeto = bloquePeso.length === 3 ? (parseFloat(bloquePeso)).toFixed(1) : (parseFloat(bloquePeso) / 10).toFixed(1);
        } else {
            const elResto = code.substring(11);
            const bloquePeso = elResto.substring(4, 8);
            pesoNeto = bloquePeso;

            const identificadorLetra = elResto.substring(8, 9);
            const letra = identificadorLetra === "1" ? "A" : (identificadorLetra === "2" ? "B" : "X");
            const nroCabezal = elResto.substring(9);
            cabezal = `${letra}${parseInt(nroCabezal)}`;
        }

        document.getElementById('field-lote').value = lote;
        document.getElementById('field-cabezal').value = cabezal;
        document.getElementById('field-fecha').value = fechaFab;
        document.getElementById('field-hora').value = hora;
        document.getElementById('field-peso').value = pesoNeto;
        document.getElementById('field-obs').value = "";
        return true;
    } catch (e) {
        document.getElementById('field-obs').value = "Error en análisis por reverso.";
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