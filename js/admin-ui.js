// === js/admin-ui.js ===
// 설명: 관리자 페이지의 UI 렌더링을 전담하는 모듈입니다.

export const DASHBOARD_ITEM_DEFINITIONS = {
    'total-staff': { title: '총원 (직원/알바)' },
    'leave-staff': { title: '휴무' },
    'active-staff': { title: '근무 (직원/알바)' },
    'working-staff': { title: '업무중' },
    'idle-staff': { title: '대기' },
    'ongoing-tasks': { title: '진행업무' },
    'total-work-time': { title: '업무진행시간' },
    'domestic-invoice': { title: '국내송장(예상)', isQuantity: true },
    'china-production': { title: '중국제작', isQuantity: true },
    'direct-delivery': { title: '직진배송', isQuantity: true }
};

export function getAllDashboardDefinitions(config) {
    return {
        ...DASHBOARD_ITEM_DEFINITIONS,
        ...(config.dashboardCustomItems || {})
    };
}

// 현재 DOM에 있는 모든 업무 이름 가져오기 (헬퍼 함수)
export function getAllTaskNamesFromDOM() {
    const taskNames = new Set();
    document.querySelectorAll('#task-groups-container .task-name').forEach(input => {
        const taskName = input.value.trim();
        if (taskName) taskNames.add(taskName);
    });
    return Array.from(taskNames);
}

// 전체 관리자 UI 렌더링 진입점
export function renderAdminUI(config) {
    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) {
        wageInput.value = config.defaultPartTimerWage || 10000;
    }

    const revenueUnitInput = document.getElementById('revenue-increment-unit');
    if (revenueUnitInput) {
        revenueUnitInput.value = config.revenueIncrementUnit || 10000000;
    }
    const workHoursInput = document.getElementById('standard-monthly-work-hours');
    if (workHoursInput) {
        workHoursInput.value = config.standardMonthlyWorkHours || 209;
    }

    renderTeamGroups(
        config.teamGroups || [], 
        config.memberWages || {}, 
        config.memberEmails || {}, 
        config.memberRoles || {}, 
        config.memberLeaveSettings || {}
    );
    
    renderDashboardItemsConfig(config.dashboardItems || [], config);
    renderKeyTasks(config.keyTasks || []);
    renderTaskGroups(config.taskGroups || []);
    renderQuantityTasks(config.quantityTaskTypes || []);
    renderQuantityToDashboardMapping(config);
    
    // 원가 분석 설정 렌더링
    renderCostAnalysisConfig(config);
}

// 상품 원가 및 손익 분석 설정 UI 렌더링
export function renderCostAnalysisConfig(config) {
    // 1. 고정비 설정
    const materialInput = document.getElementById('fixed-material-cost');
    if (materialInput) {
        materialInput.value = config.fixedMaterialCost || 0;
    }
    const shippingInput = document.getElementById('fixed-shipping-cost');
    if (shippingInput) {
        shippingInput.value = config.fixedShippingCost || 0;
    }
    const directDeliveryInput = document.getElementById('fixed-direct-delivery-cost');
    if (directDeliveryInput) {
        directDeliveryInput.value = config.fixedDirectDeliveryCost || 0;
    }

    // 2. 원가 계산 업무 선택 (체크박스 렌더링)
    const container = document.getElementById('cost-calc-tasks-container');
    if (container) {
        container.innerHTML = '';
        
        // 현재 설정된 모든 업무 목록 가져오기 (Config 기반)
        const allTasks = new Set();
        (config.taskGroups || []).forEach(group => {
            (group.tasks || []).forEach(task => allTasks.add(task));
        });

        // 이미 선택된 업무 목록
        const savedTasks = new Set(config.costCalcTasks || []);

        if (allTasks.size === 0) {
             container.innerHTML = '<p class="text-xs text-gray-400 col-span-full text-center">등록된 업무가 없습니다.</p>';
        } else {
            Array.from(allTasks).sort().forEach(taskName => {
                const isChecked = savedTasks.has(taskName) ? 'checked' : '';
                const div = document.createElement('div');
                div.className = 'flex items-center p-1';
                div.innerHTML = `
                    <input type="checkbox" id="cost-task-${taskName}" value="${taskName}" class="cost-calc-task-checkbox w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" ${isChecked}>
                    <label for="cost-task-${taskName}" class="ml-2 text-sm text-gray-700 cursor-pointer select-none">${taskName}</label>
                `;
                container.appendChild(div);
            });
        }
    }
}

export function renderTeamGroups(teamGroups, memberWages, memberEmails, memberRoles, memberLeaveSettings = {}) {
    const container = document.getElementById('team-groups-container');
    if (!container) return;
    container.innerHTML = '';

    teamGroups.forEach((group, index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 team-group-card';
        groupEl.dataset.index = index;

        const membersHtml = group.members.map((member, mIndex) => {
            const memberEmail = memberEmails[member] || '';
            const currentRole = (memberEmail && memberRoles[memberEmail.toLowerCase()]) ? memberRoles[memberEmail.toLowerCase()] : 'user';
            
            const settings = memberLeaveSettings[member] || {};
            const joinDate = settings.joinDate || '';
            const totalLeave = settings.totalLeave !== undefined ? settings.totalLeave : 15;
            
            // ✅ [신규] 연차 초기화 기준일 (적용 시작일) 및 만료일
            const leaveResetDate = settings.leaveResetDate || ''; 
            const expirationDate = settings.expirationDate || '';

            return `
            <div class="flex flex-col gap-2 mb-4 p-3 rounded hover:bg-gray-100 member-item border border-gray-200 bg-white">
                <div class="flex justify-between items-start">
                    <div class="flex items-center gap-2">
                        <span class="drag-handle text-gray-400 mr-2 cursor-move text-lg" draggable="true">☰</span>
                        
                        <div class="flex flex-col">
                            <label class="text-[10px] text-gray-500 font-bold">이름</label>
                            <input type="text" value="${member}" class="member-name w-24 p-1 border border-gray-300 rounded text-sm font-bold" placeholder="이름">
                        </div>
                        
                        <div class="flex flex-col">
                            <label class="text-[10px] text-gray-500">이메일</label>
                            <input type="email" value="${memberEmail}" class="member-email w-40 p-1 border border-gray-300 rounded text-sm" placeholder="email">
                        </div>

                        <div class="flex flex-col">
                            <label class="text-[10px] text-gray-500">시급</label>
                            <input type="number" value="${memberWages[member] || 0}" class="member-wage w-20 p-1 border border-gray-300 rounded text-sm" placeholder="시급">
                        </div>
                        
                        <div class="flex flex-col">
                             <label class="text-[10px] text-gray-500">권한</label>
                            <select class="member-role w-20 p-1 border border-gray-300 rounded text-sm">
                                <option value="user" ${currentRole === 'user' ? 'selected' : ''}>일반</option>
                                <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>관리자</option>
                            </select>
                        </div>
                    </div>
                    <button class="btn btn-danger btn-small delete-member-btn h-8" data-m-index="${mIndex}">삭제</button>
                </div>

                <div class="flex items-center gap-3 pt-2 border-t border-gray-100 bg-blue-50/50 p-2 rounded">
                    <span class="text-xs font-bold text-blue-800">🏖️ 연차 설정</span>
                    
                    <div class="flex flex-col">
                        <label class="text-[9px] text-blue-600">입사일자</label>
                        <input type="date" value="${joinDate}" class="member-join-date w-28 p-1 border border-blue-200 rounded text-xs">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-[9px] text-blue-600">총연차(일)</label>
                        <input type="number" value="${totalLeave}" class="member-total-leave w-14 p-1 border border-blue-200 rounded text-center text-xs" min="0">
                    </div>
                    
                    <div class="w-px h-8 bg-blue-200 mx-1"></div>

                    <div class="flex flex-col">
                        <label class="text-[9px] text-blue-600 font-bold" title="이 날짜 이후의 연차만 차감 계산됩니다. (초기화 시 사용)">적용 시작일 (초기화)</label>
                        <input type="date" value="${leaveResetDate}" class="member-leave-reset-date w-28 p-1 border border-blue-300 rounded text-xs bg-white font-bold text-blue-900">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-[9px] text-red-600 font-bold">사용 만료일</label>
                        <input type="date" value="${expirationDate}" class="member-leave-expiration-date w-28 p-1 border border-red-200 rounded text-xs bg-white text-red-900">
                    </div>
                </div>
            </div>
            `;
        }).join('');

        groupEl.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <div class="flex items-center">
                    <span class="drag-handle mr-2 cursor-move" draggable="true">☰</span> 
                    <input type="text" value="${group.name}" class="text-lg font-semibold team-group-name w-auto p-1 border-b border-transparent hover:border-gray-300 bg-transparent">
                </div>
                <button class="btn btn-danger btn-small delete-team-group-btn">그룹 삭제</button>
            </div>
            <div class="pl-2 space-y-2 members-container">${membersHtml}</div>
            <button class="btn btn-secondary btn-small mt-3 add-member-btn">+ 팀원 추가</button>
        `;
        container.appendChild(groupEl);
    });
}

export function renderDashboardItemsConfig(itemIds, fullConfig) {
    const container = document.getElementById('dashboard-items-container');
    if (!container) return;
    container.innerHTML = '';
    const allDefinitions = getAllDashboardDefinitions(fullConfig);

    itemIds.forEach((id, index) => {
        const itemDef = allDefinitions[id];
        if (!itemDef) return;

        const itemEl = document.createElement('div');
        const isQuantity = itemDef.isQuantity === true;
        itemEl.className = `flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 dashboard-item-config ${isQuantity ? 'is-quantity-item' : ''}`;
        itemEl.dataset.index = index;

        let itemHtml = `
            <span class="drag-handle" draggable="true">☰</span>
            <span class="dashboard-item-name flex-grow p-2 ${isQuantity ? 'bg-yellow-50' : 'bg-gray-100'} rounded text-sm font-medium" data-id="${id}">${itemDef.title}</span>
        `;
        itemHtml += `<button class="btn btn-danger btn-small delete-dashboard-item-btn ml-2" data-id="${id}">삭제</button>`;
        itemEl.innerHTML = itemHtml;
        container.appendChild(itemEl);
    });
}

export function renderKeyTasks(keyTasks) {
    const container = document.getElementById('key-tasks-container');
    if (!container) return;
    container.innerHTML = '';
    keyTasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 key-task-item';
        taskEl.dataset.index = index;
        taskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span> 
            <span class="key-task-name flex-grow p-2 bg-gray-100 rounded">${task}</span>
            <button class="btn btn-danger btn-small delete-key-task-btn" data-index="${index}">삭제</button>
        `;
        container.appendChild(taskEl);
    });
}

export function renderTaskGroups(taskGroups) {
    const container = document.getElementById('task-groups-container');
    if (!container) return;
    container.innerHTML = '';

    (taskGroups || []).forEach((group, index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 task-group-card';
        groupEl.dataset.index = index;

        const tasksHtml = (group.tasks || []).map((task, tIndex) => `
            <div class="flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 task-item">
                <span class="drag-handle" draggable="true">☰</span>
                <input type="text" value="${task}" class="task-name flex-grow p-2 border border-gray-300 rounded">
                <button class="btn btn-danger btn-small delete-task-btn" data-t-index="${tIndex}">삭제</button>
            </div>
        `).join('');

        groupEl.innerHTML = `
             <div class="flex justify-between items-center mb-4">
                <div class="flex items-center"> 
                   <span class="drag-handle mr-2 cursor-move" draggable="true">☰</span>
                   <input type="text" value="${group.name}" class="text-lg font-semibold task-group-name w-auto p-1 border-b border-transparent hover:border-gray-300 bg-transparent">
                 </div>
                <button class="btn btn-danger btn-small delete-task-group-btn">그룹 삭제</button>
            </div>
            <div class="pl-4 border-l-2 border-gray-200 space-y-2 tasks-container">${tasksHtml}</div>
            <button class="btn btn-secondary btn-small mt-3 add-task-btn">+ 업무 추가</button>
        `;
        container.appendChild(groupEl);
    });
}

export function renderQuantityTasks(quantityTasks) {
    const container = document.getElementById('quantity-tasks-container');
    if (!container) return;
    container.innerHTML = '';
    quantityTasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 quantity-task-item';
        taskEl.dataset.index = index;
        taskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span> 
            <span class="quantity-task-name flex-grow p-2 bg-gray-100 rounded">${task}</span>
            <button class="btn btn-danger btn-small delete-quantity-task-btn" data-index="${index}">삭제</button>
        `;
        container.appendChild(taskEl);
    });
}

export function renderQuantityToDashboardMapping(config) {
    const container = document.getElementById('quantity-mapping-container');
    if (!container) return;
    container.innerHTML = '';

    const mapping = config.quantityToDashboardMap || {};
    const quantityTasks = config.quantityTaskTypes || [];
    const allDefinitions = getAllDashboardDefinitions(config);

    const dashboardOptions = [];
    dashboardOptions.push(`<option value="">-- 연동 안 함 --</option>`);

    document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(itemSpan => {
        const id = itemSpan.dataset.id;
        const def = allDefinitions[id];
        if (def && def.isQuantity) {
            const title = itemSpan.textContent.trim();
            dashboardOptions.push(`<option value="${id}">${title}</option>`);
        }
    });

    if (quantityTasks.length === 0) {
        container.innerHTML = `<p class="text-sm text-gray-500 text-center">'처리량 집계 업무'에 항목을 먼저 추가해주세요.</p>`;
        return;
    }

    quantityTasks.forEach(taskName => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-4 mapping-row p-2 rounded hover:bg-gray-100';
        row.dataset.taskName = taskName;

        const currentSelection = mapping[taskName] || '';

        row.innerHTML = `
            <label class="w-1/3 font-semibold text-gray-700">${taskName}</label>
            <span class="text-gray-400">&rarr;</span>
            <select class="dashboard-mapping-select w-2.3 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm">
                ${dashboardOptions.join('')}
            </select>
        `;

        const select = row.querySelector('.dashboard-mapping-select');
        if (select) {
            select.value = currentSelection;
        }
        container.appendChild(row);
    });
}

export function populateTaskSelectModal(targetType) {
    const allTasks = getAllTaskNamesFromDOM();
    const listContainer = document.getElementById('select-task-list');
    const modalTitle = document.getElementById('select-task-modal-title');

    if (!listContainer || !modalTitle) return;

    listContainer.innerHTML = '';

    if (targetType === 'key') {
        modalTitle.textContent = "주요 업무로 추가할 업무 선택";
    } else if (targetType === 'quantity') {
        modalTitle.textContent = "처리량 집계 업무로 추가할 업무 선택";
    }

    if (allTasks.length === 0) {
        listContainer.innerHTML = '<p class="text-gray-500 col-span-full text-center">먼저 \'업무 관리\' 섹션에서 업무를 1개 이상 등록해주세요.</p>';
        return;
    }

    allTasks.sort((a, b) => a.localeCompare(b)).forEach(taskName => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'task-select-list-btn w-full text-left p-2 rounded-md border btn-secondary focus:ring-2 focus:ring-blue-300';
        button.textContent = taskName;
        button.dataset.taskName = taskName;
        listContainer.appendChild(button);
    });
}

export function openDashboardItemModal(fullConfig) {
    const listContainer = document.getElementById('select-dashboard-item-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const currentItemIds = new Set();
    document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(item => {
        currentItemIds.add(item.dataset.id);
    });

    const allDefinitions = getAllDashboardDefinitions(fullConfig);
    let hasItemsToAdd = false;

    Object.keys(allDefinitions).sort((a, b) => allDefinitions[a].title.localeCompare(allDefinitions[b].title)).forEach(id => {
        const itemDef = allDefinitions[id];
        const isAlreadyAdded = currentItemIds.has(id);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dashboard-item-select-btn w-full text-left p-2 rounded-md border focus:ring-2 focus:ring-blue-300';
        button.textContent = itemDef.title + (id.startsWith('custom-') ? ' (커스텀)' : '');
        button.dataset.id = id;

        if (isAlreadyAdded) {
            button.disabled = true;
            button.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-100', 'text-gray-500');
        } else {
            hasItemsToAdd = true;
            button.classList.add('btn-secondary');
        }
        listContainer.appendChild(button);
    });

    if (!hasItemsToAdd) {
        const noItemsMsg = document.createElement('p');
        noItemsMsg.className = 'text-gray-500 col-span-full text-center';
        noItemsMsg.textContent = '추가할 수 있는 항목이 없습니다.';
        listContainer.appendChild(noItemsMsg);
    }

    document.getElementById('select-dashboard-item-modal').classList.remove('hidden');
}