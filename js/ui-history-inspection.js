// === js/ui-history-inspection.js ===
import * as DOM from './dom-elements.js';
import * as State from './state.js';
import { getWeekOfYear } from './utils.js';
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 정렬 상태 관리 (로컬)
let sortState = { key: 'lastInspectionDate', dir: 'desc' };

export const setSortState = (key) => {
    if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.key = key;
        sortState.dir = 'desc';
    }
};

// 검수 유형 필터 상태 (all / sample / total)
export let currentInspTypeFilter = 'all';
export const setInspTypeFilter = (val) => { currentInspTypeFilter = val; };

// 빈 함수 내보내기 (이전 에러 해결용)
export const renderInspectionLogTable = (logs, productName) => {};

const getSortIcon = (key) => {
    if (sortState.key !== key) return '<span class="text-gray-300 text-[10px] ml-1 opacity-50">↕</span>';
    return sortState.dir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

const formatDefectSummary = (defectSummary) => {
    if (!defectSummary || defectSummary.length === 0) {
        return '<span class="text-gray-400">-</span>';
    }
    const lastDefect = defectSummary[defectSummary.length - 1];
    return `<span class="text-red-600 font-medium text-xs truncate block max-w-[200px]" title="${lastDefect}">${lastDefect}</span>`;
};

export const renderInspectionLayout = (container) => {
    if (!container) return;
    const activeTab = State.context.inspectionViewMode || 'product';

    container.innerHTML = `
        <div class="flex flex-col h-full relative">
            <div class="flex justify-between items-end border-b border-gray-200 mb-4 shrink-0">
                <div class="flex">
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'product' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="product">
                        📦 상품별 보기
                    </button>
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'list' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="list">
                        📅 검수 일자별 보기
                    </button>
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'qc' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="qc">
                        📊 QC 통계 리포트
                    </button>
                </div>
                <div class="pb-1 pr-1 flex gap-2 items-center">
                    <select id="insp-type-filter" class="text-xs border border-gray-300 rounded p-1.5 focus:ring-indigo-500 bg-white font-bold text-gray-700 outline-none cursor-pointer shadow-sm">
                        <option value="all" ${currentInspTypeFilter === 'all' ? 'selected' : ''}>전체 (샘플+전량)</option>
                        <option value="sample" ${currentInspTypeFilter === 'sample' ? 'selected' : ''}>샘플 검수만</option>
                        <option value="total" ${currentInspTypeFilter === 'total' ? 'selected' : ''}>전량 검수만</option>
                    </select>
                    
                    <button id="btn-add-pre-inspection" class="text-xs bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-1.5 px-3 rounded shadow-sm transition flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
                        수동 상품 추가
                    </button>
                    <button id="inspection-tab-download-btn" class="text-xs bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold py-1.5 px-3 rounded shadow-sm transition flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        다운로드
                    </button>
                </div>
            </div>
            <div id="inspection-content-area" class="flex-grow relative overflow-hidden"></div>
        </div>
    `;
};

// ✨ [수정됨] 일자별 검수 리스트 렌더링 (대기 상태 항목은 샘플 수량 0개로 철저히 계산)
export const renderInspectionListMode = async (dateList, selectedDateData) => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;

    if (!container.querySelector('.insp-list-loaded')) {
        container.innerHTML = `<div class="flex h-full items-center justify-center text-indigo-500 font-bold animate-pulse">데이터 동기화 및 렌더링 중...</div>`;
    }

    let filteredDateList = [];
    dateList.forEach(d => {
        const fList = d.data.filter(item => {
            const type = item.inspectionType === 'total' ? 'total' : 'sample';
            return currentInspTypeFilter === 'all' || type === currentInspTypeFilter;
        });
        if (fList.length > 0) {
            filteredDateList.push({
                date: d.date,
                count: fList.length,
                data: fList
            });
        }
    });

    let selectedDate = State.context.selectedInspectionDate;
    if (!filteredDateList.find(d => d.date === selectedDate) && filteredDateList.length > 0) {
        selectedDate = filteredDateList[0].date;
        State.context.selectedInspectionDate = selectedDate;
    }

    const filteredSelectedData = filteredDateList.find(d => d.date === selectedDate)?.data || [];

    if (State.db && filteredSelectedData.length > 0) {
        let needsDbUpdate = false;
        await Promise.all(filteredSelectedData.map(async (item) => {
            if (item.status === '완료' && item.inspectionType !== 'total') {
                if (item.sampleQty === undefined || item.sampleQty === 1 || item.sampleQty === 0) {
                    try {
                        const docRef = doc(State.db, 'product_history', item.name);
                        const snap = await getDoc(docRef);
                        if (snap.exists()) {
                            const logs = snap.data().logs || [];
                            const targetLog = logs.find(l => 
                                l.date === selectedDate && 
                                (item.packingDate ? l.packingDate === item.packingDate : true) &&
                                (item.code && item.code !== '-' ? l.code === item.code : true)
                            );
                            if (targetLog && targetLog.sampleQty !== undefined) {
                                const trueQty = Number(targetLog.sampleQty);
                                if (item.sampleQty !== trueQty) {
                                    item.sampleQty = trueQty;
                                    needsDbUpdate = true;
                                }
                            }
                        }
                    } catch(e) { console.warn("Auto-sync error", e); }
                }
            }
        }));

        if (needsDbUpdate) {
            try {
                const originalDayData = dateList.find(d => d.date === selectedDate)?.data;
                if (originalDayData) {
                    const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', selectedDate);
                    await updateDoc(historyDocRef, { inspectionList: originalDayData });
                }
            } catch(e) { console.error("Silent DB update failed", e); }
        }
    }

    let dateListHtml = '';
    if (!filteredDateList || filteredDateList.length === 0) {
        dateListHtml = `<div class="p-4 text-center text-sm text-gray-400">조건에 맞는 리스트가 없습니다.</div>`;
    } else {
        filteredDateList.forEach(d => {
            const isSelected = d.date === selectedDate;
            const activeClass = isSelected ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-transparent hover:bg-gray-50 text-gray-600';
            
            dateListHtml += `
                <button class="w-full text-left px-4 py-3 border-l-4 transition-all ${activeClass} group btn-select-insp-date" data-date="${d.date}">
                    <div class="flex justify-between items-center">
                        <span class="font-semibold text-sm">${d.date}</span>
                        <span class="text-xs bg-white border border-gray-200 px-2 py-0.5 rounded-full text-gray-500 group-hover:border-gray-300">${d.count}건</span>
                    </div>
                </button>
            `;
        });
    }

    let detailHtml = '';
    if (!selectedDate) {
        detailHtml = `<div class="flex h-full items-center justify-center text-gray-400 text-sm">좌측에서 날짜를 선택해주세요.</div>`;
    } else if (!filteredSelectedData || filteredSelectedData.length === 0) {
        detailHtml = `
            <div class="flex flex-col h-full">
                <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center shrink-0">
                    <div class="flex items-center gap-2">
                        <h4 class="font-bold text-gray-700 text-sm">📅 ${selectedDate} 검수 리스트 상세</h4>
                        <span class="text-xs text-gray-500">0건</span>
                    </div>
                </div>
                <div class="flex h-full items-center justify-center text-gray-400 text-sm">해당 날짜의 필터링된 데이터가 없습니다.</div>
            </div>
        `;
    } else {
        let totalInboundQty = 0;
        let totalSampleQty = 0;

        const rows = filteredSelectedData.map((item, idx) => {
            const isCompleted = item.status === '완료';
            const statusBadge = isCompleted 
                ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">완료</span>`
                : `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">대기</span>`;
            
            const typeBadge = item.inspectionType === 'total' 
                ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 shadow-sm">전량</span>`
                : `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200 shadow-sm">샘플</span>`;

            // ✨ 입고 수량 및 샘플검수 수량 계산 로직 (대기 상태는 무조건 0으로)
            const inboundQty = Number(item.inboundQty || item.qty || 0);
            
            let sampleQty = 0;
            if (isCompleted) {
                sampleQty = item.sampleQty !== undefined ? Number(item.sampleQty) : (item.inspectionType === 'total' ? inboundQty : 1);
            }
            
            totalInboundQty += inboundQty;
            totalSampleQty += sampleQty;

            return `
                <tr class="hover:bg-blue-50 transition border-b last:border-0 cursor-pointer btn-view-detail" 
                    data-product-name="${item.name}" 
                    data-product-option="${item.option || '-'}" 
                    data-product-code="${item.code || '-'}" 
                    data-target-date="${selectedDate}"
                    title="클릭하여 상세 이력 펼치기">
                    <td class="px-4 py-3 text-center">${typeBadge}</td>
                    <td class="px-4 py-3 text-xs font-mono text-gray-500">${item.code || '-'}</td>
                    <td class="px-4 py-3 text-sm font-medium text-gray-900">${item.name}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">${item.option || '-'}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">${item.supplierName || '-'}</td>
                    <td class="px-4 py-3 text-center">
                        <div class="text-xs font-bold text-gray-700">${inboundQty.toLocaleString()}</div>
                        <div class="text-[10px] ${isCompleted ? 'text-blue-600' : 'text-gray-400'} font-bold">(샘플검수: ${sampleQty.toLocaleString()}개)</div>
                    </td>
                    <td class="px-4 py-3 text-xs text-gray-500">${item.thickness || '-'}</td>
                    <td class="px-4 py-3 text-center">${statusBadge}</td>
                </tr>
            `;
        }).join('');

        detailHtml = `
            <div class="flex flex-col h-full">
                <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center shrink-0">
                    <div class="flex items-center gap-3">
                        <h4 class="font-bold text-gray-700 text-sm">📅 ${selectedDate} 검수 리스트 상세</h4>
                        <span class="text-[11px] font-medium bg-white border border-gray-200 shadow-sm px-2.5 py-1 rounded text-gray-600">
                            총 입고: <strong class="text-gray-900">${totalInboundQty.toLocaleString()}</strong>개 <span class="mx-1 text-gray-300">|</span> 
                            총 샘플검수: <strong class="text-blue-600">${totalSampleQty.toLocaleString()}</strong>개
                        </span>
                    </div>
                    <button class="text-xs bg-white border border-red-200 hover:bg-red-50 text-red-600 font-bold py-1 px-2 rounded shadow-sm transition btn-delete-history-list" 
                            data-date="${selectedDate}" title="이 날짜의 리스트 전체 삭제">
                        🗑️ 리스트 삭제
                    </button>
                </div>
                <div class="flex-grow overflow-y-auto custom-scrollbar relative">
                    <table class="w-full text-left border-collapse">
                        <thead class="bg-white text-[11px] uppercase text-gray-500 sticky top-0 z-10 shadow-sm outline outline-1 outline-gray-200">
                            <tr>
                                <th class="px-4 py-2 font-bold bg-gray-50 text-center w-[6%]">유형</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 w-[12%]">코드</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 w-[20%]">상품명</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 w-[15%]">옵션</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 w-[15%]">공급처</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 text-center w-[12%]">수량 (입고/샘플검수)</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 w-[10%]">기준</th>
                                <th class="px-4 py-2 font-bold bg-gray-50 text-center w-[10%]">상태</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-100">
                            ${rows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="absolute inset-0 flex border border-gray-200 rounded-lg overflow-hidden bg-white insp-list-loaded">
            <div class="w-1/4 min-w-[180px] border-r border-gray-200 bg-gray-50 overflow-y-auto custom-scrollbar shrink-0">
                ${dateListHtml}
            </div>
            <div class="flex-1 overflow-hidden bg-white relative">
                ${detailHtml}
            </div>
        </div>
    `;
};

export const renderInspectionHistoryTable = (historyData) => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;

    const searchInput = DOM.inspectionHistorySearchInput;
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    let filteredData = historyData.filter(item => {
        const matchId = item.id.toLowerCase().includes(searchTerm);
        let matchLog = false;
        const matchSupplierName = item.lastSupplierName && item.lastSupplierName.toLowerCase().includes(searchTerm);
        
        if (item.logs && item.logs.length > 0) {
            const lastLog = item.logs[item.logs.length - 1];
            if (lastLog.code && lastLog.code.toLowerCase().includes(searchTerm)) matchLog = true;
            if (lastLog.option && lastLog.option.toLowerCase().includes(searchTerm)) matchLog = true;
            if (lastLog.supplierName && lastLog.supplierName.toLowerCase().includes(searchTerm)) matchLog = true;
        }

        if (!matchId && !matchSupplierName && !matchLog) return false;

        if (currentInspTypeFilter !== 'all') {
            const hasMatchingLog = item.logs && item.logs.some(log => {
                const type = log.inspectionType === 'total' ? 'total' : 'sample';
                return type === currentInspTypeFilter;
            });
            if (!hasMatchingLog) return false;
        }

        return true;
    });

    if (DOM.inspectionTotalProductCount) {
        DOM.inspectionTotalProductCount.textContent = filteredData.length;
    }

    filteredData.sort((a, b) => {
        let valA = a[sortState.key];
        let valB = b[sortState.key];
        if (sortState.key === 'productName') { valA = a.id; valB = b.id; }
        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';
        if (valA < valB) return sortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.dir === 'asc' ? 1 : -1;
        return 0;
    });

    let html = `
        <div class="absolute inset-0 overflow-y-auto custom-scrollbar border border-gray-200 rounded-lg bg-white">
            <table class="w-full text-sm text-left text-gray-600 relative">
                <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-20 shadow-sm outline outline-1 outline-gray-200">
                    <tr>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-200 transition select-none bg-gray-100" data-sort-key="productName">
                            <div class="flex items-center">상품명 ${getSortIcon('productName')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3 bg-gray-100">공급처 상품명</th>
                        <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none bg-gray-100" data-sort-key="totalInbound">
                            <div class="flex items-center justify-center">총 입고(검수) 횟수 ${getSortIcon('totalInbound')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none bg-gray-100" data-sort-key="lastInspectionDate">
                            <div class="flex items-center justify-center">최근 검수일 ${getSortIcon('lastInspectionDate')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3 bg-gray-100">최근 불량/특이사항</th>
                        <th scope="col" class="px-6 py-3 text-right bg-gray-100">관리</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 bg-white">
    `;

    if (filteredData.length === 0) {
        html += `<tr><td colspan="6" class="px-6 py-8 text-center text-gray-400">
            ${searchTerm ? `'${searchTerm}'에 대한 검색 결과가 없습니다.` : '선택한 유형에 해당하는 저장된 검수 이력이 없습니다.'}
        </td></tr>`;
    } else {
        filteredData.forEach(item => {
            let supplierName = '-';
            if (item.lastSupplierName) supplierName = item.lastSupplierName;

            if (supplierName === '-' && item.logs && item.logs.length > 0) {
                const lastLog = item.logs[item.logs.length - 1];
                supplierName = lastLog.supplierName || '-';
            }

            html += `
                <tr class="hover:bg-blue-50 transition group cursor-pointer btn-view-detail" data-product-name="${item.id}" title="클릭하여 상세 이력 펼치기">
                    <td class="px-6 py-4 font-medium text-gray-900">${item.id}</td>
                    <td class="px-6 py-4 text-xs text-gray-500 truncate max-w-[150px]" title="${supplierName}">
                        ${supplierName}
                    </td>
                    <td class="px-6 py-4 text-center">
                        <span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            ${item.totalInbound || 0}회
                        </span>
                    </td>
                    <td class="px-6 py-4 text-center font-mono text-xs text-gray-500">
                        ${item.lastInspectionDate || '-'}
                    </td>
                    <td class="px-6 py-4">
                        ${formatDefectSummary(item.defectSummary)}
                    </td>
                    <td class="px-6 py-4 text-right space-x-1">
                        <button class="text-indigo-600 hover:text-indigo-900 font-semibold text-xs border border-indigo-200 rounded px-3 py-1.5 hover:bg-indigo-50 transition pointer-events-none shadow-sm">
                            상세보기 ▾
                        </button>
                        <button class="text-red-500 hover:text-red-700 font-semibold text-xs border border-red-200 rounded px-3 py-1.5 hover:bg-red-50 transition btn-delete-product opacity-0 group-hover:opacity-100 shadow-sm" 
                                data-product-name="${item.id}" title="상품 전체 삭제">
                            삭제
                        </button>
                    </td>
                </tr>
            `;
        });
    }

    html += `</tbody></table></div>`;
    container.innerHTML = html;
};

export const renderExpandedInspectionLog = (targetTr, logs, productName) => {
    const table = targetTr.closest('table');
    if (table) {
        table.querySelectorAll('.expanded-detail-row').forEach(row => row.remove());
    }

    const colspan = targetTr.children.length; 
    const isQcReport = targetTr.dataset.isQcReport === 'true';

    let displayLogs = logs.filter(log => {
        const type = log.inspectionType === 'total' ? 'total' : 'sample';
        return currentInspTypeFilter === 'all' || type === currentInspTypeFilter;
    });
    
    if (State.context.inspectionViewMode === 'list') {
        const targetOption = targetTr.dataset.productOption;
        const targetCode = targetTr.dataset.productCode;
        const targetDate = targetTr.dataset.targetDate;

        if (targetOption !== undefined) {
            displayLogs = displayLogs.filter(log => {
                const logOption = log.option || '-';
                const logCode = log.code || '-';
                const logDate = log.date || '-';
                return logOption === targetOption && logCode === targetCode && logDate === targetDate;
            });
        }
    } 
    else if (isQcReport) {
        const pType = targetTr.dataset.qcPeriodType || 'month';
        const pVal = targetTr.dataset.qcPeriodValue || '';

        displayLogs = displayLogs.filter(log => {
            if (pVal && log.date) {
                const logYear = log.date.substring(0, 4);
                const logMonth = log.date.substring(0, 7);
                const logWeek = getWeekOfYear(new Date(log.date));
                
                const isMatch = (pType === 'year' && logYear === pVal) ||
                                (pType === 'month' && logMonth === pVal) || 
                                (pType === 'week' && logWeek === pVal);
                                
                if (!isMatch) return false; 
            }

            let isDefect = false;
            const normalValues = ['정상', '양호', '동일', '없음', '해당없음', '통과', '-', ''];

            if (log.status === '불량') isDefect = true;
            if (log.defects && Array.isArray(log.defects) && log.defects.length > 0) isDefect = true;
            
            if (log.checklist) {
                Object.entries(log.checklist).forEach(([key, val]) => {
                    if (key !== 'thickness' && val) {
                        const cleanVal = String(val).trim();
                        if (cleanVal && !normalValues.includes(cleanVal)) {
                            isDefect = true;
                        }
                    }
                });
            }
            return isDefect;
        });
    }

    const tr = document.createElement('tr');
    tr.className = 'expanded-detail-row bg-indigo-50/50 shadow-inner relative z-0';
    
    let logsHtml = '';
    if (!displayLogs || displayLogs.length === 0) {
        logsHtml = '<div class="p-6 text-center text-gray-500">해당 조건에 부합하는 상세 검수 기록이 없습니다.</div>';
    } else {
        const groupedLogs = {};
        displayLogs.forEach((log, idx) => {
            const originalIdx = log.originalIndex !== undefined ? log.originalIndex : idx;
            const code = log.code || '-';
            const option = log.option || '-';
            const groupKey = `${code} / ${option}`;
            
            if (!groupedLogs[groupKey]) {
                groupedLogs[groupKey] = [];
            }
            groupedLogs[groupKey].push({ ...log, originalIndex: originalIdx });
        });

        let rowsHtml = '';

        Object.keys(groupedLogs).sort().forEach(groupKey => {
            const group = groupedLogs[groupKey];
            
            group.sort((a, b) => {
                const tA = (a.date || '') + (a.time || '');
                const tB = (b.date || '') + (b.time || '');
                return tB.localeCompare(tA); 
            });

            rowsHtml += `
                <tr class="bg-indigo-100/70 border-y border-indigo-200">
                    <td colspan="9" class="px-4 py-2 text-xs font-bold text-indigo-900">
                        🏷️ 분류 (코드 / 옵션) : <span class="text-indigo-700">${groupKey}</span> 
                        <span class="text-gray-500 font-normal ml-2">(${group.length}건)</span>
                    </td>
                </tr>
            `;

            rowsHtml += group.map(item => {
                let checklistStr = [];
                const cl = item.checklist || {};
                const normalValues = ['정상', '양호', '동일', '없음', '해당없음'];
                
                if (cl.thickness) {
                    checklistStr.push(`<span class="inline-block bg-white px-1.5 py-0.5 rounded text-[11px] text-gray-600 border border-gray-200 shadow-sm mr-1 mb-1">두께: <strong class="text-indigo-600">${cl.thickness}</strong></span>`);
                }
                
                const labelMap = { fabric: '원단', color: '컬러', distortion: '뒤틀림', unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추', lining: '안감', pilling: '보풀', dye: '이염' };
                
                Object.entries(cl).forEach(([key, val]) => {
                    if (key !== 'thickness' && val) {
                        const cleanVal = String(val).trim();
                        const isDefect = !normalValues.includes(cleanVal);
                        const colorClass = isDefect ? 'text-red-700 bg-red-50 border-red-200 font-bold' : 'text-gray-600 bg-white border-gray-200';
                        checklistStr.push(`<span class="inline-block ${colorClass} px-1.5 py-0.5 rounded text-[11px] border shadow-sm mb-1 mr-1">${labelMap[key]||key}: ${val}</span>`);
                    }
                });

                const statusBadge = item.status === '정상' 
                    ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-green-100 text-green-800">정상</span>`
                    : item.status === '사전메모' ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-orange-100 text-orange-800">사전메모</span>`
                    : `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800">불량</span>`;

                const typeBadge = item.inspectionType === 'total' 
                    ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 shadow-sm">전량</span>`
                    : `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200 shadow-sm">샘플</span>`;

                let defectText = item.defects && item.defects.length > 0 ? `<span class="text-red-600 font-bold mr-1">[${item.defects.join(', ')}]</span>` : '';
                let noteText = item.note || '';
                let fullNote = (defectText + noteText) || '<span class="text-gray-400">-</span>';

                let imageHtml = '<span class="text-gray-300 text-xs">-</span>';
                if (item.image) {
                    imageHtml = `
                        <div class="relative group cursor-pointer inline-block">
                            <img src="${item.image}" class="h-8 w-8 object-cover rounded border border-gray-300 hover:scale-150 transition-transform z-0 hover:z-10 bg-white" 
                                 onclick="const w=window.open('','_blank'); w.document.write('<img src=\\'${item.image}\\' style=\\'width:100%\\'/>');">
                        </div>`;
                }

                const inboundQtyDisplay = item.inboundQty ? item.inboundQty.toLocaleString() + '개' : '-';
                const sampleQtyDisplay = item.sampleQty !== undefined ? item.sampleQty : 1;

                return `
                    <tr class="border-b border-indigo-100/50 hover:bg-white transition bg-white/40">
                        <td class="px-4 py-3 text-center">${typeBadge}</td>
                        <td class="px-4 py-3 text-[11px] font-mono text-gray-500 whitespace-nowrap">${item.date}<br>${item.time}</td>
                        <td class="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">${item.inboundDate || '-'}</td>
                        <td class="px-4 py-3 text-center">
                            <div class="text-xs font-bold text-gray-700">${inboundQtyDisplay}</div>
                            <div class="text-[10px] text-blue-600 font-bold">(샘플검수: ${sampleQtyDisplay}개)</div>
                        </td>
                        <td class="px-4 py-3 text-center">${statusBadge}</td>
                        <td class="px-4 py-3 max-w-[300px] leading-tight">${checklistStr.join('') || '-'}</td>
                        <td class="px-4 py-3 text-xs text-gray-700 break-words max-w-[250px]">${fullNote}</td>
                        <td class="px-4 py-3 text-center">${imageHtml}</td>
                        <td class="px-4 py-3 text-right whitespace-nowrap">
                            <button class="text-blue-600 hover:text-blue-800 text-[11px] font-bold px-3 py-1.5 rounded border border-blue-200 hover:bg-blue-50 btn-edit-insp-log transition shadow-sm" data-index="${item.originalIndex}" data-product-name="${productName}">수정</button>
                        </td>
                    </tr>
                `;
            }).join('');
        });

        const headerTitle = isQcReport ? `🔍 상세 불량 내역 (해당 기간)` : `🔍 상세 검수 이력`;

        logsHtml = `
            <div class="p-4 bg-indigo-50/50 border-y border-indigo-200">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-bold text-indigo-900 text-sm flex items-center gap-2">
                        ${headerTitle} <span class="text-xs font-normal text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full border border-indigo-200">${productName}</span>
                    </h4>
                    <button class="text-xs text-gray-500 hover:text-gray-800 font-bold btn-close-expanded px-3 py-1 rounded hover:bg-gray-200 transition border border-gray-300 bg-white shadow-sm">닫기 ✖</button>
                </div>
                
                <div class="max-h-[400px] overflow-y-auto overflow-x-auto rounded-lg border border-indigo-200 bg-white shadow-sm custom-scrollbar relative">
                    <table class="w-full text-left relative z-0">
                        <thead class="bg-indigo-100 text-[11px] text-indigo-800 uppercase sticky top-0 z-10 shadow-sm outline outline-1 outline-indigo-200">
                            <tr>
                                <th class="px-4 py-2 font-bold whitespace-nowrap w-[6%] bg-indigo-100 text-center">유형</th>
                                <th class="px-4 py-2 font-bold whitespace-nowrap w-[10%] bg-indigo-100">입고(검수)일시</th>
                                <th class="px-4 py-2 font-bold whitespace-nowrap w-[10%] bg-indigo-100">출고일자</th>
                                <th class="px-4 py-2 font-bold text-center whitespace-nowrap w-[8%] bg-indigo-100">수량(입고/샘플검수)</th>
                                <th class="px-4 py-2 font-bold text-center whitespace-nowrap w-[8%] bg-indigo-100">상태</th>
                                <th class="px-4 py-2 font-bold w-[30%] bg-indigo-100">검수항목 (체크리스트)</th>
                                <th class="px-4 py-2 font-bold w-[20%] bg-indigo-100">특이사항/메모</th>
                                <th class="px-4 py-2 font-bold text-center whitespace-nowrap w-[7%] bg-indigo-100">사진</th>
                                <th class="px-4 py-2 font-bold text-right whitespace-nowrap w-[10%] bg-indigo-100">관리</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    tr.innerHTML = `<td colspan="${colspan}" class="p-0 border-0 cursor-default">${logsHtml}</td>`;
    targetTr.after(tr); 
};

export const renderQCStatsMode = (historyData, periodType = 'month', selectedPeriod = '') => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;

    if (!historyData || historyData.length === 0) {
        container.innerHTML = '<div class="text-center py-10 text-gray-500">데이터를 로드하는 중이거나 데이터가 없습니다.</div>';
        return;
    }

    const weeks = new Set();
    const months = new Set();
    const years = new Set(); 
    
    historyData.forEach(product => {
        if (product.logs && Array.isArray(product.logs)) {
            product.logs.forEach(log => {
                const type = log.inspectionType === 'total' ? 'total' : 'sample';
                if (currentInspTypeFilter !== 'all' && type !== currentInspTypeFilter) return;

                if (log.date) {
                    years.add(log.date.substring(0, 4)); 
                    months.add(log.date.substring(0, 7)); 
                    weeks.add(getWeekOfYear(new Date(log.date))); 
                }
            });
        }
    });

    const yearOptions = Array.from(years).sort().reverse(); 
    const monthOptions = Array.from(months).sort().reverse();
    const weekOptions = Array.from(weeks).sort().reverse();

    if (!selectedPeriod) {
        if (periodType === 'year') selectedPeriod = yearOptions[0];
        else if (periodType === 'month') selectedPeriod = monthOptions[0];
        else selectedPeriod = weekOptions[0];
    }

    let totalInspectedQty = 0; 
    let totalSampledQty = 0;   
    let totalDefectQty = 0;
    let totalInspectionCount = 0;
    let totalDefectCount = 0;
    const inspectedProducts = new Set();
    const productStats = {}; 

    historyData.forEach(product => {
        const pName = product.id;
        
        if (product.logs && Array.isArray(product.logs)) {
            product.logs.forEach(log => {
                if (!log.date) return;
                
                const type = log.inspectionType === 'total' ? 'total' : 'sample';
                if (currentInspTypeFilter !== 'all' && type !== currentInspTypeFilter) return;

                const logYear = log.date.substring(0, 4); 
                const logMonth = log.date.substring(0, 7);
                const logWeek = getWeekOfYear(new Date(log.date));

                const isMatch = (periodType === 'year' && logYear === selectedPeriod) || 
                                (periodType === 'month' && logMonth === selectedPeriod) || 
                                (periodType === 'week' && logWeek === selectedPeriod);

                if (isMatch) {
                    inspectedProducts.add(pName);
                    
                    if (!productStats[pName]) {
                        productStats[pName] = { totalQty: 0, sampleQty: 0, defectQty: 0, inspCount: 0, defectCount: 0, defectsList: [] };
                    }

                    const qty = Number(log.inboundQty) || Number(log.qty) || 0; 
                    const sampleQty = log.sampleQty !== undefined ? Number(log.sampleQty) : 1;
                    
                    productStats[pName].inspCount += 1;
                    totalInspectionCount += 1;
                    
                    productStats[pName].totalQty += qty;
                    productStats[pName].sampleQty += sampleQty;
                    totalInspectedQty += qty;
                    totalSampledQty += sampleQty;

                    let isDefect = false;
                    const defectReasons = [];
                    const normalValues = ['정상', '양호', '동일', '없음', '해당없음', '통과', '-', ''];

                    if (log.status === '불량') isDefect = true;
                    
                    if (log.defects && Array.isArray(log.defects) && log.defects.length > 0) {
                        isDefect = true;
                        defectReasons.push(...log.defects);
                    }

                    if (log.checklist) {
                        const labelMap = { fabric: '원단', color: '컬러', distortion: '뒤틀림', unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추', lining: '안감', pilling: '보풀', dye: '이염' };
                        Object.entries(log.checklist).forEach(([key, val]) => {
                            if (key !== 'thickness' && val) {
                                const cleanVal = String(val).trim();
                                if (cleanVal && !normalValues.includes(cleanVal)) {
                                    isDefect = true;
                                    defectReasons.push(`${labelMap[key] || key}: ${cleanVal}`);
                                }
                            }
                        });
                    }

                    if (isDefect) {
                        productStats[pName].defectCount += 1;
                        totalDefectCount += 1;
                        
                        productStats[pName].defectQty += qty; 
                        totalDefectQty += qty;

                        if (defectReasons.length > 0) {
                            productStats[pName].defectsList.push(...defectReasons);
                        } else {
                            productStats[pName].defectsList.push('상태 불량/기타');
                        }
                    }
                }
            });
        }
    });

    const qtyDefectRate = totalInspectedQty > 0 ? ((totalDefectQty / totalInspectedQty) * 100).toFixed(1) : 0;
    const countDefectRate = totalInspectionCount > 0 ? ((totalDefectCount / totalInspectionCount) * 100).toFixed(1) : 0;
    const totalProductTypes = inspectedProducts.size;

    const topDefectiveProducts = Object.entries(productStats)
        .map(([name, stats]) => ({
            name,
            totalQty: stats.totalQty,
            sampleQty: stats.sampleQty, 
            defectQty: stats.defectQty,
            qtyRate: stats.totalQty > 0 ? ((stats.defectQty / stats.totalQty) * 100).toFixed(1) : 0,
            inspCount: stats.inspCount,
            defectCount: stats.defectCount,
            countRate: stats.inspCount > 0 ? ((stats.defectCount / stats.inspCount) * 100).toFixed(1) : 0,
            commonDefects: [...new Set(stats.defectsList)].join(', ') || '-'
        }))
        .filter(p => p.defectCount > 0 || p.defectQty > 0)
        .sort((a, b) => b.defectCount - a.defectCount || b.defectQty - a.defectQty) 
        .slice(0, 15);

    container.innerHTML = `
        <div class="absolute inset-0 flex flex-col bg-gray-50 p-4 rounded-lg overflow-y-auto custom-scrollbar">
            
            <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-4 flex gap-4 items-end shrink-0">
                <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">통계 기준</label>
                    <select id="qc-period-type" class="border border-gray-300 rounded p-1.5 text-sm focus:ring-indigo-500">
                        <option value="year" ${periodType === 'year' ? 'selected' : ''}>연간 (Yearly)</option> 
                        <option value="month" ${periodType === 'month' ? 'selected' : ''}>월간 (Monthly)</option>
                        <option value="week" ${periodType === 'week' ? 'selected' : ''}>주간 (Weekly)</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">조회 기간</label>
                    <select id="qc-period-value" class="border border-gray-300 rounded p-1.5 text-sm focus:ring-indigo-500 min-w-[120px]">
                        ${periodType === 'year'
                            ? yearOptions.map(y => `<option value="${y}" ${selectedPeriod === y ? 'selected' : ''}>${y}년</option>`).join('')
                            : periodType === 'month' 
                                ? monthOptions.map(m => `<option value="${m}" ${selectedPeriod === m ? 'selected' : ''}>${m}</option>`).join('')
                                : weekOptions.map(w => `<option value="${w}" ${selectedPeriod === w ? 'selected' : ''}>${w}</option>`).join('')
                        }
                    </select>
                </div>
                <button id="btn-refresh-qc" class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold py-1.5 px-4 rounded shadow transition">
                    조회
                </button>
            </div>

            ${!selectedPeriod ? `<div class="text-center text-gray-500 py-10">해당 유형/기간에 검수 데이터가 없습니다.</div>` : `
            
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 shrink-0">
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-indigo-500">
                    <div class="text-xs text-gray-500 mb-1">총 검수 대상(입고) / 실제(샘플검수)</div>
                    <div class="text-xl font-bold text-gray-800">
                        ${totalInspectedQty.toLocaleString()}<span class="text-sm font-normal text-gray-500">개</span> <span class="text-gray-300 mx-1">/</span> <span class="text-blue-600">${totalSampledQty.toLocaleString()}</span><span class="text-sm font-normal text-gray-500">개</span>
                    </div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-blue-500">
                    <div class="text-xs text-gray-500 mb-1">검수 상품 종류</div>
                    <div class="text-2xl font-bold text-gray-800">${totalProductTypes.toLocaleString()} <span class="text-sm font-normal text-gray-500">종</span></div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 border-red-500">
                    <div class="text-xs text-gray-500 mb-1">불량 발생 횟수 / 수량</div>
                    <div class="text-xl font-bold text-red-600">${totalDefectCount.toLocaleString()}<span class="text-sm font-normal text-gray-500">회</span> <span class="text-gray-300 mx-1">/</span> ${totalDefectQty.toLocaleString()}<span class="text-sm font-normal text-gray-500">개</span></div>
                </div>
                <div class="bg-white p-4 rounded-lg shadow-sm border-l-4 ${countDefectRate > 10 ? 'border-red-500' : 'border-orange-500'}">
                    <div class="text-xs text-gray-500 mb-1">평균 불량률 (횟수 / 수량)</div>
                    <div class="text-xl font-bold text-orange-600">${countDefectRate}<span class="text-sm font-normal text-gray-500">%</span> <span class="text-gray-300 mx-1">/</span> ${qtyDefectRate}<span class="text-sm font-normal text-gray-500">%</span></div>
                </div>
            </div>

            <div class="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col shrink-0 mb-8">
                <div class="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
                    <h3 class="font-bold text-gray-700">⚠️ QC 집중 관리 대상 (발생 횟수 최다 상품 TOP 15)</h3>
                    <span class="text-xs text-gray-500 bg-white border border-gray-200 px-2 py-1 rounded shadow-sm">💡 행을 클릭하면 해당 기간의 불량 상세 내역을 볼 수 있습니다.</span>
                </div>
                
                <div class="overflow-x-auto relative">
                    <table class="w-full text-sm text-left relative">
                        <thead class="text-xs text-gray-500 bg-gray-50 outline outline-1 outline-gray-200">
                            <tr class="bg-gray-50">
                                <th class="px-4 py-3 border-b">상품명</th>
                                <th class="px-4 py-3 text-center border-b border-l bg-gray-100/50" colspan="3">📊 검수 횟수 (상품 건별) 기준</th>
                                <th class="px-4 py-3 text-center border-b border-l" colspan="3">📦 샘플검수 수량 (개수) 기준</th>
                                <th class="px-4 py-3 border-b border-l">주요 불량 사유</th>
                            </tr>
                            <tr class="text-[11px] text-gray-400 bg-gray-50">
                                <th class="px-4 py-2 border-b"></th>
                                <th class="px-2 py-2 text-center border-b border-l bg-gray-100/50">총 횟수</th>
                                <th class="px-2 py-2 text-center border-b bg-gray-100/50">불량 횟수</th>
                                <th class="px-2 py-2 text-center border-b bg-gray-100/50">횟수 불량률</th>
                                <th class="px-2 py-2 text-center border-b border-l">입고 / 샘플검수 수량</th>
                                <th class="px-2 py-2 text-center border-b">불량 수량</th>
                                <th class="px-2 py-2 text-center border-b">수량 불량률</th>
                                <th class="px-4 py-2 border-b border-l"></th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100 relative z-0">
                            ${topDefectiveProducts.length === 0 ? `
                                <tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">발견된 불량 내역이 없습니다. 🎉</td></tr>
                            ` : topDefectiveProducts.map((p, idx) => `
                                <tr class="hover:bg-indigo-50/50 transition cursor-pointer btn-view-detail group" 
                                    data-product-name="${p.name}" 
                                    data-is-qc-report="true"
                                    data-qc-period-type="${periodType}"
                                    data-qc-period-value="${selectedPeriod}"
                                    title="해당 기간의 불량 상세 이력 펼치기">
                                    <td class="px-4 py-3 font-medium text-gray-900 break-words max-w-[200px]">
                                        <span class="inline-block w-4 h-4 text-center rounded-full ${idx < 3 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'} text-[10px] mr-1 leading-4">${idx + 1}</span>
                                        <span class="group-hover:text-indigo-600 group-hover:underline transition-all">${p.name}</span>
                                    </td>
                                    
                                    <td class="px-2 py-3 text-center text-gray-600 border-l bg-gray-50/30 group-hover:bg-transparent">${p.inspCount}회</td>
                                    <td class="px-2 py-3 text-center font-bold text-red-600 bg-gray-50/30 group-hover:bg-transparent">${p.defectCount}회</td>
                                    <td class="px-2 py-3 text-center bg-gray-50/30 group-hover:bg-transparent">
                                        <span class="px-2 py-1 rounded text-[11px] font-bold ${p.countRate > 20 ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'}">
                                            ${p.countRate}%
                                        </span>
                                    </td>

                                    <td class="px-2 py-3 text-center text-gray-500 border-l group-hover:bg-transparent">
                                        <div class="text-xs font-bold text-gray-700">${p.totalQty.toLocaleString()}개</div>
                                        <div class="text-[10px] text-blue-600 font-bold">(샘플: ${p.sampleQty.toLocaleString()}개)</div>
                                    </td>
                                    <td class="px-2 py-3 text-center text-orange-600 group-hover:bg-transparent">${p.defectQty}개</td>
                                    <td class="px-2 py-3 text-center group-hover:bg-transparent">
                                        <span class="text-[11px] text-gray-500">${p.qtyRate}%</span>
                                    </td>

                                    <td class="px-4 py-3 text-[11px] text-gray-500 break-words border-l max-w-[250px] group-hover:bg-transparent">${p.commonDefects}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            `}
        </div>
    `;
};