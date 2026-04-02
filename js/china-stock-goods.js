// =========================================================
// [수정 대상 1] extractShipDates 함수 (입고 완료 필터 추가)
// =========================================================
function extractShipDates() {
    const checklistContainer = document.getElementById('date-checklist-container');
    if (!checklistContainer) return;

    const dateMap = {};
    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    
    // 입고 완료 판단을 위한 컬럼들 (cleanKey 적용 기준 예상 키)
    const inQtyColsOrig = ['1차실입고수량','2차실입고수량','3차실입고수량','4차실입고수량','5차실입고수량','6차실입고수량'];
    const inAmtColsOrig = ['1차실입고금액','2차실입고금액','3차실입고금액','4차실입고금액','5차실입고금액','6차실입고금액'];

    const dateColsBuy = ['1차패킹리스트출고일','2차패킹리스트출고일'];
    const qtyColsBuy  = ['1차패킹리스트출고수량','2차패킹리스트출고수량'];
    const inQtyColsBuy = ['1차실입고수량','2차실입고수량'];
    const inAmtColsBuy = ['1차실입고금액','2차실입고금액'];

    // 값이 존재하는지 판단하는 헬퍼 함수
    const hasValue = (v) => v !== '' && v !== undefined && v !== null && v !== 0 && v !== '0';

    const process = (rows, dCols, qCols, iQCols, iACols) => {
        rows.forEach(row => {
            dCols.forEach((dc, idx) => {
                // ★ [필터 로직] 해당 차수에 실입고수량이나 실입고금액이 있으면 스킵
                if (hasValue(row[iQCols[idx]]) || hasValue(row[iACols[idx]])) return;

                const normalized = normalizeDate(row[dc]);
                if (!normalized || normalized.length < 10) return;
                
                if (!dateMap[normalized]) dateMap[normalized] = { qty: 0, skus: new Set() };
                dateMap[normalized].qty += (parseInt(row[qCols[idx]]) || 0);
                dateMap[normalized].skus.add(row['상품코드'] || row['어드민상품코드']);
            });
        });
    };

    process(orderDataOriginal, dateColsOrig, qtyColsOrig, inQtyColsOrig, inAmtColsOrig);
    process(orderDataBuy, dateColsBuy, qtyColsBuy, inQtyColsBuy, inAmtColsBuy);

    const sortedDates = Object.entries(dateMap).sort((a, b) => b[0].localeCompare(a[0]));

    if (sortedDates.length === 0) {
        checklistContainer.innerHTML = '<div style="color:#888; font-size:12px; padding:10px;">미입고된 출고 데이터가 없습니다.</div>';
        return;
    }

    let html = '';
    sortedDates.forEach(([date, info]) => {
        const isChecked = savedDates.includes(date) ? 'checked' : '';
        html += `
            <label class="date-item">
                <input type="checkbox" class="date-check" value="${date}" ${isChecked}>
                <span>${date} (${info.skus.size}종 / ${info.qty.toLocaleString()}장)</span>
            </label>
        `;
    });
    checklistContainer.innerHTML = html;

    checklistContainer.querySelectorAll('.date-check').forEach(ck => {
        ck.addEventListener('change', () => {
            updateSavedDatesFromCheckboxes();
            renderSelectedTags();
        });
    });

    renderSelectedTags();
}

// =========================================================
// [수정 대상 2] applyDates 함수 (동일 필터 적용)
// =========================================================
function applyDates() {
    const inputDates = savedDates; 
    if (inputDates.length === 0) { alert('출고일을 선택해주세요.'); return; }
    saveConfig();

    const dateColsOrig = ['1차패킹리스트출고일','2차패킹리스트출고일','3차패킹리스트출고일','4차패킹리스트출고일','5차패킹리스트출고일','6차패킹리스트출고일'];
    const qtyColsOrig  = ['1차패킹리스트출고수량','2차패킹리스트출고수량','3차패킹리스트출고수량','4차패킹리스트출고수량','5차패킹리스트출고수량','6차패킹리스트출고수량'];
    const inQtyColsOrig = ['1차실입고수량','2차실입고수량','3차실입고수량','4차실입고수량','5차실입고수량','6차실입고수량'];
    const inAmtColsOrig = ['1차실입고금액','2차실입고금액','3차실입고금액','4차실입고금액','5차실입고금액','6차실입고금액'];

    const dateColsBuy = ['1차패킹리스트출고일','2차패킹리스트출고일'];
    const qtyColsBuy  = ['1차패킹리스트출고수량','2차패킹리스트출고수량'];
    const inQtyColsBuy = ['1차실입고수량','2차실입고수량'];
    const inAmtColsBuy = ['1차실입고금액','2차실입고금액'];

    const hasValue = (v) => v !== '' && v !== undefined && v !== null && v !== 0 && v !== '0';

    let resultMap = {};

    const match = (rows, dCols, qCols, iQCols, iACols) => {
        rows.forEach(row => {
            const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim();
            if (!code) return;

            let matched = false, totalQty = 0;
            dCols.forEach((dc, idx) => {
                // ★ [필터 로직] 입고 데이터가 있으면 합산에서 제외
                if (hasValue(row[iQCols[idx]]) || hasValue(row[iACols[idx]])) return;

                const rd = normalizeDate(row[dc] || '');
                if (rd && inputDates.includes(rd)) { 
                    matched = true; 
                    totalQty += (parseInt(row[qCols[idx]]) || 0); 
                }
            });

            if (matched) {
                if (!resultMap[code]) resultMap[code] = { code, name: getProductName(row), option: row['옵션']||'', arrivalQty: 0, bigoY: row['비고']||'' };
                resultMap[code].arrivalQty += totalQty;
            }
        });
    };

    match(orderDataOriginal, dateColsOrig, qtyColsOrig, inQtyColsOrig, inAmtColsOrig);
    match(orderDataBuy, dateColsBuy, qtyColsBuy, inQtyColsBuy, inAmtColsBuy);

    tableData = Object.values(resultMap).map(item => {
        const log = stockLogData[item.code] || {};
        const edited = editedCells[item.code] || {};
        const loc = (log['로케이션'] || '').toString().split('/')[0].trim();
        return {
            code: item.code, name: item.name, option: item.option, arrivalQty: item.arrivalQty,
            mibalQty: parseInt(log['부족수량']) || 0, totalStock: parseInt(log['정상재고']) || 0,
            location: loc,
            capacity: getCapacityByLocation(loc),
            confirmed: edited.confirmed || '', shortage: edited.shortage || '',
            directShip: item.bigoY || edited.directShip || '', memo: edited.memo || ''
        };
    }).filter(d => d.arrivalQty > 0);

    filteredData = [...tableData]; renderTable(); updateSummary(); showToast('✅ 매칭 완료');
}
