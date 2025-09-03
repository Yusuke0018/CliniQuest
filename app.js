/*
  CliniQuest MVP
  - ルーティング: #/home | #/create | #/study | #/profile
  - Firebase: 匿名サインイン、Firestore永続化
  - 追加: Firestore保存(+5XP一度きり)、学習で正解時のXP/会心/レベルUP
*/

const qs = (s, el = document) => el.querySelector(s);
const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

// -------- PWA: Service Worker & install prompt --------
const swUrl = './service-worker.js';
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl).catch(console.warn);
  });
}
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = qs('#installBtn');
  if (btn) btn.hidden = false;
});
qs('#installBtn')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  qs('#installBtn').hidden = true;
});

// -------- Online/Offline indicator --------
const onlineStatusEl = qs('#onlineStatus');
function updateOnline() {
  if (!onlineStatusEl) return;
  onlineStatusEl.textContent = navigator.onLine ? 'オンライン' : 'オフライン';
  const banner = qs('#offlineBanner');
  if (banner) {
    if (navigator.onLine) banner.classList.remove('show');
    else {
      banner.hidden = false;
      requestAnimationFrame(() => banner.classList.add('show'));
    }
  }
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
updateOnline();

// -------- Force-clear caches on each load (developer preference) --------
async function forceClearCaches() {
  try {
    if (!('caches' in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    // Also trigger SW update if registered
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update().catch(() => {})));
    }
  } catch (e) {
    console.warn('Cache clear failed', e);
  }
}
forceClearCaches();

// -------- Theme (light/dark-DQ) toggle --------
function applyTheme(theme) {
  const body = document.body;
  if (theme === 'dark') {
    body.dataset.theme = 'dark';
    body.classList.add('dq-font');
  } else {
    delete body.dataset.theme;
    body.classList.remove('dq-font');
  }
  localStorage.setItem('clq.theme', theme);
  const btn = qs('#themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '🌞 ライト' : '🌙 ダーク(DQ)';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b2550' : '#ffffff');
}

function initTheme() {
  const saved = localStorage.getItem('clq.theme') || 'light';
  applyTheme(saved);
  qs('#themeToggle')?.addEventListener('click', () => {
    const cur = (localStorage.getItem('clq.theme') || 'light') === 'dark' ? 'light' : 'dark';
    applyTheme(cur);
  });
}

// -------- Mobile swipe navigation (左右スワイプで画面移動・ループ) --------
function attachSwipeNav() {
  const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : true;
  if (!coarse) return;
  let startX = 0;
  let startY = 0;
  let tracking = false;
  const isInteractive = (el) => {
    if (!el) return false;
    const t = el.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(t)) return true;
    return el.closest && el.closest('input,textarea,select,button,a,[contenteditable="true"]');
  };
  const onStart = (x, y, target) => {
    if (isInteractive(target)) {
      tracking = false;
      return;
    }
    startX = x;
    startY = y;
    tracking = true;
  };
  const onMove = (y) => {
    if (!tracking) return;
    const dy = y - startY;
    if (Math.abs(dy) > 50) tracking = false; // 縦スクロール優先
  };
  const onEnd = (x, y) => {
    if (!tracking) return;
    tracking = false;
    const dx = x - startX;
    const dy = y - startY;
    if (Math.abs(dy) > 50) return;
    const threshold = 25;
    if (dx <= -threshold) navigateRelative(1);
    else if (dx >= threshold) navigateRelative(-1);
  };
  // Touch events
  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches && e.touches.length > 1) return;
      const t = e.touches ? e.touches[0] : e;
      onStart(t.clientX, t.clientY, e.target);
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches ? e.touches[0] : e;
      onMove(t.clientY);
    },
    { passive: true },
  );
  document.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches ? e.changedTouches[0] : e;
      onEnd(t.clientX, t.clientY);
    },
    { passive: true },
  );
  // Pointer events (for broader support)
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return;
      onStart(e.clientX, e.clientY, e.target);
    },
    { passive: true },
  );
  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'touch') return;
      onMove(e.clientY);
    },
    { passive: true },
  );
  document.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerType !== 'touch') return;
      onEnd(e.clientX, e.clientY);
    },
    { passive: true },
  );
}

function navigateRelative(step) {
  const path = getPath();
  const idx = NAV_ORDER.indexOf(path);
  const cur = idx >= 0 ? idx : 0;
  const next = (cur + step + NAV_ORDER.length) % NAV_ORDER.length;
  location.hash = '#' + NAV_ORDER[next];
}

// -------- Firebase (modular ESM via CDN) --------
// config は 1) window.CLQ_FIREBASE_CONFIG (config.jsで定義) が優先、2) 下記の空プレースホルダ
const firebaseConfig = window.CLQ_FIREBASE_CONFIG ?? {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

let fb = {
  app: null,
  auth: null,
  db: null,
  user: null,
};

// ---- ゲーム定数・状態 ----
const LEVEL_SIZE = 80;
// ステ振りテンプレート（1レベル当たり合計10になるよう調整）
const SETS = [
  [4, 3, 2, 1], // 合計10
  [4, 4, 1, 1], // 合計10
  [5, 3, 1, 1], // 合計10
  [3, 3, 3, 1], // 合計10
];
const PERMS = (() => {
  const base = [0, 1, 2, 3];
  const res = [];
  const permute = (arr, l = 0) => {
    if (l === arr.length - 1) {
      res.push(arr.slice());
      return;
    }
    for (let i = l; i < arr.length; i++) {
      [arr[l], arr[i]] = [arr[i], arr[l]];
      permute(arr, l + 1);
      [arr[l], arr[i]] = [arr[i], arr[l]];
    }
  };
  permute(base);
  return res;
})();

const state = {
  userDoc: null,
  session: {
    history: [],
    filters: { dueOnly: true, articleId: null, qaId: null, studyMode: 'due', ageDays: 3 },
  },
};

const titlesByLevel = new Map([
  [2, '見習い医師'],
  [4, '町医者'],
  [6, '若手臨床家'],
  [8, '当直番長'],
  [10, '診断の探求者'],
  [12, 'カルテの達人'],
  [14, '処方の匠'],
  [16, '救急の番人'],
  [18, '感染症ハンター'],
  [20, '呼吸器の剣士'],
  [22, '循環器の盾'],
  [24, '消化器の錬金術師'],
  [26, '内分泌の賢者'],
  [28, '腎臓の守人'],
  [30, '神経の詠唱者'],
  [32, '皮膚の識者'],
  [34, '小児の守護者'],
  [36, '在宅の旅人'],
  [38, '総合診療の導き手'],
  [40, 'ガイドライン読破者'],
  [42, 'EBMの求道者'],
  [44, '臨床推論家'],
  [46, '証拠の錬成師'],
  [48, '合併症見抜き人'],
  [50, '重症管理人'],
  [52, '外来オーケストラ指揮者'],
  [54, 'チーム医療の要'],
  [56, '患者説明の語り部'],
  [58, '医療安全の番人'],
  [60, '生活習慣コーチ'],
  [62, '予防医療の旗手'],
  [64, '研究心の探検家'],
  [66, '学びの設計者'],
  [68, '指導医見習い'],
  [70, '指導医'],
  [72, '部門統括'],
  [74, '医療経営の参謀'],
  [76, '地域医療の灯'],
  [78, '臨床の賢者'],
  [80, '百戦錬磨の臨床家'],
  [82, '知見の収集家'],
  [84, 'データ読解師'],
  [86, '合理の求道者'],
  [88, '観察眼の達人'],
  [90, '忍耐の達人'],
  [92, '共感の達人'],
  [94, '技術の大家'],
  [96, '判断の達人'],
  [98, '知識の賢王'],
  [100, '伝説の医師'],
]);

function levelTitle(level) {
  let title = '-';
  for (const [lv, name] of titlesByLevel) {
    if (level >= lv) title = name;
  }
  return title;
}

function seedFromUid(uid) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ---- Articles（Obsidian風リンク対応） ----
function slugify(title) {
  return (title || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
}

function parseWikiLinks(md) {
  // [[Title]] を #/article?slug=title にリンク
  return (md || '').replace(/\[\[([^\]]+)\]\]/g, (m, p1) => {
    const slug = slugify(p1);
    return `<a href="#/article?slug=${encodeURIComponent(slug)}">${p1}</a>`;
  });
}

async function createOrGetArticleByTitle(title) {
  const { collection, addDoc, getDocs, query, where, limit, serverTimestamp } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) throw new Error('未サインイン');
  const slug = slugify(title);
  const q = query(
    collection(fb.db, 'articles'),
    where('uid', '==', uid),
    where('slug', '==', slug),
    limit(1),
  );
  const snap = await getDocs(q);
  if (!snap.empty) return snap.docs[0].id;
  const ref = await addDoc(collection(fb.db, 'articles'), {
    uid,
    title,
    slug,
    body: '',
    tags: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

async function initFirebase() {
  if (!firebaseConfig.projectId) {
    console.warn('Firebase 未設定です。config.js を用意してください。');
    return;
  }
  const [
    { initializeApp },
    {
      getAuth,
      onAuthStateChanged,
      signInAnonymously,
      EmailAuthProvider,
      linkWithCredential,
      signInWithEmailAndPassword,
      signOut,
      GoogleAuthProvider,
      signInWithPopup,
      linkWithPopup,
      signInWithRedirect,
      linkWithRedirect,
    },
    firestore,
  ] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
  ]);

  const {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    collection,
    addDoc,
    getDocs,
    query,
    where,
    limit,
    orderBy,
    serverTimestamp,
    increment,
    runTransaction,
  } = firestore;

  // expose for helpers
  fb.fs = {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    collection,
    addDoc,
    getDocs,
    query,
    where,
    limit,
    orderBy,
    serverTimestamp,
    increment,
    runTransaction,
  };

  fb.app = initializeApp(firebaseConfig);
  fb.auth = getAuth(fb.app);
  // Firestore: オフライン永続化 + 複数タブマネージャ
  fb.db = initializeFirestore(fb.app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  fb.authApi = {
    EmailAuthProvider,
    linkWithCredential,
    signInWithEmailAndPassword,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    linkWithPopup,
    signInWithRedirect,
    linkWithRedirect,
  };

  onAuthStateChanged(fb.auth, async (user) => {
    if (!user) {
      await signInAnonymously(fb.auth).catch((e) => console.error('匿名サインイン失敗', e));
      return;
    }
    fb.user = user;
    await ensureUserInitialized();
    await ensureBaseStatsApplied();
    subscribeUserDoc();
    render();
  });
}

// ---- Users 初期化・購読 ----
async function ensureUserInitialized() {
  const { doc, getDoc, setDoc, serverTimestamp } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) return;
  const ref = doc(fb.db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const seed = seedFromUid(uid);
    await setDoc(ref, {
      displayName: null,
      seed,
      level: 1,
      totalXp: 0,
      totalCorrect: 0,
      totalCreated: 0,
      // LV1 から素のステータスを付与
      stats: { knowledge: 5, judgment: 5, skill: 5, empathy: 5 },
      statsBaseVersion: 2,
      streak: { current: 0, best: 0, lastActiveYmd: null },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

// 既存ユーザー向け: 基礎ステータスを未適用なら付与
async function ensureBaseStatsApplied() {
  const { doc, getDoc, updateDoc, serverTimestamp, runTransaction } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) return;
  const ref = doc(fb.db, 'users', uid);
  try {
    await runTransaction(fb.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const u = snap.data();
      if (u.statsBaseVersion >= 2) return; // 既に適用済み
      const s = u.stats || { knowledge: 0, judgment: 0, skill: 0, empathy: 0 };
      const patch = {
        stats: {
          knowledge: (s.knowledge || 0) + 5,
          judgment: (s.judgment || 0) + 5,
          skill: (s.skill || 0) + 5,
          empathy: (s.empathy || 0) + 5,
        },
        statsBaseVersion: 2,
        updatedAt: serverTimestamp(),
      };
      tx.update(ref, patch);
    });
  } catch {}
}

function subscribeUserDoc() {
  const { doc, onSnapshot } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) return;
  const ref = doc(fb.db, 'users', uid);
  onSnapshot(ref, (snap) => {
    state.userDoc = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    const path = getPath();
    if (path === '/home' || path === '/profile') render();
  });
}

// ---- ゲームロジック ----
function computeLevel(totalXp) {
  return Math.floor((totalXp || 0) / LEVEL_SIZE) + 1;
}

function computeLevelUpIncrements(seed, fromLevelExcl, toLevelIncl) {
  const inc = { knowledge: 0, judgment: 0, skill: 0, empathy: 0 };
  for (let lv = fromLevelExcl + 1; lv <= toLevelIncl; lv++) {
    const setIdx = (seed + lv) % 4;
    const permIdx = (seed ^ (lv * 31)) % 24;
    const values = SETS[setIdx];
    const perm = PERMS[permIdx];
    const add = [values[perm[0]], values[perm[1]], values[perm[2]], values[perm[3]]];
    inc.knowledge += add[0];
    inc.judgment += add[1];
    inc.skill += add[2];
    inc.empathy += add[3];
  }
  return inc;
}

// ---- JST ストリークと日次ログ補助 ----
function getJstYmd(date = new Date()) {
  const t = date.getTime() + 9 * 3600 * 1000; // +09:00
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function ymdToJstDate(ymd) {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const utc = Date.UTC(y, m - 1, d) - 9 * 3600 * 1000; // JST 0:00 をUTCへ
  return new Date(utc);
}

function ymdDiff(a, b) {
  const da = ymdToJstDate(a);
  const db = ymdToJstDate(b);
  return Math.round((da - db) / (24 * 3600 * 1000));
}

// yyyymmdd に日数を加算（JST基準）
function addDaysToYmd(ymd, days) {
  const base = ymdToJstDate(ymd);
  const next = new Date(base.getTime() + days * 24 * 3600 * 1000);
  return getJstYmd(next);
}

function nextStreak(streak, todayYmd) {
  const last = streak?.lastActiveYmd || null;
  if (!last) return { current: 1, best: 1, lastActiveYmd: todayYmd };
  const diff = ymdDiff(todayYmd, last);
  if (diff === 0)
    return { current: streak.current || 1, best: streak.best || 1, lastActiveYmd: last };
  if (diff === 1) {
    const cur = (streak.current || 0) + 1;
    const best = Math.max(streak.best || 0, cur);
    return { current: cur, best, lastActiveYmd: todayYmd };
  }
  return { current: 1, best: Math.max(streak.best || 0, 1), lastActiveYmd: todayYmd };
}

function logsDailyDocRef(uid, ymd) {
  const { doc } = fb.fs;
  // users/{uid}/logs_daily/{ymd} に保存（権限管理しやすくする）
  return doc(fb.db, 'users', uid, 'logs_daily', ymd);
}

// カレンダーピッカー（date input）で日付(YYYYMMDD)を選ばせるモーダル
function chooseNextDueYmdDialog(initialYmd) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const card = document.createElement('div');
    card.className = 'window';
    card.style.maxWidth = '420px';
    const initStr =
      initialYmd && /^\d{8}$/.test(initialYmd)
        ? `${initialYmd.slice(0, 4)}-${initialYmd.slice(4, 6)}-${initialYmd.slice(6, 8)}`
        : '';
    card.innerHTML = `
      <h2 class="title">次回復習タイミング</h2>
      <div class="grid">
        <div class="field"><label>日付</label><input id="duePicker" type="date" value="${initStr}"/></div>
        <div class="row" style="justify-content:flex-end;gap:.5rem;">
          <button class="btn secondary" id="cancelPick">キャンセル</button>
          <button class="btn" id="okPick">保存</button>
        </div>
      </div>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const cleanup = (val) => {
      try {
        document.body.removeChild(overlay);
      } catch {}
      resolve(val);
    };
    card.querySelector('#cancelPick').addEventListener('click', () => cleanup(null));
    card.querySelector('#okPick').addEventListener('click', () => {
      const v = card.querySelector('#duePicker').value;
      if (!v) return cleanup(null);
      const ymd = v.replace(/-/g, '');
      cleanup(ymd);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(null);
    });
  });
}

// 今日の復習数を数える（期日到来 or nextDueYmd 未設定）
async function countDueToday(limitN = 500) {
  if (!fb.fs) return 0;
  const { collection, getDocs, query, where, limit } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) return 0;
  const today = getJstYmd();
  const snap = await getDocs(
    query(collection(fb.db, 'qas'), where('uid', '==', uid), limit(limitN)),
  );
  return snap.docs.filter((d) => {
    const srs = d.data().srs;
    if (!srs || !srs.nextDueYmd) return true;
    return srs.nextDueYmd <= today;
  }).length;
}

// 学習の正誤に応じて SRS を更新
async function updateQaSrs(qaId, isCorrect) {
  if (!fb.fs) throw new Error('Firestore 未初期化');
  const { doc, runTransaction, serverTimestamp, getDoc } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) throw new Error('未サインイン');
  const ref = doc(fb.db, 'qas', qaId);
  await runTransaction(fb.db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('QA not found');
    const v = snap.data();
    if (v.uid !== uid) throw new Error('権限がありません');
    const cur = v.srs || {
      reps: 0,
      ease: 2.5,
      interval: 0,
      nextDueYmd: getJstYmd(),
      lastReviewedAt: null,
    };
    let reps = Number(cur.reps || 0);
    let ease = typeof cur.ease === 'number' ? cur.ease : 2.5;
    let interval = Number(cur.interval || 0);
    if (isCorrect) {
      reps += 1;
      ease = Math.max(1.3, Math.round((ease + 0.02) * 100) / 100);
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 3;
      else interval = Math.max(1, Math.round(interval * ease));
    } else {
      reps = 0;
      interval = 0;
      ease = Math.max(1.3, Math.round((ease - 0.2) * 100) / 100);
    }
    const today = getJstYmd();
    const nextDue = interval > 0 ? addDaysToYmd(today, interval) : today;
    tx.update(ref, {
      srs: { reps, ease, interval, nextDueYmd: nextDue, lastReviewedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    });
  });
}

// 問題編集用のモーダル（問/答え/解説/タグ/次の期日）
async function openQaEditDialog(qaId) {
  const { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, getDocs } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) return alert('未サインインです');
  const ref = doc(fb.db, 'qas', qaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return alert('問題が見つかりません');
  const v = snap.data();
  const q0 = v.question || '';
  const a0 = v.answer || '';
  const r0 = v.rationale || '';
  const t0 = (v.tags || []).join(', ');
  const d0 = v.srs?.nextDueYmd
    ? `${v.srs.nextDueYmd.slice(0, 4)}-${v.srs.nextDueYmd.slice(4, 6)}-${v.srs.nextDueYmd.slice(6, 8)}`
    : '';

  // 記事一覧（自身のもの）
  let artOptions = '<option value="">（なし）</option>';
  try {
    const as = await getDocs(query(collection(fb.db, 'articles'), where('uid', '==', uid)));
    const items = as.docs.map((d) => ({ id: d.id, ...d.data() }));
    artOptions += items
      .map(
        (it) =>
          `<option value="${it.id}" ${v.articleId === it.id ? 'selected' : ''}>${(it.title || '(無題)').replace(/</g, '&lt;')}</option>`,
      )
      .join('');
  } catch {}

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const card = document.createElement('div');
    card.className = 'window';
    card.style.maxWidth = '680px';
    card.innerHTML = `
      <h2 class="title">問題を編集</h2>
      <form id="qaEditForm" class="grid">
        <div class="field"><label>記事（任意）</label><select id="editArticle">${artOptions}</select></div>
        <div class="field"><label>問題（Q）</label><textarea id="editQ" rows="3">${q0.replace(/</g, '&lt;')}</textarea></div>
        <div class="field"><label>答え（A）</label><textarea id="editA" rows="3">${a0.replace(/</g, '&lt;')}</textarea></div>
        <div class="field"><label>解説（任意）</label><textarea id="editR" rows="3">${r0.replace(/</g, '&lt;')}</textarea></div>
        <div class="field"><label>タグ（カンマ区切り）</label><input id="editTags" value="${t0.replace(/"/g, '&quot;')}"/></div>
        <div class="field"><label>次の期日</label><input id="editDue" type="date" value="${d0}"/></div>
        <details class="card"><summary>プレビュー</summary>
          <div id="qaPreview" class="muted" style="white-space:pre-wrap;padding:.5rem;">（入力すると表示します）</div>
        </details>
        <div class="row" style="justify-content:flex-end;gap:.5rem;">
          <button class="btn secondary" type="button" id="qaCancel">キャンセル</button>
          <button class="btn" type="submit">保存</button>
        </div>
      </form>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const cleanup = (ok = false) => {
      try {
        document.body.removeChild(overlay);
      } catch {}
      resolve(ok);
    };

    // 入力に応じてプレビュー更新
    const updatePreview = () => {
      const qv = card.querySelector('#editQ').value;
      const av = card.querySelector('#editA').value;
      const rv = card.querySelector('#editR').value;
      const esc = (t) =>
        String(t || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;');
      const pv = card.querySelector('#qaPreview');
      if (pv)
        pv.innerHTML = `Q:
${esc(qv)}

A:
${esc(av)}${
          rv
            ? `

解説:
${esc(rv)}`
            : ''
        }`;
    };
    ['#editQ', '#editA', '#editR'].forEach((sel) =>
      card.querySelector(sel).addEventListener('input', updatePreview),
    );
    updatePreview();
    card.querySelector('#qaCancel').addEventListener('click', () => cleanup(false));
    card.querySelector('#qaEditForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const q1 = card.querySelector('#editQ').value.trim();
        const a1 = card.querySelector('#editA').value.trim();
        const r1 = card.querySelector('#editR').value.trim();
        const t1 = card.querySelector('#editTags').value;
        const d1 = card.querySelector('#editDue').value; // yyyy-mm-dd
        if (!q1 || !a1) return alert('Q と A は必須です');
        if (q1.length < 3 || a1.length < 1) return alert('内容が短すぎます');
        const artSel = card.querySelector('#editArticle').value;
        const tags = (t1 || '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length);
        const patch = {
          question: q1,
          answer: a1,
          rationale: r1 || null,
          tags,
          updatedAt: serverTimestamp(),
        };
        patch.articleId = artSel || null;
        patch.articleId = artSel || null;
        if (d1 && /^\d{4}-\d{2}-\d{2}$/.test(d1)) {
          const ymd = d1.replace(/-/g, '');
          const today = getJstYmd();
          const cur = v.srs || { reps: 0, ease: 2.5, interval: 0 };
          const pickedInterval = Math.max(0, ymdDiff(ymd, today));
          patch.srs = { ...cur, nextDueYmd: ymd, interval: pickedInterval };
        }
        await updateDoc(ref, patch);
        showToast && showToast('問題を更新しました');
        cleanup(true);
      } catch (err) {
        console.error(err);
        alert('更新に失敗しました: ' + (err?.message || err));
      }
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });
  });
}

async function createQaAndAward(q, a, r, tagsCsv, articleIdArg = null) {
  const { collection, addDoc, serverTimestamp, doc, runTransaction } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) throw new Error('未サインイン');
  const tags = (tagsCsv || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length);

  // 記事選択（任意）
  const articleId = articleIdArg || state.session?.filters?.articleId || null;

  // SRS 初期値: 追加直後は今日（JST）にDue
  const today = getJstYmd();

  const qaRef = await addDoc(collection(fb.db, 'qas'), {
    uid,
    articleId,
    question: q,
    answer: a,
    rationale: r || null,
    tags,
    createdXpAwarded: false,
    srs: { reps: 0, ease: 2.5, interval: 0, nextDueYmd: today, lastReviewedAt: null },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const userRef = doc(fb.db, 'users', uid);
  await runTransaction(fb.db, async (tx) => {
    const qaSnap = await tx.get(qaRef);
    if (!qaSnap.exists()) throw new Error('QA not found');
    const qa = qaSnap.data();
    if (qa.createdXpAwarded) return;
    let userSnap = await tx.get(userRef);
    let u = userSnap.exists() ? userSnap.data() : null;
    if (!u) {
      const seedInit = seedFromUid(uid);
      const init = {
        displayName: null,
        seed: seedInit,
        level: 1,
        totalXp: 0,
        totalCorrect: 0,
        totalCreated: 0,
        stats: { knowledge: 0, judgment: 0, skill: 0, empathy: 0 },
        streak: { current: 0, best: 0, lastActiveYmd: null },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      tx.set(userRef, init);
      u = init;
    }
    const addXp = 5;
    const prevXp = u.totalXp || 0;
    const prevLevel = u.level || 1;
    const newXp = prevXp + addXp;
    const newLevel = computeLevel(newXp);
    const seed = u.seed ?? seedFromUid(uid);
    const inc = newLevel > prevLevel ? computeLevelUpIncrements(seed, prevLevel, newLevel) : null;
    const todayYmd = getJstYmd();
    const newStreak = nextStreak(
      u.streak || { current: 0, best: 0, lastActiveYmd: null },
      todayYmd,
    );
    // 日次ログは読み取らずにインクリメントで更新
    const ldRef = logsDailyDocRef(uid, todayYmd);
    const patch = {
      totalXp: newXp,
      level: newLevel,
      totalCreated: (u.totalCreated || 0) + 1,
      streak: newStreak,
      updatedAt: serverTimestamp(),
    };
    if (inc) {
      patch.stats = {
        knowledge: (u.stats?.knowledge || 0) + inc.knowledge,
        judgment: (u.stats?.judgment || 0) + inc.judgment,
        skill: (u.stats?.skill || 0) + inc.skill,
        empathy: (u.stats?.empathy || 0) + inc.empathy,
      };
    }
    // 以降は書き込みのみ
    tx.update(userRef, patch);
    tx.update(qaRef, { createdXpAwarded: true, updatedAt: serverTimestamp() });
    tx.set(
      ldRef,
      {
        uid,
        ymd: todayYmd,
        created: fb.fs.increment(1),
        xp: fb.fs.increment(addXp),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

async function awardCorrectXpAndUpdate(totalCorrectDelta = 1) {
  const { doc, runTransaction, serverTimestamp } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) throw new Error('未サインイン');
  const userRef = doc(fb.db, 'users', uid);
  return runTransaction(fb.db, async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists()) throw new Error('user not found');
    const u = snap.data();
    const seed = u.seed ?? seedFromUid(uid);
    const isCritical = (seed + (u.totalCorrect || 0)) % 20 === 0;
    const gain = isCritical ? 2 : 1; // 倍増: 通常1XP→会心2XP
    const prevXp = u.totalXp || 0;
    const prevLevel = u.level || 1;
    const newXp = prevXp + gain;
    const newLevel = computeLevel(newXp);
    const inc = newLevel > prevLevel ? computeLevelUpIncrements(seed, prevLevel, newLevel) : null;
    const today = getJstYmd();
    const newStreak = nextStreak(u.streak || { current: 0, best: 0, lastActiveYmd: null }, today);
    const patch = {
      totalXp: newXp,
      level: newLevel,
      totalCorrect: (u.totalCorrect || 0) + totalCorrectDelta,
      streak: newStreak,
      updatedAt: serverTimestamp(),
    };
    if (inc) {
      patch.stats = {
        knowledge: (u.stats?.knowledge || 0) + inc.knowledge,
        judgment: (u.stats?.judgment || 0) + inc.judgment,
        skill: (u.stats?.skill || 0) + inc.skill,
        empathy: (u.stats?.empathy || 0) + inc.empathy,
      };
    }
    tx.update(userRef, patch);
    // logs_daily 集計（読み取りなしでインクリメント）
    const ldRef = logsDailyDocRef(uid, today);
    tx.set(
      ldRef,
      {
        uid,
        ymd: today,
        correct: fb.fs.increment(1),
        xp: fb.fs.increment(gain),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    const leveledUp = newLevel > prevLevel;
    return { isCritical, gain, leveledUp, levelAfter: newLevel };
  });
}

// 任意XPを付与（正解/作問カウントは触らない）
async function awardXp(addXp) {
  const { doc, runTransaction, serverTimestamp, updateDoc, setDoc } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid || !addXp) return;
  const userRef = doc(fb.db, 'users', uid);
  // Ensure the user document exists
  try {
    await ensureUserInitialized();
  } catch {}
  try {
    await runTransaction(fb.db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error('user not found');
      const u = snap.data();
      const today = getJstYmd();
      const ldRef = logsDailyDocRef(uid, today);
      const prevXp = u.totalXp || 0;
      const prevLevel = u.level || 1;
      const newXp = prevXp + addXp;
      const newLevel = computeLevel(newXp);
      const seed = u.seed ?? seedFromUid(uid);
      const inc = newLevel > prevLevel ? computeLevelUpIncrements(seed, prevLevel, newLevel) : null;
      const newStreak = nextStreak(u.streak || { current: 0, best: 0, lastActiveYmd: null }, today);
      const patch = {
        totalXp: newXp,
        level: newLevel,
        streak: newStreak,
        updatedAt: serverTimestamp(),
      };
      if (inc) {
        patch.stats = {
          knowledge: (u.stats?.knowledge || 0) + inc.knowledge,
          judgment: (u.stats?.judgment || 0) + inc.judgment,
          skill: (u.stats?.skill || 0) + inc.skill,
          empathy: (u.stats?.empathy || 0) + inc.empathy,
        };
      }
      tx.update(userRef, patch);
      tx.set(
        ldRef,
        { uid, ymd: today, xp: fb.fs.increment(addXp), updatedAt: serverTimestamp() },
        { merge: true },
      );
    });
  } catch (err) {
    // Fallback: increment XP only (level/stats will reflect later)
    try {
      const today = getJstYmd();
      await updateDoc(userRef, { totalXp: fb.fs.increment(addXp), updatedAt: serverTimestamp() });
      const ldRef = logsDailyDocRef(uid, today);
      await setDoc(
        ldRef,
        { uid, ymd: today, xp: fb.fs.increment(addXp), updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (e2) {
      console.warn('awardXp fallback failed', e2);
    }
  }
}

// -------- Routing --------
const routes = {
  '/home': viewHome,
  '/articles': viewArticles,
  '/article': viewArticle,
  '/create': viewCreate,
  '/study': viewStudy,
  '/summary': viewSummary,
  '/profile': viewProfile,
};
// スワイプナビゲーションの順序（ループ）
const NAV_ORDER = ['/home', '/articles', '/create', '/study', '/summary', '/profile'];

function getPath() {
  const h = location.hash || '#/home';
  try {
    return new URL(h.replace('#', ''), location.origin).pathname;
  } catch {
    return '/home';
  }
}

function getQuery() {
  const h = location.hash || '#/home';
  try {
    return new URL(h.replace('#', ''), location.origin).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

window.addEventListener('hashchange', () => render());

function render() {
  const root = qs('#app');
  if (!root) return;
  const path = getPath();
  const view = routes[path] || viewHome;
  root.innerHTML = '';
  root.appendChild(view());
  // ナビの活性表示
  qsa('[data-route]').forEach((a) => {
    if (a.getAttribute('href') === `#${path}`) a.classList.add('active');
    else a.classList.remove('active');
  });
  // タイトル更新
  const titleMap = {
    '/home': 'ホーム',
    '/articles': '記事',
    '/article': '記事',
    '/create': '作問',
    '/study': '学習',
    '/profile': 'プロフィール',
  };
  document.title = `CliniQuest - ${titleMap[path] || 'ホーム'}`;
}

// -------- Views (MVPプレースホルダ) --------
function panel(title, content) {
  const el = document.createElement('section');
  el.className = 'window';
  el.innerHTML = `<h2 class="title">${title}</h2>${content}`;
  return el;
}

function viewHome() {
  const div = document.createElement('div');
  const warn = !firebaseConfig.projectId
    ? '<p class="card">Firebase未設定です。<code>config.sample.js</code> を <code>config.js</code> にコピーし、Firebaseコンソールの値を入力してください。</p>'
    : '';
  const u = state.userDoc;
  const level = u?.level ?? 1;
  const totalXp = u?.totalXp ?? 0;
  const xpToNext = LEVEL_SIZE - (totalXp % LEVEL_SIZE || 0);
  const stats = u?.stats ?? { knowledge: 0, judgment: 0, skill: 0, empathy: 0 };
  const title = levelTitle(level);
  // 今日の復習数（後段で非同期取得して差し替え）
  const dueSpanId = 'dueCount_' + Math.random().toString(36).slice(2, 8);
  const content = `
    ${warn}
    <div class="grid cols-2">
      <div class="card">
        <div>レベル: <b>${level}</b> ／ 次まで: <span class="muted">${xpToNext} XP</span></div>
        <div class="muted">称号: ${title}</div>
        <div><span class="stat">知識</span>${stats.knowledge || 0} <span class="stat">判断力</span>${stats.judgment || 0} <span class="stat">技術</span>${stats.skill || 0} <span class="stat">共感力</span>${stats.empathy || 0}</div>
      </div>
      <div class="card">
        <div>今日の復習: <b id="${dueSpanId}">-</b> 問</div>
        <div>ストリーク: ${u?.streak?.current ?? 0} 日</div>
      </div>
    </div>
    <div class="row" style="margin-top: .75rem;">
      <a class="btn" href="#/study">学習をはじめる</a>
      <a class="btn secondary" href="#/create">新規作問</a>
      <a class="btn secondary" href="#/articles">記事を編集</a>
    </div>
  `;
  div.appendChild(panel('ホーム', content));
  // 非同期で今日の復習数を取得
  setTimeout(async () => {
    try {
      const n = await countDueToday();
      const el = document.getElementById(dueSpanId);
      if (el) el.textContent = String(n);
    } catch {}
  }, 0);
  return div;
}

function viewArticles() {
  const div = document.createElement('div');
  const content = `
    <form id="artForm" class="grid">
      <div class="field"><label>記事タイトル</label><input id="artTitle" required placeholder="例: 肺炎の初期対応"/></div>
      <div class="field"><label>本文（Markdown、[[リンク]]可）</label><textarea id="artBody" rows="8" placeholder="例: 肺炎の初期対応では [[抗菌薬選択]] を参照..."></textarea></div>
      <div class="field"><label>タグ（カンマ区切り・任意）</label><input id="artTagsInput" placeholder="例: 感染症, 抗菌薬"/></div>
      <div id="artTagsSuggest" class="row" style="gap:.35rem;flex-wrap:wrap;"></div>
      <div class="row"><button class="btn" type="submit">記事を保存</button></div>
    </form>
    <details class="card" id="artRelPane" style="margin-top:.25rem;"><summary>関連する記事（相互リンク）</summary>
      <div class="row" style="gap:.5rem;flex-wrap:wrap;margin-top:.5rem;">
        <input id="artRelSearch" placeholder="記事を検索（タイトル）" style="flex:1;min-width:240px;"/>
      </div>
      <div id="relSelectedChipsC" class="row" style="gap:.35rem;margin:.25rem 0;flex-wrap:wrap;"></div>
      <label style="display:inline-flex;align-items:center;gap:.35rem;margin:.25rem 0;"><input id="artRelAutoInsert" type="checkbox"/> 本文に [[タイトル]] を自動挿入（未包含のみ）</label>
      <div id="artRelList" class="grid" style="margin-top:.5rem;"></div>
    </details>
    <div id="artList" class="grid" style="margin-top:1rem;"></div>
    <details class="card" id="artSearchPane" style="margin-top:.75rem;"><summary>記事を検索</summary>
      <div class="row" style="gap:.5rem;flex-wrap:wrap;margin-top:.5rem;">
        <input id="artSearch" placeholder="記事を検索（タイトル/本文）" style="flex:1;min-width:240px;"/>
      </div>
    </details>
  `;
  div.appendChild(panel('記事', content));
  setTimeout(() => setupArticles(), 0);
  return div;
}

async function setupArticles() {
  const { collection, query, where, getDocs, addDoc, serverTimestamp } = fb.fs;
  const listEl = qs('#artList');
  const form = qs('#artForm');
  const search = qs('#artSearch');
  let selectedTag = '';
  let tagsEl = qs('#artTags') || null;
  // 新規作成用の関連記事選択UI
  const relSearchC = qs('#artRelSearch');
  const relListC = qs('#artRelList');
  let relSelectedCreate = new Set();
  const relSelectedChipsC = qs('#relSelectedChipsC');
  function renderRelSelectedChipsC(mapById) {
    if (!relSelectedChipsC) return;
    const ids = Array.from(relSelectedCreate);
    relSelectedChipsC.innerHTML = ids
      .map((id) => {
        const title = mapById?.get(id)?.title || '(無題)';
        return `<span class="tagchip" data-id="${id}">#${title} ×</span>`;
      })
      .join('');
    relSelectedChipsC.querySelectorAll('.tagchip').forEach((chip) =>
      chip.addEventListener('click', () => {
        const id = chip.getAttribute('data-id');
        relSelectedCreate.delete(id);
        renderRelCreateList();
      }),
    );
  }
  async function renderRelCreateList() {
    if (!relListC) return;
    try {
      const uidNow = fb.user?.uid;
      if (!uidNow) return;
      const snap = await getDocs(query(collection(fb.db, 'articles'), where('uid', '==', uidNow)));
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const mapById = new Map(all.map((a) => [a.id, a]));
      const term = (relSearchC?.value || '').trim().toLowerCase();
      const filtered = term
        ? all.filter((it) => (it.title || '').toLowerCase().includes(term))
        : all;
      relListC.innerHTML =
        filtered
          .map(
            (it) =>
              `<label class="row" style="align-items:center;"><input class="relCheckC" type="checkbox" value="${it.id}" ${
                relSelectedCreate.has(it.id) ? 'checked' : ''
              }/> <span>${it.title || '(無題)'} <small class="muted">(${it.id.slice(0, 6)})</small></span></label>`,
          )
          .join('') || '<div class="muted">（該当なし）</div>';
      relListC.querySelectorAll('.relCheckC').forEach((chk) =>
        chk.addEventListener('change', () => {
          const id = chk.value;
          if (chk.checked) relSelectedCreate.add(id);
          else relSelectedCreate.delete(id);
          renderRelSelectedChipsC(mapById);
        }),
      );
      renderRelSelectedChipsC(mapById);
    } catch (e) {}
  }
  relSearchC?.addEventListener('input', () => renderRelCreateList());
  renderRelCreateList();
  // グラフ表示のUIとオーバーレイ（SVG）を動的に用意
  let graphOn = false;
  function ensureGraphUi() {
    const panel = qs('#app .window');
    if (panel && !qs('#toggleArtGraph')) {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.marginTop = '.5rem';
      row.style.gap = '.5rem';
      row.innerHTML = '<button id="toggleArtGraph" class="btn secondary">グラフ表示</button>';
      const searchPane = qs('#artSearchPane');
      if (searchPane) panel.insertBefore(row, searchPane);
      else panel.appendChild(row);
      row.querySelector('#toggleArtGraph')?.addEventListener('click', () => {
        graphOn = !graphOn;
        const btn = qs('#toggleArtGraph');
        if (btn) btn.textContent = graphOn ? 'グラフ非表示' : 'グラフ表示';
        drawGraph(lastItems);
      });
    }
    const list = qs('#artList');
    if (list && !qs('#artGridWrap')) {
      const wrap = document.createElement('div');
      wrap.id = 'artGridWrap';
      wrap.className = 'art-grid-wrap';
      wrap.style.position = 'relative';
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('id', 'artGraph');
      svg.setAttribute('class', 'art-graph');
      svg.setAttribute(
        'style',
        'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;',
      );
      list.parentNode.insertBefore(wrap, list);
      wrap.appendChild(svg);
      wrap.appendChild(list);
      window.addEventListener('resize', () => drawGraph(lastItems));
    }
  }
  ensureGraphUi();
  let lastItems = [];
  function drawGraph(items) {
    const wrap = qs('#artGridWrap');
    const graph = qs('#artGraph');
    if (!wrap || !graph) return;
    if (!graphOn) {
      graph.innerHTML = '';
      return;
    }
    try {
      const wrapRect = wrap.getBoundingClientRect();
      const idBySlug = new Map(items.map((it) => [it.slug, it.id]));
      const links = [];
      const linkRe = /\[\[([^\]]+)\]\]/g;
      for (const it of items) {
        const body = it.body || '';
        let m;
        while ((m = linkRe.exec(body))) {
          const toSlug = slugify(m[1] || '');
          const toId = idBySlug.get(toSlug);
          if (toId && toId !== it.id) links.push([it.id, toId]);
        }
        // links フィールドによる相互リンクも線で可視化
        if (Array.isArray(it.links)) {
          for (const to of it.links) {
            if (to && to !== it.id) links.push([it.id, to]);
          }
        }
      }
      const nodes = new Map();
      wrap.querySelectorAll('[data-article-id]')?.forEach((el) => {
        const id = el.getAttribute('data-article-id');
        const r = el.getBoundingClientRect();
        const x = r.left - wrapRect.left + r.width / 2;
        const y = r.top - wrapRect.top + r.height / 2;
        nodes.set(id, { x, y });
      });
      const parts = [
        '<defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#93c5fd"/></marker></defs>',
      ];
      for (const [a, b] of links) {
        const na = nodes.get(a),
          nb = nodes.get(b);
        if (!na || !nb) continue;
        parts.push(
          `<line x1="${na.x}" y1="${na.y}" x2="${nb.x}" y2="${nb.y}" stroke="#93c5fd" stroke-width="2" marker-end="url(#arrow)" opacity="0.7" />`,
        );
      }
      graph.innerHTML = parts.join('');
    } catch {}
  }
  if (!tagsEl) {
    const pane = qs('#artSearchPane');
    if (pane) {
      tagsEl = document.createElement('div');
      tagsEl.id = 'artTags';
      tagsEl.className = 'row';
      tagsEl.style.gap = '.35rem';
      tagsEl.style.flexWrap = 'wrap';
      pane.appendChild(tagsEl);
    }
  }
  async function refresh() {
    const uidNow = fb.user?.uid;
    if (!uidNow) return;
    const snap = await getDocs(query(collection(fb.db, 'articles'), where('uid', '==', uidNow)));
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const term = (search?.value || '').trim().toLowerCase();
    // Tag cloud + filter
    try {
      const tags = new Map();
      for (const it of items) (it.tags || []).forEach((t) => tags.set(t, (tags.get(t) || 0) + 1));
      if (tagsEl) {
        tagsEl.innerHTML =
          (selectedTag
            ? `<span class=\"tagchip active\" data-tag=\"\">#${selectedTag} ×</span>`
            : '') +
          Array.from(tags.entries())
            .sort((a, b) => b[1] - a[1])
            .map(
              ([t, n]) =>
                `<span class=\"tagchip\" data-tag=\"${t}\">#${t} <small class=\"muted\">(${n})</small></span>`,
            )
            .join(' ');
        Array.from(tagsEl.querySelectorAll('.tagchip')).forEach((el) =>
          el.addEventListener('click', () => {
            const t = el.getAttribute('data-tag');
            selectedTag = t || '';
            refresh();
          }),
        );
      }
    } catch {}
    // 新規作成フォーム下のタグサジェスト
    try {
      const sugg = qs('#artTagsSuggest');
      if (sugg) {
        const tags = new Map();
        for (const it of items) (it.tags || []).forEach((t) => tags.set(t, (tags.get(t) || 0) + 1));
        sugg.innerHTML = Array.from(tags.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([t]) => `<span class="tagchip" data-tag="${t}">#${t}</span>`)
          .join('');
        const input = qs('#artTagsInput');
        sugg.querySelectorAll('.tagchip').forEach((el) =>
          el.addEventListener('click', () => {
            const t = el.getAttribute('data-tag');
            const cur = (input?.value || '').trim();
            const arr = cur
              ? cur
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [];
            if (!arr.includes(t)) arr.push(t);
            if (input) input.value = arr.join(', ');
          }),
        );
      }
    } catch {}
    const byTag = selectedTag
      ? items.filter((it) => Array.isArray(it.tags) && it.tags.includes(selectedTag))
      : items;
    const filtered = term
      ? items.filter(
          (it) =>
            (it.title || '').toLowerCase().includes(term) ||
            (it.body || '').toLowerCase().includes(term),
        )
      : byTag;
    listEl.innerHTML = filtered
      .map(
        (it) => `
      <div class="card">
        <div><b><a class="article-title" href="#/article?slug=${encodeURIComponent(it.slug)}">${it.title}</a></b> <small class="muted">(${it.id.slice(0, 6)})</small></div>
        <div class="muted" style="margin:.25rem 0;">${(it.body || '').slice(0, 100)}</div>
        <div class="row">
          <a class="btn secondary" href="#/study" onclick="window.CLQ_setArticle('${it.id}')">この記事で出題</a>
          <a class="btn" href="#/create" onclick="window.CLQ_createFromArticle('${it.id}', '${it.title?.replace(/"/g, '&quot;') || ''}')">この記事に作問</a>
          <a class="btn secondary" href="#/article?slug=${encodeURIComponent(it.slug)}">読む</a>
          <button class="btn ng" onclick="window.CLQ_deleteArticle('${it.id}')">削除</button>
        </div>
      </div>`,
      )
      .join('');
    try {
      const cards = Array.from(listEl.querySelectorAll('.card'));
      cards.forEach((el, i) => {
        const id = filtered[i]?.id || '';
        if (id) el.setAttribute('data-article-id', id);
      });
    } catch {}
    lastItems = filtered;
    ensureGraphUi();
    setTimeout(() => drawGraph(filtered), 0);
  }
  window.CLQ_setArticle = (id) => {
    state.session.filters.articleId = id;
    location.hash = '#/study';
  };
  window.CLQ_createFromArticle = (id, title) => {
    state.session.filters.articleId = id;
    location.hash = '#/create';
  };
  window.CLQ_deleteArticle = async (id) => {
    if (!confirm('この記事を削除します。よろしいですか？')) return;
    try {
      await deleteArticleById(id, false);
      showToast && showToast('記事を削除しました');
      refresh();
    } catch (e) {
      alert('削除に失敗しました: ' + (e?.message || e));
    }
  };
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = qs('#artTitle').value.trim();
    const body = qs('#artBody').value;
    const tagsCsv = qs('#artTagsInput')?.value || '';
    const tags = tagsCsv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length);
    const autoInsert = !!qs('#artRelAutoInsert')?.checked;
    if (!title) {
      alert('タイトルは必須です');
      return;
    }
    const uidNow = fb.user?.uid;
    if (!uidNow) {
      alert('サインイン状態を確認してください（匿名サインインが有効か、認可ドメインが正しいか）');
      return;
    }
    try {
      const slug = slugify(title);
      // 本文へ [[タイトル]] 自動挿入（未包含のみ）
      let bodyToSave = body;
      if (autoInsert && relSelectedCreate.size) {
        try {
          const uidNow2 = fb.user?.uid;
          const snap2 = await getDocs(
            query(collection(fb.db, 'articles'), where('uid', '==', uidNow2)),
          );
          const map2 = new Map(snap2.docs.map((d) => [d.id, d.data().title || '']));
          const toAdd = Array.from(relSelectedCreate)
            .map((id) => `[[${map2.get(id) || ''}]]`)
            .filter((w) => w && !bodyToSave.includes(w));
          if (toAdd.length) bodyToSave = bodyToSave + '\n\n' + toAdd.join(' ');
        } catch (e) {}
      }
      const artRef = await addDoc(collection(fb.db, 'articles'), {
        uid: uidNow,
        title,
        slug,
        body: bodyToSave,
        tags,
        links: Array.from(relSelectedCreate),
        createdXpAwarded: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // 相互リンク: 選択した記事に対し、この新規記事IDを追加
      try {
        const newId = artRef.id;
        await Promise.all(
          Array.from(relSelectedCreate).map((id) =>
            fb.fs.runTransaction(fb.db, async (tx) => {
              const r = fb.fs.doc(fb.db, 'articles', id);
              const s = await tx.get(r);
              if (!s.exists()) return;
              const v = s.data();
              const set = new Set(Array.isArray(v.links) ? v.links : []);
              set.add(newId);
              tx.update(r, { links: Array.from(set), updatedAt: serverTimestamp() });
            }),
          ),
        );
      } catch (e) {}
      // 記事作成時にも +5XP（記録用フラグはベストエフォート）
      fb.fs
        .runTransaction(fb.db, async (tx) => {
          const aSnap = await tx.get(artRef);
          if (!aSnap.exists()) return;
          const a = aSnap.data();
          if (a.createdXpAwarded) return;
          tx.update(artRef, { createdXpAwarded: true, updatedAt: serverTimestamp() });
        })
        .catch((e2) => console.warn('記事作成時のフラグ更新に失敗（継続）', e2));
      try {
        await awardXp(5);
      } catch (e3) {
        console.warn('記事作成時のXP付与に失敗', e3);
      }
      qs('#artTitle').value = '';
      qs('#artBody').value = '';
      showToast && showToast('記事を保存しました: +5XP');
      refresh();
    } catch (err) {
      console.error('記事保存エラー', err);
      alert('記事の保存に失敗しました: ' + (err?.message || err));
    }
  });
  search?.addEventListener('input', () => refresh());
  refresh();
}

function escapeRegExp(s) {
  return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function deleteArticleById(articleId, cascade = false) {
  const { doc, deleteDoc, collection, query, where, getDocs } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) throw new Error('未サインイン');
  if (cascade) {
    const snap = await getDocs(
      query(collection(fb.db, 'qas'), where('uid', '==', uid), where('articleId', '==', articleId)),
    );
    await Promise.all(snap.docs.map((d) => deleteDoc(doc(fb.db, 'qas', d.id))));
  }
  await deleteDoc(doc(fb.db, 'articles', articleId));
}
async function deleteQaById(qaId) {
  const { doc, getDoc, deleteDoc } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) throw new Error('未サインイン');
  const ref = doc(fb.db, 'qas', qaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  if (data.uid !== uid) throw new Error('権限がありません');
  await deleteDoc(ref);
}

function viewArticle() {
  const div = document.createElement('div');
  const wrap = document.createElement('section');
  wrap.className = 'window';
  wrap.innerHTML = '<div class="muted">読み込み中...</div>';
  div.appendChild(wrap);

  setTimeout(async () => {
    try {
      const uid = fb.user?.uid;
      const slug = getQuery().get('slug');
      if (!uid || !slug) {
        wrap.innerHTML =
          '<div class="card">記事が見つかりません。<a href="#/articles">記事一覧へ</a></div>';
        return;
      }
      const { collection, query, where, limit, getDocs } = fb.fs;
      const snap = await getDocs(
        query(
          collection(fb.db, 'articles'),
          where('uid', '==', uid),
          where('slug', '==', slug),
          limit(1),
        ),
      );
      if (snap.empty) {
        wrap.innerHTML =
          '<div class="card">記事が見つかりません。<a href="#/articles">記事一覧へ</a></div>';
        return;
      }
      const doc0 = snap.docs[0];
      const article = { id: doc0.id, ...doc0.data() };
      const mdSrc = (article.body || '').replace(/\[\[([^\]]+)\]\]/g, (m, p1) => {
        return `[${p1}](#/article?slug=${encodeURIComponent(slugify(p1))})`;
      });
      let html = '';
      try {
        const mod = await import('https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js');
        const marked = mod.marked || mod.default || mod;
        html = marked.parse(mdSrc);
      } catch (e) {
        console.warn('marked import failed, fallback to plain');
        html = mdSrc.replace(/\n/g, '<br/>');
      }
      const allSnap = await getDocs(query(collection(fb.db, 'articles'), where('uid', '==', uid)));
      const re = new RegExp(`\\[\\[${escapeRegExp(article.title)}\\]\\]`);
      const backs = allSnap.docs
        .filter((d) => {
          if (d.id === article.id) return false;
          const v = d.data();
          const linkInBody = re.test(v.body || '');
          const linkByField = Array.isArray(v.links) && v.links.includes(article.id);
          return linkInBody || linkByField;
        })
        .map((d) => ({ id: d.id, title: d.data().title, slug: d.data().slug }));

      wrap.innerHTML = `
        <h2 class="title">${article.title}</h2>
        <div class="card" style="background:transparent;border:none;padding:0;">
          <div id="articleBodyHtml">${html}</div>
        </div>
        <details class="card" style="margin-top:.75rem;"><summary>この記事を編集</summary>
          <div class="field" style="margin-top:.5rem;">
            <label>本文（Markdown）</label>
            <textarea id="editBody" rows="10">${article.body || ''}</textarea>
          </div>
          <div class="field"><label>タグ（カンマ区切り）</label><input id="editTags" value="${(article.tags || []).join(', ')}"/></div>
          <div class="row"><button id="saveArticle" class="btn">保存</button></div>
        </details>
        <details class="card" style="margin-top:.75rem;"><summary>関連する記事を選択（相互リンク）</summary>
          <div class="row" style="gap:.5rem;flex-wrap:wrap;margin-top:.5rem;">
            <input id="relSearch" placeholder="記事を検索（タイトル）" style="flex:1;min-width:240px;"/>
          </div>
          <div id="relList" class="grid" style="margin-top:.5rem;"></div>
        </details>
        <div class="card" style="margin-top:.5rem;">
          <div class="muted">危険な操作</div>
          <label style="display:inline-flex;align-items:center;gap:.35rem;margin:.5rem 0;">
            <input type="checkbox" id="delCascade" /> 関連する問題（Q/A）も一緒に削除する
          </label>
          <div class="row"><button id="delArticle" class="btn ng">この記事を削除</button></div>
        </div>
        <div class="row" style="margin-top:.75rem;">
          <a class="btn secondary" href="#/articles">記事一覧</a>
          <a class="btn" href="#/study" onclick="window.CLQ_setArticle('${article.id}')">この記事で出題</a>
          <a class="btn" href="#/create" onclick="(window.CLQ_createFromArticle||function(id){state.session.filters.articleId=id;location.hash='#/create';})('${article.id}')">この記事に作問</a>
        </div>
        <div class="card" style="margin-top:1rem;">
          <div class="muted">バックリンク</div>
          ${
            backs.length
              ? backs
                  .map(
                    (b) =>
                      `<div><a href=\"#/article?slug=${encodeURIComponent(b.slug)}\">${b.title}</a></div>`,
                  )
                  .join('')
              : '<div class="muted">（なし）</div>'
          }
        </div>
      `;
      const relSearch = qs('#relSearch', wrap);
      const relList = qs('#relList', wrap);
      let relSelected = new Set(Array.isArray(article.links) ? article.links : []);
      async function renderRelatedList() {
        try {
          const allQ = query(collection(fb.db, 'articles'), where('uid', '==', uid));
          const all = (await getDocs(allQ)).docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((a) => a.id !== article.id);
          const term = (relSearch?.value || '').trim().toLowerCase();
          const filtered = term
            ? all.filter((it) => (it.title || '').toLowerCase().includes(term))
            : all;
          relList.innerHTML =
            filtered
              .map(
                (it) =>
                  `<label class="row" style="align-items:center;"><input class="relCheck" type="checkbox" value="${it.id}" ${
                    relSelected.has(it.id) ? 'checked' : ''
                  }/> <span>${it.title || '(無題)'} <small class="muted">(${it.id.slice(0, 6)})</small></span></label>`,
              )
              .join('') || '<div class="muted">（該当なし）</div>';
          relList.querySelectorAll('.relCheck').forEach((chk) =>
            chk.addEventListener('change', () => {
              const id = chk.value;
              if (chk.checked) relSelected.add(id);
              else relSelected.delete(id);
            }),
          );
        } catch (e) {}
      }
      relSearch?.addEventListener('input', () => renderRelatedList());
      if (relList) renderRelatedList();
      const saveBtn = qs('#saveArticle', wrap);
      saveBtn?.addEventListener('click', async () => {
        try {
          const body = qs('#editBody', wrap).value;
          const tagsv = (qs('#editTags', wrap)?.value || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const { doc, updateDoc, serverTimestamp, runTransaction } = fb.fs;
          const selIds = Array.from(relSelected);
          const before = new Set(Array.isArray(article.links) ? article.links : []);
          const after = new Set(selIds);
          const added = selIds.filter((id) => !before.has(id));
          const removed = Array.from(before).filter((id) => !after.has(id));
          await updateDoc(doc(fb.db, 'articles', article.id), {
            body,
            tags: tagsv,
            links: selIds,
            updatedAt: serverTimestamp(),
          });
          // reciprocal updates
          await Promise.all([
            ...added.map((id) =>
              runTransaction(fb.db, async (tx) => {
                const r = doc(fb.db, 'articles', id);
                const s = await tx.get(r);
                if (!s.exists()) return;
                const v = s.data();
                const set = new Set(Array.isArray(v.links) ? v.links : []);
                set.add(article.id);
                tx.update(r, { links: Array.from(set), updatedAt: serverTimestamp() });
              }),
            ),
            ...removed.map((id) =>
              runTransaction(fb.db, async (tx) => {
                const r = doc(fb.db, 'articles', id);
                const s = await tx.get(r);
                if (!s.exists()) return;
                const v = s.data();
                const set = new Set(Array.isArray(v.links) ? v.links : []);
                set.delete(article.id);
                tx.update(r, { links: Array.from(set), updatedAt: serverTimestamp() });
              }),
            ),
          ]);
          // 記事保存時に +5XP（共通ロジック）
          try {
            await awardXp(5);
          } catch (e2) {
            console.warn('記事保存時のXP付与に失敗（継続）', e2);
          }
          // 再描画
          showToast && showToast('記事を保存しました: +5XP');
          location.hash = `#/article?slug=${encodeURIComponent(article.slug)}`;
        } catch (err) {
          alert('保存に失敗しました: ' + (err?.message || err));
        }
      });
      const delBtn = qs('#delArticle', wrap);
      delBtn?.addEventListener('click', async () => {
        const cascade = !!qs('#delCascade', wrap)?.checked;
        if (
          !confirm(
            cascade
              ? 'この記事と関連する問題（Q/A）を削除します。よろしいですか？'
              : 'この記事を削除します。よろしいですか？',
          )
        )
          return;
        try {
          await deleteArticleById(article.id, cascade);
          showToast && showToast('記事を削除しました');
          location.hash = '#/articles';
        } catch (err) {
          console.error('記事削除エラー', err);
          alert('記事の削除に失敗しました: ' + (err?.message || err));
        }
      });
    } catch (e) {
      console.error(e);
      wrap.innerHTML = `<div class=\"card\">読み込みに失敗しました: ${e?.message || e}</div>`;
    }
  }, 0);

  return div;
}

function viewCreate() {
  const div = document.createElement('div');
  const content = `
    <form id="createForm" class="grid">
      <div class="row" style="gap:.5rem;align-items:center;flex-wrap:wrap;">
        <div class="muted">紐づけ先: <b id="articleSelectedName">未選択</b></div>
        <button id="openArticlePicker" type="button" class="btn secondary">記事から選ぶ</button>
        <button id="clearArticleSelection" type="button" class="btn secondary">選択解除</button>
      </div>
      <div id="articlePicker" class="card" style="display:none;margin-top:.25rem;">
        <div class="row" style="gap:.5rem;flex-wrap:wrap;">
          <input id="articlePickSearch" placeholder="記事を検索（タイトル/本文）" style="flex:1;min-width:240px;"/>
          <button id="closeArticlePicker" type="button" class="btn secondary">閉じる</button>
        </div>
        <div id="articlePickList" class="grid" style="margin-top:.5rem;"></div>
      </div>
      <div class="field"><label>問題（Q）</label><textarea id="q" rows="3" required></textarea></div>
      <div class="field"><label>答え（A）</label><textarea id="a" rows="3" required></textarea></div>
      <div class="field"><label>解説（任意）</label><textarea id="r" rows="3"></textarea></div>
      <div class="field"><label>タグ（カンマ区切り・任意）</label><input id="tags" placeholder="例: 感染症, 抗菌薬"/></div>
      <div class="row">
        <button class="btn" type="submit">保存（+5XP）</button>
      </div>
    </form>
    <p class="muted">保存すると一度だけ +5XP が付与されます。</p>
    <div class="card" style="margin-top:1rem;">
      <div class="row" style="gap:.5rem; margin-bottom:.5rem; flex-wrap:wrap;">
        <input id="qaSearch" placeholder="問題を検索（Q/Aを対象）" style="flex:1;min-width:240px;"/>
        <input id="qaArticleFilter" placeholder="記事IDで絞込（任意）" style="min-width:200px;"/>
        <button id="qaClearFilter" class="btn secondary">絞り込み解除</button>
      </div>
      <div id="qaList" class="grid"></div>
    </div>
  `;
  div.appendChild(panel('問題を作成', content));
  setTimeout(() => {
    const form = qs('#createForm');
    const selectedNameEl = qs('#articleSelectedName');
    const picker = qs('#articlePicker');
    const openPicker = qs('#openArticlePicker');
    const closePicker = qs('#closeArticlePicker');
    const clearSel = qs('#clearArticleSelection');
    const pickSearch = qs('#articlePickSearch');
    const pickList = qs('#articlePickList');

    // 既存選択の表示（セッションにあれば）
    if (state.session.filters.articleId) {
      const id0 = state.session.filters.articleId;
      (async () => {
        try {
          const { doc, getDoc } = fb.fs;
          const snap = await getDoc(doc(fb.db, 'articles', id0));
          const t = snap.exists() ? snap.data().title || id0 : id0;
          selectedNameEl.textContent = t;
          form.dataset.articleId = id0;
        } catch {}
      })();
    }

    function setArticleSelection(id, title) {
      form.dataset.articleId = id || '';
      selectedNameEl.textContent = title || '未選択';
      // タイトル入力は廃止（記事ピッカーで選択）
      state.session.filters.articleId = id || null;
    }

    async function refreshArticlePicker() {
      const uidNow = fb.user?.uid;
      if (!uidNow || !pickList) return;
      const term = (pickSearch?.value || '').trim().toLowerCase();
      const { collection, query, where, getDocs } = fb.fs;
      const snap = await getDocs(query(collection(fb.db, 'articles'), where('uid', '==', uidNow)));
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((it) =>
          term
            ? (it.title || '').toLowerCase().includes(term) ||
              (it.body || '').toLowerCase().includes(term)
            : true,
        )
        .slice(0, 200);
      pickList.innerHTML =
        items
          .map(
            (it) => `
        <div class="card">
          <div><b>${it.title}</b> <small class="muted">(${it.id.slice(0, 6)})</small></div>
          <div class="muted" style="margin:.25rem 0;">${(it.body || '').slice(0, 80)}</div>
          <div class="row">
            <button type="button" class="btn" data-pick="${it.id}" data-title="${it.title}">この記事を紐づけ</button>
            <a class="btn secondary" href="#/article?slug=${encodeURIComponent(it.slug)}">読む</a>
          </div>
        </div>`,
          )
          .join('') || '<div class="muted">（該当なし）</div>';
      // ボタンにイベント付与
      qsa('button[data-pick]', pickList).forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-pick');
          const title = btn.getAttribute('data-title');
          setArticleSelection(id, title);
          picker.style.display = 'none';
        });
      });
    }

    openPicker?.addEventListener('click', () => {
      picker.style.display = 'block';
      refreshArticlePicker();
      pickSearch?.focus();
    });
    closePicker?.addEventListener('click', () => (picker.style.display = 'none'));
    clearSel?.addEventListener('click', () => setArticleSelection('', '未選択'));
    pickSearch?.addEventListener('input', () => refreshArticlePicker());
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      let articleId = form?.dataset?.articleId || state.session.filters.articleId || null;
      if (!articleId) {
        alert('記事を選択してください（「記事から選ぶ」から紐づけ）');
        return;
      }
      const qv = qs('#q').value.trim();
      const av = qs('#a').value.trim();
      if (!qv || !av) return alert('Q と A は必須です');
      const rv = qs('#r').value.trim();
      const tagsv = qs('#tags').value.trim();
      createQaAndAward(qv, av, rv, tagsv, articleId)
        .then(() => {
          alert('保存しました: +5XP');
          location.hash = '#/study';
        })
        .catch((err) => {
          console.error(err);
          alert('保存に失敗しました: ' + (err?.message || err));
        });
    });
    // 一覧の初期化
    const search = qs('#qaSearch');
    const artFilter = qs('#qaArticleFilter');
    const clearBtn = qs('#qaClearFilter');
    if (state.session.filters.articleId) artFilter.value = state.session.filters.articleId;
    clearBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      search.value = '';
      artFilter.value = '';
      state.session.filters.articleId = null;
      refreshQaList();
    });
    search?.addEventListener('input', () => refreshQaList());
    artFilter?.addEventListener('change', () => {
      state.session.filters.articleId = artFilter.value.trim() || null;
      refreshQaList();
    });
    window.CLQ_deleteQa = async (id) => {
      if (!confirm('この問題を削除します。よろしいですか？')) return;
      try {
        await deleteQaById(id);
        showToast && showToast('問題を削除しました');
        refreshQaList();
      } catch (e) {
        alert('削除に失敗しました: ' + (e?.message || e));
      }
    };
    // 「この問題で出題」は不要のため機能を提供しません
    window.CLQ_editQa = async (id) => {
      const ok = await openQaEditDialog(id);
      if (ok) refreshQaList();
    };
    async function refreshQaList() {
      const uid = fb.user?.uid;
      if (!uid) return;
      const listEl = qs('#qaList');
      if (!listEl) return;
      listEl.innerHTML = '<div class="muted">読み込み中...</div>';
      const term = (search?.value || '').trim().toLowerCase();
      const articleId = (artFilter?.value || '').trim();
      const { collection, query, where, getDocs, limit } = fb.fs;
      try {
        const qCol = collection(fb.db, 'qas');
        const q = query(qCol, where('uid', '==', uid), limit(100));
        const snap = await getDocs(q);
        let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (articleId) items = items.filter((it) => (it.articleId || '') === articleId);
        if (term)
          items = items.filter(
            (it) =>
              (it.question || '').toLowerCase().includes(term) ||
              (it.answer || '').toLowerCase().includes(term) ||
              (it.rationale || '').toLowerCase().includes(term),
          );
        items.sort((a, b) => {
          const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
          const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
          return tb - ta;
        });
        listEl.innerHTML =
          items
            .map(
              (it) => `
          <div class=\"card\">\n            <div><b>${(it.question || '').slice(0, 80)}</b> <small class=\"muted\">(${it.id.slice(0, 6)})</small></div>\n            <div class=\"muted\" style=\"margin:.25rem 0;\">答え: ${(it.answer || '').slice(0, 80)}</div>\n            <div class=\"row\">\n              <button class=\"btn\" onclick=\"window.CLQ_editQa('${it.id}')\">編集</button>\n              <button class=\"btn ng\" onclick=\"window.CLQ_deleteQa('${it.id}')\">削除</button>\n            </div>\n          </div>`,
            )
            .join('') || '<div class="muted">（該当なし）</div>';
      } catch (err) {
        console.error('QA一覧の取得に失敗', err);
        listEl.innerHTML = '<div class="muted">読み込みに失敗しました</div>';
      }
    }
    refreshQaList();
  });
  return div;
}

async function fetchRandomQa() {
  if (!fb.fs) return null;
  const { collection, getDocs, query, where, limit, orderBy, doc, getDoc } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) return null;
  const filters = state.session.filters || {};
  // 明示指定のQAがあればそれを優先
  if (filters.qaId) {
    try {
      const ref = doc(fb.db, 'qas', filters.qaId);
      const s = await getDoc(ref);
      state.session.filters.qaId = null; // 一度限り
      if (s.exists() && s.data().uid === uid) return { id: s.id, ...s.data() };
    } catch {}
  }
  const today = getJstYmd();
  let qCol = collection(fb.db, 'qas');
  let q = query(qCol, where('uid', '==', uid), limit(100));
  if (filters.articleId)
    q = query(
      qCol,
      where('uid', '==', uid),
      where('articleId', '==', filters.articleId),
      limit(100),
    );
  const snap = await getDocs(q);
  let docs = snap.docs.filter((d) => !state.session.history.includes(d.id));
  const mode = filters.studyMode || (filters.dueOnly ? 'due' : 'random');
  if (mode === 'due') {
    docs = docs.filter((d) => {
      const srs = d.data().srs;
      if (!srs || !srs.nextDueYmd) return true;
      return srs.nextDueYmd <= today;
    });
  } else if (mode === 'age') {
    const minDays = Number(filters.ageDays || 0);
    docs = docs.filter((d) => {
      const v = d.data();
      const ts =
        (v.srs?.lastReviewedAt && v.srs.lastReviewedAt.toDate
          ? v.srs.lastReviewedAt.toDate()
          : null) || (v.createdAt && v.createdAt.toDate ? v.createdAt.toDate() : null);
      const baseYmd = ts ? getJstYmd(ts) : today;
      const diff = ymdDiff(today, baseYmd);
      return diff >= minDays; // 最終学習/作成からの経過日数
    });
  }
  if (!docs.length) return null;
  const pick = docs[Math.floor(Math.random() * docs.length)];
  return { id: pick.id, ...pick.data() };
}

function viewStudy() {
  const div = document.createElement('div');
  const content = `
    <div class="row" style="margin-bottom:.5rem;gap:.5rem;flex-wrap:wrap;align-items:center;">
      <label style="display:inline-flex;align-items:center;gap:.35rem;">
        <span>出題モード</span>
        <select id="studyMode">
          <option value="due" ${state.session.filters.studyMode === 'due' ? 'selected' : ''}>復習（期日到来・自動）</option>
          <option value="random" ${state.session.filters.studyMode === 'random' ? 'selected' : ''}>ランダム（すべて）</option>
          <option value="age" ${state.session.filters.studyMode === 'age' ? 'selected' : ''}>経過日数指定</option>
        </select>
      </label>
      <label style="display:inline-flex;align-items:center;gap:.35rem;">
        <span>経過日数</span>
        <input id="ageDays" type="number" min="0" max="365" step="1" value="${state.session.filters.ageDays || 3}" ${state.session.filters.studyMode === 'age' ? '' : 'disabled'} style="width:6rem;"/>
      </label>
      <input id="articleFilter" placeholder="記事ID（任意）" style="flex:1;min-width:240px;" value="${state.session.filters.articleId || ''}"/>
    </div>
    <div class="muted" style="margin:.25rem 0;">※ 期日は学習結果に応じて自動設定されます。個別に変更する場合は作問一覧の「編集」から次の期日を変更できます。</div>
    <div class="dq" id="studyBox">
      <div id="qText">問題を読み、答えを思い浮かべてください。</div>
      <div id="aText" style="display:none;margin-top:.5rem;">（答え）</div>
      <div class="row" style="margin-top:.75rem;">
        <button class="btn" id="showAns">答えをみる</button>
        <button class="btn ok" id="okBtn" style="display:none;">○ 正解（+1XP）</button>
        <button class="btn ng" id="ngBtn" style="display:none;">× 不正解</button>
      </div>
      <div id="log" class="muted" style="margin-top:.5rem;"></div>
    </div>
  `;
  div.appendChild(panel('学習', content));
  setTimeout(() => setupStudy(), 0);
  return div;
}

function viewSummary() {
  const div = document.createElement('div');
  const u = state.userDoc;
  const level = u?.level ?? 1;
  const totalXp = u?.totalXp ?? 0;
  const streakCur = u?.streak?.current ?? 0;
  const title = levelTitle(level);
  const head = `
    <div class="grid cols-2">
      <div class="card">
        <div>レベル: <b>${level}</b> ／ 総XP: <b>${totalXp}</b></div>
        <div class="muted">称号: ${title} ／ ストリーク: ${streakCur} 日</div>
      </div>
      <div class="card">
        <div>総正解: ${u?.totalCorrect ?? 0} ／ 総作問: ${u?.totalCreated ?? 0}</div>
      </div>
    </div>
  `;
  const body = `
    <div class="card" style="margin-top:.75rem;">
      <div class="muted" style="margin-bottom:.25rem;">直近の活動（14日）</div>
      <div id="sumTable" class="muted">読み込み中...</div>
    </div>
  `;
  div.appendChild(panel('サマリー', head + body));
  setTimeout(() => loadSummary(), 0);
  return div;

  async function loadSummary() {
    const uid = fb.user?.uid;
    if (!uid) return;
    const { collection, query, orderBy, limit, getDocs, getDoc, doc } = fb.fs;
    const renderRows = (items) =>
      items
        .map((d) => {
          const ymd = d.ymd || '';
          const fmt = ymd ? `${ymd.slice(0, 4)}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}` : '-';
          const created = d.created ?? 0;
          const correct = d.correct ?? 0;
          const xp = d.xp ?? 0;
          return `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--border);padding:.25rem 0;">
            <div style="min-width:7.5rem;">${fmt}</div>
            <div>作問: <b>${created}</b></div>
            <div>正解: <b>${correct}</b></div>
            <div>XP: <b>${xp}</b></div>
          </div>`;
        })
        .join('');
    const el = qs('#sumTable');
    try {
      const snap = await getDocs(
        query(collection(fb.db, 'users', uid, 'logs_daily'), orderBy('ymd', 'desc'), limit(14)),
      );
      const items = snap.docs.map((d) => d.data());
      el.innerHTML = items.length
        ? renderRows(items)
        : '<div class="muted">記録がありません。</div>';
    } catch (e) {
      try {
        const today = getJstYmd();
        const base = ymdToJstDate(today);
        const ymList = Array.from({ length: 14 }, (_, i) => {
          const d = new Date(base.getTime() - i * 24 * 3600 * 1000);
          return getJstYmd(d);
        });
        const snaps = await Promise.all(
          ymList.map((ymd) =>
            getDoc(doc(fb.db, 'users', uid, 'logs_daily', ymd)).catch(() => null),
          ),
        );
        const items = snaps
          .filter((s) => s && s.exists())
          .map((s) => s.data())
          .sort((a, b) => (a.ymd < b.ymd ? 1 : -1));
        el.innerHTML = items.length
          ? renderRows(items)
          : '<div class="muted">記録がありません。</div>';
      } catch (e2) {
        el.textContent = '記録がありません。';
      }
    }
  }
}

function setupStudy() {
  const qText = qs('#qText');
  const aText = qs('#aText');
  const show = qs('#showAns');
  const ok = qs('#okBtn');
  const ng = qs('#ngBtn');
  const log = qs('#log');
  const studyMode = qs('#studyMode');
  const ageDays = qs('#ageDays');
  const articleFilter = qs('#articleFilter');
  studyMode?.addEventListener('change', () => {
    state.session.filters.studyMode = studyMode.value;
    state.session.filters.dueOnly = studyMode.value === 'due';
    if (ageDays) {
      ageDays.disabled = studyMode.value !== 'age';
      if (!ageDays.disabled) setTimeout(() => ageDays.focus(), 0);
    }
    state.session.history = [];
    load();
  });
  const onAgeDaysUpdate = () => {
    const v = Math.max(0, Math.min(365, Number(ageDays.value || 0)));
    state.session.filters.ageDays = v;
    state.session.history = [];
    load();
  };
  ageDays?.addEventListener('change', onAgeDaysUpdate);
  ageDays?.addEventListener('input', onAgeDaysUpdate);
  articleFilter?.addEventListener('change', () => {
    state.session.filters.articleId = articleFilter.value.trim() || null;
    state.session.history = [];
    load();
  });
  async function load() {
    const qa = await fetchRandomQa();
    if (!qa) {
      qText.textContent = '出題できる問題がありません。まずは作問してください。';
      show.disabled = true;
      ok.style.display = ng.style.display = 'none';
      return;
    }
    state.session.history.push(qa.id);
    qText.textContent = qa.question;
    aText.textContent = '答え: ' + qa.answer + (qa.rationale ? `\n解説: ${qa.rationale}` : '');
    aText.style.display = 'none';
    show.style.display = 'inline-block';
    ok.style.display = ng.style.display = 'none';
    log.textContent = '';
  }
  show.onclick = () => {
    aText.style.display = 'block';
    ok.style.display = ng.style.display = 'inline-block';
    show.style.display = 'none';
  };
  // 学習ボックス内のスワイプで○/×
  const box = qs('#studyBox');
  let sx = 0,
    sy = 0,
    st = false;
  const stStart = (x, y) => {
    sx = x;
    sy = y;
    st = true;
  };
  const stEnd = async (x, y) => {
    if (!st) return;
    st = false;
    const dx = x - sx,
      dy = y - sy;
    if (Math.abs(dy) > 60) return;
    if (aText.style.display !== 'block') return; // 答え表示後のみ
    if (dx >= 40) {
      ok.click();
    } else if (dx <= -40) {
      ng.click();
    }
  };
  box.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      stStart(t.clientX, t.clientY);
    },
    { passive: true },
  );
  box.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches[0];
      stEnd(t.clientX, t.clientY);
    },
    { passive: true },
  );
  box.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') stStart(e.clientX, e.clientY);
    },
    { passive: true },
  );
  box.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerType === 'touch') stEnd(e.clientX, e.clientY);
    },
    { passive: true },
  );
  ok.onclick = async () => {
    try {
      const { isCritical, gain, leveledUp } = await awardCorrectXpAndUpdate(1);
      // SRS 更新（正解）: 次回復習タイミングをカレンダーで指定可能
      const lastId = state.session.history[state.session.history.length - 1];
      if (lastId) {
        try {
          const { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, getDocs } =
            fb.fs;
          const ref = doc(fb.db, 'qas', lastId);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const v = snap.data();
            const today = getJstYmd();
            const cur = v.srs || { reps: 0, ease: 2.5, interval: 0 };
            // 自動提案（SM-2風）
            let reps = (cur.reps || 0) + 1;
            let ease = typeof cur.ease === 'number' ? cur.ease : 2.5;
            ease = Math.max(1.3, Math.round((ease + 0.02) * 100) / 100);
            let interval;
            if (reps === 1) interval = 1;
            else if (reps === 2) interval = 3;
            else interval = Math.max(1, Math.round((cur.interval || 1) * ease));
            const suggested = addDaysToYmd(today, interval);
            const picked = await chooseNextDueYmdDialog(suggested);
            if (picked) {
              const pickedInterval = Math.max(0, ymdDiff(picked, today));
              await updateDoc(ref, {
                srs: {
                  reps,
                  ease,
                  interval: pickedInterval,
                  nextDueYmd: picked,
                  lastReviewedAt: serverTimestamp(),
                },
                updatedAt: serverTimestamp(),
              });
            } else {
              // キャンセル時は自動で更新
              await updateQaSrs(lastId, true);
            }
          }
        } catch (e2) {
          console.warn('次回復習タイミングの入力に失敗（自動へフォールバック）', e2);
          await updateQaSrs(lastId, true);
        }
      }
      const line1 = isCritical
        ? `<span class="crit">✨ 会心のいちげき！ ✨／けいけんちを ${gain} かくとく！</span>`
        : `<span>正解だった！／けいけんちを ${gain} かくとく！</span>`;
      const line2 = leveledUp ? `<div>レベルが あがった！</div>` : '';
      log.innerHTML = line1 + line2;
    } catch (e) {
      console.error(e);
      alert('更新に失敗しました: ' + (e?.message || e));
    } finally {
      setTimeout(load, 500);
    }
  };
  ng.onclick = () => {
    log.innerHTML = `<span class="miss">……まちがえてしまった。</span>`;
    // SRS 更新（不正解）
    const lastId = state.session.history[state.session.history.length - 1];
    if (lastId) updateQaSrs(lastId, false).finally(() => setTimeout(load, 500));
    else setTimeout(load, 500);
  };
  load();
}

function viewProfile() {
  const div = document.createElement('div');
  const uid = fb.user?.uid ? fb.user.uid.slice(0, 8) : '-';
  const u = state.userDoc;
  const isAnon = fb.user?.isAnonymous ?? true;
  const email = fb.user?.email || '';
  const content = `
    <div class="grid cols-2">
      <div class="card">ユーザーID: <code>${uid}</code><br/>サインイン: 匿名</div>
      <div class="card">総XP: ${u?.totalXp ?? 0} ／ 正解: ${u?.totalCorrect ?? 0} ／ 作問: ${u?.totalCreated ?? 0}</div>
    </div>
    <div class="card" style="margin-top:.75rem;">
      ${
        isAnon
          ? `
      <div style="margin-bottom:.5rem;">この端末は匿名アカウントです。メールにリンクするとUIDが固定され、他端末でも同じデータにアクセスできます。</div>
      <form id="linkForm" class="row" style="gap:.5rem;flex-wrap:wrap;">
        <input id="linkEmail" type="email" placeholder="メールアドレス" required style="min-width:240px;flex:1;" />
        <input id="linkPass" type="password" placeholder="パスワード（8文字以上推奨）" required style="min-width:200px;flex:1;" />
        <button class="btn" type="submit">アカウント固定（メール連携）</button>
      </form>
      <div class="row" style="margin-top:.5rem;gap:.5rem;">
        <button id="linkGoogle" class="btn">Googleでアカウント固定</button>
        <button id="signinGoogle" class="btn secondary">Googleでサインイン</button>
      </div>
      <details style="margin-top:.5rem;"><summary>既存アカウントにサインイン</summary>
        <form id="signinForm" class="row" style="gap:.5rem;flex-wrap:wrap;margin-top:.5rem;">
          <input id="signinEmail" type="email" placeholder="メールアドレス" required style="min-width:240px;flex:1;" />
          <input id="signinPass" type="password" placeholder="パスワード" required style="min-width:200px;flex:1;" />
          <button class="btn secondary" type="submit">サインイン</button>
        </form>
      </details>
      `
          : `
      <div>メール: <b>${email}</b></div>
      <div class="row" style="margin-top:.5rem;">
        <button id="signoutBtn" class="btn secondary">サインアウト</button>
      </div>
      `
      }
      <div id="authMsg" class="muted" style="margin-top:.5rem;"></div>
    </div>
  `;
  div.appendChild(panel('プロフィール', content));
  setTimeout(() => setupProfileAuth(), 0);
  return div;
}

function setupProfileAuth() {
  const msg = qs('#authMsg');
  const showMsg = (t, isErr = false) => {
    if (!msg) return;
    msg.textContent = t;
    msg.style.color = isErr ? '#f79393' : '#9fc1ff';
  };
  const linkForm = qs('#linkForm');
  if (linkForm) {
    linkForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = qs('#linkEmail').value.trim();
      const pass = qs('#linkPass').value;
      if (!email || !pass) return;
      try {
        const cred = fb.authApi.EmailAuthProvider.credential(email, pass);
        await fb.authApi.linkWithCredential(fb.auth.currentUser, cred);
        showMsg(
          'アカウントをメールにリンクしました。今後は他端末でこのメール/パスワードで同じデータにアクセスできます。',
        );
        render();
      } catch (err) {
        if (String(err?.code || '').includes('credential-already-in-use')) {
          showMsg('このメールは既に使用されています。下の「サインイン」をお試しください。', true);
        } else {
          showMsg('リンクに失敗しました: ' + (err?.message || err), true);
        }
      }
    });
  }
  const signinForm = qs('#signinForm');
  if (signinForm) {
    signinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = qs('#signinEmail').value.trim();
      const pass = qs('#signinPass').value;
      if (!email || !pass) return;
      try {
        await fb.authApi.signInWithEmailAndPassword(fb.auth, email, pass);
        showMsg('サインインしました。');
        render();
      } catch (err) {
        showMsg('サインインに失敗しました: ' + (err?.message || err), true);
      }
    });
  }
  const signoutBtn = qs('#signoutBtn');
  if (signoutBtn) {
    signoutBtn.addEventListener('click', async () => {
      try {
        await fb.authApi.signOut(fb.auth);
        showMsg('サインアウトしました。');
        // 再度匿名で入れるよう初期化
        initFirebase();
      } catch (err) {
        showMsg('サインアウト失敗: ' + (err?.message || err), true);
      }
    });
  }

  const linkGoogleBtn = qs('#linkGoogle');
  if (linkGoogleBtn) {
    linkGoogleBtn.addEventListener('click', async () => {
      try {
        const provider = new fb.authApi.GoogleAuthProvider();
        await fb.authApi.linkWithPopup(fb.auth.currentUser, provider);
        showMsg('Googleアカウントにリンクしました。他端末でも同じデータを使用できます。');
        render();
      } catch (err) {
        if (String(err?.code || '').includes('popup-blocked')) {
          const provider = new fb.authApi.GoogleAuthProvider();
          await fb.authApi.linkWithRedirect(fb.auth.currentUser, provider);
        } else if (
          String(err?.code || '').includes('credential-already-in-use') ||
          String(err?.code || '').includes('account-exists-with-different-credential')
        ) {
          showMsg(
            'このGoogleアカウントは既に使用されています。「Googleでサインイン」をお試しください。',
            true,
          );
        } else {
          showMsg('Googleリンクに失敗しました: ' + (err?.message || err), true);
        }
      }
    });
  }
  const signinGoogleBtn = qs('#signinGoogle');
  if (signinGoogleBtn) {
    signinGoogleBtn.addEventListener('click', async () => {
      try {
        const provider = new fb.authApi.GoogleAuthProvider();
        await fb.authApi.signInWithPopup(fb.auth, provider);
        showMsg('Googleでサインインしました。');
        render();
      } catch (err) {
        if (String(err?.code || '').includes('popup-blocked')) {
          const provider = new fb.authApi.GoogleAuthProvider();
          await fb.authApi.signInWithRedirect(fb.auth, provider);
        } else {
          showMsg('Googleサインインに失敗しました: ' + (err?.message || err), true);
        }
      }
    });
  }
}

// 初期化（Firebase を先に初期化してから描画）
try {
  await initFirebase();
} catch (e) {
  console.warn('Firebase 初期化に失敗', e);
}
initTheme();
attachSwipeNav();
render();

// -------- Toast utility --------
function showToast(msg, ms = 2000) {
  const root = qs('#toastRoot');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, ms);
}
