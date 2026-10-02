// === js/ui-history-personal.js ===
// 설명: '개인 리포트' 탭의 데이터 집계 및 렌더링 로직을 담당합니다.

import { formatDuration, getWeekOfYear, formatTimeTo24H, isWeekday, toDateString } from './utils.js?v=202610021042';
import { appConfig, context, LEAVE_TYPES, db, leaveTypeLabel } from './state.js?v=202610021042';
import { computeMonthlySalary, outingDeductibleMinutes, earlyLeaveDeductibleMinutes } from './lib/calc.js?v=202610021042';
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 급여 차감 기준 근무시간 (가정값 — 회사 규정에 맞게 조정 가능)
const WORK_END_MIN = 18 * 60;                                   // 종업 18:00
const LUNCH_START_MIN = 12 * 60 + 30, LUNCH_END_MIN = 13 * 60 + 30; // 점심 12:30~13:30
const _toMin = (hhmm) => { if (!hhmm) return null; const p = String(hhmm).split(':'); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); };
const _lunchOpts = { lunchStart: LUNCH_START_MIN, lunchEnd: LUNCH_END_MIN };

// 주말근무 급여: 확정 1회당 지급액 (주말 정산과 동일 기준)
const WEEKEND_PAY_PER_SHIFT = 110000;

// 확정된 주말근무를 연도 단위로 캐싱 (멤버별 근무일자 목록)
let _weekendCache = { year: null, byMember: new Map() };

// 개인 리포트 렌더 전에 호출 — 해당 연도의 확정 주말근무를 로드해 급여에 반영한다.
export async function preloadWeekendPay(year) {
    year = String(year || '').slice(0, 4);
    if (!year || _weekendCache.year === year) return; // 미지정/캐시 히트
    const byMember = new Map();
    try {
        const colRef = collection(db, 'artifacts', 'team-work-logger-v2', 'weekend_requests');
        const q = query(colRef, where('date', '>=', `${year}-01-01`), where('date', '<=', `${year}-12-31`));
        const snap = await getDocs(q);
        snap.forEach(docSnap => {
            const d = docSnap.data();
            if (d.status === 'confirmed' && d.member && d.date) {
                if (!byMember.has(d.member)) byMember.set(d.member, []);
                byMember.get(d.member).push(d.date);
            }
        });
        _weekendCache = { year, byMember };
    } catch (e) {
        console.error('주말근무 급여 데이터 로드 실패:', e);
        _weekendCache = { year, byMember: new Map() }; // 실패해도 캐시로 두어 반복 조회 방지
    }
}

// --- 헬퍼: 정렬 아이콘 생성 ---
const getSortIcon = (currentKey, currentDir, targetKey) => {
    if (currentKey !== targetKey) return '<span class="text-gray-300 text-[10px] ml-1 opacity-0 group-hover:opacity-50">↕</span>';
    return currentDir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

// --- 헬퍼: 필터 드롭다운 UI 생성 ---
const getFilterDropdown = (target, key, currentFilterValue, options = []) => {
    const dropdownId = `${target}-${key}`;
    const isActive = context.activeFilterDropdown === dropdownId;
    const hasValue = currentFilterValue && currentFilterValue !== '';
    const iconColorClass = hasValue ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-200';

    let inputHtml = '';
    if (options && options.length > 0) {
        const optionsHtml = options.map(opt => 
            `<option value="${opt}" ${currentFilterValue === opt ? 'selected' : ''}>${opt}</option>`
        ).join('');
        inputHtml = `<select class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none cursor-pointer" data-filter-target="${target}" data-filter-key="${key}"><option value="">(전체)</option>${optionsHtml}</select>`;
    } else {
        inputHtml = `<input type="text" class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" placeholder="검색..." value="${currentFilterValue || ''}" data-filter-target="${target}" data-filter-key="${key}" autocomplete="off">`;
    }

    return `
        <div class="relative inline-block ml-1 filter-container">
            <button type="button" class="filter-icon-btn p-1 rounded transition ${iconColorClass}" data-dropdown-id="${dropdownId}" title="필터">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clip-rule="evenodd" /></svg>
            </button>
            <div class="filter-dropdown absolute top-full right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-[60] p-3 ${isActive ? 'block' : 'hidden'} text-left cursor-default">
                <div class="text-xs font-bold text-gray-500 mb-2 flex justify-between items-center">
                    <span>필터 조건</span>
                    ${hasValue ? `<button class="text-[10px] text-red-500 hover:underline" onclick="const i=this.closest('.filter-dropdown').querySelector('input,select'); i.value=''; i.dispatchEvent(new Event('input', {bubbles:true}));">지우기</button>` : ''}
                </div>
                ${inputHtml}
            </div>
        </div>
    `;
};

/**
 * 1. 데이터 필터링 및 집계 함수
 */
const aggregatePersonalData = (allHistoryData, viewMode, dateKey, memberName) => {
    // 1. 기간 필터링
    const filteredDays = allHistoryData.filter(day => {
        if (!day.id) return false;
        if (viewMode === 'personal-daily') return day.id === dateKey;
        if (viewMode === 'personal-weekly') return getWeekOfYear(new Date(day.id)) === dateKey;
        if (viewMode === 'personal-monthly') return day.id.startsWith(dateKey);
        if (viewMode === 'personal-yearly') return day.id.startsWith(dateKey);
        return false;
    });

    // 2. 초기화
    const stats = {
        totalWorkMinutes: 0,
        totalWageCost: 0,
        workDaysCount: 0,
        taskStats: {}, // { taskName: { count, duration, cost } }
        attendanceCounts: {}, // { type: count }
        attendanceDays: {}, // { type: days } (연차, 결근 등 일수 집계용)
        attendanceLogs: [], 
        dailyLogs: []
    };

    // 근태 카운트 초기화
    LEAVE_TYPES.forEach(t => { stats.attendanceCounts[t] = 0; stats.attendanceDays[t] = 0; });

    // 기간형 근태(연차·휴직 등)는 여러 날에 걸쳐 나타나므로 '횟수'는 건별로 한 번만 센다.
    // (예전엔 날마다 1회씩 세고 일수도 날마다 전체 기간을 더해, 2일짜리 연차가 '2회 4일'로 부풀었다)
    const countedLeaveKeys = new Set();

    // 시급/기본급 정보
    // memberWages 값 = 월 기본급(월급제). 시급 = 기본급 ÷ 209. 명단에 없으면 파트타이머(시급제).
    const monthlyBase = appConfig.memberWages?.[memberName] || 0;
    const isMonthlySalaried = monthlyBase > 0;
    let wage; // 시급(분/시간 원가·예상급여 계산용)
    if (isMonthlySalaried) {
        wage = monthlyBase / 209;
    } else {
        wage = 0;
        for (let i = filteredDays.length - 1; i >= 0; i--) {
            const pt = (filteredDays[i].partTimers || []).find(p => p.name === memberName);
            if (pt && pt.wage) { wage = pt.wage; break; }
        }
        if (wage === 0) wage = appConfig.defaultPartTimerWage || 10000;
    }

    // 급여 차감 누적 (월급제 전용)
    const absentDates = new Set(); // 결근한 평일 날짜
    let earlyLeaveMin = 0;         // 조퇴로 빠진 분
    let outingMin = 0;             // 외출 1시간 초과 분

    // 3. 순회 집계
    filteredDays.sort((a, b) => a.id.localeCompare(b.id)).forEach(day => {
        const date = day.id;
        let dayWorkMinutes = 0;
        const dayTasks = {};
        let dayAttendanceStatus = [];

        // A. 업무
        const myRecords = (day.workRecords || []).filter(r => r.member === memberName);
        if (myRecords.length > 0) {
            stats.workDaysCount++;
            myRecords.forEach(r => {
                const duration = Number(r.duration) || 0;
                const cost = (duration / 60) * wage;
                
                dayWorkMinutes += duration;
                stats.totalWorkMinutes += duration;
                stats.totalWageCost += cost;

                if (!stats.taskStats[r.task]) stats.taskStats[r.task] = { count: 0, duration: 0, cost: 0 };
                stats.taskStats[r.task].count++;
                stats.taskStats[r.task].duration += duration;
                stats.taskStats[r.task].cost += cost;

                dayTasks[r.task] = (dayTasks[r.task] || 0) + duration;
            });
        }

        // B. 근태
        const myLeaves = (day.onLeaveMembers || []).filter(l => l.member === memberName);
        myLeaves.forEach(leave => {
            const type = leave.type;

            if (leave.startDate) {
                // 기간형 근태(연차·휴직·출장·재택근무·외근·매장근무 등)
                //  · 횟수: 같은 건은 한 번만
                //  · 일수: 조회 기간 안에 실제로 걸친 날 수만큼 (달을 걸쳐도 과다 집계되지 않음.
                //          주말은 이미 병합 단계에서 빠져 있다)
                const leaveKey = leave.id || `${type}|${leave.startDate}|${leave.endDate || ''}`;
                if (!countedLeaveKeys.has(leaveKey)) {
                    countedLeaveKeys.add(leaveKey);
                    stats.attendanceCounts[type] = (stats.attendanceCounts[type] || 0) + 1;
                }
                stats.attendanceDays[type] = (stats.attendanceDays[type] || 0) + 1;
            } else {
                // 당일형 근태(외출·조퇴·지각) — 발생할 때마다 1회
                stats.attendanceCounts[type] = (stats.attendanceCounts[type] || 0) + 1;
            }

            // 급여 차감 누적 (월급제) — 결근/조퇴/외출
            if (isMonthlySalaried) {
                if (type === '결근' && leave.startDate) {
                    let d = new Date(leave.startDate + 'T00:00:00');
                    const end = new Date((leave.endDate || leave.startDate) + 'T00:00:00');
                    while (d <= end) {
                        const ds = toDateString(d);
                        if (isWeekday(ds)) absentDates.add(ds);
                        d.setDate(d.getDate() + 1);
                    }
                } else if (type === '조퇴') {
                    // 조퇴: 종업까지 빠진 시간에서 점심 겹침 제외
                    earlyLeaveMin += earlyLeaveDeductibleMinutes(_toMin(leave.startTime), WORK_END_MIN, _lunchOpts);
                } else if (type === '외출') {
                    // 외출: 점심시간 겹친 부분은 차감 제외, 1시간까지는 무차감
                    outingMin += outingDeductibleMinutes(_toMin(leave.startTime), _toMin(leave.endTime), { ..._lunchOpts, graceMin: 60 });
                }
            }

            // 로그용 텍스트
            let detail = '';
            if (leave.startTime) {
                detail = formatTimeTo24H(leave.startTime) + (leave.endTime ? ` ~ ${formatTimeTo24H(leave.endTime)}` : (type === '외출' ? ' ~' : ''));
            } else if (leave.startDate) {
                detail = leave.startDate + (leave.endDate && leave.endDate !== leave.startDate ? ` ~ ${leave.endDate}` : '');
            }
            
            stats.attendanceLogs.push({ date, type, detail, label: leaveTypeLabel(leave) });
            dayAttendanceStatus.push(type);
        });

        // [신규] 출퇴근 시간 추출
        const attRecord = day.dailyAttendance && day.dailyAttendance[memberName];
        const inTime = attRecord ? attRecord.inTime : null;
        const outTime = attRecord ? attRecord.outTime : null;

        // C. 일별 로그
        let mainTask = '-';
        let maxDuration = -1;
        Object.entries(dayTasks).forEach(([t, d]) => {
            if (d > maxDuration) { maxDuration = d; mainTask = t; }
        });

        stats.dailyLogs.push({
            date: date,
            workTime: dayWorkMinutes,
            mainTask: mainTask !== '-' ? `${mainTask} 외` : '-',
            attendance: dayAttendanceStatus.length > 0 ? dayAttendanceStatus.join(', ') : (dayWorkMinutes > 0 ? '정상근무' : '-'),
            inTime: inTime, // ✅ 추가
            outTime: outTime // ✅ 추가
        });
    });

    // 예상급여(세전): 월급제 = 기본급 − 근태 차감, 시급제 = 시급×업무시간(기존 totalWageCost)
    if (isMonthlySalaried) {
        const weeks = new Set([...absentDates].map(ds => getWeekOfYear(new Date(ds + 'T00:00:00'))));
        const sal = computeMonthlySalary({
            monthlyBase,
            absentDayCount: absentDates.size,
            weeksWithAbsence: weeks.size,
            earlyLeaveMin, outingMin
        });
        stats.salary = {
            isMonthlySalaried: true, monthlyBase,
            absentDays: absentDates.size, weeksWithAbsence: weeks.size,
            earlyLeaveMin, outingMin, ...sal
        };
    } else {
        stats.salary = { isMonthlySalaried: false, estimated: stats.totalWageCost, hourly: wage };
    }

    // 주말근무 급여 가산: 이 기간에 확정된 주말근무 × 11만원 (월급제·시급제 공통)
    const _inPersonalPeriod = (dateStr) => {
        if (!dateStr) return false;
        if (viewMode === 'personal-daily') return dateStr === dateKey;
        if (viewMode === 'personal-weekly') return getWeekOfYear(new Date(dateStr)) === dateKey;
        if (viewMode === 'personal-monthly') return dateStr.startsWith(dateKey);
        if (viewMode === 'personal-yearly') return dateStr.startsWith(dateKey);
        return false;
    };
    const weekendDates = (_weekendCache.byMember.get(memberName) || []).filter(_inPersonalPeriod).sort();
    const weekendCount = weekendDates.length;
    const weekendPay = weekendCount * WEEKEND_PAY_PER_SHIFT;
    stats.salary.weekendCount = weekendCount;
    stats.salary.weekendDates = weekendDates;
    stats.salary.weekendPay = weekendPay;
    stats.salary.estimatedBeforeWeekend = stats.salary.estimated || 0;
    stats.salary.estimated = (stats.salary.estimated || 0) + weekendPay;

    return { stats, filteredDays, wage };
};

/**
 * 2. 메인 렌더링 함수
 */
export const renderPersonalReport = (targetId, viewMode, dateKey, memberName, allHistoryData) => {
    const container = document.getElementById(targetId);
    if (!container) return;

    if (!memberName) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10">분석할 직원을 선택해주세요.</div>`;
        return;
    }
    if (!dateKey) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10">날짜를 선택해주세요.</div>`;
        return;
    }

    const { stats, filteredDays, wage } = aggregatePersonalData(allHistoryData, viewMode, dateKey, memberName);

    if (filteredDays.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10"><p class="font-bold text-gray-700 mb-1">${memberName}님</p><p>해당 기간에 기록이 없습니다.</p></div>`;
        return;
    }

    // ✅ [신규] 엑셀/PDF 다운로드를 위한 데이터 컨텍스트 저장
    context.lastReportData = {
        type: 'personal',
        title: `${memberName}님의 ${dateKey} 리포트`,
        stats: stats,
        filteredDays: filteredDays,
        wage: wage,
        memberName: memberName,
        dateKey: dateKey,
        viewMode: viewMode
    };

    // --- 데이터 가공 및 정렬/필터 적용 ---
    const sortState = context.personalReportSortState || {};
    const filterState = context.personalReportFilterState || {};

    // 1. 업무별 통계 배열 변환
    let taskStatsArray = Object.entries(stats.taskStats).map(([task, data]) => ({
        task,
        ...data,
        percent: stats.totalWorkMinutes > 0 ? (data.duration / stats.totalWorkMinutes) * 100 : 0,
        avgTime: data.count > 0 ? data.duration / data.count : 0
    }));
    
    // ✅ 필터 옵션 추출
    const allTaskNames = [...new Set(taskStatsArray.map(t => t.task))].sort();

    // 필터 (업무)
    if (filterState.taskStats?.task) {
        taskStatsArray = taskStatsArray.filter(t => t.task === filterState.taskStats.task);
    }
    // 정렬 (업무)
    const tsSort = sortState.taskStats || { key: 'duration', dir: 'desc' };
    taskStatsArray.sort((a, b) => {
        let vA = a[tsSort.key], vB = b[tsSort.key];
        if (typeof vA === 'string') return vA.localeCompare(vB) * (tsSort.dir === 'asc' ? 1 : -1);
        return (vA - vB) * (tsSort.dir === 'asc' ? 1 : -1);
    });

    // 2. 근태 로그
    let attLogs = [...stats.attendanceLogs];
    
    // ✅ 필터 옵션 추출
    const allAttTypes = [...new Set(attLogs.map(l => l.type))].sort();

    // 필터 (근태)
    if (filterState.attendanceLogs?.type) {
        attLogs = attLogs.filter(l => l.type === filterState.attendanceLogs.type);
    }
    // 정렬 (근태)
    const alSort = sortState.attendanceLogs || { key: 'date', dir: 'asc' };
    attLogs.sort((a, b) => (a[alSort.key] > b[alSort.key] ? 1 : -1) * (alSort.dir === 'asc' ? 1 : -1));

    // 3. 일별 로그
    let dailyLogs = [...stats.dailyLogs];

    // ✅ 필터 옵션 추출
    const allDailyAttStatus = [...new Set(dailyLogs.map(l => l.attendance))].sort();
    
    // 필터 (일별)
    if (filterState.dailyLogs?.attendance) {
        dailyLogs = dailyLogs.filter(l => l.attendance === filterState.dailyLogs.attendance);
    }
    // 정렬 (일별)
    const dlSort = sortState.dailyLogs || { key: 'date', dir: 'asc' };
    dailyLogs.sort((a, b) => {
        let vA = a[dlSort.key], vB = b[dlSort.key];
        if (typeof vA === 'string') return vA.localeCompare(vB) * (dlSort.dir === 'asc' ? 1 : -1);
        return (vA - vB) * (dlSort.dir === 'asc' ? 1 : -1);
    });

    // --- HTML 생성 ---
    let html = `<div class="space-y-6 animate-fade-in">`;

    // 1. 상단 요약 카드 & 다운로드 버튼
    html += `
        <div class="flex flex-col md:flex-row justify-between items-center mb-2">
            <div class="flex items-center gap-4">
                <h3 class="text-xl font-bold text-gray-800"><span class="text-blue-600">${memberName}</span>님의 ${dateKey} 리포트</h3>
                <div class="flex gap-2">
                    <button id="personal-download-btn" class="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-semibold py-1 px-3 rounded-md text-sm flex items-center gap-1 transition shadow-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        다운로드
                    </button>
                </div>
            </div>
            <span class="relative inline-flex items-center gap-1.5 text-xs text-gray-400 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded mt-2 md:mt-0 cursor-pointer select-none transition" onclick="const m=this.querySelector('.pay-mask'), r=this.querySelector('.pay-real'), ic=this.querySelector('.pay-eye'); m.classList.toggle('hidden'); r.classList.toggle('hidden'); ic.textContent = m.classList.contains('hidden') ? '👁️' : '🙈';" title="클릭하여 표시/가리기">
                <span class="pay-mask tracking-wider">${stats.salary && stats.salary.isMonthlySalaried ? `기본급 ●●●,●●●원 · 시급 ●●,●●●원` : `적용 시급: ●●,●●●원`}</span>
                <span class="pay-real hidden">${stats.salary && stats.salary.isMonthlySalaried ? `기본급 ${Math.round(stats.salary.monthlyBase).toLocaleString()}원 · 시급 ${Math.round(stats.salary.hourly).toLocaleString()}원` : `적용 시급: ${Math.round(wage).toLocaleString()}원`}</span>
                <span class="pay-eye text-[11px]">🙈</span>
            </span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-white p-4 rounded-xl border border-blue-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">총 근무일</div><div class="text-2xl font-extrabold text-gray-800">${stats.workDaysCount}일</div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-blue-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">총 업무 시간</div><div class="text-2xl font-extrabold text-blue-600">${formatDuration(stats.totalWorkMinutes)}</div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-blue-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">예상 급여 (세전)</div>
                <div class="cursor-pointer select-none group" onclick="const m=this.querySelector('.pay-mask'), r=this.querySelector('.pay-real'), ic=this.querySelector('.pay-eye'); m.classList.toggle('hidden'); r.classList.toggle('hidden'); ic.textContent = m.classList.contains('hidden') ? '👁️ 클릭하여 가리기' : '🙈 클릭하여 표시';" title="클릭하여 표시/가리기">
                    <div class="pay-mask text-2xl font-extrabold text-gray-300 tracking-widest">●,●●●,●●●원</div>
                    <div class="pay-real hidden">
                        <div class="text-2xl font-extrabold text-gray-800">${Math.round((stats.salary && stats.salary.estimated != null) ? stats.salary.estimated : stats.totalWageCost).toLocaleString()}원</div>
                        ${stats.salary && stats.salary.isMonthlySalaried && stats.salary.totalDeduction > 0 ? `<div class="text-[10px] text-red-500 mt-1">근태 차감 −${Math.round(stats.salary.totalDeduction).toLocaleString()}원</div>` : ''}
                        ${stats.salary && stats.salary.weekendPay > 0 ? `<div class="text-[10px] text-emerald-600 mt-1">주말근무 ${stats.salary.weekendCount}회 +${stats.salary.weekendPay.toLocaleString()}원</div>` : ''}
                    </div>
                    <div class="pay-eye text-[10px] text-gray-400 mt-1 group-hover:text-blue-500 transition">🙈 클릭하여 표시</div>
                </div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-red-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">특이 근태</div>
                <div class="text-sm font-semibold text-gray-700 truncate">${Object.entries(stats.attendanceCounts).filter(([,c])=>c>0).map(([t,c])=>`${t} ${c}`).join(', ')||'-'}</div>
            </div>
        </div>
    `;

    // 2. 업무별 상세 통계 (필터/정렬 적용)
    const th_task = (key, label, w='') => `<th class="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none group ${w}" data-sort-target="taskStats" data-sort-key="${key}"><div class="flex items-center justify-end ${w?'justify-start':''}"><span>${label} ${getSortIcon(tsSort.key, tsSort.dir, key)}</span></div></th>`;

    html += `
        <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
            <h4 class="text-lg font-bold text-gray-800 mb-4">📊 업무별 수행 내역</h4>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left text-gray-600">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                        <tr>
                            <th class="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none group" data-sort-target="taskStats" data-sort-key="task">
                                <div class="flex items-center justify-between">
                                    <span>업무명 ${getSortIcon(tsSort.key, tsSort.dir, 'task')}</span>
                                    ${getFilterDropdown('taskStats', 'task', filterState.taskStats?.task, allTaskNames)}
                                </div>
                            </th>
                            ${th_task('count', '수행 횟수')} ${th_task('duration', '총 소요 시간')} ${th_task('percent', '비중')} ${th_task('avgTime', '평균 시간/건')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${taskStatsArray.length === 0 ? '<tr><td colspan="5" class="px-4 py-4 text-center text-gray-400">데이터 없음</td></tr>' : ''}
                        ${taskStatsArray.map(data => `
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3 font-medium text-gray-900">${data.task}</td>
                                <td class="px-4 py-3 text-right">${data.count}회</td>
                                <td class="px-4 py-3 text-right font-bold text-blue-600">${formatDuration(data.duration)}</td>
                                <td class="px-4 py-3 text-right">
                                    <div class="flex items-center justify-end gap-2">
                                        <span class="text-xs text-gray-500">${data.percent.toFixed(1)}%</span>
                                        <div class="w-16 bg-gray-200 rounded-full h-1.5"><div class="bg-blue-500 h-1.5 rounded-full" style="width: ${data.percent}%"></div></div>
                                    </div>
                                </td>
                                <td class="px-4 py-3 text-right text-gray-500">${formatDuration(data.avgTime)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // 3. 근태 요약 및 상세 기록
    if (attLogs.length > 0 || Object.values(stats.attendanceCounts).some(c=>c>0)) {
        const summaryHtml = LEAVE_TYPES.map(type => {
            const count = stats.attendanceCounts[type] || 0;
            if (count === 0) return '';
            let text = `${type}: <strong>${count}회</strong>`;
            // 기간형 근태는 일수도 함께 표기 (집계된 값이 있으면 종류 제한 없이)
            if (stats.attendanceDays[type] > 0) {
                text += ` <span class="text-xs text-gray-500">(${stats.attendanceDays[type]}일)</span>`;
            }
            return `<div class="bg-gray-50 rounded px-3 py-2 text-sm text-gray-700 border border-gray-200 shadow-sm">${text}</div>`;
        }).join('');

        const th_att = (key, label) => `<th class="px-4 py-2 cursor-pointer hover:bg-gray-100 select-none group" data-sort-target="attendanceLogs" data-sort-key="${key}"><div class="flex items-center"><span>${label} ${getSortIcon(alSort.key, alSort.dir, key)}</span></div></th>`;

        html += `
            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                <h4 class="text-lg font-bold text-gray-800 mb-4">📅 근태 기록</h4>
                
                <div class="flex flex-wrap gap-2 mb-4">
                    ${summaryHtml}
                </div>

                <div class="overflow-x-auto max-h-60">
                    <table class="w-full text-sm text-left text-gray-600">
                        <thead class="text-xs text-gray-700 uppercase bg-red-50 border-b border-red-100 sticky top-0">
                            <tr>
                                ${th_att('date', '날짜')}
                                <th class="px-4 py-2 cursor-pointer hover:bg-gray-100 select-none group" data-sort-target="attendanceLogs" data-sort-key="type">
                                    <div class="flex items-center justify-between">
                                        <span>유형 ${getSortIcon(alSort.key, alSort.dir, 'type')}</span>
                                        ${getFilterDropdown('attendanceLogs', 'type', filterState.attendanceLogs?.type, allAttTypes)}
                                    </div>
                                </th>
                                <th class="px-4 py-2">상세 시간/기간</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                             ${attLogs.length === 0 ? '<tr><td colspan="3" class="px-4 py-4 text-center text-gray-400">조건에 맞는 기록 없음</td></tr>' : ''}
                             ${attLogs.map(log => `
                                <tr class="hover:bg-red-50">
                                    <td class="px-4 py-2 font-medium">${log.date}</td>
                                    <td class="px-4 py-2"><span class="px-2 py-0.5 rounded text-xs font-bold ${log.type==='지각'||log.type==='결근'?'bg-red-100 text-red-700':'bg-gray-100 text-gray-700'}">${log.label || log.type}</span></td>
                                    <td class="px-4 py-2 text-gray-500">${log.detail}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // 4. 일자별 로그 (일별 뷰가 아닐 때만)
    if (viewMode !== 'personal-daily') {
        const th_daily = (key, label) => `<th class="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none group" data-sort-target="dailyLogs" data-sort-key="${key}"><div class="flex items-center"><span>${label} ${getSortIcon(dlSort.key, dlSort.dir, key)}</span></div></th>`;
        
        html += `
            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                <h4 class="text-lg font-bold text-gray-800 mb-4">🗓️ 일자별 활동 요약</h4>
                <div class="overflow-x-auto max-h-96">
                    <table class="w-full text-sm text-left text-gray-600">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-100 border-b sticky top-0">
                            <tr>
                                ${th_daily('date', '날짜')}
                                <th class="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none group" data-sort-target="dailyLogs" data-sort-key="attendance">
                                    <div class="flex items-center justify-between">
                                        <span>근태 ${getSortIcon(dlSort.key, dlSort.dir, 'attendance')}</span>
                                        ${getFilterDropdown('dailyLogs', 'attendance', filterState.dailyLogs?.attendance, allDailyAttStatus)}
                                    </div>
                                </th>
                                <th class="px-4 py-3">출근</th> <th class="px-4 py-3">퇴근</th> <th class="px-4 py-3">주요 업무</th>
                                ${th_daily('workTime', '총 근무 시간')}
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                             ${dailyLogs.length === 0 ? '<tr><td colspan="6" class="px-4 py-4 text-center text-gray-400">조건에 맞는 기록 없음</td></tr>' : ''}
                             ${dailyLogs.map(log => `
                                <tr class="hover:bg-gray-50">
                                    <td class="px-4 py-3 font-medium text-gray-900">${log.date} (${getDayOfWeek(log.date)})</td>
                                    <td class="px-4 py-3"><span class="px-2 py-1 rounded text-xs ${log.attendance==='정상근무'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-800'}">${log.attendance}</span></td>
                                    <td class="px-4 py-3 text-gray-600 font-mono text-xs">${log.inTime ? formatTimeTo24H(log.inTime) : '-'}</td> <td class="px-4 py-3 text-gray-600 font-mono text-xs">${log.outTime ? formatTimeTo24H(log.outTime) : '-'}</td> <td class="px-4 py-3 text-gray-600">${log.mainTask}</td>
                                    <td class="px-4 py-3 text-right font-bold text-blue-600">${formatDuration(log.workTime)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    html += `</div>`;
    container.innerHTML = html;
};

function getDayOfWeek(dateStr) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[new Date(dateStr).getDay()];
}