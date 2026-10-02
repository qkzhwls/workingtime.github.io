// === js/china-stock-gate.js ===
// 🔒 화면 게이트 — 로그인돼 있는지 확인하고, 아니면 화면을 가린다.
//
// china-stock 은 메인 앱과 같은 프로젝트(work-tool-e2943)를 쓴다.
// 같은 브라우저에서 메인 앱에 로그인해 두었다면 세션이 공유되어 그대로 열린다.
//
// ⚠️ 다만 세션이 공유되지 않는 경우가 있다 —
//    · 홈 화면에 추가한 앱(PWA)에서 링크를 눌러 '다른 브라우저'로 열릴 때 (iOS에서 특히)
//    · 시크릿/사생활 보호 모드, 저장공간 차단
//    이럴 때 "메인 앱에서 로그인하세요"만 띄우면 이미 로그인한 사용자는 막막해진다.
//    그래서 이 화면에서 바로 로그인할 수 있는 칸을 함께 둔다(계정은 메인 앱과 같다).
//
// ⚠️ 이건 '화면을 가리는' 장치다. 데이터 자체는 firestore.rules 가 막는다.
import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
// ⚠️ china-stock-goods.js 와 '똑같은 주소'로 가져와야 모듈이 한 번만 만들어진다(?v=9.9 포함).
import { initializeFirebase } from './china-stock-config.js?v=202610021228';

const OVERLAY_ID = 'cs-auth-gate';

const removeGate = () => {
    document.getElementById(OVERLAY_ID)?.remove();
    document.documentElement.style.overflow = '';
};

/** 확인 중 표시 */
const showChecking = () => {
    removeGate();
    const el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.style.cssText = BASE_STYLE;
    setGateBody(el, `<div style="font-size:40px;">🔒</div>
        <div style="font-size:16px; font-weight:800;">로그인 상태를 확인하는 중…</div>`);
    document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';
};

// ⚠️ 모바일에서 키보드가 올라오면 보이는 높이가 350~400px 로 줄어든다.
//    'flex + justify-content:center' 만 쓰면 내용이 그보다 커질 때 위아래가 잘리고,
//    스크롤도 안 돼서 로그인 버튼을 누를 수가 없다.
//    → 바깥은 스크롤 되는 상자, 안쪽은 margin:auto 로 가운데 정렬(넘치면 위에서부터 보인다).
const BASE_STYLE = `position:fixed; inset:0; z-index:2147483600; background:#f5f5f5;
    display:flex; overflow-y:auto; -webkit-overflow-scrolling:touch;
    font-family:'Noto Sans KR',sans-serif; color:#37474f; text-align:center;`;
const INNER_STYLE = `margin:auto; display:flex; flex-direction:column; align-items:center;
    gap:10px; padding:24px; width:100%;`;

/** 게이트 내용 채우기 — 바깥 스크롤 상자 안에 가운데 정렬 상자를 하나 두고 거기에 넣는다 */
const setGateBody = (el, html) => {
    el.innerHTML = `<div style="${INNER_STYLE}">${html}</div>`;
};

/** 로그인 칸이 있는 게이트 */
const showLogin = (auth) => {
    removeGate();
    const el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.style.cssText = BASE_STYLE;
    setGateBody(el, `
        <div style="font-size:40px;">🔒</div>
        <div style="font-size:17px; font-weight:800;">로그인이 필요합니다</div>
        <div style="font-size:12.5px; color:#78909c; line-height:1.7; max-width:320px;">
            업무관리와 같은 계정입니다.<br>휴대폰에서 한 번 로그인하면 다음부터는 바로 열립니다.
        </div>
        <form id="cs-login-form" style="display:flex; flex-direction:column; gap:8px; width:100%; max-width:300px; margin-top:6px;">
            <input id="cs-email" type="email" inputmode="email" autocomplete="username" placeholder="이메일"
                   style="padding:11px 12px; border:1px solid #cfd8dc; border-radius:9px; font-size:15px;">
            <input id="cs-pw" type="password" autocomplete="current-password" placeholder="비밀번호"
                   style="padding:11px 12px; border:1px solid #cfd8dc; border-radius:9px; font-size:15px;">
            <button type="submit" id="cs-login-btn"
                    style="padding:12px; border:0; border-radius:9px; background:#1976d2; color:#fff; font-size:15px; font-weight:700;">로그인</button>
            <div id="cs-login-err" style="font-size:12px; color:#c62828; min-height:16px;"></div>
        </form>
        <a href="index.html" style="font-size:12.5px; color:#607d8b;">업무관리 열기</a>`);
    document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';

    const form = el.querySelector('#cs-login-form');
    const err = el.querySelector('#cs-login-err');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = el.querySelector('#cs-login-btn');
        btn.disabled = true; btn.textContent = '로그인 중…'; err.textContent = '';
        try {
            await signInWithEmailAndPassword(auth,
                el.querySelector('#cs-email').value.trim(),
                el.querySelector('#cs-pw').value);
            // 성공하면 onAuthStateChanged 가 게이트를 걷어낸다
        } catch (e2) {
            const code = e2 && e2.code ? e2.code : '';
            err.textContent = (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found')
                ? '이메일 또는 비밀번호가 잘못되었습니다.'
                : `로그인 오류: ${code || e2}`;
            btn.disabled = false; btn.textContent = '로그인';
        }
    });
};

showChecking();

try {
    const { auth } = initializeFirebase();
    if (!auth) throw new Error('auth 없음');
    onAuthStateChanged(auth, (user) => {
        if (user) removeGate();
        else showLogin(auth);
    });
} catch (e) {
    console.warn('[china-stock] 로그인 확인 실패 — 게이트를 해제합니다:', e);
    removeGate();   // 확인 자체가 안 되면 화면을 막아 업무를 멈추게 하지는 않는다
}
