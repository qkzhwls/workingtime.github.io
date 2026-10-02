// === js/uph-tooltip.js ===
// 📖 화면에 표시되는 모든 'UPH' 텍스트에 마우스오버 설명(이름풀이·뜻·계산방식)을 자동으로 붙인다.
//
// UPH는 대시보드·생산성·인력운영·마일스톤·정산·업무예상 등 30군데 넘게 흩어져 있고
// 상당수가 자바스크립트로 동적 생성되므로, 각 위치를 일일이 고치는 대신
// DOM을 감시하며 'UPH' 텍스트를 찾아 툴팁 마크업으로 감싸는 방식을 쓴다.
// (canvas 차트 축 제목처럼 그림으로 그려지는 텍스트는 대상이 아니다)

const TIP_HTML = `
  <b>UPH</b> · Units Per Hour<br>
  <span class="uph-tip-sub">우리말로 "시간당 처리량"</span>
  <hr>
  <b>뜻</b><br>
  작업자가 <b>1시간</b> 동안 처리한 물량(개수)입니다.
  인원 수나 근무시간이 서로 달라도 효율을 공정하게 비교할 수 있어,
  생산성을 판단하는 핵심 지표로 씁니다.
  <hr>
  <b>계산방식</b><br>
  <span class="uph-tip-formula">UPH = 총 처리량(개) ÷ 총 작업시간(시간)</span>
  <span class="uph-tip-sub">· 총 처리량 = 해당 업무의 물량 합계<br>
  · 총 작업시간 = 해당 업무 기록의 소요시간(분) 합계 ÷ 60</span>
  <hr>
  <b>예시</b><br>
  3명이 2시간씩(총 6시간) 1,200개를 처리 → 1,200 ÷ 6 = <b>200 UPH</b>
  <hr>
  <span class="uph-tip-sub">※ 값이 <b>높을수록</b> 효율이 좋습니다.
  분당 처리량(UPM)은 ÷60, 일당 처리량(UPD)은 ×8시간으로 환산한 값입니다.</span>
`;

const STYLE_ID = 'uph-tooltip-style';
const CSS = `
.uph-term{
  border-bottom:1px dotted currentColor;
  cursor:help;
  position:relative;
  white-space:nowrap;
}
.uph-term > .uph-tip{
  position:fixed;
  z-index:2147483000;
  display:none;
  width:min(20rem, calc(100vw - 24px));
  padding:10px 12px;
  border-radius:10px;
  background:#1f2937;
  color:#f3f4f6;
  font-size:11px;
  font-weight:400;
  line-height:1.6;
  letter-spacing:0;
  text-align:left;
  white-space:normal;
  word-break:keep-all;
  box-shadow:0 10px 30px rgba(0,0,0,.35);
  pointer-events:none;
}
.uph-term > .uph-tip b{ color:#fff; font-weight:700; }
.uph-term > .uph-tip hr{
  border:0; border-top:1px solid rgba(255,255,255,.15); margin:6px 0;
}
.uph-term > .uph-tip .uph-tip-sub{ display:block; color:#9ca3af; }
.uph-term > .uph-tip .uph-tip-formula{
  display:block; margin:2px 0; padding:5px 7px;
  background:rgba(255,255,255,.08); border-radius:6px;
  color:#93c5fd; font-weight:700;
}
.uph-term.uph-open > .uph-tip{ display:block; }
`;

let observer = null;
let scanScheduled = false;
let suppressObserver = false;

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
}

// 텍스트를 건드리면 안 되는 요소들
const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT',
    'OPTION', 'CANVAS', 'SVG', 'CODE', 'PRE', 'TITLE'
]);

function shouldSkip(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
        if (SKIP_TAGS.has(el.tagName)) return true;
        if (el.classList && el.classList.contains('uph-term')) return true;
        if (el.isContentEditable) return true;
    }
    return false;
}

// 'UPH'만 정확히 잡는다(UPHX 같은 단어 일부는 제외).
const UPH_RE = /UPH(?![A-Za-z0-9])/g;

function decorate(root) {
    if (!root || !root.ownerDocument && root.nodeType !== 9) return 0;

    const doc = root.nodeType === 9 ? root : root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue || node.nodeValue.indexOf('UPH') === -1) return NodeFilter.FILTER_REJECT;
            if (shouldSkip(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);

    targets.forEach(textNode => {
        const text = textNode.nodeValue;
        UPH_RE.lastIndex = 0;
        const frag = doc.createDocumentFragment();
        let last = 0, m;

        while ((m = UPH_RE.exec(text)) !== null) {
            if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));

            const term = doc.createElement('span');
            term.className = 'uph-term';
            term.setAttribute('tabindex', '0');
            term.setAttribute('role', 'button');
            term.setAttribute('aria-label', 'UPH 용어 설명 보기');
            term.appendChild(doc.createTextNode('UPH'));

            const tip = doc.createElement('span');
            tip.className = 'uph-tip';
            tip.innerHTML = TIP_HTML;
            term.appendChild(tip);

            frag.appendChild(term);
            last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));

        textNode.parentNode.replaceChild(frag, textNode);
    });

    return targets.length;
}

// 툴팁은 position:fixed라서 열릴 때 위치를 직접 계산한다.
// (부모에 overflow:hidden / transform 이 걸린 패널 안에서도 잘리지 않게 하기 위함)
function placeTip(term) {
    const tip = term.querySelector(':scope > .uph-tip');
    if (!tip) return;

    term.classList.add('uph-open');
    tip.style.left = '0px';
    tip.style.top = '0px';

    const r = term.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const margin = 8;

    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - t.width - margin));

    let top = r.bottom + 6;
    if (top + t.height > window.innerHeight - margin) {
        top = r.top - t.height - 6;                 // 아래 공간이 없으면 위로
        if (top < margin) top = Math.max(margin, window.innerHeight - t.height - margin);
    }

    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
}

function hideTip(term) {
    term.classList.remove('uph-open');
}

function bindInteractions() {
    const open = (e) => {
        const term = e.target.closest && e.target.closest('.uph-term');
        if (term) placeTip(term);
    };
    const close = (e) => {
        const term = e.target.closest && e.target.closest('.uph-term');
        if (term) hideTip(term);
    };

    document.addEventListener('mouseover', open, true);
    document.addEventListener('mouseout', close, true);
    document.addEventListener('focusin', open, true);
    document.addEventListener('focusout', close, true);

    // 모바일: 탭하면 열리고 바깥을 누르면 닫힘
    document.addEventListener('click', (e) => {
        const term = e.target.closest && e.target.closest('.uph-term');
        document.querySelectorAll('.uph-term.uph-open').forEach(el => { if (el !== term) hideTip(el); });
        if (term) placeTip(term);
    }, true);

    window.addEventListener('scroll', () => {
        document.querySelectorAll('.uph-term.uph-open').forEach(hideTip);
    }, true);
}

function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    // requestAnimationFrame은 백그라운드 탭에서 멈추므로 타이머를 쓴다.
    setTimeout(() => {
        scanScheduled = false;
        suppressObserver = true;
        try { decorate(document.body); } catch (e) { console.warn('[uph-tooltip] scan 실패:', e); }
        suppressObserver = false;
    }, 50);
}

export function initUphTooltips() {
    if (observer) return;
    injectStyle();
    bindInteractions();
    scheduleScan();

    // 이력 모달·리포트 등 대부분의 UPH는 자바스크립트로 나중에 그려지므로 DOM을 계속 감시한다.
    observer = new MutationObserver((mutations) => {
        if (suppressObserver) return;
        for (const m of mutations) {
            if (m.type !== 'childList' || m.addedNodes.length === 0) continue;
            for (const node of m.addedNodes) {
                const text = node.nodeType === 3 ? node.nodeValue : (node.textContent || '');
                if (text && text.indexOf('UPH') !== -1) { scheduleScan(); return; }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUphTooltips, { once: true });
} else {
    initUphTooltips();
}
