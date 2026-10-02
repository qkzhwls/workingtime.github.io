// === js/admin-ui.js ===
// 설명: 관리자 페이지의 UI 렌더링을 전담하는 모듈입니다. (다크모드 지원)

import { withBuiltinMenus } from './menu-catalog.js?v=202610021042';

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

export function getAllTaskNamesFromDOM() {
    const taskNames = new Set();
    document.querySelectorAll('#task-groups-container .task-name').forEach(input => {
        const taskName = input.value.trim();
        if (taskName) taskNames.add(taskName);
    });
    return Array.from(taskNames);
}

export function renderAdminUI(config) {
    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) wageInput.value = config.defaultPartTimerWage || 10000;

    const revenueUnitInput = document.getElementById('revenue-increment-unit');
    if (revenueUnitInput) revenueUnitInput.value = config.revenueIncrementUnit || 10000000;
    
    const workHoursInput = document.getElementById('standard-monthly-work-hours');
    if (workHoursInput) workHoursInput.value = config.standardMonthlyWorkHours || 209;

    renderTeamGroups(
        config.teamGroups || [],
        config.memberWages || {},
        config.memberEmails || {},
        config.memberRoles || {},
        config.memberLeaveSettings || {},
        config.memberRanks || {},
        config.resignedMembers || {}
    );

    renderResignedMembers(
        config.teamGroups || [],
        config.memberWages || {},
        config.memberEmails || {},
        config.memberRoles || {},
        config.memberLeaveSettings || {},
        config.memberRanks || {},
        config.resignedMembers || {}
    );

    renderSystemAccountsConfig(config.systemAccounts || []);
    renderPermissionsConfig(config);
    renderDashboardMenu(config.dashboardMenu || []);
    renderDashboardItemsConfig(config.dashboardItems || [], config);
    renderKeyTasks(config.keyTasks || []);
    renderTaskGroups(config.taskGroups || []);
    renderQuantityTasks(config.quantityTaskTypes || []);
    renderQuantityToDashboardMapping(config);
    renderCostAnalysisConfig(config);
}

export function renderPermissionsConfig(config) {
    const container = document.getElementById('permissions-container');
    if (!container) return;
    container.innerHTML = '';

    const allUsers = [];

    // 퇴사자는 목록에서 뺀다. 저장 시 admin-logic 이 이 명단을 기준으로
    // 접근을 전부 해제하므로, 여기서 빼는 것 = 그 사람의 접근 차단이다.
    const resigned = config.resignedMembers || {};
    const isResigned = (name) => Boolean(resigned[name]);

    (config.teamGroups || []).forEach(g => {
        (g.members || []).forEach(m => {
            if (isResigned(m)) return;
            const email = config.memberEmails?.[m] || '';
            if(email) allUsers.push({ name: m, email: email, type: '팀원' });
        });
    });
    
    (config.systemAccounts || []).forEach(acc => {
        if(acc.email) allUsers.push({ name: acc.name, email: acc.email, type: '시스템계정' });
    });

    const uniqueUsers = Array.from(new Map(allUsers.map(item => [item.email.toLowerCase(), item])).values());

    // 저장된 메뉴만 보면 그 뒤에 코드로 추가된 메뉴(중국제작 미발계산기 등)가 빠져
    // 권한을 아예 선택할 수 없다. 대시보드 사이드바와 같은 목록을 쓴다.
    const allMenus = [];
    withBuiltinMenus(config.dashboardMenu || []).forEach(cat => {
        (cat.items || []).forEach(item => {
            if (item && item.name && !allMenus.includes(item.name)) allMenus.push(item.name);
        });
    });

    uniqueUsers.forEach(user => {
        const emailLower = user.email.toLowerCase();
        const role = config.memberRoles?.[emailLower] || 'user';
        const access = config.memberMenuAccess?.[emailLower] || [];
        const isUser = role === 'user';
        
        const checkboxesHtml = allMenus.map(menuName => {
            const isNoAccessSet = !config.memberMenuAccess || !config.memberMenuAccess[emailLower];
            const checked = (isNoAccessSet || access.includes(menuName)) ? 'checked' : '';
            return `
                <label class="inline-flex items-center gap-1.5 mr-4 mb-2 cursor-pointer select-none">
                    <input type="checkbox" value="${menuName}" class="perm-menu-checkbox w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 bg-white dark:bg-gray-800" ${checked} ${!isUser ? 'disabled' : ''}>
                    <span class="text-xs font-bold text-gray-700 dark:text-gray-300">${menuName}</span>
                </label>
            `;
        }).join('');

        const row = document.createElement('div');
        row.className = 'permission-item p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm flex flex-col md:flex-row gap-4 md:items-center transition-colors';
        row.dataset.email = emailLower;

        row.innerHTML = `
            <div class="w-full md:w-1/4 flex flex-col gap-1 shrink-0">
                <span class="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-1">
                    ${user.name} 
                    <span class="text-[10px] font-normal bg-gray-100 dark:bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded">${user.type}</span>
                </span>
                <span class="text-xs text-gray-500 dark:text-gray-400">${user.email}</span>
            </div>
            <div class="w-full md:w-1/5 shrink-0">
                <label class="block text-[10px] text-gray-500 dark:text-gray-400 mb-1 font-bold">기본 권한</label>
                <select class="perm-role w-full p-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 rounded-md text-sm font-bold dark:text-white outline-none focus:border-blue-500 transition-colors">
                    <option value="user" ${role === 'user' ? 'selected' : ''}>일반</option>
                    <option value="admin" ${role === 'admin' ? 'selected' : ''}>관리자</option>
                </select>
            </div>
            <div class="w-full flex-1 perm-menu-list p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700 transition-opacity ${isUser ? '' : 'opacity-40 pointer-events-none'}">
                <div class="flex justify-between items-center mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                    <div class="text-[10px] font-bold text-gray-500 dark:text-gray-400">접근 허용 메뉴 (일반 권한 전용)</div>
                    <div class="flex gap-2">
                        <button type="button" class="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline select-all-menu-btn py-1 px-2 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">전체 체크</button>
                        <button type="button" class="text-[10px] font-bold text-red-600 dark:text-red-400 hover:underline deselect-all-menu-btn py-1 px-2 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">전체 해제</button>
                    </div>
                </div>
                <div class="flex flex-wrap pt-1">
                    ${checkboxesHtml}
                </div>
            </div>
        `;
        container.appendChild(row);
    });

    if (uniqueUsers.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">이메일이 등록된 계정이 없습니다.</p>';
    }
}

// 팀원 1명의 편집 카드 HTML. 활성 팀원(그룹 카드 내부)과 퇴사자 섹션에서 공용으로 사용.
// groupName은 data-group-name으로 심어, 저장 시 퇴사자를 원래 그룹으로 되돌리는 데 사용.
function buildMemberItemHtml(member, maps, groupName, opts = {}) {
    const { memberWages = {}, memberEmails = {}, memberRanks = {}, memberLeaveSettings = {}, resignedMembers = {} } = maps;
    const isResigned = !!opts.isResignedSection;
    const memberEmail = memberEmails[member] || '';
    const currentRank = memberRanks[member] || '사원';
    const settings = memberLeaveSettings[member] || {};
    const joinDate = settings.joinDate || '';
    const totalLeave = settings.totalLeave !== undefined ? settings.totalLeave : 15;
    const leaveResetDate = settings.leaveResetDate || '';
    const expirationDate = settings.expirationDate || '';
    const resignDate = resignedMembers[member] || '';
    const ranks = ['사원','주임','대리','과장','차장','부장','이사','상무','전무','사장','대표'];
    const rankOptions = ranks.map(r => `<option value="${r}" ${currentRank === r ? 'selected' : ''}>${r}</option>`).join('');

    const cardBg = isResigned
        ? 'border-gray-400 dark:border-gray-500 bg-gray-100/70 dark:bg-gray-900/50'
        : 'border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/30';

    const actionBtns = isResigned
        ? `<div class="flex flex-col gap-1.5">
                <button type="button" class="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 font-bold px-3 py-2 rounded-md transition reactivate-member-btn">↩️ 재직 복귀</button>
                <button type="button" class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-2 rounded-md transition delete-member-btn" title="과거 기록 계산에서 급여까지 완전히 제거됩니다.">완전 삭제</button>
           </div>`
        : `<button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-2 rounded-md transition delete-member-btn">삭제</button>`;

    const groupBadge = isResigned
        ? `<span class="text-[10px] font-bold text-white bg-gray-500 dark:bg-gray-600 rounded px-2 py-1 self-center" title="원래 소속 그룹">${groupName}</span>`
        : '';

    return `
    <div class="flex flex-col gap-3 mb-4 p-4 rounded-xl border ${cardBg} shadow-sm member-item transition-colors" data-group-name="${groupName}">
        <div class="flex flex-wrap md:flex-nowrap justify-between items-start gap-4">
            <div class="flex flex-wrap items-center gap-3 w-full md:w-auto">
                <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
                ${groupBadge}
                <div class="flex flex-col">
                    <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">이름</label>
                    <input type="text" value="${member}" class="member-name w-24 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm font-bold dark:text-white outline-none focus:border-blue-500" placeholder="이름">
                </div>
                <div class="flex flex-col">
                    <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">직급</label>
                    <select class="member-rank w-20 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm font-bold dark:text-white outline-none focus:border-blue-500">${rankOptions}</select>
                </div>
                <div class="flex flex-col">
                    <label class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">이메일</label>
                    <input type="email" value="${memberEmail}" class="member-email w-48 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white outline-none focus:border-blue-500" placeholder="email">
                </div>
                <div class="flex flex-col">
                    <label class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">기본급 (월)</label>
                    <input type="number" value="${memberWages[member] || 0}" class="member-wage w-28 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white outline-none focus:border-blue-500" placeholder="월 기본급"
                        oninput="const h=this.closest('.flex.flex-col').nextElementSibling && this.closest('.flex.flex-col').nextElementSibling.querySelector('.member-hourly'); if(h) h.value=Math.round((Number(this.value)||0)/209).toLocaleString();">
                </div>
                <div class="flex flex-col">
                    <label class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">시급 (자동 ÷209)</label>
                    <input type="text" value="${Math.round((Number(memberWages[member]) || 0) / 209).toLocaleString()}" class="member-hourly w-24 p-2 border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 rounded-md text-sm text-gray-500 dark:text-gray-400 outline-none cursor-not-allowed" readonly tabindex="-1" title="기본급 ÷ 209 (자동 계산, 수정 불가)">
                </div>
            </div>
            ${actionBtns}
        </div>

        <div class="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <span class="text-xs font-bold text-blue-600 dark:text-blue-400 w-full md:w-auto mb-2 md:mb-0">🏖️ 연차 설정</span>
            <div class="flex flex-col">
                <label class="text-[9px] text-blue-600 dark:text-blue-400 mb-1">입사일자</label>
                <input type="date" value="${joinDate}" class="member-join-date w-32 p-1.5 border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 rounded text-xs dark:text-gray-200 outline-none">
            </div>
            <div class="flex flex-col">
                <label class="text-[9px] text-blue-600 dark:text-blue-400 mb-1">총연차(일)</label>
                <input type="number" value="${totalLeave}" class="member-total-leave w-16 p-1.5 border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 rounded text-xs text-center dark:text-gray-200 outline-none" min="0">
            </div>
            <div class="hidden md:block w-px h-8 bg-gray-300 dark:bg-gray-600 mx-2"></div>
            <div class="flex flex-col">
                <label class="text-[9px] text-gray-500 dark:text-gray-400 mb-1 font-bold">적용 시작일</label>
                <input type="date" value="${leaveResetDate}" class="member-leave-reset-date w-32 p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded text-xs font-bold text-gray-700 dark:text-gray-200 outline-none">
            </div>
            <div class="flex flex-col">
                <label class="text-[9px] text-red-500 dark:text-red-400 mb-1 font-bold">사용 만료일</label>
                <input type="date" value="${expirationDate}" class="member-leave-expiration-date w-32 p-1.5 border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 rounded text-xs text-red-700 dark:text-red-400 outline-none">
            </div>
            <div class="hidden md:block w-px h-8 bg-gray-300 dark:bg-gray-600 mx-2"></div>
            <div class="flex flex-col">
                <label class="text-[9px] text-gray-700 dark:text-gray-300 mb-1 font-bold">🚪 퇴사일 (비활성)</label>
                <input type="date" value="${resignDate}" class="member-resign-date w-32 p-1.5 border border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-800 rounded text-xs font-bold text-gray-800 dark:text-gray-100 outline-none" title="입력하면 이 날짜 다음날부터 팀 선택·명단·집계에서 제외되고, 저장 시 아래 '퇴사자' 섹션으로 이동합니다. 급여·과거기록은 그대로 보존됩니다. 비우면 재직으로 복귀합니다.">
            </div>
        </div>
    </div>
    `;
}

export function renderTeamGroups(teamGroups, memberWages, memberEmails, memberRoles, memberLeaveSettings = {}, memberRanks = {}, resignedMembers = {}) {
    const container = document.getElementById('team-groups-container');
    if (!container) return;
    container.innerHTML = '';
    const maps = { memberWages, memberEmails, memberRanks, memberLeaveSettings, resignedMembers };

    teamGroups.forEach((group, index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'p-5 border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 shadow-sm team-group-card transition-colors';
        groupEl.dataset.index = index;

        // 그룹 카드에는 '재직 중'(퇴사일 미지정) 팀원만 표시. 퇴사자는 하단 별도 섹션으로.
        const activeMembers = [...new Set(group.members)].filter(m => !resignedMembers[m]);
        const membersHtml = activeMembers.map(member => buildMemberItemHtml(member, maps, group.name)).join('');

        groupEl.innerHTML = `
            <div class="flex justify-between items-center mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
                <div class="flex items-center gap-2">
                    <span class="drag-handle mr-2 cursor-move text-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" draggable="true">☰</span> 
                    <input type="text" value="${group.name}" class="text-lg font-extrabold text-gray-800 dark:text-white team-group-name w-auto bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 p-1 outline-none">
                </div>
                <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-1.5 rounded-md transition delete-team-group-btn">그룹 삭제</button>
            </div>
            <div class="space-y-3 members-container">${membersHtml}</div>
            
            <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-center">
                <button class="text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-lg transition w-full md:w-auto shadow-sm add-member-btn">+ 팀원 추가</button>
            </div>
        `;
        container.appendChild(groupEl);
    });
}

// 🚪 퇴사자 별도 섹션 렌더. teamGroups 전체에서 resignedMembers에 있는 사람만 원 그룹과 함께 표시.
export function renderResignedMembers(teamGroups, memberWages, memberEmails, memberRoles, memberLeaveSettings = {}, memberRanks = {}, resignedMembers = {}) {
    const section = document.getElementById('resigned-members-section');
    const container = document.getElementById('resigned-members-container');
    const countEl = document.getElementById('resigned-count');
    if (!container) return;
    container.innerHTML = '';
    const maps = { memberWages, memberEmails, memberRanks, memberLeaveSettings, resignedMembers };

    const rows = [];
    (teamGroups || []).forEach(group => {
        [...new Set(group.members || [])].forEach(member => {
            if (resignedMembers[member]) rows.push({ member, groupName: group.name });
        });
    });
    // 퇴사일 늦은 순
    rows.sort((a, b) => (resignedMembers[b.member] || '').localeCompare(resignedMembers[a.member] || ''));

    if (rows.length === 0) {
        if (section) section.classList.add('hidden');
        if (countEl) countEl.textContent = '';
        return;
    }
    if (section) section.classList.remove('hidden');
    if (countEl) countEl.textContent = `(${rows.length}명)`;
    container.innerHTML = rows.map(r => buildMemberItemHtml(r.member, maps, r.groupName, { isResignedSection: true })).join('');
}

// 💡 시스템 전용 계정 렌더링 함수도 하드코딩된 컨테이너에 내용만 채우도록 간소화됨
export function renderSystemAccountsConfig(accounts) {
    let container = document.getElementById('system-accounts-container');
    if (!container) return;
    
    container.innerHTML = '';

    accounts.forEach(acc => {
        const item = document.createElement('div');
        item.className = 'system-account-item flex flex-wrap md:flex-nowrap items-end gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 transition-colors';
        item.innerHTML = `
            <div class="flex flex-col flex-1 min-w-[150px]">
                <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">계정 이름 (별칭)</label>
                <input type="text" value="${acc.name || ''}" class="sys-name p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm font-bold dark:text-white outline-none focus:border-blue-500" placeholder="예: 외부 관리자">
            </div>
            <div class="flex flex-col flex-1 min-w-[200px]">
                <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">이메일 (로그인 ID)</label>
                <input type="email" value="${acc.email || ''}" class="sys-email p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white outline-none focus:border-blue-500" placeholder="admin@example.com">
            </div>
            <button type="button" class="delete-sys-account-btn w-full md:w-auto text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-4 py-2.5 rounded-md md:h-[38px] transition-colors shadow-sm">삭제</button>
        `;
        container.appendChild(item);
    });
}

export function renderCostAnalysisConfig(config) {
    const materialInput = document.getElementById('fixed-material-cost');
    if (materialInput) materialInput.value = config.fixedMaterialCost || 0;
    
    const shippingInput = document.getElementById('fixed-shipping-cost');
    if (shippingInput) shippingInput.value = config.fixedShippingCost || 0;
    
    const directDeliveryInput = document.getElementById('fixed-direct-delivery-cost');
    if (directDeliveryInput) directDeliveryInput.value = config.fixedDirectDeliveryCost || 0;

    const container = document.getElementById('cost-calc-tasks-container');
    if (container) {
        container.innerHTML = '';
        
        const allTasks = new Set();
        (config.taskGroups || []).forEach(group => {
            (group.tasks || []).forEach(task => allTasks.add(task));
        });

        const savedTasks = new Set(config.costCalcTasks || []);

        if (allTasks.size === 0) {
             container.innerHTML = '<p class="text-xs text-gray-400 dark:text-gray-500 col-span-full text-center py-4">등록된 업무가 없습니다.</p>';
        } else {
            Array.from(allTasks).sort().forEach(taskName => {
                const isChecked = savedTasks.has(taskName) ? 'checked' : '';
                const div = document.createElement('div');
                div.className = 'flex items-center p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:border-purple-300 dark:hover:border-purple-500 transition-colors';
                div.innerHTML = `
                    <input type="checkbox" id="cost-task-${taskName}" value="${taskName}" class="cost-calc-task-checkbox w-4 h-4 text-purple-600 border-gray-300 dark:border-gray-600 rounded focus:ring-purple-500 bg-gray-50 dark:bg-gray-900" ${isChecked}>
                    <label for="cost-task-${taskName}" class="ml-2 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer select-none flex-grow">${taskName}</label>
                `;
                container.appendChild(div);
            });
        }
    }
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
        const bgClass = isQuantity ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-400' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300';
        
        itemEl.className = `flex items-center gap-3 p-3 rounded-lg border ${bgClass} shadow-sm dashboard-item-config group transition-colors`;
        itemEl.dataset.index = index;

        let itemHtml = `
            <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
            <span class="dashboard-item-name flex-grow font-bold text-sm" data-id="${id}">
                ${isQuantity ? '📦 ' : ''}${itemDef.title}
            </span>
        `;
        itemHtml += `<button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-dashboard-item-btn opacity-0 group-hover:opacity-100" data-id="${id}">삭제</button>`;
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
        taskEl.className = 'flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm key-task-item group transition-colors';
        taskEl.dataset.index = index;
        taskEl.innerHTML = `
            <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span> 
            <span class="flex-grow font-bold text-sm text-gray-700 dark:text-gray-300">⭐ <span class="key-task-name">${task}</span></span>
            <button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-key-task-btn opacity-0 group-hover:opacity-100" data-index="${index}">삭제</button>
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
        groupEl.className = 'p-5 border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 shadow-sm task-group-card transition-colors';
        groupEl.dataset.index = index;

        const tasksHtml = (group.tasks || []).map((task, tIndex) => `
            <div class="flex items-center justify-between p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-500 transition-colors task-item group shadow-sm">
                <div class="flex items-center gap-2 flex-grow">
                    <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
                    <input type="text" value="${task}" class="task-name flex-grow p-1.5 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 text-sm font-semibold dark:text-white outline-none">
                </div>
                <button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-task-btn opacity-0 group-hover:opacity-100" data-t-index="${tIndex}">삭제</button>
            </div>
        `).join('');

        groupEl.innerHTML = `
             <div class="flex justify-between items-center mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
                <div class="flex items-center gap-2"> 
                   <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move text-lg" draggable="true">☰</span>
                   <input type="text" value="${group.name}" class="text-lg font-extrabold text-gray-800 dark:text-white task-group-name w-auto bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 p-1 outline-none">
                 </div>
                <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-1.5 rounded-md transition delete-task-group-btn">그룹 삭제</button>
            </div>
            
            <div class="space-y-2 tasks-container grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">${tasksHtml}</div>
            
            <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <button class="text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-lg transition shadow-sm add-task-btn">+ 업무 추가</button>
            </div>
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
        taskEl.className = 'flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm quantity-task-item group transition-colors';
        taskEl.dataset.index = index;
        taskEl.innerHTML = `
            <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span> 
            <span class="flex-grow font-bold text-sm text-gray-700 dark:text-gray-300">📝 <span class="quantity-task-name">${task}</span></span>
            <button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-quantity-task-btn opacity-0 group-hover:opacity-100" data-index="${index}">삭제</button>
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
            const title = itemSpan.textContent.trim().replace('📦 ', '');
            dashboardOptions.push(`<option value="${id}">${title}</option>`);
        }
    });

    if (quantityTasks.length === 0) {
        container.innerHTML = `<p class="text-sm text-gray-500 dark:text-gray-400 text-center py-4">'처리량 집계 업무'에 항목을 먼저 추가해주세요.</p>`;
        return;
    }

    quantityTasks.forEach(taskName => {
        const row = document.createElement('div');
        row.className = 'flex flex-wrap md:flex-nowrap items-center gap-4 mapping-row p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 transition-colors';
        row.dataset.taskName = taskName;

        const currentSelection = mapping[taskName] || '';

        row.innerHTML = `
            <label class="w-full md:w-1/3 font-extrabold text-sm text-gray-700 dark:text-gray-200 break-all">${taskName}</label>
            <span class="hidden md:inline text-gray-400">➡️</span>
            <select class="dashboard-mapping-select flex-grow p-2.5 border border-blue-200 dark:border-blue-800 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-400 font-bold outline-none transition-colors w-full md:w-auto">
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
        modalTitle.textContent = "메인 보드에 고정할 업무 선택";
    } else if (targetType === 'quantity') {
        modalTitle.textContent = "처리량을 입력받을 업무 선택";
    }

    if (allTasks.length === 0) {
        listContainer.innerHTML = '<p class="text-gray-500 dark:text-gray-400 col-span-full text-center py-8">먼저 \'업무 등록 관리\' 섹션에서 업무를 1개 이상 생성해주세요.</p>';
        return;
    }

    allTasks.sort((a, b) => a.localeCompare(b)).forEach(taskName => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'task-select-list-btn w-full text-left p-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-500 transition-colors font-bold text-gray-700 dark:text-gray-200 text-sm shadow-sm';
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
        button.className = 'dashboard-item-select-btn w-full text-left p-3 rounded-xl border transition-colors font-bold text-sm shadow-sm';
        button.textContent = itemDef.title + (id.startsWith('custom-') ? ' (커스텀)' : '');
        button.dataset.id = id;

        if (isAlreadyAdded) {
            button.disabled = true;
            button.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-100', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700', 'text-gray-400', 'dark:text-gray-500');
        } else {
            hasItemsToAdd = true;
            button.classList.add('bg-blue-50', 'dark:bg-blue-900/20', 'border-blue-200', 'dark:border-blue-800', 'text-blue-700', 'dark:text-blue-400', 'hover:bg-blue-100', 'dark:hover:bg-blue-900/40');
        }
        listContainer.appendChild(button);
    });

    if (!hasItemsToAdd) {
        const noItemsMsg = document.createElement('p');
        noItemsMsg.className = 'text-gray-500 dark:text-gray-400 col-span-full text-center py-4';
        noItemsMsg.textContent = '모든 항목이 이미 위젯에 등록되어 있습니다.';
        listContainer.appendChild(noItemsMsg);
    }

    document.getElementById('select-dashboard-item-modal').classList.remove('hidden');
}

export function renderDashboardMenu(menuConfig) {
    const container = document.getElementById('menu-categories-container');
    if (!container) return;
    container.innerHTML = '';

    (menuConfig || []).forEach((menuGroup, index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'p-5 border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 shadow-sm menu-category-card transition-colors drop-zone';
        groupEl.dataset.index = index;

        const itemsHtml = (menuGroup.items || []).map((item, iIndex) => `
            <div class="flex items-center justify-between p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:border-blue-300 dark:hover:border-blue-500 transition-colors menu-item group shadow-sm">
                <div class="flex items-center gap-3 flex-grow">
                    <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
                    <input type="text" value="${item.name}" class="menu-item-name flex-grow p-1.5 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 text-sm font-semibold dark:text-white outline-none" placeholder="소분류 이름">
                    <input type="text" value="${item.link || ''}" class="menu-item-link w-1/3 p-1.5 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 text-xs text-gray-500 dark:text-gray-400 outline-none" placeholder="연결 링크 (예: index.html)">
                </div>
                <button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-menu-item-btn opacity-0 group-hover:opacity-100" type="button">삭제</button>
            </div>
        `).join('');

        groupEl.innerHTML = `
             <div class="flex justify-between items-center mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
                <div class="flex items-center gap-2"> 
                   <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move text-lg" draggable="true">☰</span>
                   <input type="text" value="${menuGroup.category}" class="text-lg font-extrabold text-gray-800 dark:text-white menu-category-name w-auto bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 p-1 outline-none" placeholder="대분류 이름">
                 </div>
                <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-1.5 rounded-md transition delete-menu-category-btn" type="button">대분류 삭제</button>
            </div>
            
            <div class="space-y-2 menu-items-container min-h-[60px] p-2 -mx-2 rounded-lg border-2 border-transparent border-dashed hover:border-gray-300 dark:hover:border-gray-600 transition-colors">${itemsHtml}</div>
            
            <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <button class="text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-lg transition shadow-sm add-menu-item-btn" type="button">+ 소분류 추가</button>
            </div>
        `;
        container.appendChild(groupEl);
    });
}