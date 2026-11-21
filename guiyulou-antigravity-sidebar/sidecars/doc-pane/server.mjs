// 文献面板的后端。Antigravity 启动这个脚本时，把分配的端口写在环境变量 ANTIGRAVITY_SIDECAR_WEB_PORT 里，
// 这里用 Node 自带的 http 模块在该端口上起一个只监听本机回环地址的服务器，不依赖应用自带的 sidecar SDK。
// 提供：页面与脚本库、目录列表、文件名搜索、读文件、写文件，评论记录的按轮存取（读对话的记录文件判断引用是否已随消息发出），以及通过 Electron 调试端口把文字插进对话输入框、让原装输入框浮到面板底部。
import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { homedir } from 'node:os';

const here = import.meta.dirname;
const port = parseInt(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT);
const uiToken = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN;   // 非 GET 请求要带这个令牌，和应用 SDK 的做法一致
const staticTypes = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css' };
// /raw/<绝对路径> 通道按扩展名给类型，预览 HTML 时网页里相对路径引用的样式、脚本、图片都从这里取
const rawTypes = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };
const binaryTypes = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const skip = (name) => name.startsWith('.') || name === 'node_modules' || name === '__pycache__';
// 完整的评论记录放在插件文件夹根下（本文件在 <插件>/sidecars/doc-pane/ 里，往上两层就是插件根）：
// notes.json 供面板重开时恢复清单，notes.md 供左边的代理按编号查。放这里是因为规则文件里要写死这个路径，它在每台机器上都一样。
const dataDir = resolve(here, '..', '..');
// 评论记录分两部分：notes 是当前这一轮（还没随消息发出去的），rounds 是已经发出去的各轮，新的在前。旧版本的 notes.json 只是一个数组，读进来当作当前这一轮
function readStore() {
  const d = existsSync(join(dataDir, 'notes.json')) ? JSON.parse(readFileSync(join(dataDir, 'notes.json'), 'utf-8')) : [];
  return Array.isArray(d) ? { notes: d, rounds: [] } : d;
}
// 每一轮的编号都从 1 开始，所以 notes.md 按轮分节，新的在前；每条多写一行 Label（对话框里跟在 [Ref n] 后面的那几个字），代理靠编号加 Label 对上是哪一轮的哪一条
function writeStore(store) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'notes.json'), JSON.stringify(store, null, 1), 'utf-8');
  // 来源两种：文件里的一段（路径加行号或页码），或本轮对话的某一条消息（第几条、谁说的）
  const entry = (x) => [`### [Ref ${x.n}]`, `Label: ${x.label}`, ...(x.chat ? [`Source: this conversation, message ${x.msg} (${x.role === 'user' ? 'said by the user' : 'said by the agent'})`] : [`File: ${x.path}`, `Location: ${x.page ? 'page ' + x.page : (x.line ? 'line ' + x.line : 'unknown')}`]), ...(x.locator ? [`Element: ${x.locator}`] : []), ...(x.snippet ? [`Snippet: ${x.snippet}`] : []), `Quote: ${x.quote}`, `Comment: ${x.comment || '(none)'}`, ''];
  const md = ['# guiyulou-antigravity-sidebar notes', '', 'Numbering restarts at 1 with every message, so the notes are grouped into rounds, newest first. A `[Ref n] <text>` line in a user message refers to the entry with that number whose Label is `<text>`.', ''];
  if (store.notes.length) md.push('## Not sent yet', '', ...store.notes.flatMap(entry));
  for (const r of store.rounds) md.push(`## Round sent ${r.sent}`, '', ...r.notes.flatMap(entry));
  writeFileSync(join(dataDir, 'notes.md'), md.join('\n'), 'utf-8');
}

// 一、目录列表：返回 dir 下的直接子项，文件夹在前、文件在后，各自按名字排序。页面点开一个文件夹时调一次。
function listDir(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).filter(e => !skip(e.name));
  const byName = (a, b) => a.name.localeCompare(b.name, 'zh');
  const dirs = entries.filter(e => e.isDirectory()).map(e => ({ name: e.name, path: join(dir, e.name), dir: true })).sort(byName);
  const files = entries.filter(e => e.isFile()).map(e => ({ name: e.name, path: join(dir, e.name), dir: false })).sort(byName);
  return [...dirs, ...files];
}

// 二、文件名搜索：从 root 往下递归，相对路径里含 needle（不分大小写）的文件收进 hits，最多 200 条。
function walk(dir, root, needle, hits) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skip(e.name) || hits.length >= 200) continue;
    const full = join(dir, e.name);
    const rel = full.slice(root.length + 1);
    if (e.isDirectory()) walk(full, root, needle, hits);
    else if (e.isFile() && rel.toLowerCase().includes(needle)) hits.push({ name: e.name, path: full, rel });
  }
}

// 三、连上 Antigravity 的对话输入框。应用的 Electron 主进程开着 Chrome 调试端口，端口号写在用户数据目录的 DevToolsActivePort 文件里。
// 连上当前页面后，返回几个小工具：在页面里执行脚本、模拟按键、像输入法上屏一样插字。用完要 close。
async function connectComposer() {
  // Antigravity 把调试端口号写在它的用户数据目录里，按系统找：macOS、Windows、Linux 三个位置
  const portFile = [join(homedir(), 'Library/Application Support/Antigravity/DevToolsActivePort'), join(process.env.APPDATA || '', 'Antigravity/DevToolsActivePort'), join(homedir(), '.config/Antigravity/DevToolsActivePort')].find(existsSync);
  if (!portFile) throw new Error('Antigravity DevToolsActivePort file not found');
  const cdpPort = readFileSync(portFile, 'utf-8').split('\n')[0].trim();
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const page = targets.find(t => t.type === 'page' && t.url.startsWith('https://127.0.0.1'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const waiting = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const call = (method, params = {}) => new Promise(r => { ws.send(JSON.stringify({ id: ++id, method, params })); waiting.set(id, r); });
  const evalJs = async (expr) => (await call('Runtime.evaluate', { returnByValue: true, expression: expr })).result?.result?.value;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const key = async (k, code, vk, modifiers = 0) => { for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers }); };
  const ED = `[...document.querySelectorAll('[data-lexical-editor="true"]')].find(e => e.getBoundingClientRect().width > 0)`;
  // 把光标放到输入框末尾，返回现有文字；找不到输入框返回 null
  const focusEnd = () => evalJs(`(() => { const ed = ${ED}; if (!ed) return null; ed.focus(); const sel = getSelection(); sel.selectAllChildren(ed); sel.collapseToEnd(); return ed.innerText; })()`);
  return { call, evalJs, sleep, key, ED, focusEnd, close: () => ws.close() };
}

// 插入：先把光标放到末尾（已有文字就另起一行），文字段像输入法上屏一样插入，段内换行按 shift+回车（直接插换行符会被丢掉，普通回车会发送）。
// 文件段先敲 @ 和文件名，等候选菜单里选中项正是这个文件后按 Tab 得到文件小标签；对不上就退掉敲进去的字，改插纯文字路径。
async function insertIntoComposer(segments, opts = {}) {
  const c = await connectComposer();
  const typeText = async (text) => { const lines = text.split('\n'); for (let i = 0; i < lines.length; i++) { if (i > 0) await c.key('Enter', 'Enter', 13, 8); if (lines[i] !== '') await c.call('Input.insertText', { text: lines[i] }); } };
  const existing = await c.focusEnd();
  if (existing === null || existing === undefined) { c.close(); throw new Error('Chat input box not found; open a conversation on the left first'); }
  // 输入框里已有文字：默认另起一行；inline 为真时接在同一行后面（前面没有空格就补一个）
  if (existing.trim() !== '') { if (opts.inline) { if (!/\s$/.test(existing)) await c.call('Input.insertText', { text: ' ' }); } else await c.key('Enter', 'Enter', 13, 8); }
  for (const seg of segments) {
    if (seg.text !== undefined) { await typeText(seg.text); continue; }
    await c.call('Input.insertText', { text: '@' }); await c.sleep(300);
    await c.call('Input.insertText', { text: seg.mention });
    let matched = false;
    for (let t = 0; t < 14 && !matched; t++) {
      await c.sleep(150);
      const sel = await c.evalJs(`(() => { const o = document.querySelector('[role="option"][aria-selected="true"]'); return o ? o.innerText.split('\\n') : null; })()`);
      matched = !!sel && sel[0] === seg.mention && (!seg.dir || !sel[1] || sel[1] === seg.dir);
    }
    if (matched) { await c.key('Tab', 'Tab', 9); await c.sleep(400); }
    else { await c.key('Escape', 'Escape', 27); for (let i = 0; i < seg.mention.length + 1; i++) await c.key('Backspace', 'Backspace', 8); await c.sleep(300); await c.call('Input.insertText', { text: seg.fallback + ' ' }); }
  }
  c.close();
}

// 改输入框里已经写进去的引用行。每个 op 带要找的原文 find：remove 为真就删掉这段（整行独占时连同换行一起删），否则换成 replace。
// 做法是在输入框的文本节点里找到那段文字、用 DOM 选区选中，再像键盘一样退格或替换；找不到（用户已改过或已发送）就跳过。
async function editComposer(ops) {
  const c = await connectComposer();
  for (const op of ops) {
    const info = await c.evalJs(`(() => { const ed = ${c.ED}; if (!ed) return null;
      const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let node;
      while ((node = w.nextNode())) { const i = node.data.indexOf(${JSON.stringify(op.find)}); if (i < 0) continue;
        const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + ${op.find.length}); const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
        const span = node.parentElement, whole = i === 0 && i + ${op.find.length} === node.data.length;
        return { whole, prevBr: whole && !!span.previousSibling && span.previousSibling.tagName === 'BR', nextBr: whole && !!span.nextSibling && span.nextSibling.tagName === 'BR' }; }
      return null; })()`);
    if (!info) continue;
    await c.sleep(120);
    if (op.remove) { await c.key('Backspace', 'Backspace', 8); if (info.prevBr) await c.key('Backspace', 'Backspace', 8); else if (info.nextBr) await c.key('Delete', 'Delete', 46); }
    else await c.call('Input.insertText', { text: op.replace });
    await c.sleep(100);
  }
  await c.focusEnd();
  c.close();
}

// 对话记录卡用的动作。读整轮对话：页面里 data-quotable 的块就是消息正文，在 user-input-step 容器里的是用户说的，其余是代理说的；相邻的代理块合并成一条。
// 对话区默认只装着最近的回合，更早的要按一个隐藏的 Load older messages 钮才加载进页面，所以先连点它，直到按钮消失或点了也不再多出内容。
async function chatRecent(n) {
  const c = await connectComposer();
  const COUNT = `document.querySelectorAll('[data-quotable="true"]').length`;
  for (let i = 0; i < 40; i++) {
    const before = await c.evalJs(COUNT);
    const clicked = await c.evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Load older messages'); if (!b) return false; b.click(); return true; })()`);
    if (!clicked) break;
    let grown = false; for (let t = 0; t < 15 && !grown; t++) { await c.sleep(100); grown = (await c.evalJs(COUNT)) !== before; }
    if (!grown) break;
  }
  const items = await c.evalJs(`(() => { const out = [];
    for (const e of document.querySelectorAll('[data-quotable="true"]')) {
      const role = e.closest('[data-testid="user-input-step"]') ? 'user' : 'agent'; let text = e.innerText.trim(); if (!text) continue;
      if (role === 'agent') text = text.replace(/^(Worked|Thought|Ran) for [^\\n]*\\n?/, '').trim(); if (!text) continue;   // 去掉代理消息开头“Worked for 1m”这类状态行
      const last = out[out.length - 1]; if (last && last.role === 'agent' && role === 'agent') last.text += '\\n' + text; else out.push({ role, text }); }
    return out.slice(-${n}).map(m => ({ role: m.role, text: m.text.length > 100000 ? m.text.slice(0, 100000) + '…' : m.text })); })()`);   // 单条只在极端长度时才截
  c.close(); return items || [];
}
// 主题变量。宿主只在它自己创建面板时推一次主题，面板自己重载过就收不到了；这个接口从主窗口直接读当前主题的变量，面板等不到推送时来要。
async function readTheme() {
  const c = await connectComposer();
  const r = await c.evalJs(`(() => { const names = ['--background', '--foreground', '--muted-foreground', '--card', '--border', '--primary', '--primary-foreground', '--error', '--muted', '--secondary', '--sidebar', '--accent', '--popover'];
    const cs = getComputedStyle(document.documentElement), out = {};
    for (const n of names) { const v = (document.documentElement.style.getPropertyValue(n) || cs.getPropertyValue(n) || '').trim(); if (v) out[n] = v; }
    if (!out['--accent'] && out['--primary']) out['--accent'] = out['--primary'];
    return { theme: document.body.className, cssVariables: out }; })()`);
  c.close(); return r || { cssVariables: {} };
}

// 判断带引用的消息有没有发出去。Antigravity 把每个对话的每一步写在 <应用数据目录>/brain/<对话编号>/.system_generated/logs/transcript_full.jsonl 里，一行一步；
// 用户发出的消息是 type 为 USER_INPUT 的一步，created_at 是发出的时间（只精确到秒），content 是正文。这里只读这个文件，不改它。
// 应用数据目录取本程序数据目录里 sidecar_data 之前的那一段（宿主把各后台程序的数据目录都放在 <应用数据目录>/sidecar_data/ 之下）
const appData = (process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || join(homedir(), '.gemini/antigravity/sidecar_data/doc-pane/data')).split(/[\\/]sidecar_data[\\/]/)[0];
// since 是这一轮第一条评论的建立时间（毫秒），numbers 是这一轮的各个编号：这之后只要有一条用户消息带着其中某个 [Ref n]，这一轮就算发出去了
function roundSent(conv, since, numbers) {
  const file = join(appData, 'brain', conv, '.system_generated', 'logs', 'transcript_full.jsonl');
  if (!/^[0-9a-f-]{8,}$/i.test(conv) || !existsSync(file)) return false;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.includes('"USER_INPUT"') || !line.includes('[Ref ')) continue;   // 先按字面筛一遍，绝大多数行不用解析
    const step = JSON.parse(line);
    if (step.type === 'USER_INPUT' && Date.parse(step.created_at) >= Math.floor(since / 1000) * 1000 && numbers.some(n => (step.content || '').includes(`[Ref ${n}]`))) return true;
  }
  return false;
}
// 面板网址里没带对话编号时（面板是在对话还没建立时打开的），从主窗口的地址里取：主窗口的地址形如 https://127.0.0.1:端口/c/<对话编号>
async function currentConversation() {
  const c = await connectComposer(); const path = await c.evalJs('location.pathname'); c.close();
  return (String(path).match(/\/c\/([0-9a-f-]{8,})/i) || [])[1] || '';
}

// 五、原装输入框浮起。面板最大化后，把主窗口里真正的输入框浮到面板底部，原装的 @ 文件、斜杠命令、附件、选模型、停止钮全部可用。
// 实测得知：只改输入框自己浮不上来。它上面有两层 container-type: size 的容器和一层 z-index: 0 的对话列把层级封了顶，
// 最大化时主程序还给整条对话列写了 pointer-events: none。所以这段在主窗口里运行的控制器要改五个元素：
// 封顶祖先的 container-type 改成 normal、z-index 改成 auto；输入框本身写固定定位、位置宽度、z-index 9999 和 pointer-events: auto。
// 面板每三秒发一次心跳（on），控制器每秒自查：窗口可见却八秒没心跳、窗格不再是最大化、输入框被重建，都自动还原（off）。
// 面板没要浮起时发的是 probe，只回答窗格是否最大化，不改任何东西。
// 还原只撤销我们改过的那几个属性，而且先确认当前值仍是我们写的值，主程序自己重写过的不碰，所以窗格恢复后布局不会被旧值盖掉。
const FLOAT_JS = String.raw`(() => {
  const V = 6;
  if (window.__dpFloat && window.__dpFloat.v === V) return;
  if (window.__dpFloat) { try { window.__dpFloat.off(); } catch (e) { } }
  const S = { active: false, box: null, caps: [], last: 0, timer: null, obs: null, ro: null, owner: '', side: null, lowered: new Map() };   // owner：发起浮起的那个面板实例的标识；side：对话列这一侧的子树；lowered：被压低层级的元素及原值
  const BOX = () => document.getElementById('antigravity.agentSidePanelInputBox');
  const IFR = () => [...document.querySelectorAll('iframe[data-testid="sidecar-iframe"]')].filter(f => f.getBoundingClientRect().width > 0).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  // 最大化的判据：顶栏有 Restore Pane 钮，并且面板 iframe 盖住了输入框所在的位置（左边的对话列表展开时面板不满宽，所以不按宽度比例判断）
  const MAX = () => { const f = IFR(), box = BOX(); if (!f || !box || !document.querySelector('[aria-label="Restore Pane"]')) return false; const r = f.getBoundingClientRect(), b = box.getBoundingClientRect(); const cx = b.left + b.width / 2, cy = b.top + b.height / 2; return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom; };
  const PROPS = ['position', 'left', 'bottom', 'width', 'z-index', 'pointer-events'];
  // 宽度最多 900，两侧各留 150 以上，右下角要放面板自己的"Conversation"小胶囊
  function geometry() { const f = IFR().getBoundingClientRect(); const w = Math.min(f.width - 48, 900, f.width - 300); return { left: Math.round(f.x + (f.width - w) / 2), width: Math.round(w) }; }
  function enforce() {
    if (!S.active || !document.contains(S.box) || !IFR()) return;
    for (const c of S.caps) {
      if (c.ct && c.el.style.containerType !== 'normal') { c.origCT = c.el.style.containerType; c.el.style.containerType = 'normal'; }
      if (c.z && c.el.style.zIndex !== 'auto') { c.origZ = c.el.style.zIndex; c.el.style.zIndex = 'auto'; }
    }
    const g = geometry(), st = S.box.style;
    const want = { position: 'fixed', left: g.left + 'px', bottom: '12px', width: g.width + 'px', 'z-index': '9999', 'pointer-events': 'auto' };
    for (const k in want) if (st.getPropertyValue(k) !== want[k]) st.setProperty(k, want[k]);
    // 拆掉对话列的层级分组之后，列里自带的悬停滚动条（z-index 30）和“滚到底部”钮（20）会压过面板（20）显现出来；浮起期间把它们压到 1
    if (S.side) for (const e of S.side.querySelectorAll('[class*="z-"]')) { if (S.box.contains(e) || S.lowered.has(e)) continue; const cs = getComputedStyle(e); if (cs.position !== 'static' && parseInt(cs.zIndex) >= 20) { S.lowered.set(e, e.style.zIndex); e.style.zIndex = '1'; } }
  }
  function on(owner) {
    S.last = Date.now(); S.owner = owner || S.owner;
    if (!MAX()) { off(); return { state: 'not-maximized' }; }
    const box = BOX(), ifr = IFR();
    if (!box) { off(); return { state: 'missing' }; }
    if (S.active && S.box !== box) off();
    if (!S.active) {
      const anc = e => { const out = []; while (e && e !== document.body) { out.push(e); e = e.parentElement; } return out; };
      const A = anc(box), B = anc(ifr); const common = A.find(e => B.includes(e));
      if (!common) return { state: 'missing' };
      S.caps = A.slice(1, A.indexOf(common)).map(e => { const cs = getComputedStyle(e); return { el: e, ct: cs.containerType !== 'normal', z: cs.zIndex !== 'auto', origCT: e.style.containerType, origZ: e.style.zIndex }; }).filter(c => c.ct || c.z);
      S.side = A[A.indexOf(common) - 1]; S.lowered = new Map();
      S.box = box; S.active = true;
      S.obs = new MutationObserver(enforce); for (const c of S.caps) S.obs.observe(c.el, { attributes: true, attributeFilter: ['style'] }); S.obs.observe(box, { attributes: true, attributeFilter: ['style'] });
      S.ro = new ResizeObserver(enforce);
      window.addEventListener('resize', enforce);
      S.timer = setInterval(tick, 1000);
    }
    S.ro.disconnect(); S.ro.observe(ifr);
    enforce();
    return { state: 'on', height: Math.round(box.getBoundingClientRect().height) };
  }
  // 窗口被别的窗口挡住时浏览器会把面板里的定时器放慢到一分钟一次，所以心跳超时只在窗口可见时才算数
  function tick() { if (S.active && ((document.visibilityState === 'visible' && Date.now() - S.last > 8000) || !MAX() || !document.contains(S.box))) off(); }
  // 宿主为每个对话各保留一个面板实例，隐藏实例的归位指令不能打断可见实例的浮起，所以带标识的归位只听当前浮起者的
  function off(owner) {
    if (!S.active) return probe();
    if (owner && S.owner && owner !== S.owner) return probe();
    S.obs.disconnect(); S.ro.disconnect(); clearInterval(S.timer); window.removeEventListener('resize', enforce);
    for (const c of S.caps) { if (c.ct && c.el.style.containerType === 'normal') c.el.style.containerType = c.origCT; if (c.z && c.el.style.zIndex === 'auto') c.el.style.zIndex = c.origZ; }
    for (const k of PROPS) S.box.style.removeProperty(k);
    for (const [e, orig] of S.lowered) if (e.style.zIndex === '1') e.style.zIndex = orig;
    S.active = false; S.caps = []; S.box = null; S.owner = ''; S.side = null; S.lowered = new Map();
    return probe();
  }
  // 只查不动：窗格是否最大化、输入框是否已浮起
  function probe() { return { state: !MAX() ? 'not-maximized' : (S.active ? 'on' : 'maximized'), height: S.active ? Math.round(S.box.getBoundingClientRect().height) : 0 }; }
  window.__dpFloat = { v: V, on, off, probe };
})()`;
// cmd 三种：on 浮起并维持（心跳）、off 归位、probe 只查不动。回报 state：on 已浮起、maximized 最大化但没浮起、not-maximized、missing
async function floatComposer(cmd, owner) {
  const c = await connectComposer();
  const r = await c.evalJs(`${FLOAT_JS}; window.__dpFloat.${cmd === 'on' ? 'on' : cmd === 'probe' ? 'probe' : 'off'}(${JSON.stringify(owner || '')})`);
  c.close(); return r || { state: 'error' };
}

// 六、HTTP 服务。GET 给页面、脚本库和读类接口；POST 给写文件和插字，POST 必须带令牌。
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const q = url.searchParams;
  const send = (status, type, body) => {
    if (url.pathname === '/api/insert') console.log(status === 200 ? '插入成功' : '插入失败');
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });   // 不让宿主缓存页面和脚本，改完文件重载面板就能生效
    res.end(body);
  };
  const json = (obj) => send(200, 'application/json', JSON.stringify(obj));
  try {
    if (req.method !== 'GET' && uiToken && req.headers['x-sidecar-token'] !== uiToken && q.get('token') !== uiToken) return send(401, 'application/json', '{"error":"unauthorized"}');
    if (url.pathname === '/') return send(200, staticTypes['.html'], readFileSync(join(here, 'index.html')));
    if (url.pathname.startsWith('/vendor/') || url.pathname === '/app.js' || url.pathname === '/style.css') return send(200, staticTypes[extname(url.pathname)], readFileSync(join(here, url.pathname.slice(1))));
    if (url.pathname.startsWith('/raw/')) { const fp = decodeURIComponent(url.pathname.slice(4)); if (!existsSync(fp)) return send(404, 'text/plain', 'Not found'); return send(200, rawTypes[extname(fp).toLowerCase()] || 'application/octet-stream', readFileSync(fp)); }
    if (url.pathname === '/api/home') return json({ home: homedir() });
    if (url.pathname === '/api/tree') return json({ entries: listDir(q.get('dir')) });
    if (url.pathname === '/api/search') { const hits = []; walk(q.get('root'), q.get('root'), q.get('q').toLowerCase(), hits); return json({ hits }); }
    if (url.pathname === '/api/notes' && req.method === 'GET') { const store = readStore(); return json({ notes: store.notes, kept: store.rounds.reduce((k, r) => k + r.notes.length, 0) }); }   // kept：已发出去的各轮里一共还存着多少条
    if (url.pathname === '/api/chat/recent') return json({ items: await chatRecent(parseInt(q.get('n') || '8')) });
    if (url.pathname === '/api/theme') return json(await readTheme());
    if (url.pathname === '/api/file') { const p = q.get('path'); const type = binaryTypes[extname(p).toLowerCase()]; return type ? send(200, type, readFileSync(p)) : send(200, 'text/plain; charset=utf-8', readFileSync(p, 'utf-8')); }
    const body = JSON.parse(await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b || '{}')); }));
    if (url.pathname === '/api/notes') { writeStore({ ...readStore(), notes: body.notes }); return json({ ok: true }); }   // 只换当前这一轮，已发出去的各轮原样保留
    if (url.pathname === '/api/notes/archive') { const store = readStore(); store.rounds.unshift({ sent: new Date().toLocaleString('sv-SE').slice(0, 16), conversation: body.conv, notes: body.notes }); store.notes = []; writeStore(store); return json({ ok: true }); }   // 这一轮已随消息发出：移到已发送各轮的最前面，当前这一轮清空
    if (url.pathname === '/api/notes/clear') { writeStore({ notes: [], rounds: [] }); return json({ ok: true }); }   // Clear all：当前这一轮和已发出去的各轮一起清掉
    if (url.pathname === '/api/sent') { const conv = body.conv || await currentConversation(); return json({ sent: roundSent(conv, body.since, body.numbers), conv }); }
    if (url.pathname === '/api/save') { writeFileSync(body.path, body.content, 'utf-8'); return json({ ok: true }); }
    if (url.pathname === '/api/insert') { await insertIntoComposer(body.segments || [{ text: body.text }], { inline: !!body.inline }); return json({ ok: true }); }
    if (url.pathname === '/api/composer') { await editComposer(body.ops); return json({ ok: true }); }
    if (url.pathname === '/api/float') return json(await floatComposer(body.cmd || (body.on ? 'on' : 'off'), body.owner));
    send(404, 'text/plain', 'Not found');
  } catch (err) { send(500, 'application/json', JSON.stringify({ error: err.message })); }
});
server.listen(port, '127.0.0.1', () => console.log(`[doc-pane] listening on 127.0.0.1:${port}`));
