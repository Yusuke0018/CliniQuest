/*
  CliniQuest MVP skeleton (hash router + Firebase init + SW)
  - ルーティング: #/home | #/create | #/study | #/profile
  - Firebase: 匿名サインイン、Firestore永続化（設定は config.js または下記プレースホルダ）
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
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
updateOnline();

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

async function initFirebase() {
  if (!firebaseConfig.projectId) {
    console.warn('Firebase 未設定です。config.js を用意してください。');
    return;
  }
  const [
    { initializeApp },
    { getAuth, onAuthStateChanged, signInAnonymously },
    { initializeFirestore, persistentLocalCache, persistentMultipleTabManager },
  ] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
  ]);

  fb.app = initializeApp(firebaseConfig);
  fb.auth = getAuth(fb.app);
  // Firestore: オフライン永続化 + 複数タブマネージャ
  fb.db = initializeFirestore(fb.app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });

  onAuthStateChanged(fb.auth, async (user) => {
    if (!user) {
      await signInAnonymously(fb.auth).catch((e) => console.error('匿名サインイン失敗', e));
      return;
    }
    fb.user = user;
    // 初回ユーザー文書の作成は後続実装（MVP通過後）
    render();
  });
}

// -------- Routing --------
const routes = {
  '/home': viewHome,
  '/create': viewCreate,
  '/study': viewStudy,
  '/profile': viewProfile,
};

function getPath() {
  const h = location.hash || '#/home';
  try {
    return new URL(h.replace('#', ''), location.origin).pathname;
  } catch {
    return '/home';
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
  const content = `
    ${warn}
    <div class="grid cols-2">
      <div class="card">
        <div>レベル: <b>1</b> ／ 次まで: <span class="muted">80 XP</span></div>
        <div class="muted">称号: -</div>
        <div><span class="stat">知識</span>0 <span class="stat">判断力</span>0 <span class="stat">技術</span>0 <span class="stat">共感力</span>0</div>
      </div>
      <div class="card">
        <div>今日の復習: <b>0</b> 問</div>
        <div>ストリーク: 0 日</div>
      </div>
    </div>
    <div class="row" style="margin-top: .75rem;">
      <a class="btn" href="#/study">学習をはじめる</a>
      <a class="btn secondary" href="#/create">新規作問</a>
    </div>
  `;
  div.appendChild(panel('ホーム', content));
  return div;
}

function viewCreate() {
  const div = document.createElement('div');
  const content = `
    <form id="createForm" class="grid">
      <div class="field"><label>問題（Q）</label><textarea id="q" rows="3" required></textarea></div>
      <div class="field"><label>答え（A）</label><textarea id="a" rows="3" required></textarea></div>
      <div class="field"><label>解説（任意）</label><textarea id="r" rows="3"></textarea></div>
      <div class="field"><label>タグ（カンマ区切り・任意）</label><input id="tags" placeholder="例: 感染症, 抗菌薬"/></div>
      <div class="row">
        <button class="btn" type="submit">保存（+5XP）</button>
      </div>
    </form>
    <p class="muted">MVPではローカル保存のダミー挙動です（Firebase接続後に同期へ移行）。</p>
  `;
  div.appendChild(panel('問題を作成', content));
  setTimeout(() => {
    const form = qs('#createForm');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = qs('#q').value.trim();
      const a = qs('#a').value.trim();
      if (!q || !a) return alert('Q と A は必須です');
      const r = qs('#r').value.trim();
      const tags = qs('#tags').value.trim();
      const qa = { q, a, r, tags, createdAt: Date.now() };
      const list = JSON.parse(localStorage.getItem('clq.qas') || '[]');
      list.push(qa);
      localStorage.setItem('clq.qas', JSON.stringify(list));
      alert('保存しました（ダミー）: +5XP');
      location.hash = '#/study';
    });
  });
  return div;
}

function viewStudy() {
  const div = document.createElement('div');
  const content = `
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
  const list = JSON.parse(localStorage.getItem('clq.qas') || '[]');
  const qText = qs('#qText');
  const aText = qs('#aText');
  const show = qs('#showAns');
  const ok = qs('#okBtn');
  const ng = qs('#ngBtn');
  const log = qs('#log');
  if (!list.length) {
    qText.textContent = 'まだ問題がありません。まずは作問してください。';
    show.disabled = true;
    return;
  }
  const idx = Math.floor(Math.random() * list.length);
  const item = list[idx];
  qText.textContent = item.q;
  aText.textContent = '答え: ' + item.a + (item.r ? `\n解説: ${item.r}` : '');
  show.onclick = () => {
    aText.style.display = 'block';
    ok.style.display = ng.style.display = 'inline-block';
    show.style.display = 'none';
  };
  ok.onclick = () => {
    const xp = 1; // 会心は後で実装
    log.innerHTML = `<span>正解だった！／けいけんちを ${xp} かくとく！</span>`;
  };
  ng.onclick = () => {
    log.innerHTML = `<span class="miss">……まちがえてしまった。</span>`;
  };
}

function viewProfile() {
  const div = document.createElement('div');
  const uid = fb.user?.uid ? fb.user.uid.slice(0, 8) : '-';
  const content = `
    <div class="grid cols-2">
      <div class="card">ユーザーID: <code>${uid}</code><br/>サインイン: 匿名</div>
      <div class="card">総XP: 0 ／ 正解: 0 ／ 作問: 0</div>
    </div>
  `;
  div.appendChild(panel('プロフィール', content));
  return div;
}

// 初期化
render();
initFirebase();
