// === js/listeners-auth.js ===
// 설명: 로그인/로그아웃 관련 리스너를 담당합니다.

import * as DOM from './dom-elements.js?v=202610021042';
import * as State from './state.js?v=202610021042';
import { showToast } from './utils.js?v=202610021042';
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export function setupAuthListeners() {

    if (DOM.loginForm) {
        DOM.loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (DOM.loginSubmitBtn) DOM.loginSubmitBtn.disabled = true;
            if (DOM.loginButtonText) DOM.loginButtonText.classList.add('hidden');
            if (DOM.loginButtonSpinner) DOM.loginButtonSpinner.classList.remove('hidden');
            if (DOM.loginErrorMsg) DOM.loginErrorMsg.classList.add('hidden');

            const email = DOM.loginEmailInput.value;
            const password = DOM.loginPasswordInput.value;

            try {
                await signInWithEmailAndPassword(State.auth, email, password);
                if (DOM.loginPasswordInput) DOM.loginPasswordInput.value = '';
            } catch (error) {
                console.error('Login error:', error.code, error.message);
                if (DOM.loginErrorMsg) {
                    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                        DOM.loginErrorMsg.textContent = '이메일 또는 비밀번호가 잘못되었습니다.';
                    } else {
                        DOM.loginErrorMsg.textContent = `로그인 오류: ${error.code}`;
                    }
                    DOM.loginErrorMsg.classList.remove('hidden');
                }
            } finally {
                if (DOM.loginSubmitBtn) DOM.loginSubmitBtn.disabled = false;
                if (DOM.loginButtonText) DOM.loginButtonText.classList.remove('hidden');
                if (DOM.loginButtonSpinner) DOM.loginButtonSpinner.classList.add('hidden');
            }
        });
    }

    if (DOM.logoutBtn) {
        DOM.logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(State.auth);
            } catch (error) {
                console.error('Logout error:', error);
                showToast('로그아웃 중 오류가 발생했습니다.', true);
            }
        });
    }

    if (DOM.logoutBtnMobile) {
        DOM.logoutBtnMobile.addEventListener('click', async () => {
            try {
                await signOut(State.auth);
            } catch (error) {
                console.error('Logout error:', error);
                showToast('로그아웃 중 오류가 발생했습니다.', true);
            }
        });
    }
}