// === js/ui-main-dashboard.js ===
import { getAllDashboardDefinitions } from './ui.js';
import * as State from './state.js';

export let currentEzadminData = null;

export const renderNoticeWidget = (appState) => {
    const memoList = document.getElementById('widget-memo-list');
    if (!memoList) return;

    const notices = appState.importantNotices || [];
    
    if (notices.length === 0) {
        memoList.innerHTML = `<li class="text-yellow-700/60 dark:text-yellow-500/60 list-none -ml-4 text-center text-xs py-4 font-normal">등록된 중요 알림이 없습니다.</li>`;
        return;
    }

    let html = '';
    notices.forEach(notice => {
        const textClass = notice.completed ? 'line-through text-yellow-700/50 dark:text-yellow-500/50' : 'text-yellow-900 dark:text-yellow-200 font-bold';
        const icon = notice.completed ? '✅' : '📌';
        
        const safeText = notice.text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');
        
        const mentionStyle = '<span class="inline-block bg-indigo-100/80 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700/50 rounded-md px-1.5 py-0 text-[10px] font-black mx-1 align-middle shadow-sm leading-tight">@$1</span>';
        const highlightedText = safeText.replace(/@([가-힣a-zA-Z0-9]+)/g, mentionStyle);
        
        html += `<li class="${textClass} list-none -ml-4 flex items-start gap-2 mb-1.5"><span class="shrink-0 text-sm mt-0.5">${icon}</span> <span class="leading-snug break-words flex-1">${highlightedText}</span></li>`;
    });
    memoList.innerHTML = html;
};

export const updateEzadminDisplay = () => {
    const ezData = currentEzadminData;
    if (!ezData) return;

    const invoiceEl = document.getElementById('ezadmin-invoice-count');
    const deliveryEl = document.getElementById('ezadmin-delivery-count');

    if (invoiceEl && ezData.invoice !== undefined) {
        invoiceEl.textContent = ezData.invoice.toLocaleString();
    }
    if (deliveryEl && ezData.delivery !== undefined) {
        deliveryEl.textContent = ezData.delivery.toLocaleString();
    }
};

export const renderDashboardLayout = (appConfig) => {
    const personnelContainer = document.getElementById('summary-personnel');
    const workloadContainer = document.getElementById('summary-workload');
    
    if (!personnelContainer && !workloadContainer) return;

    const itemIds = appConfig.dashboardItems || [];
    const allDefinitions = getAllDashboardDefinitions(appConfig);

    let personnelHtml = '';
    let workloadHtml = '';

    itemIds.forEach(id => {
        const def = allDefinitions[id];
        if (!def) return;

        const isQuantity = def.isQuantity === true;
        const safeTitle = def.title.replace(/ /g, '&nbsp;'); 

        if (isQuantity) {
            workloadHtml += `
                <div class="flex justify-between items-center py-2 border-b border-blue-50 dark:border-blue-900/50 last:border-0 hover:bg-blue-50/50 dark:hover:bg-blue-900/30 transition-colors px-2 rounded gap-2 overflow-hidden">
                    <span class="text-sm font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap shrink-0 break-keep tracking-tight">${safeTitle}</span>
                    <span id="${def.valueId}" class="text-sm font-extrabold text-blue-700 dark:text-blue-300 bg-white dark:bg-gray-800 px-2 py-0.5 rounded-md shadow-sm border border-blue-100 dark:border-blue-800 transition-all shrink-0">0</span>
                </div>
            `;
        } else {
            personnelHtml += `
                <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors px-2 rounded gap-2 overflow-hidden">
                    <span class="text-sm font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap shrink-0 break-keep tracking-tight">${safeTitle}</span>
                    <span id="${def.valueId}" class="text-sm font-extrabold text-gray-800 dark:text-gray-200 transition-all shrink-0">0</span>
                </div>
            `;
        }
    });

    const ezInvoice = (currentEzadminData && currentEzadminData.invoice) || 0;
    const ezDelivery = (currentEzadminData && currentEzadminData.delivery) || 0;

    workloadHtml += `
        <div class="mt-4 p-3 border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 rounded-xl shadow-sm">
            <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-2.5 flex items-center gap-1">
                <span>🚚</span> 이지어드민 연동
            </div>
            <div class="flex gap-2">
                <div class="flex-1 flex justify-between items-center bg-orange-50 dark:bg-orange-900/20 px-2.5 py-2 rounded-lg border border-orange-100 dark:border-orange-800/50 transition-colors shadow-sm">
                    <span class="text-xs font-extrabold text-orange-600 dark:text-orange-400 break-keep">송장</span>
                    <span id="ezadmin-invoice-count" class="text-sm font-black text-orange-700 dark:text-orange-300 transition-all duration-300">${ezInvoice.toLocaleString()}</span>
                </div>
                <div class="flex-1 flex justify-between items-center bg-purple-50 dark:bg-purple-900/20 px-2.5 py-2 rounded-lg border border-purple-100 dark:border-purple-800/50 transition-colors shadow-sm">
                    <span class="text-xs font-extrabold text-purple-600 dark:text-purple-400 break-keep">배송</span>
                    <span id="ezadmin-delivery-count" class="text-sm font-black text-purple-700 dark:text-purple-300 transition-all duration-300">${ezDelivery.toLocaleString()}</span>
                </div>
            </div>
        </div>
    `;

    if (personnelContainer) personnelContainer.innerHTML = personnelHtml;
    if (workloadContainer) workloadContainer.innerHTML = workloadHtml;
};

export const updateSummary = (appState, appConfig) => {
    const allDefinitions = getAllDashboardDefinitions(appConfig);
    const elements = {};
    Object.keys(allDefinitions).forEach(id => {
        const def = allDefinitions[id];
        if (def && def.valueId) {
            elements[id] = document.getElementById(def.valueId);
        }
    });

    const teamGroups = appConfig.teamGroups || [];
    const allStaffMembers = new Set(teamGroups.flatMap(g => g.members));
    const allPartTimers = new Set((appState.partTimers || []).map(p => p.name));
    const totalStaffCount = allStaffMembers.size;
    const totalPartTimerCount = allPartTimers.size;

    const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
    const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
    const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];

    const onLeaveMemberNames = new Set(
        combinedOnLeaveMembers
            .filter(item => {
                if (item.type === '외출' && item.endTime) return false;
                if (item.type === '지각') return false;
                return allStaffMembers.has(item.member) || allPartTimers.has(item.member);
            })
            .map(item => item.member)
    );
    const onLeaveTotalCount = onLeaveMemberNames.size;

    const attendanceMap = appState.dailyAttendance || {};
    const currentlyClockedIn = new Set(
        Object.keys(attendanceMap).filter(member => 
            attendanceMap[member].status === 'active' && !onLeaveMemberNames.has(member)
        )
    );

    const availableStaffCount = [...currentlyClockedIn].filter(member => allStaffMembers.has(member)).length;
    const availablePartTimerCount = [...currentlyClockedIn].filter(member => allPartTimers.has(member)).length;

    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' && !onLeaveMemberNames.has(r.member));
    const pausedRecords = (appState.workRecords || []).filter(r => r.status === 'paused' && !onLeaveMemberNames.has(r.member));
    
    const ongoingMembers = new Set(ongoingRecords.map(r => r.member));
    const pausedMembers = new Set(pausedRecords.map(r => r.member));

    const totalWorkingCount = ongoingMembers.size;
    
    const pausedStaffCount = [...pausedMembers].filter(member => allStaffMembers.has(member)).length;
    const pausedPartTimerCount = [...pausedMembers].filter(member => allPartTimers.has(member)).length;
    
    const workingStaffCount = [...ongoingMembers].filter(member => allStaffMembers.has(member)).length;
    const workingPartTimerCount = [...ongoingMembers].filter(member => allPartTimers.has(member)).length;

    const idleStaffCount = Math.max(0, availableStaffCount - workingStaffCount - pausedStaffCount);
    const idlePartTimerCount = Math.max(0, availablePartTimerCount - workingPartTimerCount - pausedPartTimerCount);
    
    const totalIdleCount = idleStaffCount + idlePartTimerCount;

    const ongoingOrPausedRecords = (appState.workRecords || []).filter(r => (r.status === 'ongoing' || r.status === 'paused') && !onLeaveMemberNames.has(r.member));
    const ongoingTaskCount = new Set(ongoingOrPausedRecords.map(r => r.task)).size;

    if (elements['total-staff']) elements['total-staff'].textContent = `${totalStaffCount}/${totalPartTimerCount}`;
    if (elements['leave-staff']) elements['leave-staff'].textContent = `${onLeaveTotalCount}`;
    if (elements['active-staff']) elements['active-staff'].textContent = `${availableStaffCount}/${availablePartTimerCount}`;
    if (elements['working-staff']) elements['working-staff'].textContent = `${totalWorkingCount}`;
    if (elements['idle-staff']) elements['idle-staff'].textContent = `${totalIdleCount}`;
    if (elements['ongoing-tasks']) elements['ongoing-tasks'].textContent = `${ongoingTaskCount}`;

    const quantitiesFromState = appState.taskQuantities || {};
    const quantityStatuses = appState.taskQuantityStatuses || {};
    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};
    
    for (const task in quantitiesFromState) {
        const quantity = quantitiesFromState[task] || 0;
        const targetDashboardId = taskNameToDashboardIdMap[task];

        if (targetDashboardId && elements[targetDashboardId]) {
            const el = elements[targetDashboardId];
            el.textContent = quantity;

            el.classList.remove('quantity-estimated', 'quantity-confirmed', 'text-red-500', 'text-green-500');

            const status = quantityStatuses[task];
            if (status === 'estimated') {
                el.classList.add('text-red-500'); 
            } else if (status === 'confirmed') {
                el.classList.add('text-green-500'); 
            }
        }
    }

    updateEzadminDisplay();
    renderNoticeWidget(appState);
};

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'EZADMIN_DATA_UPDATE') {
        const ezData = event.data.data;
        currentEzadminData = ezData; 

        const invoiceEl = document.getElementById('ezadmin-invoice-count');
        const deliveryEl = document.getElementById('ezadmin-delivery-count');
        
        if (invoiceEl && ezData.invoice !== undefined) {
            invoiceEl.textContent = ezData.invoice.toLocaleString();
            invoiceEl.classList.add('scale-125', 'text-orange-500');
            setTimeout(() => invoiceEl.classList.remove('scale-125', 'text-orange-500'), 500);
        }
        if (deliveryEl && ezData.delivery !== undefined) {
            deliveryEl.textContent = ezData.delivery.toLocaleString();
            deliveryEl.classList.add('scale-125', 'text-purple-500');
            setTimeout(() => deliveryEl.classList.remove('scale-125', 'text-purple-500'), 500);
        }
    }
});

// 사이드바 동적 필터링 및 재배치 (매뉴얼 새 창 열기 포함)
export const applyDynamicSidebar = (appConfig) => {
    if (!appConfig || !appConfig.dashboardMenu) return;

    const pcNav = document.querySelector('aside nav');
    const mobileNav = document.getElementById('nav-content');
    if (!pcNav && !mobileNav) return;

    const currentUserEmail = State.auth.currentUser?.email?.toLowerCase() || '';
    const currentUserRole = State.appState.currentUserRole;
    
    let allowedMenus = null; 
    if (currentUserRole !== 'admin') {
        allowedMenus = appConfig.memberMenuAccess?.[currentUserEmail] || [];
    }

    const pcElements = {};
    if (pcNav) {
        pcNav.querySelectorAll('button, a').forEach(el => {
            const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
            const name = textNode ? textNode.textContent.trim() : el.textContent.trim();
            if (name) pcElements[name] = el;
        });
        pcNav.innerHTML = '';
    }

    const mobileElements = {};
    let mobileHeader = null;
    let logoutBtn = null;
    
    if (mobileNav) {
        mobileHeader = mobileNav.firstElementChild; 
        logoutBtn = document.getElementById('logout-btn-mobile');
        
        mobileNav.querySelectorAll('button, a, div').forEach(el => {
            if (el.id === 'logout-btn-mobile' || el === mobileHeader || (mobileHeader && mobileHeader.contains(el))) return;
            if (el.tagName !== 'BUTTON' && el.tagName !== 'A') return;
            
            const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
            const name = textNode ? textNode.textContent.trim() : el.textContent.trim();
            if (name) mobileElements[name] = el;
        });

        Array.from(mobileNav.children).forEach(child => {
            if (child !== mobileHeader && child !== logoutBtn) {
                mobileNav.removeChild(child);
            }
        });
    }

    appConfig.dashboardMenu.forEach((group, index) => {
        const visibleItems = group.items.filter(item => {
            if (allowedMenus === null) return true; 
            return allowedMenus.includes(item.name);
        });

        if (visibleItems.length === 0) return;

        if (pcNav) {
            const pcCat = document.createElement('div');
            pcCat.className = `text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 px-2 ${index > 0 ? 'mt-6' : ''}`;
            pcCat.textContent = group.category;
            pcNav.appendChild(pcCat);
        }

        if (mobileNav) {
            const mobCat = document.createElement('div');
            mobCat.className = `px-5 py-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase ${index > 0 ? 'mt-2' : ''}`;
            mobCat.textContent = group.category;
            if (logoutBtn) mobileNav.insertBefore(mobCat, logoutBtn);
            else mobileNav.appendChild(mobCat);
        }

        visibleItems.forEach(item => {
            // ✨ 신규: 해당 메뉴가 매뉴얼(manual.html)인지 판단
            const isManualLink = item.link && item.link.includes('manual.html');

            if (pcNav) {
                const pcEl = pcElements[item.name];
                if (pcEl) {
                    if (pcEl.tagName === 'A' && item.link && item.link !== '#') {
                        pcEl.href = item.link;
                        if(isManualLink) pcEl.target = '_blank'; // 새 탭
                    }
                    pcNav.appendChild(pcEl);
                } else {
                    const newPc = document.createElement('a');
                    newPc.href = item.link || '#';
                    if(isManualLink) newPc.target = '_blank'; // 새 탭
                    newPc.className = "w-full flex items-center gap-3 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 px-4 py-3 rounded-xl font-medium transition";
                    newPc.innerHTML = `<span class="text-lg">🔗</span> ${item.name}`;
                    pcNav.appendChild(newPc);
                }
            }

            if (mobileNav) {
                const mobEl = mobileElements[item.name];
                if (mobEl) {
                    if (mobEl.tagName === 'A' && item.link && item.link !== '#') {
                        mobEl.href = item.link;
                        if(isManualLink) mobEl.target = '_blank'; // 새 탭
                    }
                    if (logoutBtn) mobileNav.insertBefore(mobEl, logoutBtn);
                    else mobileNav.appendChild(mobEl);
                } else {
                    const newMob = document.createElement('a');
                    newMob.href = item.link || '#';
                    if(isManualLink) newMob.target = '_blank'; // 새 탭
                    newMob.className = "text-left px-5 py-4 border-b dark:border-gray-700 text-sm font-medium dark:text-gray-200 flex items-center gap-2";
                    newMob.innerHTML = `<span class="text-lg">🔗</span> ${item.name}`;
                    if (logoutBtn) mobileNav.insertBefore(newMob, logoutBtn);
                    else mobileNav.appendChild(newMob);
                }
            }
        });
    });
};