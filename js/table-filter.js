// === js/table-filter.js ===
// 표 머리글 필터 공용 헬퍼 — 여러 값을 동시에 고를 수 있는 '다중 선택' 방식.
//
// 저장 형태
//   · null/undefined → 필터 없음(전체 통과). 체크박스가 모두 켜진 상태와 같다.
//   · 배열           → 그 안의 값만 통과. 빈 배열이면 아무것도 통과하지 않는다('해제').
//   · 문자열         → 예전 단일 선택/검색어. 그대로 두어도 동작하도록 함께 처리한다.
//
// 쓰는 쪽은 matchesFilter() 하나로 세 형태를 모두 비교할 수 있다.

const escHtml = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 이 칸에 필터가 걸려 있는가 (아이콘 강조·'지우기' 표시용) */
export const hasFilter = (f) => Array.isArray(f) ? true : !!(f && String(f).trim());

/** 값이 필터를 통과하는가. */
export const matchesFilter = (value, f) => {
    if (f == null) return true;                       // 필터 없음
    const v = String(value == null ? '' : value);
    if (Array.isArray(f)) return f.map(String).includes(v);   // 빈 배열이면 아무것도 통과 못 함
    if (!String(f).trim()) return true;
    return v === String(f);
};

/** 아이콘 옆에 표시할 선택 개수 */
export const filterCount = (f) => Array.isArray(f) ? f.length : (hasFilter(f) ? 1 : 0);

/**
 * 다중 선택 체크박스 목록 HTML.
 *  target/key 는 어느 표의 어느 칸인지 구분하는 값으로, 리스너가 그대로 읽는다.
 *  current 가 비어 있으면 '전체 선택' 상태로 보여준다(= 아무 제한 없음).
 */
export function multiFilterBody(target, key, current, options = []) {
    // current 가 없으면 '전체 선택' 상태로 본다.
    const all = current == null;
    const picked = Array.isArray(current) ? current.map(String)
                 : (hasFilter(current) ? [String(current)] : []);

    if (!options.length) {
        return `<input type="text" class="w-full p-2 border border-gray-300 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
                       placeholder="검색..." value="${escHtml(Array.isArray(current) ? '' : (current || ''))}"
                       data-filter-target="${escHtml(target)}" data-filter-key="${escHtml(key)}" autocomplete="off">`;
    }

    const rows = options.map(opt => {
        const v = String(opt);
        const on = all || picked.includes(v);
        return `<label class="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-gray-100 cursor-pointer text-sm">
            <input type="checkbox" class="w-3.5 h-3.5 shrink-0" ${on ? 'checked' : ''}
                   data-filter-multi data-filter-target="${escHtml(target)}" data-filter-key="${escHtml(key)}" value="${escHtml(v)}">
            <span class="truncate" title="${escHtml(v)}">${escHtml(v === '' ? '(빈 값)' : v)}</span>
        </label>`;
    }).join('');

    return `
        <div class="flex items-center justify-between mb-1.5">
            <span class="text-[11px] text-gray-400">${options.length}개 항목</span>
            <span>
                <button type="button" class="text-[11px] font-bold text-blue-600 hover:underline px-1"
                        data-filter-all data-filter-target="${escHtml(target)}" data-filter-key="${escHtml(key)}">전체</button>
                <button type="button" class="text-[11px] font-bold text-blue-600 hover:underline px-1"
                        data-filter-none data-filter-target="${escHtml(target)}" data-filter-key="${escHtml(key)}">해제</button>
            </span>
        </div>
        <input type="search" class="w-full p-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-2 focus:ring-blue-500 mb-1.5"
               placeholder="값 검색" data-filter-search autocomplete="off">
        <div class="max-h-52 overflow-y-auto -mx-1 px-1" data-filter-list>${rows}</div>`;
}

/**
 * 체크박스 조작 결과를 필터 값으로 만든다.
 *  전부 체크 → null(필터 없음)로 되돌린다.
 */
export function readMultiFilter(dropdownEl) {
    const boxes = [...dropdownEl.querySelectorAll('input[data-filter-multi]')];
    const checked = boxes.filter(b => b.checked).map(b => b.value);
    return checked.length === boxes.length ? null : checked;
}

// ────────────────────────────────────────────────────────────
// 떠 있는 필터 팝업
// 표가 스크롤 영역(overflow) 안에 있으면 머리글 내부에 절대배치한 목록이 잘린다.
// 그래서 팝업을 body에 붙이고 버튼 좌표에 맞춰 띄운다.
// ────────────────────────────────────────────────────────────
let _openKey = null;

export const closeFloatingFilter = () => {
    document.querySelectorAll('.tf-pop').forEach(el => el.remove());
    _openKey = null;
};

/**
 * @param {HTMLElement} anchor  기준이 되는 버튼
 * @param {object} opt  { key, label, options, current, onChange(newValue) }
 */
export function openFloatingFilter(anchor, opt) {
    const key = opt.key;
    if (_openKey === key) { closeFloatingFilter(); return; }
    closeFloatingFilter();
    _openKey = key;

    const pop = document.createElement('div');
    pop.className = 'tf-pop';
    pop.style.cssText = 'position:fixed;z-index:1000;width:230px;background:#fff;border:1px solid #e2e8f0;'
        + 'border-radius:10px;box-shadow:0 10px 30px rgba(15,23,42,.18);padding:10px;font-size:12px;color:#334155;';
    pop.innerHTML = `<div class="font-bold text-gray-600 mb-1.5">${escHtml(opt.label)}</div>`
        + multiFilterBody('float', key, opt.current, opt.options || []);
    document.body.appendChild(pop);

    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8)) + 'px';
    pop.style.top = (a.bottom + h + 8 > window.innerHeight ? Math.max(8, a.top - h - 4) : a.bottom + 4) + 'px';

    const apply = () => opt.onChange(readMultiFilter(pop));

    pop.addEventListener('change', (e) => { if (e.target.matches('input[data-filter-multi]')) apply(); });
    pop.addEventListener('click', (e) => {
        if (e.target.closest('[data-filter-all]')) {
            pop.querySelectorAll('input[data-filter-multi]').forEach(b => { b.checked = true; });
            opt.onChange(null);                       // 전체 = 필터 없음
        } else if (e.target.closest('[data-filter-none]')) {
            pop.querySelectorAll('input[data-filter-multi]').forEach(b => { b.checked = false; });
            opt.onChange([]);                         // 해제 = 아무것도 통과 못 함
        }
    });
    pop.addEventListener('input', (e) => {
        if (!e.target.matches('[data-filter-search]')) return;
        const kw = e.target.value.trim().toLowerCase();
        pop.querySelectorAll('[data-filter-list] label').forEach(l => {
            l.style.display = l.textContent.toLowerCase().includes(kw) ? '' : 'none';
        });
    });

    setTimeout(() => pop.querySelector('[data-filter-search]')?.focus(), 20);
}

document.addEventListener('click', (e) => {
    if (!_openKey) return;
    if (e.target.closest('.tf-pop') || e.target.closest('[data-tf-filter]')) return;
    closeFloatingFilter();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFloatingFilter(); });
window.addEventListener('resize', closeFloatingFilter);

/**
 * 표 안에 그려지는 필터 드롭다운을 화면 기준(fixed)으로 띄운다.
 *
 * 표는 가로·세로 스크롤이 걸린 상자 안에 있어서, 드롭다운을 표 안에 두면
 * 그 상자에 잘려 반쯤만 보인다(업무리포트 첫 헤더에서 실제로 그랬다).
 * 위치만 화면 기준으로 옮기면 잘리지 않는다.
 *
 * 드롭다운은 다시 그려질 때마다 새로 만들어지므로, 렌더 직후에 불러 준다.
 */
export function placeOpenDropdown(container) {
    if (!container) return;
    const dd = container.querySelector('.filter-dropdown:not(.hidden)');
    if (!dd) return;
    const btn = dd.closest('.filter-container')?.querySelector('.filter-icon-btn');
    if (!btn) return;

    const a = btn.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.right = 'auto';          // 클래스(right-0)가 남아 있으면 폭이 늘어난다
    dd.style.marginTop = '0';
    dd.style.zIndex = '1000';

    const w = dd.offsetWidth || 240;
    const h = dd.offsetHeight || 260;
    // 오른쪽 정렬을 유지하되 화면 밖으로 나가지 않게 한다
    let left = a.right - w;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    dd.style.left = left + 'px';
    dd.style.top = (a.bottom + h + 8 > window.innerHeight
        ? Math.max(8, a.top - h - 4)
        : a.bottom + 4) + 'px';
}
