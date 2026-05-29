// === js/history-excel-utils.js ===
import { showToast } from './utils.js';

export const fitToColumn = (ws) => {
    const objectMaxLength = [];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (!data || data.length === 0) return;
    if (data[0]) {
        Object.keys(data[0]).forEach((key, index) => {
            objectMaxLength[index] = String(data[0][key]).length;
        });
    }
    data.slice(1).forEach(row => {
        Object.keys(row).forEach((key, index) => {
            const cellLength = String(row[key] ?? '').length;
            objectMaxLength[index] = Math.max(objectMaxLength[index] || 10, cellLength);
        });
    });
    ws['!cols'] = objectMaxLength.map(w => ({ width: w + 5 }));
};

export const appendTotalRow = (ws, data, headers) => {
    if (!data || data.length === 0) return;
    const total = {};
    const sums = {};

    headers.forEach(header => {
        if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)') || header.includes('횟수')) {
            sums[header] = data.reduce((acc, row) => acc + (Number(row[header]) || 0), 0);
        }
    });

    headers.forEach((header, index) => {
        if (index === 0) {
            total[header] = '총 합계';
        } else if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)') || header.includes('횟수')) {
            if (header === '개당 처리비용(원)') {
                 const totalCost = sums['총 인건비(원)'] || 0;
                 const totalQty = sums['총 처리량(개)'] || 0;
                 const totalCostPerItem = (totalQty > 0) ? (totalCost / totalQty) : 0;
                 total[header] = Math.round(totalCostPerItem);
            } else {
                 total[header] = Math.round(sums[header]);
            }
        } else {
            total[header] = '';
        }
    });
    XLSX.utils.sheet_add_json(ws, [total], { skipHeader: true, origin: -1 });
};

export const downloadContentAsPdf = (elementId, title) => {
    const originalElement = document.getElementById(elementId);
    if (!originalElement) return showToast('출력할 내용을 찾을 수 없습니다.', true);

    showToast('PDF 변환을 시작합니다. (잠시만 기다려주세요)');

    const tempContainer = document.createElement('div');
    tempContainer.id = 'pdf-temp-container';
    tempContainer.style.position = 'fixed';
    tempContainer.style.top = '0';
    tempContainer.style.left = '0';
    tempContainer.style.width = '1120px';
    tempContainer.style.height = 'auto';
    tempContainer.style.background = 'white';
    tempContainer.style.zIndex = '-9999';
    tempContainer.style.overflow = 'visible';
    
    tempContainer.innerHTML = `<style>
        #pdf-temp-container * { overflow: visible !important; max-height: none !important; height: auto !important; scrollbar-width: none !important; }
        #pdf-temp-container table { page-break-inside: auto; width: 100% !important; table-layout: fixed !important; }
        #pdf-temp-container tr { page-break-inside: avoid; page-break-after: auto; }
        #pdf-temp-container thead { display: table-header-group; }
        #pdf-temp-container tfoot { display: table-footer-group; }
        .break-inside-avoid, .p-4, .p-5, .p-6 { page-break-inside: avoid !important; }
        body, .bg-gray-50 { background: white !important; }
        .bg-white { background: white !important; box-shadow: none !important; border: 1px solid #e5e7eb !important; }
        th, td, p, div { word-wrap: break-word; white-space: normal !important; }
    </style>`;
    
    const clonedElement = originalElement.cloneNode(true);
    clonedElement.querySelectorAll('button, input, select, .no-print').forEach(el => el.remove());

    const allElements = clonedElement.querySelectorAll('*');
    allElements.forEach(el => {
        el.classList.remove('overflow-y-auto', 'overflow-x-auto', 'overflow-hidden', 'overflow-auto', 'max-h-40', 'max-h-48', 'max-h-60', 'max-h-96', 'max-h-screen', 'max-h-[60vh]', 'max-h-[70vh]', 'max-h-[85vh]', 'max-h-[90vh]', 'h-full', 'h-screen', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-2xl', 'fixed', 'absolute', 'sticky');
        el.style.maxHeight = 'none';
        el.style.height = 'auto';
        el.style.overflow = 'visible';
        el.style.position = 'static';
        el.style.width = '';
    });

    tempContainer.appendChild(clonedElement);
    document.body.appendChild(tempContainer);

    const originalCanvases = originalElement.querySelectorAll('canvas');
    const clonedCanvases = clonedElement.querySelectorAll('canvas');
    originalCanvases.forEach((origCanvas, index) => {
        if (clonedCanvases[index]) {
            const ctx = clonedCanvases[index].getContext('2d');
            clonedCanvases[index].width = origCanvas.width;
            clonedCanvases[index].height = origCanvas.height;
            ctx.drawImage(origCanvas, 0, 0);
            clonedCanvases[index].style.width = '100%';
            clonedCanvases[index].style.height = 'auto';
        }
    });

    const opt = {
        margin: [10, 10, 10, 10],
        filename: `${title}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0, windowWidth: 1120, height: tempContainer.scrollHeight },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    html2pdf().from(tempContainer).set(opt).save()
        .then(() => showToast('PDF 저장이 완료되었습니다.'))
        .catch(err => { console.error('PDF generation error:', err); showToast('PDF 생성 중 오류가 발생했습니다.', true); })
        .finally(() => document.body.removeChild(tempContainer));
};