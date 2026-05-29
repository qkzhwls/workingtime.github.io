// === js/listeners-modals-sim.js ===
import * as DOM from './dom-elements.js';
import { appState, appConfig, allHistoryData } from './state.js';
import { showToast, formatDuration, calcElapsedMinutes, getCurrentTime } from './utils.js';
import { runAdvancedSimulation } from './analysis-logic.js'; 
import { calculateAverageStaffing, calculateStandardThroughputs } from './ui-history-reports-logic.js';
import { fetchAllHistoryData } from './history-data-manager.js';

const CUSTOM_TASK_ORDER = ['채우기', '국내배송', '교환반품', '해외배송', '상.하차', '중국제작', '직진배송', '티니'];
const DEFAULT_CONCURRENT_TASKS = ['해외배송', '상.하차'];

const sortTasksCustom = (a, b) => {
    const idxA = CUSTOM_TASK_ORDER.indexOf(a);
    const idxB = CUSTOM_TASK_ORDER.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
};

const getRecentHistoryData = (months = 2) => {
    if (!allHistoryData || allHistoryData.length === 0) return [];
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);
    return allHistoryData.filter(d => d.id >= cutoffStr);
};

const updateFirstRowCheckbox = () => {
    const tbody = document.getElementById('sim-task-table-body');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('.sim-task-row');
    rows.forEach((row, index) => {
        const checkbox = row.querySelector('.sim-row-concurrent');
        const label = row.querySelector('span');
        if (index === 0) {
            checkbox.disabled = true;
            checkbox.checked = false;
            checkbox.classList.add('opacity-30', 'cursor-not-allowed');
            checkbox.classList.remove('cursor-pointer');
            if(label) label.classList.add('invisible');
        } else {
            checkbox.disabled = false;
            checkbox.classList.remove('opacity-30', 'cursor-not-allowed');
            checkbox.classList.add('cursor-pointer');
            if(label) label.classList.remove('invisible');
        }
    });
};

const renderSimulationTaskRow = (tbody, task = '', qty = '', workers = 0, isConcurrent = false, standardSpeed = 0, manualStartTime = '') => {
    const row = document.createElement('tr');
    row.className = 'bg-white border-b hover:bg-gray-50 transition sim-task-row group';
    row.draggable = true;
    
    const isFirstRow = tbody.children.length === 0;
    const disableCheckbox = isFirstRow ? 'disabled' : '';
    const checkedAttr = (!isFirstRow && isConcurrent) ? 'checked' : '';
    const checkboxClass = isFirstRow ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer';

    let taskOptions = '<option value="">선택</option>';
    const quantityTaskTypes = [...((appConfig && appConfig.quantityTaskTypes) || [])];
    
    quantityTaskTypes.sort(sortTasksCustom).forEach(taskName => {
        const selected = (taskName === task) ? 'selected' : '';
        taskOptions += `<option value="${taskName}" ${selected}>${taskName}</option>`;
    });

    const workerVal = workers > 0 ? Math.round(workers) : '';
    const speedVal = standardSpeed > 0 ? standardSpeed.toFixed(2) : '';

    row.innerHTML = `
        <td class="px-2 py-2 text-center cursor-grab text-gray-300 hover:text-indigo-600 active:cursor-grabbing transition" title="드래그하여 순서 변경">
            <svg class="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"></path></svg>
        </td>
        <td class="px-2 py-2 text-center border-r border-gray-100">
            <div class="flex flex-col items-center justify-center">
                <input type="checkbox" class="sim-row-concurrent w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 ${checkboxClass}" ${disableCheckbox} ${checkedAttr}>
                <span class="text-[10px] text-gray-400 mt-0.5 font-medium ${isFirstRow ? 'invisible' : ''}">동시</span>
            </div>
        </td>
        <td class="px-2 py-2">
            <select class="sim-row-task w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm font-bold text-gray-700 bg-gray-50 shadow-inner">
                ${taskOptions}
            </select>
        </td>
        <td class="px-2 py-2">
            <input type="time" class="sim-row-manual-start w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm text-indigo-600 font-bold bg-white" title="수동 시작 시각 지정" value="${manualStartTime}">
        </td>
        <td class="px-2 py-2">
            <input type="number" class="sim-row-speed w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right bg-gray-50 text-gray-500 font-mono" placeholder="자동" step="0.01" value="${speedVal}">
        </td>
        <td class="px-2 py-2">
            <input type="number" class="sim-row-qty w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right font-bold text-gray-800 shadow-inner" placeholder="1000" min="1" value="${qty > 0 ? qty : ''}">
        </td>
        <td class="px-2 py-2">
            <input type="number" class="sim-row-worker-or-time w-full p-2 border-indigo-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm text-right font-bold text-indigo-700 bg-indigo-50/50 shadow-inner placeholder:font-normal placeholder:text-gray-300" placeholder="(자동 배분)" min="1" step="1" value="${workerVal}">
        </td>
        <td class="px-2 py-2 text-center">
            <button class="sim-row-delete-btn text-gray-300 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mx-auto" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
            </button>
        </td>
    `;
    tbody.appendChild(row);
};

function makeDraggable(modalOverlay, header, contentBox) {
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        if (contentBox.dataset.hasBeenUncentered !== 'true') {
            const rect = contentBox.getBoundingClientRect();
            modalOverlay.classList.remove('flex', 'items-center', 'justify-center');
            contentBox.style.position = 'absolute';
            contentBox.style.top = `${rect.top}px`;
            contentBox.style.left = `${rect.left}px`;
            contentBox.style.width = `${rect.width}px`;
            contentBox.style.transform = 'none';
            contentBox.dataset.hasBeenUncentered = 'true';
        }
        const rect = contentBox.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isDragging) return;
        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;
        contentBox.style.left = `${newLeft}px`;
        contentBox.style.top = `${newTop}px`;
    }

    function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}

// ✨ 핵심: 결과를 명확하게 3단계로 분리하여 렌더링
const renderSimulationResults = (data) => {
    const contentBox = document.getElementById('sim-modal-content-box');
    const simResultThead = document.getElementById('sim-result-thead');
    const simResultTbody = document.getElementById('sim-result-tbody');
    const summaryGrid = document.getElementById('sim-summary-grid');
    
    if (!data) {
        if (DOM.simResultContainer) DOM.simResultContainer.classList.add('hidden');
        if (contentBox) contentBox.style.height = null;
        return;
    }
    
    if (contentBox) contentBox.style.height = 'auto';

    const { results, totalDuration, finalEndTimeStr, totalCost, totalWorkersForTarget, targetEndTimeStr, simulationPoolSize } = data;
    
    // 1. 카드 UI 분리 렌더링
    if (summaryGrid) {
        const extraNeeded = Math.max(0, totalWorkersForTarget - simulationPoolSize);
        
        summaryGrid.innerHTML = `
            <div class="bg-blue-50/70 p-5 rounded-2xl border border-blue-200 flex flex-col justify-center shadow-sm relative overflow-hidden">
                <div class="text-[11px] text-blue-600 mb-2 font-extrabold tracking-wider">1️⃣ 현재 투입 인원 (${simulationPoolSize}명) 기준</div>
                <div class="text-3xl font-extrabold text-blue-800">${finalEndTimeStr} <span class="text-sm font-bold text-blue-600">종료 예상</span></div>
                <div class="text-xs text-blue-500 mt-2 font-medium">총 소요 시간: ${formatDuration(totalDuration)}</div>
            </div>
            
            <div class="bg-green-50 p-5 rounded-2xl border border-green-200 flex flex-col justify-center shadow-md relative overflow-hidden ring-1 ring-green-300">
                <div class="text-[11px] text-green-700 mb-2 font-extrabold tracking-wider">2️⃣ 목표 퇴근 (${targetEndTimeStr}) 맞출 시</div>
                <div class="text-3xl font-extrabold text-green-800">총 ${totalWorkersForTarget}명 <span class="text-sm font-bold text-green-600">필요</span></div>
                <div class="mt-2.5">
                    <span class="text-[11px] text-red-600 font-extrabold bg-white border border-red-200 px-2.5 py-1 rounded-full shadow-sm">
                        🚨 유동 인원 <span class="text-base">+${extraNeeded}명</span> 더 필요
                    </span>
                </div>
            </div>
            
            <div class="bg-orange-50/70 p-5 rounded-2xl border border-orange-200 flex flex-col justify-center shadow-sm relative overflow-hidden">
                <div class="text-[11px] text-orange-600 mb-2 font-extrabold tracking-wider">3️⃣ 예상 총 인건비</div>
                <div class="text-3xl font-extrabold text-orange-800">${Math.round(totalCost).toLocaleString()}<span class="text-sm font-bold text-orange-600">원</span></div>
                <div class="text-xs text-orange-500 mt-2 font-medium">현재 투입 (${simulationPoolSize}명) 기준</div>
            </div>
        `;
    }

    // 2. 표 헤더 변경 (투입 인원 명확화)
    if (simResultThead) {
        simResultThead.innerHTML = `
            <tr>
                <th class="px-4 py-3 border-b border-gray-200">업무명</th>
                <th class="px-4 py-3 text-center border-b border-gray-200">동시진행</th>
                <th class="px-4 py-3 text-right border-b border-gray-200">표준 속도</th>
                <th class="px-4 py-3 text-right border-b border-gray-200 text-indigo-700">개별 할당 인원</th>
                <th class="px-4 py-3 text-right border-b border-gray-200">예상 소요 시간</th>
                <th class="px-4 py-3 text-right border-b border-gray-200">예상 종료 시각</th>
            </tr>
        `;
    }

    // 3. 표 내용 렌더링 (고정 인원 vs 유동 배분 뱃지)
    if (simResultTbody) {
        simResultTbody.innerHTML = results.map(res => {
            let relatedTaskHtml = '';
            if (res.relatedTaskInfo) {
                const fixedTime = res.relatedTaskInfo.time;
                const timeClass = fixedTime > 0 ? "text-gray-400" : "text-gray-300";
                relatedTaskHtml = `<div class="text-[10px] ${timeClass} font-normal mt-0.5">+ ${res.relatedTaskInfo.name} (${formatDuration(fixedTime)})</div>`;
            }
            const concurrentIcon = res.isConcurrent 
                ? `<span class="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-[10px] font-bold border border-indigo-100">동시</span>` 
                : '<span class="text-gray-300 text-[10px] font-bold">-</span>';
            
            // 🔥 고정/유동 배지 완벽 분리
            const workerBadge = res.assignedWorkers > 0 
                ? `<span class="inline-flex items-center gap-1 bg-indigo-100 text-indigo-800 font-extrabold px-2.5 py-1 rounded-md text-[11px] border border-indigo-200 shadow-sm"><span class="text-sm">👤</span> ${res.assignedWorkers}명 (고정)</span>`
                : `<span class="inline-flex items-center gap-1 bg-gray-100 text-gray-500 font-bold px-2.5 py-1 rounded-md text-[11px] border border-gray-200"><span class="text-sm">🔄</span> 유동 배분</span>`;

            return `
            <tr class="bg-white hover:bg-blue-50/30 transition border-b border-gray-100">
                <td class="px-4 py-3.5 font-bold text-gray-800">
                    ${res.task}
                    ${relatedTaskHtml} 
                </td>
                <td class="px-4 py-3.5 text-center">
                    ${concurrentIcon}
                </td>
                <td class="px-4 py-3.5 text-right text-gray-500 font-mono text-xs">
                    ${res.speed.toFixed(2)}
                </td>
                <td class="px-4 py-3.5 text-right">
                    ${workerBadge}
                </td>
                <td class="px-4 py-3.5 text-right text-indigo-700 font-bold text-sm">
                    ${formatDuration(res.durationMinutes)}
                    ${res.includesLunch ? '<span class="text-[10px] text-orange-500 block leading-none mt-1 font-medium">(점심 포함)</span>' : ''}
                </td>
                <td class="px-4 py-3.5 text-right font-extrabold text-gray-800">${res.expectedEndTime}</td>
            </tr>
            `;
        }).join('');
    }
    
    if (DOM.simResultContainer) DOM.simResultContainer.classList.remove('hidden');
    if (DOM.simInputArea) DOM.simInputArea.classList.remove('hidden');
};

const renderTimelineChart = (data) => {
    const container = document.getElementById('sim-bottleneck-container');
    if (!container || !data || !data.results) return;
    
    if (!data.globalStartTimeMs || !data.globalEndTimeMs) {
        container.classList.add('hidden');
        return;
    }
    
    container.innerHTML = `<h4 class="text-sm font-extrabold text-gray-800 mb-3 mt-8 flex items-center gap-2"><span>📈</span> 시뮬레이션 타임라인</h4>`;
    
    const chartWrapper = document.createElement('div');
    chartWrapper.className = "space-y-3 bg-white p-5 rounded-2xl border border-gray-200 relative shadow-sm";
    
    const totalMs = data.globalEndTimeMs - data.globalStartTimeMs;
    
    data.results.forEach(res => {
        const row = document.createElement('div');
        row.className = "flex items-center gap-3";
        
        const [startH, startM] = res.startTime.split(':').map(Number);
        const startMsDate = new Date(data.globalStartTimeMs);
        startMsDate.setHours(startH, startM, 0, 0);
        let offsetMs = startMsDate.getTime() - data.globalStartTimeMs;
        if (offsetMs < -43200000) offsetMs += 86400000; 
        
        let leftPercent = totalMs > 0 ? (offsetMs / totalMs) * 100 : 0;
        let widthPercent = totalMs > 0 ? ((res.durationMinutes * 60000) / totalMs) * 100 : 100;
        
        if (leftPercent < 0) leftPercent = 0;
        if (leftPercent + widthPercent > 100) widthPercent = 100 - leftPercent;

        const isLunchIncluded = res.includesLunch ? '<span class="text-orange-300 ml-1">🍵</span>' : '';

        const rowHtml = `
            <div class="w-24 text-[11px] font-bold text-gray-600 truncate text-right pr-2" title="${res.task}">${res.task}</div>
            <div class="flex-grow bg-gray-50 h-8 rounded-lg border border-gray-200 relative overflow-hidden shadow-inner">
                <div class="absolute h-full bg-gradient-to-r from-indigo-500 to-indigo-600 flex items-center justify-center text-[10px] text-white font-bold rounded shadow transition-all hover:brightness-110 cursor-pointer" 
                     style="left: ${leftPercent}%; width: ${widthPercent}%; min-width: 4rem;"
                     title="${res.task} (${res.startTime} ~ ${res.expectedEndTime})">
                    ${res.startTime} ~ ${res.expectedEndTime} ${isLunchIncluded}
                </div>
            </div>
        `;
        row.innerHTML = rowHtml;
        chartWrapper.appendChild(row);
    });
    
    const now = new Date(data.globalStartTimeMs);
    const lunchStartMsDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30);
    const lunchStartOffset = lunchStartMsDate.getTime() - data.globalStartTimeMs;
    
    if (lunchStartOffset > 0 && lunchStartOffset < totalMs) {
        const lunchLeft = (lunchStartOffset / totalMs) * 100;
        const lunchWidth = ((60 * 60000) / totalMs) * 100; 
        
        const lunchMarker = document.createElement('div');
        lunchMarker.className = "absolute top-0 bottom-0 bg-orange-100 bg-opacity-30 border-x border-orange-300 border-dashed pointer-events-none";
        lunchMarker.style.left = `${lunchLeft}%`;
        lunchMarker.style.width = `${lunchWidth}%`;
        lunchMarker.innerHTML = `<div class="text-[9px] text-orange-600 absolute top-[-20px] left-1 bg-white border border-orange-100 px-1.5 py-0.5 rounded font-bold shadow-sm">점심 휴식 (12:30~13:30)</div>`;
        chartWrapper.appendChild(lunchMarker);
    }

    container.appendChild(chartWrapper);
    container.classList.remove('hidden');
};

export function setupSimulationModalListeners() {
    
    const simAddTaskRowBtn = document.getElementById('sim-add-task-row-btn');
    const simTaskTableBody = document.getElementById('sim-task-table-body');
    const simStartTimeInput = document.getElementById('sim-start-time-input');
    const simEndTimeInput = document.getElementById('sim-end-time-input');

    const openSimulationModalLogic = async () => {
        if (DOM.simInputArea) DOM.simInputArea.classList.remove('hidden');
        
        if (!allHistoryData || allHistoryData.length === 0) {
            await fetchAllHistoryData();
        }

        const attendanceMap = appState.dailyAttendance || {};
        const currentActiveCount = Object.values(attendanceMap).filter(a => a.status === 'active').length;
        
        if (simTaskTableBody) {
            simTaskTableBody.innerHTML = '';

            const recentHistory = getRecentHistoryData(2);
            const avgStaffMap = calculateAverageStaffing(recentHistory);
            const standards = calculateStandardThroughputs(recentHistory);
            
            const quantityTaskSet = new Set(appConfig.quantityTaskTypes || []);
            const quantities = appState.taskQuantities || {};
            const tasksToShow = new Set(appConfig.keyTasks || []); 
            Object.keys(quantities).forEach(t => {
                if (Number(quantities[t]) > 0) tasksToShow.add(t); 
            });

            let tasksWereAdded = false;
            let commonStartTime = simStartTimeInput ? simStartTimeInput.value : "09:00";

            Array.from(tasksToShow).sort(sortTasksCustom).forEach((taskName, idx) => {
                if (quantityTaskSet.has(taskName)) { 
                    const qty = Number(quantities[taskName]) || 0;
                    let avgStaff = avgStaffMap[taskName] || 0;
                    
                    if (avgStaff <= 0) {
                        avgStaff = currentActiveCount > 0 ? 1 : 0;
                    } else if (currentActiveCount > 0) {
                        avgStaff = Math.min(avgStaff, currentActiveCount);
                    }
                    avgStaff = Math.round(avgStaff);

                    const isConcurrent = DEFAULT_CONCURRENT_TASKS.includes(taskName);
                    const speed = standards[taskName] || 0;
                    
                    const rowStartTime = idx === 0 ? commonStartTime : '';
                    
                    renderSimulationTaskRow(simTaskTableBody, taskName, qty, avgStaff, isConcurrent, speed, rowStartTime);
                    tasksWereAdded = true;
                }
            });

            if (!tasksWereAdded) {
                renderSimulationTaskRow(simTaskTableBody, '', '', 0, false, 0, commonStartTime);
            }
            updateFirstRowCheckbox(); 
        }
        
        if (appState.simulationResults) {
            const savedStartTime = appState.simulationResults.startTime;
            const savedEndTime = appState.simulationResults.endTime; 
            if (savedStartTime && simStartTimeInput) simStartTimeInput.value = savedStartTime;
            if (savedEndTime && simEndTimeInput) simEndTimeInput.value = savedEndTime;

            renderSimulationResults(appState.simulationResults);
            try {
                renderTimelineChart(appState.simulationResults);
            } catch (err) {}
        } else {
            renderSimulationResults(null); 
            const container = document.getElementById('sim-bottleneck-container');
            if (container) container.classList.add('hidden'); 

            if (simStartTimeInput && !simStartTimeInput.value) simStartTimeInput.value = "09:00"; 
            if (simEndTimeInput && !simEndTimeInput.value) simEndTimeInput.value = "17:30"; 
        }

        const contentBox = document.getElementById('sim-modal-content-box');
        if (contentBox) {
            contentBox.removeAttribute('style');
            contentBox.dataset.hasBeenUncentered = 'false';
        }
        if (DOM.costSimulationModal) {
             DOM.costSimulationModal.classList.add('flex', 'items-center', 'justify-center');
             DOM.costSimulationModal.classList.remove('hidden');
        }
    };

    if (DOM.openCostSimulationBtn) {
        DOM.openCostSimulationBtn.addEventListener('click', () => {
            openSimulationModalLogic();
            document.getElementById('menu-dropdown')?.classList.add('hidden');
        });
    }

    if (DOM.openCostSimulationBtnMobile) {
        DOM.openCostSimulationBtnMobile.addEventListener('click', () => {
            openSimulationModalLogic();
            if (DOM.navContent) DOM.navContent.classList.add('hidden'); 
        });
    }

    if (simAddTaskRowBtn && simTaskTableBody) {
        simAddTaskRowBtn.addEventListener('click', () => {
            const commonStartTime = simStartTimeInput ? simStartTimeInput.value : "";
            const isFirst = simTaskTableBody.children.length === 0;
            renderSimulationTaskRow(simTaskTableBody, '', '', 0, false, 0, isFirst ? commonStartTime : '');
        });
    }

    if (simTaskTableBody) {
        simTaskTableBody.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.sim-row-delete-btn');
            if (deleteBtn) {
                deleteBtn.closest('tr').remove();
                updateFirstRowCheckbox();
            }
        });

        simTaskTableBody.addEventListener('change', (e) => {
            if (e.target.classList.contains('sim-row-task')) {
                const taskName = e.target.value;
                const row = e.target.closest('tr');
                
                const speedInput = row.querySelector('.sim-row-speed');
                const qtyInput = row.querySelector('.sim-row-qty');
                const workerInput = row.querySelector('.sim-row-worker-or-time');
                const concurrentCheck = row.querySelector('.sim-row-concurrent');
                const startInput = row.querySelector('.sim-row-manual-start');

                if (taskName) {
                     const recentHistory = getRecentHistoryData(2);
                     const standards = calculateStandardThroughputs(recentHistory);
                     const speed = standards[taskName] || 0;
                     if (speedInput) speedInput.value = speed > 0 ? speed.toFixed(2) : '';
                     
                     const quantities = appState.taskQuantities || {};
                     if (qtyInput && quantities[taskName]) {
                         qtyInput.value = quantities[taskName];
                     }
                     
                     const avgStaffMap = calculateAverageStaffing(recentHistory);
                     const attendanceMap = appState.dailyAttendance || {};
                     const currentActiveCount = Object.values(attendanceMap).filter(a => a.status === 'active').length;
                     
                     if (workerInput) {
                         let avgStaff = avgStaffMap[taskName] || (currentActiveCount > 0 ? 1 : 0);
                         if (currentActiveCount > 0 && avgStaff > 0) avgStaff = Math.min(avgStaff, currentActiveCount);
                         workerInput.value = Math.round(avgStaff) || '';
                     }

                     if (concurrentCheck && DEFAULT_CONCURRENT_TASKS.includes(taskName)) {
                         concurrentCheck.checked = true;
                     }

                     if (startInput && !startInput.value && row.previousElementSibling === null) {
                         startInput.value = simStartTimeInput ? simStartTimeInput.value : "09:00";
                     }
                }
            }
        });

        let draggedRow = null;

        simTaskTableBody.addEventListener('dragstart', (e) => {
            const target = e.target.closest('tr');
            if (target) {
                draggedRow = target;
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => target.classList.add('opacity-50', 'bg-indigo-50'), 0);
            }
        });

        simTaskTableBody.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const targetRow = e.target.closest('tr');
            if (targetRow && targetRow !== draggedRow) {
                const bounding = targetRow.getBoundingClientRect();
                const offset = bounding.y + (bounding.height / 2);
                if (e.clientY - offset > 0) {
                    targetRow.after(draggedRow);
                } else {
                    targetRow.before(draggedRow);
                }
            }
        });

        simTaskTableBody.addEventListener('dragend', (e) => {
            if (draggedRow) {
                draggedRow.classList.remove('opacity-50', 'bg-indigo-50');
                draggedRow = null;
            }
            updateFirstRowCheckbox();
        });
    }

    if (DOM.simCalculateBtn) {
        DOM.simCalculateBtn.addEventListener('click', () => {
            const currentStartTimeStr = simStartTimeInput ? simStartTimeInput.value : "09:00";
            const currentEndTimeStr = simEndTimeInput ? simEndTimeInput.value : "17:30";
            const includeLinkedTasks = document.getElementById('sim-include-linked-tasks-checkbox')?.checked || false;

            const rows = document.querySelectorAll('.sim-task-row');
            const taskList = [];
            let totalFixedWorkers = 0; 
            let hasAnyFixed = false;

            rows.forEach((row, index) => {
                const task = row.querySelector('.sim-row-task').value;
                const qty = Number(row.querySelector('.sim-row-qty').value);
                const workerInputStr = row.querySelector('.sim-row-worker-or-time').value;
                const workerInput = workerInputStr ? Number(workerInputStr) : 0;
                const isConcurrent = row.querySelector('.sim-row-concurrent').checked;
                const manualSpeed = Number(row.querySelector('.sim-row-speed').value);
                const manualStart = row.querySelector('.sim-row-manual-start').value;

                if (task && qty > 0) {
                    if (workerInput > 0) hasAnyFixed = true;
                    totalFixedWorkers += workerInput;
                    
                    taskList.push({ 
                        task, 
                        targetQty: qty, 
                        manualSpeed, 
                        manualStart: manualStart || null,
                        isConcurrent: (index > 0 && isConcurrent),
                        requiredWorkers: workerInput 
                    });
                }
            });

            if (taskList.length === 0) {
                showToast('입력 정보를 확인해주세요.', true);
                return;
            }

            // 전체 가용 풀(Pool) 계산
            let activeStaffCount = 1;
            const attendanceMap = appState.dailyAttendance || {};
            const activeStaff = Object.values(attendanceMap).filter(a => a.status === 'active').length;
            if (activeStaff > 0) activeStaffCount = activeStaff;

            let simulationPoolSize = activeStaffCount;
            if (totalFixedWorkers > simulationPoolSize) {
                simulationPoolSize = totalFixedWorkers; 
            } else if (!hasAnyFixed) {
                simulationPoolSize = activeStaffCount;
            }

            // 1. 현재 풀(Pool) 인원 기준 시뮬레이션
            const timeSimulation = runAdvancedSimulation('fixed-workers', taskList, simulationPoolSize, currentStartTimeStr, includeLinkedTasks);
            
            // 2. 목표 종료 시간 달성 역산 시뮬레이션
            const targetSimulation = runAdvancedSimulation('target-time', taskList, currentEndTimeStr, currentStartTimeStr, includeLinkedTasks);

            if (timeSimulation.error) {
                showToast(timeSimulation.error, true);
                return;
            }

            const results = timeSimulation.results.map((tRes) => {
                return { ...tRes };
            });

            const simulationData = {
                results,
                totalDuration: timeSimulation.totalDuration,
                finalEndTimeStr: timeSimulation.finalEndTimeStr,
                totalCost: timeSimulation.totalCost,
                totalWorkersForTarget: targetSimulation.error ? 0 : targetSimulation.totalWorkers,
                targetEndTimeStr: currentEndTimeStr,
                simulationPoolSize: simulationPoolSize,
                startTime: currentStartTimeStr,
                endTime: currentEndTimeStr,
                globalStartTimeMs: timeSimulation.globalStartTimeMs,
                globalEndTimeMs: timeSimulation.globalEndTimeMs
            };
            
            appState.simulationResults = simulationData;
            
            renderSimulationResults(simulationData);
            renderTimelineChart(simulationData);
        });
    }

    const modalOverlay = DOM.costSimulationModal;
    const modalHeader = document.getElementById('sim-modal-header');
    const modalContentBox = document.getElementById('sim-modal-content-box');

    if (modalOverlay && modalHeader && modalContentBox) {
        makeDraggable(modalOverlay, modalHeader, modalContentBox);
    }
}