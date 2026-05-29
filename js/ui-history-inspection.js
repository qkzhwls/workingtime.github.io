// === js/ui-history-inspection.js ===
import * as DOM from './dom-elements.js';
import { context } from './state.js';

// 정렬 상태 관리 (로컬)
let sortState = { key: 'lastInspectionDate', dir: 'desc' };

// 헬퍼: 정렬 아이콘 HTML 생성
const getSortIcon = (key) => {
    if (sortState.key !== key) return '<span class="text-gray-300 text-[10px] ml-1 opacity-50">↕</span>';
    return sortState.dir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

// 헬퍼: 불량 이력 요약 (최신 1건 표시)
const formatDefectSummary = (defectSummary) => {
    if (!defectSummary || defectSummary.length === 0) {
        return '<span class="text-gray-400">-</span>';
    }
    const lastDefect = defectSummary[defectSummary.length - 1];
    return `<span class="text-red-600 font-medium text-xs truncate block max-w-[200px]" title="${lastDefect}">${lastDefect}</span>`;
};

/**
 * 메인 프레임 렌더링 (탭 버튼 포함 + 다운로드 버튼 이동)
 */
export const renderInspectionLayout = (container) => {
    if (!container) return;
    const activeTab = context.inspectionViewMode || 'product';

    container.innerHTML = `
        <div class="flex flex-col h-full">
            <div class="flex justify-between items-end border-b border-gray-200 mb-4">
                <div class="flex">
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'product' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="product">
                        📦 상품별 보기
                    </button>
                    <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'list' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" 
                            data-insp-tab="list">
                        📅 입고 리스트별 보기
                    </button>
                </div>
                <div class="pb-1 pr-1">
                    <button id="inspection-tab-download-btn" class="text-xs bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold py-1.5 px-3 rounded shadow-sm transition flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        다운로드
                    </button>
                </div>
            </div>

            <div id="inspection-content-area" class="flex-grow overflow-hidden relative">
            </div>
        </div>
    `;
};

export const renderInspectionListMode = (dateList, selectedDateData) => {
    const container = document.getElementById('inspection-content-area');
    if (!container) return;

    const selectedDate = context.selectedInspectionDate;

    // 1. 날짜 목록 HTML 생성
    let dateListHtml = '';
    if (!dateList || dateList.length === 0) {
        dateListHtml = `<div class="p-4 text-center text-sm text-gray-400">업로드된 리스트가 없습니다.</div>`;
    } else {
        dateList.forEach(d => {
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

    // 2. 상세 리스트 HTML 생성
    let detailHtml = '';
    if (!selectedDate) {
        detailHtml = `<div class="flex h-full items-center justify-center text-gray-400 text-sm">좌측에서 날짜를 선택해주세요.</div>`;
    } else if (!selectedDateData) {
        detailHtml = `<div class="flex h-full items-center justify-center text-gray-400 text-sm">데이터를 불러올 수 없습니다.</div>`;
    } else if (selectedDateData.length === 0) {
        detailHtml = `
            <div class="flex flex-col h-full">
                <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <h4 class="font-bold text-gray-700 text-sm">📅 ${selectedDate} 입고 리스트 상세</h4>
                        <span class="text-xs text-gray-500">0건</span>
                    </div>
                    <button class="text-xs bg-white border border-red-200 hover:bg-red-50 text-red-600 font-bold py-1 px-2 rounded shadow-sm transition" 
                            data-action="request-history-deletion" data-date-key="${selectedDate}" title="이 날짜의 리스트 전체 삭제">
                        🗑️ 리스트 삭제
                    </button>
                </div>
                <div class="flex h-full items-center justify-center text-gray-400 text-sm">해당 날짜의 리스트 데이터가 없습니다.</div>
            </div>
        `;
    } else {
        const rows = selectedDateData.map((item, idx) => {
            const isCompleted = item.status === '완료';
            const statusBadge = isCompleted 
                ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">완료</span>`
                : `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">대기</span>`;
            
            return `
                <tr class="hover:bg-gray-50 transition border-b last:border-0">
                    <td class="px-4 py-3 text-xs font-mono text-gray-500">${item.code || '-'}</td>
                    <td class="px-4 py-3 text-sm font-medium text-gray-900">${item.name}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">${item.option || '-'}</td>
                    <td class="px-4 py-3 text-xs text-gray-600">${item.supplierName || '-'}</td>
                    <td class="px-4 py-3 text-xs text-center">${item.qty || 0}</td>
                    <td class="px-4 py-3 text-xs text-gray-500">${item.thickness || '-'}</td>
                    <td class="px-4 py-3 text-center">${statusBadge}</td>
                </tr>
            `;
        }).join('');

        detailHtml = `
            <div class="flex flex-col h-full">
                <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <h4 class="font-bold text-gray-700 text-sm">📅 ${selectedDate} 입고 리스트 상세</h4>
                        <span class="text-xs text-gray-500">총 ${selectedDateData.length}개 상품</span>
                    </div>
                    <button class="text-xs bg-white border border-red-200 hover:bg-red-50 text-red-600 font-bold py-1 px-2 rounded shadow-sm transition" 
                            data-action="request-history-deletion" data-date-key="${selectedDate}" title="이 날짜의 리스트 전체 삭제">
                        🗑️ 리스트 삭제
                    </button>
                </div>
                <div class="flex-grow overflow-y-auto">
                    <table class="w-full text-left border-collapse">
                        <thead class="bg-white text-xs uppercase text-gray-500 sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th class="px-4 py-2 font-semibold bg-gray-50">코드</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50">상품명</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50">옵션</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50">공급처</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50 text-center">수량</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50">기준</th>
                                <th class="px-4 py-2 font-semibold bg-gray-50 text-center">상태</th>
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
        <div class="flex h-full border border-gray-200 rounded-lg overflow-hidden bg-white">
            <div class="w-1/4 min-w-[180px] border-r border-gray-200 bg-gray-50 overflow-y-auto custom-scrollbar">
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
        if (matchId) return true;
        
        const matchSupplierName = item.lastSupplierName && item.lastSupplierName.toLowerCase().includes(searchTerm);
        if (matchSupplierName) return true;

        if (item.logs && item.logs.length > 0) {
            const lastLog = item.logs[item.logs.length - 1];
            if (lastLog.code && lastLog.code.toLowerCase().includes(searchTerm)) return true;
            if (lastLog.option && lastLog.option.toLowerCase().includes(searchTerm)) return true;
            if (lastLog.supplierName && lastLog.supplierName.toLowerCase().includes(searchTerm)) return true;
        }
        return false;
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
        <div class="h-full overflow-y-auto border border-gray-200 rounded-lg">
            <table class="w-full text-sm text-left text-gray-600">
                <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10 shadow-sm">
                    <tr>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-200 transition select-none" data-sort-key="productName">
                            <div class="flex items-center">상품명 ${getSortIcon('productName')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3">코드 / 옵션</th>
                        <th scope="col" class="px-6 py-3">공급처 상품명</th>
                        <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none" data-sort-key="totalInbound">
                            <div class="flex items-center justify-center">총 입고 ${getSortIcon('totalInbound')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:bg-gray-200 transition select-none" data-sort-key="lastInspectionDate">
                            <div class="flex items-center justify-center">최근 검수일 ${getSortIcon('lastInspectionDate')}</div>
                        </th>
                        <th scope="col" class="px-6 py-3">최근 불량 내역</th>
                        <th scope="col" class="px-6 py-3 text-right">관리</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 bg-white">
    `;

    if (filteredData.length === 0) {
        html += `<tr><td colspan="7" class="px-6 py-8 text-center text-gray-400">
            ${searchTerm ? `'${searchTerm}'에 대한 검색 결과가 없습니다.` : '저장된 검수 이력이 없습니다.'}
        </td></tr>`;
    } else {
        filteredData.forEach(item => {
            let code = '-';
            let option = '-';
            let supplierName = '-';
            
            if (item.lastCode) code = item.lastCode;
            if (item.lastOption) option = item.lastOption;
            if (item.lastSupplierName) supplierName = item.lastSupplierName;

            if (code === '-' && item.logs && item.logs.length > 0) {
                const lastLog = item.logs[item.logs.length - 1];
                code = lastLog.code || '-';
                option = lastLog.option || '-';
                supplierName = lastLog.supplierName || '-';
            }

            html += `
                <tr class="hover:bg-gray-50 transition group">
                    <td class="px-6 py-4 font-medium text-gray-900">${item.id}</td>
                    <td class="px-6 py-4 text-xs text-gray-500">
                        <div class="font-mono text-gray-700">${code}</div>
                        <div class="text-gray-400">${option}</div>
                    </td>
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
                        <button class="text-indigo-600 hover:text-indigo-900 font-semibold text-xs border border-indigo-200 rounded px-3 py-1.5 hover:bg-indigo-50 transition btn-view-detail" 
                                data-product-name="${item.id}">
                            상세보기
                        </button>
                        <button class="text-red-500 hover:text-red-700 font-semibold text-xs border border-red-200 rounded px-3 py-1.5 hover:bg-red-50 transition btn-delete-product opacity-0 group-hover:opacity-100" 
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

export const renderInspectionLogTable = (logs, productName) => {
    const tbody = DOM.inspectionLogTableBody;
    const titleEl = DOM.inspectionLogProductName;
    
    if (!tbody) return;
    if (titleEl) titleEl.textContent = productName;

    tbody.innerHTML = '';

    const table = tbody.closest('table');
    if (table) {
        const thead = table.querySelector('thead');
        if (thead) {
            thead.innerHTML = `
                <tr>
                    <th class="px-4 py-3 w-[12%]">일시</th>
                    <th class="px-4 py-3 w-[7%]">담당</th>
                    <th class="px-4 py-3 w-[10%]">입고일자</th>
                    <th class="px-4 py-3 w-[8%]">코드</th>
                    <th class="px-4 py-3 w-[8%]">옵션</th>
                    <th class="px-4 py-3 w-[10%]">공급처 상품명</th>
                    <th class="px-4 py-3 w-[5%] text-center">수량</th>
                    <th class="px-4 py-3 w-[8%] text-center">상태</th>
                    <th class="px-4 py-3 w-[8%] text-center">사진</th>
                    <th class="px-4 py-3">특이사항</th>
                    <th class="px-4 py-3 w-[10%] text-right">관리</th>
                </tr>`;
        }
    }

    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="p-6 text-center text-gray-400">검수 기록이 없습니다.</td></tr>';
        return;
    }

    const logsWithIndex = logs.map((log, idx) => ({ ...log, originalIndex: idx }));
    logsWithIndex.sort((a, b) => {
        const tA = (a.date || '') + (a.time || '');
        const tB = (b.date || '') + (b.time || '');
        return tB.localeCompare(tA);
    });

    logsWithIndex.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition border-b';

        const statusBadge = item.status === '정상' 
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">정상</span>`
            : `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">불량</span>`;

        let defectText = '';
        if (item.defects && item.defects.length > 0) {
            defectText = `<span class="text-red-600 font-bold mr-1">[${item.defects.join(', ')}]</span>`;
        }
        const noteText = item.note || '';
        const fullText = (defectText + noteText) || '<span class="text-gray-300">-</span>';

        let imageHtml = '<span class="text-gray-300 text-xs">-</span>';
        if (item.image) {
            imageHtml = `
                <div class="relative group cursor-pointer">
                    <img src="${item.image}" class="h-8 w-8 object-cover rounded border border-gray-300 hover:scale-150 transition-transform z-0 hover:z-10 bg-white" 
                         onclick="const w=window.open('','_blank'); w.document.write('<img src=\\'${item.image}\\' style=\\'width:100%\\'/>');">
                    <span class="absolute bottom-0 right-0 block h-2 w-2 rounded-full ring-2 ring-white bg-green-400"></span>
                </div>`;
        }

        tr.innerHTML = `
            <td class="px-4 py-3 whitespace-nowrap text-gray-600 font-mono text-xs">${item.date}<br>${item.time}</td>
            <td class="px-4 py-3 whitespace-nowrap font-medium text-gray-900 text-xs">${item.inspector || '-'}</td>
            <td class="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">${item.inboundDate || item.packingNo || '-'}</td>
            <td class="px-4 py-3 whitespace-nowrap text-gray-500 font-mono text-xs">${item.code || '-'}</td>
            <td class="px-4 py-3 whitespace-nowrap text-gray-500 text-xs truncate max-w-[100px]" title="${item.option}">${item.option || '-'}</td>
            <td class="px-4 py-3 whitespace-nowrap text-gray-500 text-xs truncate max-w-[150px]" title="${item.supplierName}">
                ${item.supplierName || '-'}
            </td>
            <td class="px-4 py-3 whitespace-nowrap text-center font-bold text-gray-700 text-xs">${item.inboundQty ? item.inboundQty.toLocaleString() : '-'}</td>
            <td class="px-4 py-3 whitespace-nowrap text-center">${statusBadge}</td>
            <td class="px-4 py-3 whitespace-nowrap text-center">${imageHtml}</td>
            <td class="px-4 py-3 text-xs text-gray-600 max-w-xs break-words">${fullText}</td>
            <td class="px-4 py-3 whitespace-nowrap text-right">
                <button class="text-blue-600 hover:text-blue-900 font-medium text-xs border border-blue-200 rounded px-2 py-1 hover:bg-blue-50 transition btn-edit-insp-log" data-index="${item.originalIndex}">수정</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
};

export const setSortState = (key) => {
    if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.key = key;
        sortState.dir = 'desc';
    }
};