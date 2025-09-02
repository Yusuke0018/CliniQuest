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
const SETS = [
  [5, 3, 2, 1],
  [5, 4, 2, 1],
  [5, 4, 3, 1],
  [5, 4, 3, 2],
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
  session: { history: [], filters: { dueOnly: true, articleId: null } },
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
    onSnapshot,
    collection,
    addDoc,
    getDocs,
    query,
    where,
    limit,
    orderBy,
    serverTimestamp,
    runTransaction,
  } = firestore;

  // expose for helpers
  fb.fs = {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    onSnapshot,
    collection,
    addDoc,
    getDocs,
    query,
    where,
    limit,
    orderBy,
    serverTimestamp,
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
      stats: { knowledge: 0, judgment: 0, skill: 0, empathy: 0 },
      streak: { current: 0, best: 0, lastActiveYmd: null },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
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
  return doc(fb.db, 'logs_daily', `${uid}_${ymd}`);
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
    if (!qa.createdXpAwarded) {
      const userSnap = await tx.get(userRef);
      const u = userSnap.data();
      const prevXp = u.totalXp || 0;
      const prevLevel = u.level || 1;
      const addXp = 5;
      const newXp = prevXp + addXp;
      const newLevel = computeLevel(newXp);
      const inc =
        newLevel > prevLevel ? computeLevelUpIncrements(u.seed, prevLevel, newLevel) : null;
      const today = getJstYmd();
      const newStreak = nextStreak(u.streak || { current: 0, best: 0, lastActiveYmd: null }, today);
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
      tx.update(userRef, patch);
      tx.update(qaRef, { createdXpAwarded: true, updatedAt: serverTimestamp() });
      // logs_daily 集計
      const ldRef = logsDailyDocRef(uid, today);
      const ldSnap = await tx.get(ldRef);
      if (ldSnap.exists()) {
        const d = ldSnap.data();
        tx.update(ldRef, {
          created: (d.created || 0) + 1,
          xp: (d.xp || 0) + addXp,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(ldRef, {
          uid,
          ymd: today,
          created: 1,
          correct: 0,
          xp: addXp,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
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
    // logs_daily 集計
    const ldRef = logsDailyDocRef(uid, today);
    const ldSnap = await tx.get(ldRef);
    if (ldSnap.exists()) {
      const d = ldSnap.data();
      tx.update(ldRef, {
        correct: (d.correct || 0) + 1,
        xp: (d.xp || 0) + gain,
        updatedAt: serverTimestamp(),
      });
    } else {
      tx.set(ldRef, {
        uid,
        ymd: today,
        created: 0,
        correct: 1,
        xp: gain,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    const leveledUp = newLevel > prevLevel;
    return { isCritical, gain, leveledUp, levelAfter: newLevel };
  });
}

// -------- Routing --------
const routes = {
  '/home': viewHome,
  '/articles': viewArticles,
  '/article': viewArticle,
  '/create': viewCreate,
  '/study': viewStudy,
  '/profile': viewProfile,
};
// スワイプナビゲーションの順序（ループ）
const NAV_ORDER = ['/home', '/articles', '/create', '/study', '/profile'];

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
  // 下部タブの活性
  qsa('#tabbar [data-route]').forEach((a) => {
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
  // 学習バッジ更新（非同期）
  setTimeout(async () => {
    try {
      const n = await countDueToday();
      const bd = qs('#tabStudyBadge');
      if (bd) {
        if (n > 0) {
          bd.textContent = String(n);
          bd.hidden = false;
        } else {
          bd.hidden = true;
        }
      }
    } catch {}
  }, 0);
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
      <div class="row"><button class="btn" type="submit">記事を保存</button></div>
    </form>
    <div id="artList" class="grid" style="margin-top:1rem;"></div>
  `;
  div.appendChild(panel('記事', content));
  setTimeout(() => setupArticles(), 0);
  return div;
}

async function setupArticles() {
  const { collection, query, where, getDocs, addDoc, serverTimestamp } = fb.fs;
  const listEl = qs('#artList');
  const form = qs('#artForm');
  // 検索欄を追加（存在しなければ）
  if (!qs('#artSearch')) {
    const cont = qs('#app .window');
    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginBottom = '.5rem';
    row.innerHTML =
      '<input id="artSearch" placeholder="記事を検索（タイトル/本文）" style="flex:1;min-width:240px;"/>';
    cont?.insertBefore(row, cont.children[1]);
  }
  const search = qs('#artSearch');
  async function refresh() {
    const uidNow = fb.user?.uid;
    if (!uidNow) return;
    const snap = await getDocs(query(collection(fb.db, 'articles'), where('uid', '==', uidNow)));
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const term = (search?.value || '').trim().toLowerCase();
    const filtered = term
      ? items.filter(
          (it) =>
            (it.title || '').toLowerCase().includes(term) ||
            (it.body || '').toLowerCase().includes(term),
        )
      : items;
    listEl.innerHTML = filtered
      .map(
        (it) => `
      <div class="card">
        <div><b><a href="#/article?slug=${encodeURIComponent(it.slug)}">${it.title}</a></b> <small class="muted">(${it.id.slice(0, 6)})</small></div>
        <div class="muted" style="margin:.25rem 0;">${(it.body || '').slice(0, 100)}</div>
        <div class="row">
          <a class="btn secondary" href="#/study" onclick="window.CLQ_setArticle('${it.id}')">この記事で出題</a>
          <a class="btn secondary" href="#/article?slug=${encodeURIComponent(it.slug)}">読む</a>
        </div>
      </div>`,
      )
      .join('');
  }
  window.CLQ_setArticle = (id) => {
    state.session.filters.articleId = id;
    location.hash = '#/study';
  };
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = qs('#artTitle').value.trim();
    const body = qs('#artBody').value;
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
      await addDoc(collection(fb.db, 'articles'), {
        uid: uidNow,
        title,
        slug,
        body,
        tags: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      qs('#artTitle').value = '';
      qs('#artBody').value = '';
      showToast && showToast('記事を保存しました');
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
        .filter((d) => d.id !== article.id && re.test(d.data().body || ''))
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
          <div class="row"><button id="saveArticle" class="btn">保存</button></div>
        </details>
        <div class="row" style="margin-top:.75rem;">
          <a class="btn secondary" href="#/articles">記事一覧</a>
          <a class="btn" href="#/study" onclick="window.CLQ_setArticle('${article.id}')">この記事で出題</a>
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
      const saveBtn = qs('#saveArticle', wrap);
      saveBtn?.addEventListener('click', async () => {
        try {
          const body = qs('#editBody', wrap).value;
          const { doc, updateDoc, serverTimestamp } = fb.fs;
          await updateDoc(doc(fb.db, 'articles', article.id), {
            body,
            updatedAt: serverTimestamp(),
          });
          // 再描画
          showToast && showToast('記事を保存しました');
          location.hash = `#/article?slug=${encodeURIComponent(article.slug)}`;
        } catch (err) {
          alert('保存に失敗しました: ' + (err?.message || err));
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
      <div class="field"><label>記事タイトル（既存/新規）</label><input id="articleTitle" placeholder="例: 肺炎の初期対応"/></div>
      <div class="field"><label>問題（Q）</label><textarea id="q" rows="3" required></textarea></div>
      <div class="field"><label>答え（A）</label><textarea id="a" rows="3" required></textarea></div>
      <div class="field"><label>解説（任意）</label><textarea id="r" rows="3"></textarea></div>
      <div class="field"><label>タグ（カンマ区切り・任意）</label><input id="tags" placeholder="例: 感染症, 抗菌薬"/></div>
      <div class="row">
        <button class="btn" type="submit">保存（+5XP）</button>
      </div>
    </form>
    <p class="muted">保存すると一度だけ +5XP が付与されます。</p>
  `;
  div.appendChild(panel('問題を作成', content));
  setTimeout(() => {
    const form = qs('#createForm');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const artTitle = qs('#articleTitle').value.trim();
      let articleId = null;
      if (artTitle) {
        try {
          articleId = await createOrGetArticleByTitle(artTitle);
        } catch (e2) {}
        if (articleId) state.session.filters.articleId = articleId;
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
  });
  return div;
}

async function fetchRandomQa() {
  const { collection, getDocs, query, where, limit, orderBy } = fb.fs;
  const uid = fb.user?.uid;
  if (!uid) return null;
  const filters = state.session.filters || {};
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
  if (filters.dueOnly)
    docs = docs.filter((d) => {
      const srs = d.data().srs;
      if (!srs || !srs.nextDueYmd) return true;
      return srs.nextDueYmd <= today;
    });
  if (!docs.length) return null;
  const pick = docs[Math.floor(Math.random() * docs.length)];
  return { id: pick.id, ...pick.data() };
}

function viewStudy() {
  const div = document.createElement('div');
  const content = `
    <div class="row" style="margin-bottom:.5rem;">
      <label style="display:inline-flex;align-items:center;gap:.35rem;">
        <input type="checkbox" id="dueOnly" ${state.session.filters.dueOnly ? 'checked' : ''}/> 復習のみ
      </label>
      <input id="articleFilter" placeholder="記事ID（任意）" style="flex:1;min-width:240px;" value="${state.session.filters.articleId || ''}"/>
    </div>
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

function setupStudy() {
  const qText = qs('#qText');
  const aText = qs('#aText');
  const show = qs('#showAns');
  const ok = qs('#okBtn');
  const ng = qs('#ngBtn');
  const log = qs('#log');
  const dueOnly = qs('#dueOnly');
  const articleFilter = qs('#articleFilter');
  dueOnly?.addEventListener('change', () => {
    state.session.filters.dueOnly = !!dueOnly.checked;
    state.session.history = [];
    load();
  });
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
      // SRS 更新（正解）
      const lastId = state.session.history[state.session.history.length - 1];
      if (lastId) await updateQaSrs(lastId, true);
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

// 初期化
render();
initFirebase();
initTheme();
attachSwipeNav();

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
