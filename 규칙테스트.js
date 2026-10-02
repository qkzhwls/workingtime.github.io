/**
 * Firestore 보안 규칙 자동 테스트 (Firebase 에뮬레이터)
 *
 * Cloud Shell 에서 실행한다. 실제 데이터베이스는 건드리지 않는다.
 * 가짜 프로젝트(demo-rules-test) 위에서 에뮬레이터로만 돈다.
 *
 *   npx firebase emulators:exec --only firestore --project demo-rules-test "node 규칙테스트.js"
 *
 * 실제 직원 이메일은 쓰지 않는다. 가짜 계정으로 판정 로직만 검증한다.
 */
const fs = require('fs');
const {
  initializeTestEnvironment, assertSucceeds, assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
} = require('firebase/firestore');

const APP = ['artifacts', 'team-work-logger-v2'];
const ADMIN = 'admin@example.test';
const STAFF = 'staff@example.test';

let pass = 0, fail = 0;
const results = [];

async function check(name, expect, fn) {
  try {
    await (expect === 'ALLOW' ? assertSucceeds(fn()) : assertFails(fn()));
    pass++; results.push(['OK  ', name]);
  } catch (e) {
    fail++; results.push(['실패', name + '  → ' + String(e.message || e).slice(0, 90)]);
  }
}

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  await testEnv.clearFirestore();

  // ── 규칙을 끈 상태로 시험용 문서를 심는다 ──────────────────────────────
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const roles = {};
    roles[ADMIN] = 'admin';
    roles[STAFF] = 'user';
    await setDoc(doc(db, ...APP, 'config', 'mainConfig'), { memberRoles: roles });
    await setDoc(doc(db, ...APP, 'config', 'sheetDashboard'), { scriptUrl: '', sheets: [] });
    await setDoc(doc(db, ...APP, 'daily_data', '2026-09-28'), { x: 1 });
    await setDoc(doc(db, ...APP, 'daily_data', '2026-09-28', 'workRecords', 'r1'), { x: 1 });
    await setDoc(doc(db, ...APP, 'history', '2026-09-28'), { x: 1 });
    await setDoc(doc(db, ...APP, 'persistent_data', 'leaveSchedule'), { x: 1 });
    await setDoc(doc(db, ...APP, 'plannedData', '2026-09-29'), { x: 1 });
    await setDoc(doc(db, ...APP, 'manuals', 'm_staff'), { author: STAFF, title: 'a' });
    await setDoc(doc(db, ...APP, 'manuals', 'm_admin'), { author: ADMIN, title: 'b' });
    await setDoc(doc(db, ...APP, 'manuals', 'm_old'), { title: 'c' });   // author 없음
    await setDoc(doc(db, 'Locations', 'x'), { x: 1 });
    await setDoc(doc(db, 'ChinaStockGoods', 'x'), { x: 1 });
  });

  const admin = testEnv.authenticatedContext('uadmin', { email: ADMIN }).firestore();
  const staff = testEnv.authenticatedContext('ustaff', { email: STAFF }).firestore();
  const upper = testEnv.authenticatedContext('uupper',
    { email: ADMIN.toUpperCase() }).firestore();
  const anon = testEnv.unauthenticatedContext().firestore();

  const cfg = (db) => doc(db, ...APP, 'config', 'mainConfig');

  // ── 급소: config/mainConfig ───────────────────────────────────────────
  await check('관리자가 mainConfig 읽기', 'ALLOW', () => getDoc(cfg(admin)));
  await check('★ 관리자가 mainConfig 수정', 'ALLOW', () => updateDoc(cfg(admin), { t: 1 }));
  await check('직원이 mainConfig 읽기', 'ALLOW', () => getDoc(cfg(staff)));
  await check('★ 직원이 mainConfig 수정', 'DENY', () => updateDoc(cfg(staff), { t: 1 }));
  await check('직원이 mainConfig 삭제', 'DENY', () => deleteDoc(cfg(staff)));
  await check('대소문자 달라도 관리자 인정', 'ALLOW', () => updateDoc(cfg(upper), { t: 1 }));

  // ── config 의 다른 문서는 전원 쓰기 (시트 대시보드) ───────────────────
  await check('직원이 sheetDashboard 수정', 'ALLOW',
    () => updateDoc(doc(staff, ...APP, 'config', 'sheetDashboard'), { t: 1 }));

  // ── 일상 업무 경로 — 막히면 안 된다 ───────────────────────────────────
  await check('직원이 daily_data 수정', 'ALLOW',
    () => updateDoc(doc(staff, ...APP, 'daily_data', '2026-09-28'), { t: 1 }));
  await check('직원이 workRecords 수정', 'ALLOW',
    () => updateDoc(doc(staff, ...APP, 'daily_data', '2026-09-28', 'workRecords', 'r1'), { t: 1 }));
  await check('직원이 history 수정', 'ALLOW',
    () => updateDoc(doc(staff, ...APP, 'history', '2026-09-28'), { t: 1 }));
  await check('직원이 persistent_data 수정', 'ALLOW',
    () => updateDoc(doc(staff, ...APP, 'persistent_data', 'leaveSchedule'), { t: 1 }));
  await check('직원이 plannedData 수정', 'ALLOW',
    () => updateDoc(doc(staff, ...APP, 'plannedData', '2026-09-29'), { t: 1 }));
  await check('직원이 notifications 생성', 'ALLOW',
    () => setDoc(doc(staff, ...APP, 'notifications', 'n1'), { t: 1 }));
  await check('직원이 weekend_requests 생성', 'ALLOW',
    () => setDoc(doc(staff, ...APP, 'weekend_requests', 'w1'), { t: 1 }));

  // ── 매뉴얼 ────────────────────────────────────────────────────────────
  await check('직원이 매뉴얼 작성', 'ALLOW',
    () => setDoc(doc(staff, ...APP, 'manuals', 'm_new'), { author: STAFF, title: 'n' }));
  await check('직원이 본인 매뉴얼 수정', 'ALLOW',
    () => updateDoc(doc(staff, ...APP, 'manuals', 'm_staff'), { title: 'z' }));
  await check('직원이 남의 매뉴얼 수정', 'DENY',
    () => updateDoc(doc(staff, ...APP, 'manuals', 'm_admin'), { title: 'z' }));
  await check('직원이 author 없는 옛 매뉴얼 수정', 'DENY',
    () => updateDoc(doc(staff, ...APP, 'manuals', 'm_old'), { title: 'z' }));
  await check('관리자가 남의 매뉴얼 수정', 'ALLOW',
    () => updateDoc(doc(admin, ...APP, 'manuals', 'm_staff'), { title: 'z' }));

  // ── integrations (자동화 전용 — 클라이언트 쓰기 금지) ─────────────────
  // 이지어드민 연동 숫자가 여기 있다. 대시보드가 이 문서의 lastOkAt 으로
  // '언제 기준 숫자인가'·'오래됐다' 를 판단하므로, 클라이언트가 쓸 수 있으면
  // 브라우저 콘솔 한 줄로 그 경고를 거짓으로 만들 수 있다.
  await check('직원이 integrations 생성', 'DENY',
    () => setDoc(doc(staff, ...APP, 'integrations', 'ezadmin'), { invoice: 9 }));
  await check('직원이 integrations 수정', 'DENY',
    () => updateDoc(doc(staff, ...APP, 'integrations', 'ezadmin'), { invoice: 9 }));
  await check('관리자도 integrations 쓰기 금지', 'DENY',
    () => setDoc(doc(admin, ...APP, 'integrations', 'ezadmin'), { invoice: 9 }));
  await check('직원이 integrations 읽기', 'ALLOW',
    () => getDoc(doc(staff, ...APP, 'integrations', 'ezadmin')));

  // ── 최상위 컬렉션 ─────────────────────────────────────────────────────
  await check('직원이 Locations 수정', 'ALLOW',
    () => updateDoc(doc(staff, 'Locations', 'x'), { t: 1 }));
  await check('직원이 ChinaStockGoods 수정', 'ALLOW',
    () => updateDoc(doc(staff, 'ChinaStockGoods', 'x'), { t: 1 }));

  // ── 미인증은 전부 막혀야 한다 ─────────────────────────────────────────
  await check('미인증 history 읽기', 'DENY',
    () => getDoc(doc(anon, ...APP, 'history', '2026-09-28')));
  await check('미인증 mainConfig 읽기', 'DENY', () => getDoc(cfg(anon)));
  await check('미인증 Locations 읽기', 'DENY', () => getDoc(doc(anon, 'Locations', 'x')));
  await check('미인증 쓰기', 'DENY',
    () => setDoc(doc(anon, ...APP, 'daily_data', '2026-09-28'), { t: 1 }));

  // ── 규칙에 없는 경로 ──────────────────────────────────────────────────
  await check('직원이 미정의 컬렉션 쓰기', 'DENY',
    () => setDoc(doc(staff, 'RandomCollection', 'x'), { t: 1 }));
  await check('직원이 미정의 컬렉션 읽기', 'DENY',
    () => getDoc(doc(staff, 'RandomCollection', 'x')));

  await testEnv.cleanup();

  console.log('');
  for (const [mark, name] of results) console.log(`  ${mark}  ${name}`);
  console.log(`\n통과 ${pass} / 실패 ${fail}`);
  if (fail === 0) {
    console.log('\n전부 통과했습니다. 게시해도 됩니다.');
  } else {
    console.log('\n실패가 있습니다. 게시하지 마세요.');
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('실행 오류:', e);
  process.exit(1);
});
