// 文献面板的页面逻辑。从上到下分八段：工具与提示条、宿主消息、目录树与搜索、打开与显示文件、编辑与保存、选字评论与评论卡片、原装输入框浮起与对话记录、放大缩小。
const $ = (id) => document.getElementById(id);
const side = $('side'), tree = $('tree');
// 显示区分左右两栏（paneA、paneB，右栏只在分屏时显示）。顶栏的选项卡条是所有打开文件的一条总清单，不分栏；每个选项卡记着自己在哪一栏显示（pane 字段）。
// panes 存每栏的数据：el 栏元素、views 显示区容器、placeholder 占位块、active 这一栏正显示的选项卡；paneIdx 是当前栏。
// 下面这几个全局量始终描述“当前栏正显示的选项卡”：view 是它的那块显示区（没有就是占位块），current、currentText、cm、dirty、live 等同理
const panes = [$('paneA'), $('paneB')].map(el => ({ el, views: el.querySelector('.views'), placeholder: el.querySelector('.placeholder'), active: null }));
let paneIdx = 0; const pane = () => panes[paneIdx];
let view = panes[0].placeholder;
const token = new URLSearchParams(location.search).get('token');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sidecar-Token': token }, body: JSON.stringify(body) } : undefined);
  const d = await r.json(); if (d.error) throw new Error(d.error); return d;
};
// 细线小图标
const ICON = {
  folder: '<svg viewBox="0 0 16 16"><path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 1.5H13a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12v-7.5z"/></svg>',
  file: '<svg viewBox="0 0 16 16"><path d="M4 1.5h5l3.5 3.5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11.5a1 1 0 0 1 1-1z"/><path d="M9 1.5V5h3.5"/></svg>',
  copy: '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 7v4M9.5 7v4"/></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};
// 提示条：报错、确认、反馈都从这里出。面板 iframe 的沙箱没放开浏览器弹框，所以自己画。
let toastTimer = null;
function toast(text, { ms = 2500, kind = '' } = {}) {
  const t = $('toast'); clearTimeout(toastTimer); t.className = 'show ' + kind; t.innerHTML = `<span>${esc(text)}</span>`;
  if (ms) toastTimer = setTimeout(() => { t.className = ''; }, ms);
}
function ask(text, okLabel, onOk) {
  const t = $('toast'); clearTimeout(toastTimer); t.className = 'show'; t.innerHTML = `<span>${esc(text)}</span><button class="ok">${esc(okLabel)}</button><button class="no">Cancel</button>`;
  t.querySelector('.ok').onclick = () => { t.className = ''; onOk(); };
  t.querySelector('.no').onclick = () => { t.className = ''; };
}
window.addEventListener('error', (e) => toast('Page error: ' + e.message, { ms: 6000, kind: 'error' }));
window.addEventListener('unhandledrejection', (e) => toast('Error: ' + (e.reason && e.reason.message || e.reason), { ms: 6000, kind: 'error' }));
// 顶栏图标钮的小气泡。带 data-tip 的图标钮，鼠标一移上去就在图标的右下方显示它的名字（比系统自带的提示出得快，也短）；
// 靠近面板右边缘的钮右下方放不下，就往左收到刚好不出界。按下鼠标时收起，免得盖住随后弹出的清单
const tip = $('tip');
$('bar').addEventListener('mouseover', (e) => {
  const b = e.target.closest('[data-tip]'); if (!b) { tip.style.display = 'none'; return; }
  tip.textContent = b.dataset.tip; tip.style.display = 'block'; const r = b.getBoundingClientRect();
  tip.style.left = Math.min(r.right - 8, innerWidth - tip.offsetWidth - 4) + 'px'; tip.style.top = (r.bottom - 2) + 'px';
});
$('bar').addEventListener('mouseleave', () => { tip.style.display = 'none'; });
$('bar').addEventListener('mousedown', () => { tip.style.display = 'none'; });
pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
const md = window.markdownit({ html: false, linkify: true });

let root = null, current = null, currentText = '', cm = null, dirty = false;   // 这几项都是“当前选项卡”的状态，切换选项卡时存进去、取出来
const tabs = [];   // 所有打开的文件，每项 { path, pane, el, text, cm, dirty, live, scroll, activeLine, imgWidgets, imgSig }
const notes = []; let pending = null; const cmMarks = {};   // notes：当前这一轮（还没随消息发出去）的评论；cmMarks：编辑器里每条评论的书签，按编号存
let kept = 0;   // 已经随消息发出去的评论有多少条：它们只留在记录文件里供代理查阅，面板里不再显示
const conv = new URLSearchParams(location.search).get('conversationId') || '';   // 本面板所在对话的编号，宿主写在面板网址里；没带时由后端从主窗口的地址里取
api('/api/notes').then(d => { notes.push(...d.notes); kept = d.kept || 0; for (const x of notes) { x.label = x.label || shortLabel(x); x.at = x.at || Date.now(); } updateBar(); placeMarks(); });
const relOf = (p) => root && p.startsWith(root) ? p.slice(root.length + 1) : p;

// 一、宿主消息。主题变量和工作区路径由宿主通过 postMessage 推来（和应用 SDK 里 preload.js 的约定相同）。
// 1.5 秒内没收到工作区就先用默认文件夹，之后收到了再切过去。
let themed = false;
window.addEventListener('message', (e) => {
  if (e.data?.type === 'theme-change') { themed = true; for (const [k, v] of Object.entries(e.data.payload.cssVariables)) document.documentElement.style.setProperty(k, v); }
  if (e.data?.type === 'workspace-change') { const uris = e.data.payload?.workspaceUris || []; if (uris.length) setRoot(decodeURIComponent(new URL(uris[0]).pathname)); }
});
setTimeout(async () => { if (!root) { const d = await api('/api/home'); if (!root) setRoot(d.home); } }, 1500);   // 宿主没推来工作区就用用户主目录
// 宿主只在自己创建面板时推主题，面板自己重载后收不到；1 秒内没等到就向后端要主窗口当前的主题变量，之后宿主再推会覆盖
setTimeout(async () => { if (themed) return; try { const d = await api('/api/theme'); for (const [k, v] of Object.entries(d.cssVariables || {})) document.documentElement.style.setProperty(k, v); } catch { } }, 1000);

// 二、目录树与搜索。目录点开时才向后端要它的子项；搜索框有字时，树换成搜索结果清单。
function setRoot(dir) { root = dir; tree.innerHTML = ''; tree.appendChild(makeDirNode(dir, dir.slice(dir.lastIndexOf('/') + 1), true)); updateBar(); }
function makeDirNode(path, name, open) {
  const wrap = document.createElement('div');
  const row = document.createElement('div'); row.className = 'node dir'; row.innerHTML = `<span class="tw">▶</span>${ICON.folder}<span class="nm">${esc(name)}</span>`;
  const kids = document.createElement('div'); kids.className = 'children'; kids.style.display = 'none';
  let loaded = false;
  row.onclick = async () => {
    if (!loaded) { const d = await api('/api/tree?dir=' + encodeURIComponent(path)); for (const e of d.entries) kids.appendChild(e.dir ? makeDirNode(e.path, e.name, false) : makeFileNode(e.path, e.name)); loaded = true; }
    const shown = kids.style.display !== 'none'; kids.style.display = shown ? 'none' : ''; row.classList.toggle('open', !shown);
  };
  // 行尾两个小钮，和文件行一样：复制文件夹的绝对路径；把文件夹作为“@文件夹”小标签插进对话框（@ 菜单把目录和文件混在一起列出，对不上时退回插相对路径）
  const cp = document.createElement('button'); cp.className = 'icon small rowbtn'; cp.title = 'Copy absolute path of this folder'; cp.innerHTML = ICON.copy;
  cp.onclick = (e) => { e.stopPropagation(); navigator.clipboard.writeText(path).then(() => toast('Path copied', { ms: 1500 }), (err) => toast('Could not copy: ' + err.message, { ms: 5000, kind: 'error' })); };
  const at = document.createElement('button'); at.className = 'icon small rowbtn at'; at.title = 'Mention this folder in the chat'; at.textContent = '@';
  at.onclick = async (e) => {
    e.stopPropagation();
    const rel = relOf(path), dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    try { await api('/api/insert', { segments: [{ mention: name, dir, fallback: (rel || name) + '/' }], inline: true }); }
    catch (err) { toast('Could not mention the folder: ' + err.message, { ms: 6000, kind: 'error' }); }
  };
  row.append(cp, at);
  wrap.append(row, kids); if (open) row.onclick(); return wrap;
}
function makeFileNode(path, label, sub) {
  const row = document.createElement('div'); row.className = 'node file' + (path === current ? ' on' : '') + (sub !== undefined ? ' hit' : ''); row.dataset.path = path; row.title = path;
  row.innerHTML = `${sub === undefined ? '<span class="tw"></span>' : ''}${ICON.file}<span class="nm">${esc(label)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span>`;
  row.onclick = () => openFile(path);
  row.draggable = true; row.addEventListener('dragstart', (e) => { dragFile = path; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', path); });   // 可以把文件直接拖到显示区的左半或右半打开
  // 行尾的 @ 小钮：把这个文件作为“@文件”小标签插进当前对话框，和手动敲 @ 选文件一样；对不上时退回插入相对路径
  const at = document.createElement('button'); at.className = 'icon small rowbtn at'; at.title = 'Mention this file in the chat'; at.textContent = '@';
  at.onclick = async (e) => {
    e.stopPropagation();
    const name = path.slice(path.lastIndexOf('/') + 1), rel = relOf(path), dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    try { await api('/api/insert', { segments: [{ mention: name, dir, fallback: rel }], inline: true }); }
    catch (err) { toast('Could not mention the file: ' + err.message, { ms: 6000, kind: 'error' }); }
  };
  // @ 钮左边的复制钮：把这个文件的绝对路径复制到剪贴板
  const cp = document.createElement('button'); cp.className = 'icon small rowbtn'; cp.title = 'Copy absolute path'; cp.innerHTML = ICON.copy;
  cp.onclick = (e) => { e.stopPropagation(); navigator.clipboard.writeText(path).then(() => toast('Path copied', { ms: 1500 }), (err) => toast('Could not copy: ' + err.message, { ms: 5000, kind: 'error' })); };
  row.append(cp, at); return row;
}
let searchTimer = null;
async function runSearch() {
  const q = $('search').value.trim();
  if (!q) { setRoot(root); return; }
  const d = await api('/api/search?root=' + encodeURIComponent(root) + '&q=' + encodeURIComponent(q));
  tree.innerHTML = ''; for (const h of d.hits) tree.appendChild(makeFileNode(h.path, h.name, h.rel.slice(0, h.rel.length - h.name.length - 1) || '.'));
  if (!d.hits.length) tree.innerHTML = '<div class="hint">No matching files</div>';
}
$('search').addEventListener('input', () => { $('searchbox').classList.toggle('has', !!$('search').value); clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 200); });
$('searchClear').onclick = () => { $('search').value = ''; $('searchbox').classList.remove('has'); setRoot(root); $('search').focus(); };
$('treeBtn').onclick = () => { const hidden = side.classList.toggle('hidden'); $('resizer').classList.toggle('hidden', hidden); $('treeBtn').classList.toggle('on', !hidden); };
// 拖动目录栏右侧的细条改宽度
$('resizer').addEventListener('mousedown', (e) => {
  const startX = e.clientX, startW = side.offsetWidth; $('resizer').classList.add('on'); e.preventDefault();
  const move = (ev) => { side.style.width = Math.max(140, Math.min(startW + ev.clientX - startX, innerWidth - 200)) + 'px'; };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); $('resizer').classList.remove('on'); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
});

// 三、打开与显示文件。每个打开的文件一个选项卡，各有自己的显示区。pdf 按需逐页画并铺可选中的文字层；图片直接显示；md 默认阅读态（记住最后选的档）；其他文本文件直接进编辑器；二进制文件不预览。
// 打开文件：已经开着就切到它的选项卡；否则新开一个（上限八个）。未保存的改动留在各自的选项卡里，不再因为打开别的文件而丢失
async function openFile(path) {
  const found = tabs.find(t => t.path === path); if (found) { activate(found); return; }   // 已经开着：它在哪一栏就切到哪一栏显示
  if (tabs.length >= 8) { toast('Eight tabs are open; close one first.', { ms: 4000, kind: 'error' }); return; }
  const tab = { path, pane: paneIdx, el: document.createElement('div'), text: '', cm: null, dirty: false, live: false, scroll: 0, activeLine: null, imgWidgets: [], imgSig: '' };
  tab.el.className = 'view'; pane().views.appendChild(tab.el); tabs.push(tab); activate(tab);
  await loadTab();
}
const setView = (cls) => { view.className = 'view on' + (cls ? ' ' + cls : ''); };
// 把当前选项卡的文件（重新）装进它的显示区：pdf 逐页画，图片直接显示，md 按记住的档，html 预览，其余进编辑器
async function loadTab() {
  const tab = pane().active, path = current; cm = null; dropCmMarks(); view.innerHTML = ''; setView('');
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const noPreview = ['xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'gdx', 'zip', 'gz', 'tgz', '7z', 'rar', 'dmg', 'pkg', 'exe', 'dylib', 'so', 'o', 'pyc', 'sqlite', 'db', 'parquet', 'feather', 'pkl', 'npy', 'npz', 'mat', 'rdata', 'rds', 'fls', 'fdb_latexmk', 'synctex', 'bin', 'ttf', 'otf', 'woff', 'woff2', 'mp4', 'mov', 'mp3', 'wav'];
  if (noPreview.includes(ext)) { view.innerHTML = '<div class="hint">This file type (.' + esc(ext) + ') is not previewed here.</div>'; updateBar(); return; }
  if (ext === 'pdf') await showPdf(path);
  else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) { setView('img'); view.innerHTML = `<img src="/api/file?path=${encodeURIComponent(path)}">`; }
  else { const text = await (await fetch('/api/file?path=' + encodeURIComponent(path))).text(); if (pane().active !== tab) activate(tab); currentText = text; if (ext === 'md' || ext === 'markdown') { let pref = 'read'; try { pref = localStorage.getItem('dp-mdmode') || 'read'; } catch { } if (pref === 'live' || pref === 'source') showEditor(ext, pref === 'live'); else showMarkdown(); } else if (ext === 'html' || ext === 'htm') showHtml(); else showEditor(ext); }
  updateBar();
}
async function showPdf(path) {
  setView('pdf'); const v = view;   // 逐页 await 期间用户可能切到别的选项卡，页面要一直放进这一块
  const bytes = new Uint8Array(await (await fetch('/api/file?path=' + encodeURIComponent(path))).arrayBuffer());
  v.pdfDoc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  await layoutPdf(v); pdfRO.observe(v);   // 排好第一遍之后才开始盯这块显示区的宽度
}
// 把一块显示区里的 PDF 按这块显示区现在的宽度排一遍：打开文件时排一次，之后显示区的宽度变了再排（见下面的 pdfRO）。
// 每次开排记一个序号 pdfRun；逐页 await 期间如果又开始了新的一遍，旧的这一遍就停下，两遍的页面不会叠在一起
async function layoutPdf(v) {
  const run = v.pdfRun = (v.pdfRun || 0) + 1, pdf = v.pdfDoc; v.innerHTML = '';
  const width = v.pdfWidth = Math.min(v.clientWidth - 24, 960) * zoom;
  // 先按每页尺寸放好空白页，滚到附近（上下各 800 像素以内）才真正画那一页，长文件打开就不用等全部画完
  const io = new IntersectionObserver((entries) => { for (const en of entries) if (en.isIntersecting) { io.unobserve(en.target); en.target.renderPage(); } }, { root: v, rootMargin: '800px 0px' });
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i); if (v.pdfRun !== run) return;
    const scale = width / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });
    const holder = document.createElement('div'); holder.className = 'page'; holder.style.width = viewport.width + 'px'; holder.style.height = viewport.height + 'px';
    holder.renderPage = async () => {
      const canvas = document.createElement('canvas'); canvas.width = viewport.width * devicePixelRatio; canvas.height = viewport.height * devicePixelRatio; canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
      const layer = document.createElement('div'); layer.className = 'textLayer'; layer.style.setProperty('--scale-factor', scale);
      holder.append(canvas, layer);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0] }).promise;
      await pdfjsLib.renderTextLayer({ textContentSource: await page.getTextContent(), container: layer, viewport, textDivs: [] }).promise;
      // 文字层末尾加一块“内容结束”层：按下鼠标时把它从按下的位置铺到页底，拖选超出行尾时选区就不会跳到后面的行（pdf.js 自带查看器的做法）
      const end = document.createElement('div'); end.className = 'endOfContent'; layer.appendChild(end);
      layer.addEventListener('mousedown', (e) => { const r = layer.getBoundingClientRect(); end.style.top = Math.max(0, (e.clientY - r.top) / r.height * 100).toFixed(2) + '%'; end.classList.add('active'); });
      layer.addEventListener('mouseup', () => { end.style.top = ''; end.classList.remove('active'); });
      placeMarks();
    };
    v.appendChild(holder); io.observe(holder);
  }
}
// PDF 的页宽跟着所在显示区的宽度走。进出分屏、拖分隔条、收放目录栏、窗格最大化或恢复，都会让显示区变宽或变窄；
// 宽度停止变化 250 毫秒后，按新宽度算出该用的页宽，和当前排版用的页宽（pdfWidth）差 8 像素以上就重排，滚动位置按比例保住。
// 隐藏着的选项卡宽度是 0，不处理；它重新显示时宽度从 0 变回来，会再触发一次，所以分屏时打开、退出分屏后才切过去的 PDF 也会重排
const pdfRO = new ResizeObserver((entries) => {
  for (const en of entries) {
    const v = en.target; clearTimeout(v.pdfTimer);
    v.pdfTimer = setTimeout(async () => {
      if (!v.offsetWidth || Math.abs(Math.min(v.offsetWidth - 24, 960) * zoom - v.pdfWidth) < 8) return;
      const ratio = v.scrollTop / Math.max(1, v.scrollHeight); await layoutPdf(v); v.scrollTop = ratio * v.scrollHeight;
      const t = tabs.find(x => x.el === v); if (t) t.scroll = v.scrollTop;   // 选项卡自己记着的滚动位置是旧排版下的数值，换成新排版下的，之后它隐藏再显示时才回得到同一处
    }, 250);
  }
});
function showMarkdown() {
  cm = null; dropCmMarks(); setView('md'); view.innerHTML = '<div class="mdbody"></div>';
  view.firstChild.innerHTML = md.render(currentText);
  // md 里的图片：网址和内嵌数据原样保留，其余按 md 所在目录换算成绝对路径，经 /api/file 取图
  const dir = current.slice(0, current.lastIndexOf('/') + 1);
  for (const img of view.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    if (!src || /^(https?:|data:)/.test(src)) continue;
    img.src = '/api/file?path=' + encodeURIComponent(decodeURIComponent(new URL(src, 'file://' + dir).pathname));
  }
  updateBar(); placeMarks();
}

// 三之二、HTML 预览。内嵌框架从 /raw/<路径> 加载，网页里相对路径引用的样式、脚本、图片都能找到。框架和面板同源，所以能读到里面的选区、往里面打标记。
const MARK_CSS = 'sup.mark{display:inline-block;min-width:14px;height:14px;padding:0 3px;margin:0 2px;border-radius:7px;background:#cb4b16;color:#fff;font:9px/14px -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;vertical-align:super;user-select:none;cursor:pointer}';
// 分屏时预览页面自己的竖向滚动条也不显示（统一由显示区最右侧那一条代替）：框架里的 html 元素带上 dp-split 类时生效，横向的留一条细的
const SPLIT_CSS = 'html.dp-split::-webkit-scrollbar{width:0;height:8px}html.dp-split::-webkit-scrollbar-thumb{background:rgba(128,128,128,.5);border-radius:4px}';
function showHtml() {
  cm = null; dropCmMarks(); setView('html'); view.innerHTML = '';
  const f = document.createElement('iframe'); f.className = 'htmlFrame'; f.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms'); f.src = '/raw' + encodeURI(current).replace(/#/g, '%23').replace(/\?/g, '%3F');
  view.appendChild(f);
  f.addEventListener('load', () => {
    const d = f.contentDocument; if (!d || !d.head) return;
    const st = d.createElement('style'); st.textContent = MARK_CSS + SPLIT_CSS; d.head.appendChild(st); d.documentElement.classList.toggle('dp-split', document.body.classList.contains('split'));
    d.addEventListener('mousedown', () => focusPane(panes.findIndex(p => p.el.contains(f))), true);   // 在预览里按下鼠标，这一栏同样成为当前栏：框架里的鼠标事件传不到面板页面，各栏上接的那个 mousedown 收不到
    d.addEventListener('mouseup', () => setTimeout(showPopBtn, 0));
    d.addEventListener('click', (e) => { const m = e.target.closest && e.target.closest('sup.mark'); if (m) openNoteBox(+m.dataset.n, frameRect(m)); });
    placeMarks();
  });
  updateBar();
}
const frameDoc = () => { const f = view.querySelector('iframe.htmlFrame'); return f && f.contentDocument; };
// 框架里元素的位置换算到面板坐标
function frameRect(el) { const f = view.querySelector('iframe.htmlFrame').getBoundingClientRect(), r = el.getBoundingClientRect(); return { left: f.left + r.left, top: f.top + r.top, right: f.left + r.right, bottom: f.top + r.bottom, width: r.width, height: r.height, getBoundingClientRect() { return this; } }; }
// 元素的定位：从元素往上到 body，每层写标签名，有 id 用 id，同类兄弟多于一个就加序号
function cssPath(el) {
  const parts = [];
  for (let e = el; e && e.nodeType === 1 && e.tagName !== 'HTML'; e = e.parentElement) {
    let t = e.tagName.toLowerCase(); if (e.id) { parts.unshift(t + '#' + e.id); break; }
    const sib = e.parentElement ? [...e.parentElement.children].filter(c => c.tagName === e.tagName) : [e]; if (sib.length > 1) t += `:nth-of-type(${sib.indexOf(e) + 1})`;
    parts.unshift(t);
  }
  return parts.join(' > ');
}
// 找某个编号的标记：面板正文里，或者 html 预览框架里
function findMark(n) { return document.querySelector(`sup.mark[data-n="${n}"]`) || (frameDoc() && frameDoc().querySelector(`sup.mark[data-n="${n}"]`)) || null; }

// 四、编辑与保存。CodeMirror 5 做编辑器，按扩展名选语法着色；没有对应着色的按普通文本。有改动时顶栏出现“保存”，Cmd-S 也能保存。
// md 有两种编辑态：Source 是普通源码；Live 也是在源码上编辑、保存写回的仍是原文一字不差，只是显示得接近渲染效果：
// 标题放大、粗体斜体直接显示、链接只显示文字，#、**、[]() 这类记号只在光标所在的那一行显示，图片挂在所在行的下方，表格行用等宽字体。
const modes = { gms: 'gams', inc: 'gams', md: 'markdown', markdown: 'markdown', py: 'python', tex: 'stex', bib: 'stex', r: 'r', jl: 'julia', sh: 'shell', zsh: 'shell', js: 'javascript', mjs: 'javascript', json: { name: 'javascript', json: true }, xml: 'xml', html: 'xml', svg: 'xml' };
let live = false, activeLine = null, imgWidgets = [], imgSig = '', imgTimer = null;   // live：当前编辑器是否 Live 态；activeLine：光标所在行的句柄
function showEditor(ext, wantLive = false) {
  const prev = cm ? { cur: cm.getCursor(), top: cm.getScrollInfo().top } : null;   // 两种编辑态之间切换时保住光标和滚动位置
  dropCmMarks(); live = wantLive && (ext === 'md' || ext === 'markdown'); setView(live ? 'code live' : 'code'); view.innerHTML = '';
  // Live 态要开 highlightFormatting，Markdown 模式才会给 #、**、[]() 这些记号单独打上 formatting 类，样式表才能按行隐藏它们
  cm = CodeMirror(view, { value: currentText, mode: live ? { name: 'markdown', highlightFormatting: true, strikethrough: true } : (modes[ext] || null), lineNumbers: !live, lineWrapping: true, extraKeys: { 'Cmd-S': save, 'Ctrl-S': save }, scrollbarStyle: document.body.classList.contains('split') ? 'null' : 'native' });   // scrollbarStyle 为 null：分屏时编辑器自己的滚动条不显示
  cm.on('change', () => { dirty = true; updateBar(); if (live) { clearTimeout(imgTimer); imgTimer = setTimeout(placeImages, 300); } });
  if (live) {
    activeLine = null; cm.on('cursorActivity', markActiveLine); markActiveLine();
    cm.on('renderLine', (c, line, el) => { if (/^\s*\|/.test(line.text)) el.classList.add('md-table'); });
    imgWidgets = []; imgSig = ''; placeImages(); cm.refresh();   // renderLine 挂在初次渲染之后，刷新一遍让已画出的表格行也带上等宽类
  }
  if (prev) { cm.setCursor(prev.cur); cm.scrollTo(null, prev.top); }
  updateBar(); placeMarks();
}
// 光标所在行的外层加 active 类，样式表只让这一行显示 Markdown 记号。记行句柄而不记行号，行号会随编辑漂移
function markActiveLine() { const h = cm.getLineHandle(cm.getCursor().line); if (h === activeLine) return; if (activeLine) cm.removeLineClass(activeLine, 'wrap', 'active'); cm.addLineClass(h, 'wrap', 'active'); activeLine = h; }
// 图片：每行找 ![..](路径)，相对路径按 md 所在目录换算，经 /api/file 取图，挂成该行下方的行部件；图片行集合没变就不重挂
function placeImages() {
  if (!cm || !live) return;
  const dir = current.slice(0, current.lastIndexOf('/') + 1), found = [];
  cm.eachLine((line) => { const m = line.text.match(/!\[[^\]]*\]\(\s*([^)\s]+)/); if (m) found.push({ line, src: m[1] }); });
  const sig = found.map(f => cm.getLineNumber(f.line) + ':' + f.src).join('|'); if (sig === imgSig) return; imgSig = sig;
  for (const w of imgWidgets) w.clear(); imgWidgets = [];
  for (const f of found) {
    const img = document.createElement('img'); img.className = 'md-img';
    img.src = /^(https?:|data:)/.test(f.src) ? f.src : '/api/file?path=' + encodeURIComponent(decodeURIComponent(new URL(f.src, 'file://' + dir).pathname));
    const w = cm.addLineWidget(f.line, img, { noHScroll: true }); img.onload = () => w.changed(); imgWidgets.push(w);   // 图片加载完才知道高度，通知编辑器重排
  }
}
async function save() {
  if (cm) currentText = cm.getValue();
  await api('/api/save', { path: current, content: currentText });
  dirty = false; updateBar(); toast('Saved');
}
$('saveBtn').onclick = save;
// 四之二、刷新。文件在面板外面被改过（代理改的，或者别的程序改的）之后，点顶栏的刷新钮，把当前栏正显示的文件按磁盘上的最新内容重新装一遍。
// 档位不变（阅读、Live、Source、预览各自保持），滚动位置回到刷新前的地方；有未保存的改动先问一声，因为重新装入会把它们丢掉
const imagesSettled = (imgs) => Promise.race([Promise.all(imgs.map(i => i.decode().catch(() => { }))), new Promise(r => setTimeout(r, 800))]);   // 等一批图片装完，最多等 0.8 秒：图片的高度装完才知道，滚动位置要在这之后再摆一次才准
async function refreshFile() {
  if (!current) return;
  if (dirty) { ask('This tab has unsaved changes.', 'Reload anyway', () => { dirty = false; refreshFile(); }); return; }
  const tab = pane().active, path = current, ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase(), isHtml = /\.html?$/i.test(path), s = scrollNow(), top = s ? s.top : 0;
  if (!cm && !view.classList.contains('md') && !view.classList.contains('html')) { const v = view; await loadTab(); v.scrollTop = top; toast('Reloaded', { ms: 1200 }); return; }   // PDF、图片：整个重装，页面尺寸不变，滚回原来的像素位置
  const r = await fetch('/api/file?path=' + encodeURIComponent(path));
  if (!r.ok) { toast('Could not reload: ' + (await r.json()).error, { ms: 5000, kind: 'error' }); return; }   // 文件读不到（被移走或删掉了）：面板里现有的内容原样留着
  const text = await r.text(); if (pane().active !== tab) activate(tab); currentText = text;
  if (cm) { showEditor(isHtml ? 'html' : ext, live); if (live) { const c = cm; await imagesSettled(imgWidgets.map(w => w.node)); c.scrollTo(null, top); } }   // 编辑器：showEditor 自己保住光标和滚动位置；Live 态图片装完后再摆一次
  else if (isHtml) { showHtml(); const f = view.querySelector('iframe.htmlFrame'); f.addEventListener('load', () => { f.contentDocument.scrollingElement.scrollTop = top; }); }   // 预览：新页面装完再滚回去
  else { showMarkdown(); const v = view; v.scrollTop = top; await imagesSettled([...v.querySelectorAll('img')]); v.scrollTop = top; }   // 阅读态：先摆一次，图片装完再摆一次
  toast('Reloaded', { ms: 1200 });
}
$('reloadBtn').onclick = refreshFile;
// 顶栏三档：Read 渲染阅读；Live、Source 两种编辑态。md 记住最后选的那一档，下次打开 md 沿用；html 只有 Preview｜Source
for (const b of $('modeSeg').querySelectorAll('button')) b.onclick = () => {
  const isHtml = /\.html?$/i.test(current || ''), m = b.dataset.mode;
  if (m === 'read') { if (cm) { currentText = cm.getValue(); if (isHtml) { showHtml(); if (dirty) toast('The preview shows the saved version; current edits are not saved yet.', { ms: 4000 }); } else showMarkdown(); } }
  else { const wantLive = m === 'live'; if (!cm || live !== wantLive) { if (cm) currentText = cm.getValue(); showEditor(isHtml ? 'html' : 'md', wantLive); } }
  if (!isHtml) try { localStorage.setItem('dp-mdmode', m); } catch { }
};
function updateBar() {
  const isMd = current && /\.(md|markdown)$/i.test(current), isHtml = current && /\.html?$/i.test(current);
  $('modeSeg').style.display = (isMd || isHtml) ? '' : 'none';
  $('modeSeg').querySelector('[data-mode=read]').textContent = isHtml ? 'Preview' : 'Read'; $('modeSeg').querySelector('[data-mode=live]').style.display = isHtml ? 'none' : '';
  const mode = !cm ? 'read' : (live ? 'live' : 'source');
  for (const b of $('modeSeg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === mode);
  $('saveBtn').style.display = dirty ? '' : 'none'; $('reloadBtn').style.display = current ? '' : 'none';
  $('badge').textContent = notes.length; $('badge').classList.toggle('zero', notes.length === 0); $('notesBtn').classList.toggle('has', notes.length > 0);
  if ($('menu').classList.contains('show')) renderMenu();
  renderStrip(); $('splitBtn').classList.toggle('on', document.body.classList.contains('split'));
}
// 选项卡条：一条总清单。当前栏正显示的高亮；分屏时另一栏正显示的带一道浅底线；未保存的名字后带点；没有选项卡时写一句提示
function renderStrip() {
  const split = document.body.classList.contains('split'), cur = pane().active, other = split ? panes[1 - paneIdx].active : null;
  $('tabs').innerHTML = tabs.map((t, i) => `<div class="tab${t === cur ? ' on' : ''}${t === other ? ' shown' : ''}${(t === cur ? dirty : t.dirty) ? ' dirty' : ''}" data-i="${i}" draggable="true" title="${esc(t.path)}${split ? (t.pane ? ' — right pane' : ' — left pane') : ''}"><span class="nm">${esc(t.path.slice(t.path.lastIndexOf('/') + 1))}</span><button class="x" title="Close">×</button></div>`).join('') || '<span class="empty">Select a file</span>';
}
$('tabs').addEventListener('click', (e) => { const tb = e.target.closest('.tab'); if (!tb) return; const t = tabs[+tb.dataset.i]; if (e.target.closest('.x')) closeTab(t); else activate(t); });
// 切到某个选项卡：它在哪一栏就把哪一栏当成当前栏，在那一栏里显示它。先把当前状态存回原来正显示的选项卡（saved 为真表示已经存过），再取它的状态出来；
// 显示区只是隐藏和显示，所以滚动、编辑器里的光标和改动、PDF 已画的页、标记都原地不动
function saveActive() { const t = pane().active; if (!t) return; Object.assign(t, { text: currentText, cm, dirty, live, activeLine, imgWidgets, imgSig, scroll: cm ? cm.getScrollInfo().top : view.scrollTop }); }
function activate(tab, saved) {
  if (!saved) saveActive();
  if (tab.pane !== paneIdx) { paneIdx = tab.pane; for (const p of panes) p.el.classList.toggle('focus', p === pane()); }
  const p = pane(), wasHidden = p.active !== tab;
  p.active = tab; for (const t of tabs) if (t.pane === paneIdx) t.el.classList.toggle('on', t === tab); p.placeholder.classList.remove('on');
  loadState(tab, wasHidden);
}
// 把选项卡的状态取出来当作当前状态。restore 为真时（这块显示区刚从隐藏变为显示）恢复滚动位置并让编辑器重排
function loadState(tab, restore) {
  view = tab.el; current = tab.path; currentText = tab.text; cm = tab.cm; dirty = tab.dirty; live = tab.live; activeLine = tab.activeLine; imgWidgets = tab.imgWidgets; imgSig = tab.imgSig;
  for (const n of tree.querySelectorAll('.node.file')) n.classList.toggle('on', n.dataset.path === current);
  closeNoteBox(); popBtn.style.display = 'none';
  if (restore) { if (cm) { cm.refresh(); cm.scrollTo(null, tab.scroll); } else view.scrollTop = tab.scroll; }
  updateBar(); placeMarks();
}
function clearState() { view = pane().placeholder; view.classList.add('on'); current = null; currentText = ''; cm = null; dirty = false; live = false; for (const n of tree.querySelectorAll('.node.file')) n.classList.remove('on'); closeNoteBox(); updateBar(); }
// 在不是当前栏的那一栏里显示某个选项卡（它的状态都在它自己身上，不经过全局量）
function showIn(p, t) { p.active = t; for (const o of tabs) if (panes[o.pane] === p) o.el.classList.toggle('on', o === t); p.placeholder.classList.remove('on'); if (t.cm) { t.cm.refresh(); t.cm.scrollTo(null, t.scroll); } else t.el.scrollTop = t.scroll; }
// 同一栏里离某个位置最近的另一个选项卡：先往前找，再往后找
function neighbor(p, i) { const same = tabs.filter(t => panes[t.pane] === p); return same.filter(t => tabs.indexOf(t) < i).pop() || same[0] || null; }
// 关闭选项卡：有未保存改动先问一声。关的是某一栏正显示的，就换成那一栏里离它最近的；那一栏空了，是右栏就自动取消分屏
function closeTab(tab) {
  const p = panes[tab.pane], isShown = p.active === tab, isCur = isShown && tab.pane === paneIdx;
  if (isCur ? dirty : tab.dirty) { ask('This tab has unsaved changes.', 'Close anyway', () => { if (isCur) dirty = false; else tab.dirty = false; closeTab(tab); }); return; }
  for (const x of notes) if (x.path === tab.path) delete cmMarks[x.n];
  const i = tabs.indexOf(tab); tab.el.remove(); tabs.splice(i, 1);
  if (!isShown) { updateBar(); return; }
  p.active = null; const next = neighbor(p, i);
  if (next) { if (isCur) activate(next, true); else showIn(p, next); }
  else if (p === panes[1]) unsplit();
  else if (isCur) clearState(); else p.placeholder.classList.add('on');
  updateBar();
}
// 三之三、分屏。换当前栏：先把当前状态存回原栏正显示的选项卡，再取目标栏正显示的（没有就是占位状态）；在哪一栏里按下鼠标，哪一栏就成为当前栏
function focusPane(i) {
  if (i === paneIdx) return;
  saveActive(); paneIdx = i; for (const p of panes) p.el.classList.toggle('focus', p === pane());
  if (pane().active) loadState(pane().active, false); else clearState();
}
for (const p of panes) p.el.addEventListener('mousedown', () => focusPane(panes.indexOf(p)), true);
// 分屏开关：开时右栏出现并成为当前栏，接下来点的文件进右栏；关时右栏的选项卡都回左栏显示
function toggleSplit() { if (document.body.classList.contains('split')) unsplit(); else { document.body.classList.add('split'); focusPane(1); updateBar(); } }
function unsplit() {
  const focusedTab = pane().active; saveActive();
  for (const t of tabs) if (t.pane === 1) { t.pane = 0; panes[0].views.appendChild(t.el); t.el.classList.remove('on'); }
  const bShown = panes[1].active; panes[1].active = null; panes[1].placeholder.classList.add('on'); document.body.classList.remove('split');
  panes[0].el.style.flex = '';   // 拖分隔条时写在左栏上的固定宽度一并清掉，左栏才会重新占满显示区
  paneIdx = 0; for (const p of panes) p.el.classList.toggle('focus', p === panes[0]);
  const show = focusedTab || bShown || panes[0].active; panes[0].active = null;   // 置空后 activate 不会把状态存错地方
  if (show) activate(show, true); else clearState();
}
$('splitBtn').onclick = toggleSplit;
// 拖动两栏中间的分隔条改左栏宽度。宽度写成左栏的行内样式，只该在分屏期间有效，所以退出分屏的两处（unsplit 和 moveTab）都要把它清掉
$('paneDivider').addEventListener('mousedown', (e) => {
  const startX = e.clientX, startW = panes[0].el.offsetWidth; e.preventDefault();
  const move = (ev) => { panes[0].el.style.flex = '0 0 ' + Math.max(200, Math.min(startW + ev.clientX - startX, $('panes').offsetWidth - 200)) + 'px'; };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); if (cm) cm.refresh(); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
});
// 分屏时的滚动条。两栏自己的竖向滚动条都不显示，显示区最右侧只留一条（paneScroll）：滑块画的是当前栏（最后一次按下鼠标的那一栏）正显示内容的滚动位置，拖它滚的也是当前栏。
// 当前栏的内容有三种滚法：阅读视图、PDF、图片滚的是显示区自己；编辑器由 CodeMirror 管；HTML 预览滚的是内嵌框架里的页面。scrollNow 把三种统一成“位置、总高、可见高、设位置”
const paneScroll = $('paneScroll'), paneThumb = paneScroll.firstChild;
function scrollNow() {
  if (cm) { const i = cm.getScrollInfo(); return { top: i.top, height: i.height, client: i.clientHeight, set: (y) => cm.scrollTo(null, y) }; }
  const el = view.classList.contains('html') ? frameDoc().scrollingElement : view; if (!el) return null;   // 预览页面还没载入到有可滚动的根元素
  return { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight, set: (y) => { el.scrollTop = y; } };
}
// 每一帧按当前栏的滚动位置摆一次滑块，所以换当前栏、换选项卡、滚轮滚动、内容变长变短都不用另外通知；内容不够滚（或当前栏是空的）就不画滑块
function drawPaneScroll() {
  requestAnimationFrame(drawPaneScroll); if (!document.body.classList.contains('split')) return;
  const s = scrollNow(), track = paneScroll.clientHeight; if (!s || s.height <= s.client + 1) { paneThumb.style.display = 'none'; return; }
  const h = Math.max(24, track * s.client / s.height);
  paneThumb.style.display = ''; paneThumb.style.height = h + 'px'; paneThumb.style.top = (track - h) * s.top / (s.height - s.client) + 'px';
}
drawPaneScroll();
// 按住滑块拖；或者按在轨道上，滑块中心先跳到按下的位置再跟着拖。用指针捕获，拖动中鼠标移到 HTML 预览上方也不会丢事件
paneScroll.addEventListener('pointerdown', (e) => {
  const s = scrollNow(); if (!s || s.height <= s.client + 1) return; e.preventDefault(); paneScroll.setPointerCapture(e.pointerId); paneScroll.classList.add('on');
  const r = paneScroll.getBoundingClientRect(), h = paneThumb.offsetHeight, grab = e.target === paneThumb ? e.clientY - paneThumb.getBoundingClientRect().top : h / 2;
  const move = (ev) => scrollNow().set((ev.clientY - r.top - grab) / (r.height - h) * (s.height - s.client));
  move(e); paneScroll.onpointermove = move; paneScroll.onpointerup = paneScroll.onpointercancel = () => { paneScroll.onpointermove = null; paneScroll.classList.remove('on'); };
});
// 分屏一开一关（body 上的 split 类，有好几处代码会改它），编辑器和 HTML 预览自己的竖向滚动条跟着关掉或恢复。统一在这里盯着这个类，不必每处各写一遍
let wasSplit = false;
new MutationObserver(() => {
  const split = document.body.classList.contains('split'); if (split === wasSplit) return; wasSplit = split;
  for (const el of document.querySelectorAll('.CodeMirror')) el.CodeMirror.setOption('scrollbarStyle', split ? 'null' : 'native');
  for (const f of document.querySelectorAll('iframe.htmlFrame')) f.contentDocument.documentElement?.classList.toggle('dp-split', split);
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
// 把选项卡搬到某一栏显示（at 给了就同时在总清单里换到那个位置），然后切到那一栏并显示它。源栏正显示的若是它，就换成源栏里最近的；右栏空了就自动取消分屏
function moveTab(tab, to, at) {
  saveActive();
  const from = panes[tab.pane];
  if (at !== undefined) { const i = tabs.indexOf(tab); tabs.splice(i, 1); if (i < at) at -= 1; tabs.splice(at, 0, tab); }
  if (from !== to) {
    tab.pane = panes.indexOf(to); to.views.appendChild(tab.el); tab.el.classList.remove('on');
    if (from.active === tab) { from.active = null; const n = neighbor(from, tabs.length); if (n) showIn(from, n); else from.placeholder.classList.add('on'); }
    if (from === panes[1] && !tabs.some(t => t.pane === 1)) { document.body.classList.remove('split'); panes[0].el.style.flex = ''; }   // 右栏空了：取消分屏，左栏的固定宽度一并清掉
  }
  activate(tab, true);
}
// 拖拽选项卡：拖到清单里别的位置就换顺序（留在原来那一栏）；拖到显示区的左半或右半就去那一栏显示，没分屏时拖到右半自动分屏
let dragTab = null, dragFile = null; const panesEl = $('panes'), dropHint = $('dropHint'), strip = $('tabs');   // dragFile：从目录树拖出来的文件路径
const hideDrop = () => { dropHint.style.display = 'none'; };
// 落在哪一栏只按鼠标当时的位置算：分屏时看鼠标是否到了右栏的左边界，没分屏时看在显示区的左半还是右半
const dropSide = (e) => { const r = panesEl.getBoundingClientRect(); return document.body.classList.contains('split') ? (e.clientX >= panes[1].el.getBoundingClientRect().left ? 1 : 0) : (e.clientX > r.left + r.width / 2 ? 1 : 0); };
strip.addEventListener('dragstart', (e) => { const tb = e.target.closest('.tab'); if (!tb) return; dragTab = tabs[+tb.dataset.i]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragTab.path); tb.classList.add('dragging'); });
strip.addEventListener('dragover', (e) => { if (!dragTab) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
strip.addEventListener('drop', (e) => { if (!dragTab) return; e.preventDefault(); const tb = e.target.closest('.tab'); let at = tabs.length; if (tb) { const r = tb.getBoundingClientRect(); at = +tb.dataset.i + (e.clientX > r.left + r.width / 2 ? 1 : 0); } moveTab(dragTab, panes[dragTab.pane], at); dragTab = null; });
strip.addEventListener('dragend', () => { dragTab = null; hideDrop(); updateBar(); });
// 显示区的 dragover 和 drop 在捕获阶段处理（addEventListener 末尾的 true），处理完不再往下传。原因是编辑器（CodeMirror）自己也监听这两个事件：
// 它会截住 dragover，鼠标在编辑器上方时落点提示出不来；它还会把拖来的路径当成文字插进正文。赶在它之前处理，这两件事都不再发生。
// 不是选项卡或目录树文件的拖拽（比如在编辑器里拖动选中的文字）这里不处理，照常交给编辑器
panesEl.addEventListener('dragover', (e) => {
  if (!dragTab && !dragFile) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = dragTab ? 'move' : 'copy';
  const r = panesEl.getBoundingClientRect(), split = document.body.classList.contains('split'), side = dropSide(e);
  const box = split ? panes[side].el.getBoundingClientRect() : { left: side ? r.left + r.width / 2 : r.left, width: r.width / 2 };
  dropHint.style.display = 'block'; dropHint.style.left = (box.left - r.left) + 'px'; dropHint.style.width = box.width + 'px';
}, true);
panesEl.addEventListener('dragleave', (e) => { if (!panesEl.contains(e.relatedTarget)) hideDrop(); });
panesEl.addEventListener('drop', (e) => {
  if (!dragTab && !dragFile) return; e.preventDefault(); e.stopPropagation(); const side = dropSide(e); hideDrop(); if (side === 1) document.body.classList.add('split');   // 落在哪一栏按松手时的鼠标位置现算，不依赖之前有没有收到过 dragover
  if (dragTab) moveTab(dragTab, panes[side]); else { focusPane(side); const path = dragFile; const t = tabs.find(x => x.path === path); if (t) moveTab(t, panes[side]); else openFile(path); }   // 从目录树拖来的文件：已开着就搬到那一栏，否则在那一栏打开
  dragTab = null; dragFile = null;
}, true);
document.addEventListener('dragend', () => { dragFile = null; hideDrop(); });

// 五、选字评论。在显示区或对话记录卡里选中文字、松开鼠标，选区末尾下方出现“评论”小胶囊；点它弹出评论框；
// 确认后在选区处打一个编号标记，评论记进清单和数据文件，并把「[引用n] 评论开头」填进左边的对话输入框（不发送）。
const popBtn = $('popBtn'), pop = $('pop'), popText = pop.querySelector('textarea');
$('panes').addEventListener('mouseup', () => setTimeout(showPopBtn, 0)); $('chatLog').addEventListener('mouseup', () => setTimeout(showPopBtn, 0));
function showPopBtn() {
  if (pop.style.display === 'block') return;
  let text = '', x = 0, y = 0;
  const cs = getSelection(), inChat = !!cs && !cs.isCollapsed && $('chatLog').contains(cs.anchorNode);   // 对话记录卡里的选区：来源是本轮对话的某一条
  if (inChat) { const range = cs.getRangeAt(0); text = range.toString(); const r = range.getBoundingClientRect(); x = r.right; y = r.bottom; const el = (range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer).closest('.msg'); pending = { text, range: range.cloneRange(), doc: document, chat: true, msgEl: el }; }
  else if (cm) { text = cm.getSelection(); if (text) { const c = cm.cursorCoords(cm.getCursor('to'), 'window'); x = c.left; y = c.bottom; pending = { text, cmPos: cm.getCursor('to'), line: cm.getCursor('from').line + 1 }; } }
  else {
    const fd = view.classList.contains('html') ? frameDoc() : null, doc = fd || document, sel = doc.getSelection();
    if (sel && !sel.isCollapsed && (fd || view.contains(sel.anchorNode))) {
      const range = sel.getRangeAt(0); text = range.toString(); /* 用 Range 取文字：框架没有焦点时 Selection.toString() 会是空的 */ const r = range.getBoundingClientRect(); const off = fd ? view.querySelector('iframe.htmlFrame').getBoundingClientRect() : { left: 0, top: 0 };
      x = off.left + r.right; y = off.top + r.bottom; pending = { text, range: range.cloneRange(), doc };
      if (fd) { const el = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer; pending.locator = cssPath(el); const c = el.cloneNode(true); for (const m of c.querySelectorAll('sup.mark')) m.remove(); pending.snippet = c.outerHTML.replace(/\s+/g, ' ').slice(0, 240); }   // 片段里去掉已打的编号标记
    }
  }
  if (!text.trim()) { popBtn.style.display = 'none'; return; }
  popBtn.style.display = 'inline-flex'; popBtn.style.left = Math.max(0, Math.min(x - 24, innerWidth - 80)) + 'px'; popBtn.style.top = Math.min(y + 6, innerHeight - 32) + 'px';
}
popBtn.onclick = () => {
  popBtn.style.display = 'none'; pop.style.display = 'block';
  pop.style.left = Math.max(8, Math.min(parseFloat(popBtn.style.left), innerWidth - 324)) + 'px'; pop.style.top = Math.min(parseFloat(popBtn.style.top), innerHeight - 190) + 'px';
  pop.querySelector('.quote').textContent = pending.text; popText.value = ''; popText.focus();
};
$('popCancel').onclick = () => { pop.style.display = 'none'; pending = null; };
popText.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('popOk').click(); if (e.key === 'Escape') $('popCancel').click(); });
function makeMark(n, doc = document) { const s = doc.createElement('sup'); s.className = 'mark'; s.dataset.n = n; s.textContent = n; s.title = 'Click to view this note'; return s; }
$('popOk').onclick = async () => {
  if (!pending) return;   // 弹窗已经关了（比如连点两下），不再处理
  const n = notes.length + 1;
  if (pending.cmPos) cmMarks[n] = cm.setBookmark(pending.cmPos, { widget: makeMark(n) });
  else { const r = pending.range, doc = pending.doc || document; r.collapse(view.classList.contains('pdf')); r.insertNode(makeMark(n, doc)); doc.getSelection().removeAllRanges(); }   // md 放在选区末尾；PDF 文字层的选区末尾不可靠，放在选区开头
  // 定位：编辑器里直接有行号；阅读态的 md 拿引文开头几个字到源文件里找行号；PDF 找选区所在的页
  const note = pending.chat
    ? { n, chat: true, msg: [...$('chatLog').querySelectorAll('.msg')].indexOf(pending.msgEl) + 1, role: pending.msgEl && pending.msgEl.classList.contains('user') ? 'user' : 'agent', file: 'Conversation', path: '', quote: pending.text.trim(), comment: popText.value.trim(), line: null, page: null, locator: null, snippet: null }
    : { n, file: relOf(current), path: current, quote: pending.text.trim(), comment: popText.value.trim(), line: pending.line || null, page: null, locator: pending.locator || null, snippet: pending.snippet || null };
  if (!pending.chat && !cm && (view.classList.contains('md') || view.classList.contains('html'))) { const head = note.quote.replace(/\s+/g, ' ').slice(0, 12); const idx = currentText.split('\n').findIndex(l => l.replace(/\s+/g, ' ').includes(head)); note.line = idx >= 0 ? idx + 1 : null; }
  if (!pending.chat && !cm && view.classList.contains('pdf')) { const node = pending.range.startContainer; const pg = (node.nodeType === 3 ? node.parentElement : node).closest('.page'); note.page = pg ? [...view.querySelectorAll('.page')].indexOf(pg) + 1 : null; }
  note.label = shortLabel(note); note.at = Date.now();   // at：这条评论的建立时间。后端拿这一轮第一条的时间，去找这之后发出的用户消息
  notes.push(note); pop.style.display = 'none'; pending = null; updateBar();
  await api('/api/notes', { notes });   // 完整记录写进数据文件，代理按编号去读
  try { await api('/api/insert', { segments: [{ text: `[Ref ${n}] ${note.label}` }] }); }
  catch (e) { toast('Could not insert into the chat box: ' + e.message, { ms: 6000, kind: 'error' }); }
};
// 对话框里跟在编号后面的几个字：评论开头 12 个字，没写评论就用引文开头；英文在词中间就退到前一个空格处截断
function shortLabel(x) {
  const t = (x.comment || x.quote).replace(/\s+/g, ' ');
  if (t.length <= 14) return t;
  let head = t.slice(0, 12); if (/[A-Za-z]/.test(t[12]) && head.includes(' ')) head = head.slice(0, head.lastIndexOf(' '));
  return head + '…';
}
const where = (x) => x.chat ? `msg ${x.msg}` : (x.page ? `p. ${x.page}` : (x.line ? `line ${x.line}` : ''));

// 六、编号标记就是入口。点正文里的编号弹出详情卡：能改评论再保存，也能直接删除；删除后后面的编号前移一位，
// 对话框里已写入的引用行跟着删或改号；重新打开文件时按引文把标记补回去。顶栏评论钮下只有一个小清单，用来跳到别的文件里的标记。
const noteBox = $('noteBox'); let delArmed = null, clearArmed = null;
function openNoteBox(n, anchor) {
  const x = notes.find(v => v.n === n); if (!x) return; delArmed = null;
  noteBox.innerHTML = `<div class="where"><span class="n">${n}</span><span class="f" title="${esc(x.path)}">${esc(x.file)} ${where(x)}</span><button class="icon small" id="nbClose" title="Close">${ICON.close}</button></div>${x.locator ? `<div class="loc">Element: ${esc(x.locator)}</div>` : ''}<div class="q">${esc(x.quote)}</div><textarea placeholder="Comment, Cmd+Enter to save">${esc(x.comment)}</textarea><div class="btns"><button class="icon small danger" id="nbDel" title="Delete this note">${ICON.trash}</button><span class="sp"></span><button class="pill primary" id="nbSave">Save</button></div>`;
  noteBox.classList.add('show');
  const r = anchor.getBoundingClientRect(); const h = noteBox.offsetHeight;
  noteBox.style.left = Math.max(8, Math.min(r.left - 8, innerWidth - 316)) + 'px';
  noteBox.style.top = (r.bottom + 8 + h <= innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8)) + 'px';
  const ta = noteBox.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  $('nbClose').onclick = closeNoteBox;
  $('nbSave').onclick = async () => { await saveNote(n, ta.value.trim()); closeNoteBox(); };
  $('nbDel').onclick = () => { if (delArmed !== n) { delArmed = n; $('nbDel').className = 'pill danger armed'; $('nbDel').innerHTML = ICON.trash + 'Delete'; return; } deleteNote(n); };   // 第一次点进入确认态并保持；重开详情卡时恢复
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('nbSave').click(); if (e.key === 'Escape') closeNoteBox(); });
}
function closeNoteBox() { noteBox.classList.remove('show'); noteBox.innerHTML = ''; delArmed = null; }
$('panes').addEventListener('click', (e) => { const m = e.target.closest('sup.mark'); if (m) openNoteBox(+m.dataset.n, m); });
// 阅读态里 Markdown 的链接：相对路径指向的本地文件在面板里打开；页内锚点滚到对应标题；网址不让整个面板页面跳走（面板页面一旦导航走就只剩 Not found）
$('panes').addEventListener('click', (e) => {
  const a = e.target.closest('a[href]'); if (!a || !view.contains(a) || !view.classList.contains('md')) return;
  e.preventDefault(); const href = a.getAttribute('href');
  if (href.startsWith('#')) { const id = decodeURIComponent(href.slice(1)); const h = [...view.querySelectorAll('h1,h2,h3,h4,h5,h6,[id]')].find(x => x.id === id || x.textContent.trim() === id); if (h) h.scrollIntoView({ block: 'start' }); return; }
  if (/^(https?:|mailto:)/.test(href)) { navigator.clipboard.writeText(href).then(() => toast('Link copied: ' + href, { ms: 3000 }), () => toast(href, { ms: 3000 })); return; }
  const dir = current.slice(0, current.lastIndexOf('/') + 1); openFile(decodeURIComponent(new URL(href.split('#')[0], 'file://' + dir).pathname));
});
$('chatLog').addEventListener('click', (e) => { const m = e.target.closest('sup.mark'); if (m) openNoteBox(+m.dataset.n, m); });

// 改评论：记录文件重写；对话框里那一行的标签跟着换
async function saveNote(n, comment) {
  const x = notes.find(v => v.n === n); const old = x.label;
  x.comment = comment; x.label = shortLabel(x);
  await api('/api/notes', { notes });
  if (old !== x.label) await api('/api/composer', { ops: [{ find: `[Ref ${n}] ${old}`, replace: `[Ref ${n}] ${x.label}` }] }).catch(e => toast('Could not update the line in the chat box: ' + e.message, { ms: 5000, kind: 'error' }));
  toast('Saved');
}
// 删一条：去掉标记和记录，后面的编号前移一位（标记、书签、记录、对话框里的引用行一起改）
async function deleteNote(n) {
  const x = notes.find(v => v.n === n); if (!x) return;
  const ops = [{ find: `[Ref ${n}] ${x.label}`, remove: true }];
  removeMark(n); notes.splice(notes.indexOf(x), 1);
  for (const y of notes) if (y.n > n) { ops.push({ find: `[Ref ${y.n}] ${y.label}`, replace: `[Ref ${y.n - 1}] ${y.label}` }); renumberMark(y.n, y.n - 1); y.n -= 1; }
  closeNoteBox(); updateBar();
  await api('/api/notes', { notes });
  await api('/api/composer', { ops }).catch(e => toast('Could not update reference lines in the chat box: ' + e.message, { ms: 5000, kind: 'error' }));
}
function dropCmMarks() { for (const x of notes) if (x.path === current) delete cmMarks[x.n]; }   // 当前选项卡的编辑器实例换了，它那些书签对象作废；别的选项卡的不动
function removeMark(n) { if (cmMarks[n]) { cmMarks[n].clear(); delete cmMarks[n]; } const m = findMark(n); if (m) m.remove(); }
function renumberMark(from, to) { const m = findMark(from); if (m) { m.dataset.n = to; m.textContent = to; } if (cmMarks[from]) { cmMarks[to] = cmMarks[from]; delete cmMarks[from]; } }
// 把所有编号标记去掉：编辑器里的书签，以及页面里和各个 HTML 预览框架里的标记
function clearMarks() {
  for (const n in cmMarks) { cmMarks[n].clear(); delete cmMarks[n]; }
  for (const d of [document, ...[...document.querySelectorAll('iframe.htmlFrame')].map(f => f.contentDocument)]) for (const m of d.querySelectorAll('sup.mark')) m.remove();
}

// 六之二、发出去之后按轮归档。带引用的消息一发出，这一轮评论就算用完：编号标记和清单清空，下一条评论从 1 重新编号；
// 这一轮的完整记录由后端移进“已发送”的各轮里，代理仍然按编号查得到。
// “发出去了”由后端看对话的记录文件来判断：这一轮有评论、本面板正显示着时，每 0.3 秒问一次（后端查一次只要一两毫秒），这一轮第一条评论建立之后有没有哪条用户消息带着这一轮的 [Ref n]
setInterval(async () => {
  if (!notes.length || !shown()) return;
  let d; try { d = await api('/api/sent', { conv, since: notes[0].at, numbers: notes.map(x => x.n) }); } catch { return; }   // 后端这次没查成（比如记录文件正写到一半），下次再问
  if (!d.sent || !notes.length) return;
  const sent = notes.splice(0); clearMarks(); closeNoteBox(); kept += sent.length; updateBar();
  await api('/api/notes/archive', { conv: d.conv, notes: sent });
}, 300);

// 标记恢复：当前文件里每条还没有标记的评论，按引文在显示区里找位置补上。阅读态 md 找引文结尾，编辑器找原文里的位置，PDF 找引文开头所在的文字块。
function placeMarks() {
  for (const x of notes) {
    if (x.chat) {   // 对话来源：记录卡展开着才补，优先在原来那一条消息里找引文结尾
      if (findMark(x.n) || !chat.classList.contains('open')) continue;
      const tail = x.quote.replace(/\s+/g, ' ').trim().slice(-16), msgs = chatLog.querySelectorAll('.msg'), roots = [msgs[x.msg - 1], chatLog].filter(Boolean);
      for (const rootEl of roots) { const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT); let node, done = false; while (!done && (node = w.nextNode())) { const i = node.data.indexOf(tail); if (i < 0) continue; const r = document.createRange(); r.setStart(node, i + tail.length); r.collapse(true); r.insertNode(makeMark(x.n)); done = true; } if (done) break; }
      continue;
    }
    if (x.path !== current || cmMarks[x.n] || findMark(x.n)) continue;
    const q = x.quote.replace(/\s+/g, ' ').trim(); const head = q.slice(0, view.classList.contains('pdf') ? 10 : 16), tail = q.slice(-16);
    if (cm) { const text = cm.getValue(); let i = text.indexOf(q), at = i >= 0 ? i + q.length : -1; if (at < 0) { i = text.indexOf(head); at = i >= 0 ? i + head.length : -1; } if (at >= 0) cmMarks[x.n] = cm.setBookmark(cm.posFromIndex(at), { widget: makeMark(x.n) }); continue; }
    const want = view.classList.contains('pdf') ? head : tail, atEnd = !view.classList.contains('pdf');
    const rootEl = view.classList.contains('html') ? (frameDoc() && frameDoc().body) : view; if (!rootEl) continue; const doc = rootEl.ownerDocument;
    const w = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT); let node;
    while ((node = w.nextNode())) { const i = node.data.indexOf(want); if (i < 0) continue; const r = doc.createRange(); r.setStart(node, atEnd ? i + want.length : i); r.collapse(true); r.insertNode(makeMark(x.n, doc)); break; }
  }
}

// 评论钮下的小清单：点一行跳到那条标记（在别的文件里就先打开那个文件），底部是复制全部详情和清空全部
function renderMenu() {
  const m = $('menu');
  const rows = notes.map(x => `<div class="row" data-n="${x.n}"><span class="n">${x.n}</span><span class="f" title="${esc(x.path)}">${esc(x.file.slice(x.file.lastIndexOf('/') + 1))}</span><span class="w">${where(x)}</span></div>`).join('');
  // 清单只列当前这一轮。已经发出去的各轮不再列出，只在底部写一行还存着多少条；Clear all 把当前这一轮和已发出去的各轮一起清掉，所以只要还存着就显示
  m.innerHTML = (rows || `<div class="empty">${kept ? 'No notes in this round.' : 'No notes yet. Select text in the document and click Comment.'}</div>`)
    + (kept ? `<div class="kept">${kept} sent ${kept === 1 ? 'note is' : 'notes are'} kept for the agent.</div>` : '')
    + (notes.length || kept ? `<div class="foot">${notes.length ? '<button id="copyAll">Copy all notes</button>' : ''}<button id="clearAll" class="danger">${clearArmed ? 'Confirm clear' : 'Clear all'}</button></div>` : '');
  for (const row of m.querySelectorAll('.row')) row.onclick = () => { m.classList.remove('show'); jumpTo(+row.dataset.n); };
  if ($('copyAll')) $('copyAll').onclick = () => { navigator.clipboard.writeText(notes.map(x => `[Ref ${x.n}] ${x.file} ${where(x)}\nQuote: ${x.quote}\nComment: ${x.comment || '(none)'}`).join('\n\n')); };
  if ($('clearAll')) $('clearAll').onclick = async () => {
    if (!clearArmed) { clearArmed = true; renderMenu(); setTimeout(() => { clearArmed = false; if ($('menu').classList.contains('show')) renderMenu(); }, 3000); return; }
    clearArmed = false; const ops = [...notes].reverse().map(x => ({ find: `[Ref ${x.n}] ${x.label}`, remove: true }));
    clearMarks(); notes.length = 0; kept = 0; closeNoteBox(); updateBar(); renderMenu();
    await api('/api/notes/clear', {}); if (ops.length) await api('/api/composer', { ops }).catch(() => {});
  };
}
async function jumpTo(n) {
  const x = notes.find(v => v.n === n); if (!x) return;
  if (x.chat) { if (!document.body.classList.contains('native')) { openNoteBox(n, $('notesBtn')); return; } stage = 2; chatBtn.className = 'icon on log'; toggleLog(true); }   // 记录卡只在输入框浮起时有；展开它并把三态计到第二档，心跳才不会把它收起
  else if (x.path !== current) { await openFile(x.path); if (view.classList.contains('pdf') && x.page) { const pg = view.querySelectorAll('.page')[x.page - 1]; if (pg) pg.scrollIntoView(); } }
  for (let t = 0; t < 20; t++) { const m = findMark(n); if (m) { m.scrollIntoView({ block: 'center' }); openNoteBox(n, m.ownerDocument === document ? m : frameRect(m)); return; } await new Promise(r => setTimeout(r, 150)); }
  openNoteBox(n, $('notesBtn'));   // 正文里找不到标记（引文没对上），就挂在评论钮下面
}
$('notesBtn').onclick = () => { const m = $('menu'); const open = m.classList.toggle('show'); if (!open) return; renderMenu(); const r = $('notesBtn').getBoundingClientRect(); m.style.top = (r.bottom + 6) + 'px'; m.style.left = Math.max(8, r.right - 250) + 'px'; };
document.addEventListener('mousedown', (e) => { const m = $('menu'); if (m.classList.contains('show') && !m.contains(e.target) && !$('notesBtn').contains(e.target)) m.classList.remove('show'); });

// 七、原装输入框浮起与对话记录。面板自己不画输入框。顶栏的对话图标只在窗格最大化后出现，点击按三态推进：
// 起点 0 什么都不显示；1 主窗口里真正的输入框浮到面板底部；2 再在它上方展开对话记录卡；再点回到 0。
// 面板够宽时每三秒请后端查一次：0 态只查不动（probe），得知窗格最大化就亮出图标；1、2 态发“浮起并维持”（on）的心跳。
// 回报窗格没最大化、找不到输入框、后端出错，就回到 0 态并藏起图标。面板收窄、被关掉时发一次 off 让输入框归位；
// 后端断掉时心跳自然停止，主窗口那边八秒后自动还原。
const chat = $('chat'), chatLog = $('chatLog'), chatBtn = $('chatBtn');
let stage = 0, floatTimer = null, logTimer = null;
// 宿主为每个对话各保留一个面板实例，同一时刻只有一个显示，其余的被设成不占位但仍在运行。隐藏实例不能发任何指令，
// 否则会和可见实例打架（曾经出现每三秒一个来回的闪烁）。隐藏时视口宽度读出来还是旧值，只能看文档是否有尺寸。
// me 是本实例的标识，随指令一起发给后端，控制器只听当前浮起者的归位指令。
const me = Math.random().toString(36).slice(2);
const shown = () => document.documentElement.clientWidth > 0;
// 按后端回报和当前阶段摆界面：图标是否出现、输入框是否已浮起（显示区底部留白）、记录卡是否展开
function render(r) {
  const max = r.state === 'on' || r.state === 'maximized';
  if (!max) stage = 0;
  const floated = r.state === 'on' && stage >= 1;
  document.body.classList.toggle('max', max); document.body.classList.toggle('native', floated);
  if (floated) document.documentElement.style.setProperty('--dp-native-h', (r.height || 82) + 'px');
  chatBtn.className = 'icon' + (stage >= 1 ? ' on' : '') + (stage === 2 ? ' log' : '');
  toggleLog(floated && stage === 2);
}
async function floatBeat(cmd) {
  let r; try { r = await api('/api/float', { cmd, owner: me }); } catch { r = { state: 'error' }; }
  render(r);
}
function beat() {
  if (!shown()) { if (stage >= 1) { stage = 0; floatBeat('off'); } else render({ state: 'hidden' }); return; }   // 本实例被隐藏：自己浮起的要收回，别的不碰
  floatBeat(stage >= 1 ? 'on' : 'probe');
}
function startFloat() { if (floatTimer) return; beat(); floatTimer = setInterval(beat, 3000); }
function stopFloat() { if (!floatTimer) return; clearInterval(floatTimer); floatTimer = null; stage = 0; floatBeat('off'); }
// 面板尺寸刚变（最大化、恢复）或窗口刚重新可见时，不等下一次心跳，250 毫秒后就查一次，让图标和输入框尽快跟上
let beatSoon = null;
function beatNow() { if (!floatTimer) return; clearTimeout(beatSoon); beatSoon = setTimeout(beat, 250); }
window.addEventListener('resize', beatNow); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beatNow(); });
new ResizeObserver(beatNow).observe(document.documentElement);   // 本实例被隐藏或重新显示时（切换对话）不会有 resize 事件，用它来触发
window.addEventListener('pagehide', () => { if (floatTimer) navigator.sendBeacon('/api/float?token=' + encodeURIComponent(token), JSON.stringify({ cmd: 'off', owner: me })); });
chatBtn.onclick = () => { stage = (stage + 1) % 3; floatBeat(stage >= 1 ? 'on' : 'off'); };
function onResize() {
  document.body.classList.toggle('wide', innerWidth >= 1000);
  if (innerWidth >= 800) startFloat(); else stopFloat();   // 窄于 800 的窗格不会是最大化的，不必查
}   // PDF 的重排不在这里做：页宽跟着所在显示区的宽度走，由 pdfRO 统一处理
window.addEventListener('resize', onResize); onResize();
function toggleLog(open) { if (chat.classList.contains('open') === open) return; chat.classList.toggle('open', open); clearInterval(logTimer); logTimer = null; if (open) { refreshLog(); logTimer = setInterval(refreshLog, 2000); } }
// 记录卡每两秒重抓一次对话。整块重画会清掉选区，所以内容没变就不重画；用户正在卡里选着文字时也不重画，选区就能一直保持，直到下一次点击把它取消
let lastLogJson = '';
async function refreshLog() {
  try {
    const d = await api('/api/chat/recent?n=10000'); const json = JSON.stringify(d.items);
    const sel = getSelection(), selecting = !!sel && !sel.isCollapsed && chatLog.contains(sel.anchorNode);
    if (json === lastLogJson || selecting) return;
    lastLogJson = json; const atBottom = chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 24;
    chatLog.innerHTML = d.items.map(m => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join('') || '<div class="hint">This conversation is empty so far</div>';
    if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
    placeMarks();   // 重画把标记抹掉了，按引文补回来
  } catch (e) { lastLogJson = ''; chatLog.innerHTML = `<div class="hint">Could not read the conversation: ${esc(e.message)}</div>`; }
}

// 八、放大缩小。顶栏的“− 100% +”控制显示区的缩放：阅读态和编辑器改字号，PDF 按比例重画，图片按比例放大。比例记在本机，下次打开沿用。
let zoom = 1; try { zoom = parseFloat(localStorage.getItem('dp-zoom')) || 1; } catch { }
function applyZoom(z, redraw = true) {
  zoom = Math.min(2, Math.max(0.6, Math.round(z * 10) / 10)); try { localStorage.setItem('dp-zoom', zoom); } catch { }
  document.documentElement.style.setProperty('--dp-zoom', zoom); $('zoomReset').textContent = Math.round(zoom * 100) + '%';
  if (cm) cm.refresh();
  if (redraw && view.classList.contains('pdf') && current) { const ratio = view.scrollTop / Math.max(1, view.scrollHeight); loadTab().then(() => { view.scrollTop = ratio * view.scrollHeight; }); }
}
$('zoomIn').onclick = () => applyZoom(zoom + 0.1); $('zoomOut').onclick = () => applyZoom(zoom - 0.1); $('zoomReset').onclick = () => applyZoom(1);
applyZoom(zoom, false);
