// === js/inspection-editor.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { showToast, getCurrentTime, getTodayDateString } from './utils.js';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, serverTimestamp, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderInspectionHistoryTable, renderInspectionLogTable, renderExpandedInspectionLog } from './ui-history-inspection.js';
import { getUniqueInboundCount } from './inspection-logic.js';
import { manualImageBase64, clearManualImageState } from './inspection-media.js';

export let currentProductLogs = [];

export const loadAllInspectionHistory = async () => {
    const container = document.getElementById('inspection-history-view-container');
    if (!container) return;
    
    container.innerHTML = '<div class="text-center text-gray-500 py-10 flex flex-col items-center justify-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>검수 이력을 불러오는 중입니다...</div>';

    try {
        const colRef = collection(State.db, 'product_history');
        const snapshot = await getDocs(colRef);
        
        const historyData = [];
        snapshot.forEach(doc => {
            historyData.push({ id: doc.id, ...doc.data() });
        });

        renderInspectionHistoryTable(historyData);
    } catch (e) {
        console.error("Error loading all inspection history:", e);
        container.innerHTML = '<div class="text-center text-red-500 py-10">데이터를 불러오는 중 오류가 발생했습니다.</div>';
        showToast("검수 이력 로딩 실패", true);
    }
};

export const loadInspectionLogs = async (productName, targetTr = null) => {
    if (!productName) return;
    
    const managerModal = document.getElementById('inspection-log-manager-modal');
    if (!targetTr && managerModal) {
         managerModal.classList.remove('hidden');
         const title = document.getElementById('inspection-log-product-name');
         if (title) title.textContent = productName;
         const tbody = document.getElementById('inspection-log-table-body');
         if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-500">로딩 중...</td></tr>';
    }

    try {
        const safeProductName = productName.replace(/\//g, '-');
        const docRef = doc(State.db, 'product_history', safeProductName);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            currentProductLogs = data.logs || [];
        } else {
            currentProductLogs = [];
        }

        if (targetTr) {
            renderExpandedInspectionLog(targetTr, currentProductLogs, productName);
        } else {
            renderInspectionLogTable(currentProductLogs, productName);
        }

    } catch (e) {
        console.error("Error loading inspection logs:", e);
        showToast("상세 이력을 불러오는 중 오류가 발생했습니다.", true);
    }
};

export const prepareEditInspectionLog = (productName, index) => {
    const log = currentProductLogs[index];
    if (!log) return;

    const getEl = (id) => document.getElementById(id);
    
    if (getEl('edit-insp-product-name')) getEl('edit-insp-product-name').value = productName;
    if (getEl('edit-insp-date-time')) getEl('edit-insp-date-time').value = `${log.date} ${log.time}`;
    if (getEl('edit-insp-packing-no')) getEl('edit-insp-packing-no').value = log.packingDate || '';
    if (getEl('edit-insp-inbound-date')) getEl('edit-insp-inbound-date').value = log.inboundDate || '';
    if (getEl('edit-insp-inbound-qty')) getEl('edit-insp-inbound-qty').value = log.inboundQty || 0;
    if (getEl('edit-insp-sample-qty')) getEl('edit-insp-sample-qty').value = log.sampleQty || 1;
    if (getEl('edit-insp-notes')) getEl('edit-insp-notes').value = log.note || '';
    if (getEl('edit-insp-log-index')) getEl('edit-insp-log-index').value = index;
    if (getEl('edit-insp-supplier-name')) getEl('edit-insp-supplier-name').value = log.supplierName || '';

    const checklist = log.checklist || {};
    const setEditSelect = (id, val) => { 
        const el = getEl(id);
        if (el) el.value = val || (el.options && el.options.length > 0 ? el.options[0].value : ''); 
    };
    
    if (getEl('edit-insp-check-thickness')) getEl('edit-insp-check-thickness').value = checklist.thickness || ''; 
    setEditSelect('edit-insp-check-fabric', checklist.fabric);
    setEditSelect('edit-insp-check-color', checklist.color);
    setEditSelect('edit-insp-check-distortion', checklist.distortion);
    setEditSelect('edit-insp-check-unraveling', checklist.unraveling);
    setEditSelect('edit-insp-check-finishing', checklist.finishing);
    setEditSelect('edit-insp-check-zipper', checklist.zipper);
    setEditSelect('edit-insp-check-button', checklist.button);
    setEditSelect('edit-insp-check-lining', checklist.lining);
    setEditSelect('edit-insp-check-pilling', checklist.pilling);
    setEditSelect('edit-insp-check-dye', checklist.dye);

    const editModal = document.getElementById('inspection-log-editor-modal');
    if (editModal) editModal.classList.remove('hidden');
};

export const updateInspectionLog = async () => {
    const getEditVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    };

    const productName = getEditVal('edit-insp-product-name');
    const index = parseInt(getEditVal('edit-insp-log-index'), 10);
    
    if (!productName || isNaN(index) || !currentProductLogs[index]) return;

    const checklist = {
        thickness: getEditVal('edit-insp-check-thickness'),
        fabric: getEditVal('edit-insp-check-fabric'),
        color: getEditVal('edit-insp-check-color'),
        distortion: getEditVal('edit-insp-check-distortion'),
        unraveling: getEditVal('edit-insp-check-unraveling'),
        finishing: getEditVal('edit-insp-check-finishing'),
        zipper: getEditVal('edit-insp-check-zipper'),
        button: getEditVal('edit-insp-check-button'),
        lining: getEditVal('edit-insp-check-lining'),
        pilling: getEditVal('edit-insp-check-pilling'),
        dye: getEditVal('edit-insp-check-dye')
    };

    const defectsFound = [];
    const NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음'];
    const labelMap = {
        fabric: '원단', color: '컬러', distortion: '뒤틀림',
        unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
        lining: '안감', pilling: '보풀', dye: '이염'
    };
    Object.entries(checklist).forEach(([key, value]) => {
        if (key === 'thickness') return;
        if (!NORMAL_VALUES.includes(value)) {
            defectsFound.push(`${labelMap[key] || key}(${value})`);
        }
    });

    const updatedLog = {
        ...currentProductLogs[index], 
        packingDate: getEditVal('edit-insp-packing-no'), 
        inboundDate: getEditVal('edit-insp-inbound-date'), 
        inboundQty: Number(getEditVal('edit-insp-inbound-qty')) || 0,
        sampleQty: Number(getEditVal('edit-insp-sample-qty')) || 1, 
        supplierName: getEditVal('edit-insp-supplier-name'), 
        checklist: checklist,
        defects: defectsFound,
        note: getEditVal('edit-insp-notes'),
        status: defectsFound.length > 0 ? '불량' : '정상'
    };

    currentProductLogs[index] = updatedLog;

    try {
        const safeProductName = productName.replace(/\//g, '-');
        const docRef = doc(State.db, 'product_history', safeProductName);
        const newDefectSummary = currentProductLogs
            .filter(l => l.defects && l.defects.length > 0)
            .map(l => `${l.date}: ${l.defects.join(', ')}`);

        const updates = {
            logs: currentProductLogs,
            defectSummary: newDefectSummary,
            totalInbound: getUniqueInboundCount(currentProductLogs)
        };
        
        if (index === currentProductLogs.length - 1) {
            updates.lastSupplierName = updatedLog.supplierName;
            updates.lastCode = updatedLog.code;
            updates.lastOption = updatedLog.option;
        }
        
        await updateDoc(docRef, updates);

        showToast("기록이 수정되었습니다.");
        const editModal = document.getElementById('inspection-log-editor-modal');
        if (editModal) editModal.classList.add('hidden');
        renderInspectionLogTable(currentProductLogs, productName);

    } catch (e) {
        console.error("Error updating log:", e);
        showToast("수정 중 오류가 발생했습니다.", true);
    }
};

export const deleteInspectionLog = async () => {
    const pNameEl = document.getElementById('edit-insp-product-name');
    const idxEl = document.getElementById('edit-insp-log-index');
    const productName = pNameEl ? pNameEl.value : '';
    const index = idxEl ? parseInt(idxEl.value, 10) : NaN;

    if (!productName || isNaN(index)) return;
    if (!confirm("정말 이 상세 기록을 삭제하시겠습니까?")) return;

    currentProductLogs.splice(index, 1);

    try {
        const safeProductName = productName.replace(/\//g, '-');
        const docRef = doc(State.db, 'product_history', safeProductName);
        const newDefectSummary = currentProductLogs
            .filter(l => l.defects && l.defects.length > 0)
            .map(l => `${l.date}: ${l.defects.join(', ')}`);
        
        const updates = {
            logs: currentProductLogs,
            defectSummary: newDefectSummary,
            totalInbound: getUniqueInboundCount(currentProductLogs) 
        };
        
        if (currentProductLogs.length > 0) {
            const lastLog = currentProductLogs[currentProductLogs.length - 1];
            updates.lastSupplierName = lastLog.supplierName || '-'; 
            updates.lastCode = lastLog.code || '-';
            updates.lastOption = lastLog.option || '-';
        } else {
            updates.lastSupplierName = '-';
            updates.lastCode = '-';
            updates.lastOption = '-';
            updates.totalInbound = 0; 
        }

        await updateDoc(docRef, updates);

        showToast("기록이 삭제되었습니다.");
        const editModal = document.getElementById('inspection-log-editor-modal');
        if (editModal) editModal.classList.add('hidden');
        renderInspectionLogTable(currentProductLogs, productName);

    } catch (e) {
        console.error("Error deleting log:", e);
        showToast("삭제 중 오류가 발생했습니다.", true);
    }
};

export const deleteProductHistory = async (productName) => {
    if (!productName) return false;
    if (!confirm(`정말 '${productName}' 상품의 모든 검수 이력을 삭제하시겠습니까?\n(이 작업은 복구할 수 없습니다)`)) return false;

    try {
        const safeProductName = productName.replace(/\//g, '-');
        const docRef = doc(State.db, 'product_history', safeProductName);
        await deleteDoc(docRef);
        showToast(`'${productName}' 상품 및 이력이 모두 삭제되었습니다.`);
        return true; 
    } catch (e) {
        console.error("Error deleting product:", e);
        showToast("상품 삭제 중 오류가 발생했습니다.", true);
        return false;
    }
};

export const savePreInspectionNote = async () => {
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    };

    let productName = getVal('manual-insp-product-name').trim();
    if (!productName) {
        showToast("상품명은 필수 입력 항목입니다.", true);
        return false;
    }
    
    productName = productName.replace(/\//g, '-'); 

    const checklist = {
        thickness: getVal('manual-insp-check-thickness'),
        fabric: getVal('manual-insp-check-fabric'),
        color: getVal('manual-insp-check-color'),
        distortion: getVal('manual-insp-check-distortion'),
        unraveling: getVal('manual-insp-check-unraveling'),
        finishing: getVal('manual-insp-check-finishing'),
        zipper: getVal('manual-insp-check-zipper'),
        button: getVal('manual-insp-check-button'),
        lining: getVal('manual-insp-check-lining'),
        pilling: getVal('manual-insp-check-pilling'),
        dye: getVal('manual-insp-check-dye')
    };

    if (!checklist.thickness || Object.values(checklist).some(v => v === "" || v === null)) {
        alert("⚠️ 두께 기준을 포함한 모든 품질 체크리스트 항목을 확인해주세요.");
        return false;
    }

    const today = getTodayDateString();
    const inboundDate = getVal('manual-insp-inbound-date') || today;
    const packingDate = getVal('manual-insp-packing-date') || '-';
    const inboundQty = getVal('manual-insp-qty');
    const note = getVal('manual-insp-note');
    const code = getVal('manual-insp-code') || '-';
    const option = getVal('manual-insp-option') || '-';
    const supplierName = getVal('manual-insp-supplier') || '-';

    const defectsFound = [];
    const NORMAL_VALUES = ['정상', '양호', '동일', '없음', '해당없음'];
    
    const labelMap = {
        fabric: '원단', color: '컬러', distortion: '뒤틀림',
        unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추',
        lining: '안감', pilling: '보풀', dye: '이염'
    };

    Object.entries(checklist).forEach(([key, value]) => {
        if (key === 'thickness') return;
        if (!NORMAL_VALUES.includes(value)) {
            defectsFound.push(`${labelMap[key] || key}(${value})`);
        }
    });

    const status = defectsFound.length > 0 ? '불량' : '정상';
    const nowTime = getCurrentTime();

    const inspectionRecord = {
        date: today,
        time: nowTime,
        inspector: State.appState.currentUser || 'Unknown',
        inboundDate: inboundDate,
        packingDate: packingDate,
        inboundQty: Number(inboundQty) || 0,
        sampleQty: 1, 
        option: option,
        code: code,
        supplierName: supplierName, 
        location: '수동등록',
        checklist,
        defects: defectsFound,
        note,
        status,
        image: manualImageBase64 || null
    };

    const btn = document.getElementById('save-pre-insp-btn');
    if(btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    try {
        const docRef = doc(State.db, 'product_history', productName);
        const docSnap = await getDoc(docRef);
        let existingLogs = [];
        
        if (docSnap.exists()) {
            existingLogs = docSnap.data().logs || [];
        }
        
        const tempLogs = [...existingLogs, inspectionRecord];
            
        const updates = {
            lastInspectionDate: today,
            totalInbound: getUniqueInboundCount(tempLogs),
            logs: arrayUnion(inspectionRecord),
            updatedAt: serverTimestamp(),
            lastCode: code,
            lastOption: option,
            lastSupplierName: supplierName
        };

        if (defectsFound.length > 0) {
            const defectSummaryStr = `${today}: ${defectsFound.join(', ')}`;
            updates.defectSummary = arrayUnion(defectSummaryStr);
        }

        await setDoc(docRef, updates, { merge: true });
        
        const getEl = (id) => document.getElementById(id);
        if (getEl('manual-insp-product-name')) getEl('manual-insp-product-name').value = '';
        if (getEl('manual-insp-code')) getEl('manual-insp-code').value = '';
        if (getEl('manual-insp-option')) getEl('manual-insp-option').value = '';
        if (getEl('manual-insp-qty')) getEl('manual-insp-qty').value = '';
        if (getEl('manual-insp-thickness')) getEl('manual-insp-check-thickness').value = '';
        if (getEl('manual-insp-supplier')) getEl('manual-insp-supplier').value = '';
        if (getEl('manual-insp-note')) getEl('manual-insp-note').value = '';
        if (getEl('manual-insp-packing-date')) getEl('manual-insp-packing-date').value = '';
        
        const selects = document.querySelectorAll('#pre-register-inspection-modal select');
        selects.forEach(sel => sel.value = "정상"); 

        clearManualImageState();

        const preModal = document.getElementById('pre-register-inspection-modal');
        if (preModal) preModal.classList.add('hidden');
        
        showToast(`'${productName}' 수동 검수 저장 완료!`);
        return true;

    } catch (e) {
        console.error("Error saving manual inspection:", e);
        showToast("수동 등록 저장 중 오류가 발생했습니다.", true);
        return false;
    } finally {
        if(btn) { 
            btn.disabled = false; 
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg> 검수 완료 및 즉시 저장`; 
        }
    }
};