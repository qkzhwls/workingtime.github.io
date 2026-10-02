// === js/utils.js ===

/**
 * 인원 산정용 정직원 명단(중복 제거 + 인원 제외 명단 적용)을 반환.
 * - 멤버 리스트 표시(선택 모달 등)에는 쓰지 않음. "몇 명?"을 셀 때만 사용.
 * - 제외 명단: appConfig.headcountExcludedMembers (없으면 빈 배열).
 * - teamGroups 내에서 한 사람이 여러 그룹에 들어 있어도 1명으로 셈.
 */
export const getRegularMembersForCount = (appConfig, dateStr = null) => {
    const flat = (appConfig?.teamGroups || []).flatMap(g => g?.members || []);
    const excluded = new Set(appConfig?.headcountExcludedMembers || []);
    const asOf = dateStr || getTodayDateString();
    const uniq = new Set();
    flat.forEach(name => {
        if (!name) return;
        if (excluded.has(name)) return;
        if (!isMemberActiveOn(name, asOf, appConfig)) return; // 퇴사자 제외(해당 날짜 기준)
        uniq.add(name);
    });
    return uniq;
};

// 전체 업무 키 목록(중복 제거, 순서: taskGroups → keyTasks → quantityTaskTypes → qualityCostTasks 보충)
export const getAllTaskKeys = (appConfig) => {
    const cfg = appConfig || {};
    const seen = new Set();
    const out = [];
    const add = (t) => { if (t && !seen.has(t)) { seen.add(t); out.push(t); } };
    (cfg.taskGroups || []).forEach(g => (g.tasks || []).forEach(add));
    (cfg.keyTasks || []).forEach(add);
    (cfg.quantityTaskTypes || []).forEach(add);
    (cfg.qualityCostTasks || []).forEach(add);
    return out;
};

// ===== 퇴사 처리(재직/비활성) 헬퍼 =====
// resignedMembers: { '이름': 'YYYY-MM-DD' }  ← 퇴사일. 팀원 데이터(급여·과거기록)는 그대로 두고 상태만 표시.

// 퇴사일 조회 (미퇴사면 null)
export const getResignationDate = (name, appConfig) => {
    const r = appConfig?.resignedMembers || {};
    return r[name] || null;
};

// 특정 날짜에 재직 중인지. 퇴사일 당일까지는 재직(포함), 그 다음날부터 비활성.
export const isMemberActiveOn = (name, dateStr, appConfig) => {
    const resign = getResignationDate(name, appConfig);
    if (!resign) return true;
    const asOf = dateStr || getTodayDateString();
    return asOf <= resign;
};

// 화면 명단(팀 선택·출근·연차 배정 등)에 노출할 '재직 중' 팀원 목록. 기본 오늘 기준.
export const getActiveTeamMembers = (appConfig, dateStr = null) => {
    const asOf = dateStr || getTodayDateString();
    const out = [];
    (appConfig?.teamGroups || []).forEach(g => (g?.members || []).forEach(name => {
        if (name && isMemberActiveOn(name, asOf, appConfig)) out.push(name);
    }));
    return out;
};

// 월급제 시급 환산 기준 시간(주휴 포함, 월 209시간). calc.js의 computeMonthlySalary와 동일 기준.
export const SALARY_STD_HOURS = 209;

/**
 * 인건비 계산용 "시급" 맵을 생성한다.
 * ⚠️ appConfig.memberWages 값은 "월 기본급"(월급제)이므로 시급 = 기본급 ÷ 209로 환산해야 한다.
 *    (예전에 memberWages가 시급이던 흔적으로, 여러 집계 코드가 월기본급을 시급처럼 곱해
 *     월급제 인건비가 209배 부풀려지는 버그가 있었음 → 이 헬퍼로 일원화)
 * 파트타이머(시급제) 시급은 이 맵 위에 각 호출부에서 pt.wage로 덮어쓴다(이미 시급이라 환산 대상 아님).
 * @returns {{[member: string]: number}} 팀원명 → 시급(원)
 */
export const buildMemberHourlyWageMap = (memberWages = {}) => {
    const out = {};
    const src = memberWages || {};
    for (const name in src) {
        if (Object.prototype.hasOwnProperty.call(src, name)) {
            out[name] = (Number(src[name]) || 0) / SALARY_STD_HOURS;
        }
    }
    return out;
};

export const showToast = (message, isError = false) => {
    const container = document.getElementById('toast-container');
    if (!container) return; 
    const toast = document.createElement('div');
    toast.className = `toast p-3 rounded-lg shadow-xl text-white ${isError ? 'bg-red-500' : 'bg-green-500'}`;
    toast.textContent = message;
    container.prepend(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 3000);
};

// 네이티브 confirm 대체 — 스타일된 모달, Promise<boolean> 반환.
// 자체 DOM을 생성하므로 어느 페이지에서나 동작(별도 마크업/컨테이너 불필요).
export const showConfirm = (message, opts = {}) => {
    const { title = '확인', okText = '확인', cancelText = '취소', danger = false } = opts;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    return new Promise((resolve) => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
        const okColor = danger ? '#dc2626' : '#2563eb';
        ov.innerHTML = `
            <div role="dialog" aria-modal="true" style="background:#fff;border-radius:16px;max-width:380px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden;font-family:inherit;">
              <div style="padding:20px 20px 8px;font-weight:800;font-size:16px;color:#111827;">${esc(title)}</div>
              <div style="padding:0 20px 18px;font-size:14px;color:#374151;line-height:1.55;white-space:pre-line;">${esc(message)}</div>
              <div style="display:flex;gap:8px;padding:12px 16px;background:#f9fafb;border-top:1px solid #f1f5f9;justify-content:flex-end;">
                <button data-act="cancel" style="padding:8px 16px;border-radius:10px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-weight:700;font-size:13px;cursor:pointer;">${esc(cancelText)}</button>
                <button data-act="ok" style="padding:8px 16px;border-radius:10px;border:none;background:${okColor};color:#fff;font-weight:700;font-size:13px;cursor:pointer;">${esc(okText)}</button>
              </div>
            </div>`;
        const done = (val) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
        const onKey = (e) => { if (e.key === 'Escape') done(false); else if (e.key === 'Enter') done(true); };
        ov.addEventListener('click', (e) => {
            if (e.target === ov) return done(false); // 바깥 클릭=취소
            const b = e.target.closest('[data-act]');
            if (b) done(b.dataset.act === 'ok');
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(ov);
        const okBtn = ov.querySelector('[data-act="ok"]');
        if (okBtn) okBtn.focus();
    });
};

export const calcElapsedMinutes = (start, end, pauses = []) => {
    if (!start || !end) return 0;
    const s = new Date(`1970-01-01T${start}:00Z`).getTime();
    const e = new Date(`1970-01-01T${end}:00Z`).getTime();
    let total = Math.max(0, e - s);
    (pauses || []).forEach(p => {
        if (p.start && p.end) {
            const ps = new Date(`1970-01-01T${p.start}:00Z`).getTime();
            const pe = new Date(`1970-01-01T${p.end}:00Z`).getTime();
            if (pe > ps) total -= (pe - ps);
        }
    });
    return Math.max(0, total / 60000);
};

// ✅ 총 휴식 시간(분) 계산 함수
export const calcTotalPauseMinutes = (pauses = []) => {
    if (!pauses || pauses.length === 0) return 0;
    let total = 0;
    
    const now = new Date();
    const nowTimeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    pauses.forEach(p => {
        if (p.start) {
            const s = new Date(`1970-01-01T${p.start}:00Z`).getTime();
            const endTimeStr = p.end || nowTimeStr;
            const e = new Date(`1970-01-01T${endTimeStr}:00Z`).getTime();
            
            if (e > s) {
                total += (e - s);
            }
        }
    });
    return Math.floor(total / 60000);
};

export const formatTimeTo24H = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const date = new Date(1970, 0, 1, hours, minutes);
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

export const getCurrentTime = () => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

/** HTML 에 값을 끼워 넣기 전에 반드시 통과시킬 것.
 *  상품명·메모처럼 사람이 넣은 값에 < " ' 가 들어오면 마크업이 깨지거나 코드로 해석된다.
 *  (예전에는 이 함수를 모듈마다 다시 써서 13벌이 돌아다녔다) */
export const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 시간(hour) → '2시간 30분'. 음수도 부호를 붙여 그대로 표기한다.
 *  formatDuration 과 달리 공백이 없고 음수를 다룬다(남는 시간/초과 시간 표시용). */
export const formatHM = (hours) => {
    const total = Math.round(Math.abs(Number(hours) || 0) * 60);
    const sign = (Number(hours) || 0) < 0 ? '-' : '';
    const h = Math.floor(total / 60), m = total % 60;
    if (h === 0) return `${sign}${m}분`;
    return m === 0 ? `${sign}${h}시간` : `${sign}${h}시간 ${m}분`;
};

/** 분 → '1시간 30분' */
export const formatMinutesHM = (minutes) => formatHM((Number(minutes) || 0) / 60);

export const formatDuration = (minutes) => {
    minutes = Math.round(minutes);
    if (isNaN(minutes) || minutes < 0) return '0 분';
    if (minutes === 0) return '0 분';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    let result = '';
    if (h > 0) result += `${h} 시간 `;
    if (m > 0) result += `${m} 분`;
    return result.trim();
};

export const isWeekday = (dateString) => {
    const date = new Date(dateString + 'T00:00:00');
    const day = date.getDay();
    return day >= 1 && day <= 5; // 월(1) ~ 금(5)
};

/** Date → 'YYYY-MM-DD' (로컬 기준).
 *
 *  ⚠️ toISOString().slice(0,10) 을 그냥 쓰면 안 된다 — UTC 로 바뀌면서 한국시간(UTC+9)에서는
 *     ① 오전 9시 이전의 new Date() 가 '어제'가 되고,
 *     ② new Date('2026-09-08T00:00:00') 처럼 로컬 자정으로 만든 날짜도 통째로 하루 밀린다.
 *     날짜 문자열이 필요하면 언제나 이 함수를 쓸 것. */
export const toDateString = (date = new Date()) => {
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const getTodayDateString = () => toDateString(new Date());

export const getWeekOfYear = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

// 💡 [변경됨] 초를 제거하고 "00시 00분" 형태로 출력하도록 수정
export const displayCurrentDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const dayOfWeek = weekdays[now.getDay()];
    
    // 시간, 분 추출 및 두 자리수 맞춤
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    
    // 최종 표시될 텍스트 (예: 2024년 05월 12일 (수) 14시 30분)
    const dateString = `${year}년 ${month}월 ${day}일 (${dayOfWeek}) ${hours}시 ${minutes}분`;
    
    const displayElement = document.getElementById('current-date-display');
    if (displayElement) {
        displayElement.textContent = dateString;
    }
};

export const normalizeName = (s = '') => s.normalize('NFC').trim().toLowerCase();

export const calculateDateDifference = (start, end) => {
    if (!start) return 0;
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date(start);
    const startUTC = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endUTC = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    const diffTime = endUTC - startUTC;
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    return diffDays + 1;
};

// ✅ 주말을 제외한 평일(Working Days)만 계산하는 함수
export const calculateWorkingDays = (start, end) => {
    if (!start) return 0;
    const startDate = new Date(start + 'T00:00:00');
    const endDate = end ? new Date(end + 'T00:00:00') : new Date(start + 'T00:00:00');
    let count = 0;
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const day = d.getDay();
        if (day >= 1 && day <= 5) count++; // 평일만 카운트
    }
    return count;
};

export const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
};

// 🔥 법정 공휴일 — 달력 표시와 업무 예상(주말·공휴일 건너뛰기)에서 함께 쓴다.
export function getHolidayName(year, month, day) {
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const md = `${mm}-${dd}`;
    const ymd = `${year}-${mm}-${dd}`;

    const fixedHolidays = {
        '01-01': '신정', '03-01': '3·1절', '05-05': '어린이날', '06-06': '현충일',
        '08-15': '광복절', '10-03': '개천절', '10-09': '한글날', '12-25': '기독탄신일(크리스마스)'
    };

    const variableHolidays = {
        '2024-02-09': '설날 연휴', '2024-02-10': '설날', '2024-02-11': '설날 연휴', '2024-02-12': '대체공휴일',
        '2024-04-10': '국회의원선거', '2024-05-06': '대체공휴일', '2024-05-15': '부처님오신날',
        '2024-09-16': '추석 연휴', '2024-09-17': '추석', '2024-09-18': '추석 연휴',
        '2025-01-28': '설날 연휴', '2025-01-29': '설날', '2025-01-30': '설날 연휴',
        '2025-03-03': '대체공휴일', '2025-05-05': '어린이날/부처님오신날', '2025-05-06': '대체공휴일',
        '2025-10-05': '추석 연휴', '2025-10-06': '추석', '2025-10-07': '추석 연휴', '2025-10-08': '대체공휴일',
        '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
        '2026-03-02': '대체공휴일', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일',
        '2026-06-03': '지방선거', '2026-08-16': '대체공휴일',
        '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-10-04': '대체공휴일', '2026-10-05': '대체공휴일'
    };

    if (variableHolidays[ymd]) return variableHolidays[ymd];
    if (fixedHolidays[md]) return fixedHolidays[md];
    return null;
}
