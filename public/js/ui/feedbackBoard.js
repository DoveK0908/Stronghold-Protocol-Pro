// The lobby's anonymous feedback board (public/js/ui/…): players post feedback without a name, discuss each other's
// posts, and the maintainer — after typing the board password — replies and moves a post between the four columns.
//
// The board is server state (server/feedbackBoard.js, /api/feedback). This module only draws it: nothing here is part of
// game readiness, and a board that cannot be reached leaves every other lobby control usable.
//
// ANONYMITY: the board never learns who posted — the server keeps a hash of a random secret that this browser stores, and
// that secret is the only way to edit or withdraw one's own post later.
import { html, Button, Icon, Modal, Spinner } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';
import { FEEDBACK_PATH, FEEDBACK_STATUSES, FEEDBACK_STATUS_LABEL } from '../../../shared/feedback.js';

const SECRETS_PREF = 'feedback.secrets';

/** The secrets this browser holds: `{ [postId]: secret }`, the only proof it wrote a post. @returns {Record<string,string>} */
function loadSecrets() {
  const value = loadPref(SECRETS_PREF, {});
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [id, secret] of Object.entries(value)) if (typeof secret === 'string' && typeof id === 'string') out[id] = secret;
  return out;
}

/** @param {Record<string,string>} secrets */
function saveSecrets(secrets) {
  // the board keeps at most 500 posts; a browser that wrote more than that in one profile is not worth the space
  const ids = Object.keys(secrets).slice(-200);
  savePref(SECRETS_PREF, Object.fromEntries(ids.map((id) => [id, secrets[id]])));
}

/** `MM-DD HH:mm` in the player's own time zone: the board shows a day and a minute, never a time zone. @param {number} ts */
function stamp(ts) {
  const d = new Date(Number(ts) || 0);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The board's error codes → what the player reads. @param {string} code */
function message(code) {
  switch (code) {
    case 'TOO_LONG': return t('内容太长了，请缩短后再发布。');
    case 'EMPTY': return t('标题和内容都不能为空。');
    case 'RATE_LIMIT': return t('操作太频繁，请等一分钟再试。');
    case 'BOARD_FULL': return t('反馈板已满，请联系维护者清理。');
    case 'NOT_YOURS': return t('只有发布者本人可以修改或撤回这条反馈。');
    case 'BAD_PASSWORD': return t('密码不正确。');
    case 'NOT_MAINTAINER': return t('维护者身份已过期，请重新输入密码。');
    case 'TOO_LARGE': return t('内容太大了。');
    case 'INTERNAL': return t('服务器出错了，请稍后再试。');
    default: return t('操作没有完成，请稍后再试。');
  }
}

/**
 * One request to the board. Resolves with the board's body (`{ ok: true, … }`) and rejects with `{ code, detail }` so the
 * caller can show the reason instead of a blank panel.
 * @param {Record<string, any>} [body] absent: read the board
 */
async function call(body) {
  let res;
  try {
    res = await fetch(FEEDBACK_PATH, body === undefined ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw { code: 'OFFLINE', detail: {} };
  }
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!data || data.ok !== true) throw { code: data?.error || 'INTERNAL', detail: data || {} };
  return data;
}

/**
 * The board itself. Rendered while open (the caller mounts it), the way every other lobby dialog is.
 * @param {{ onClose: () => void }} props
 */
export function FeedbackBoard({ onClose }) {
  const [state, setState] = useState({ status: 'loading', posts: [], limits: null });
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [replyDraft, setReplyDraft] = useState('');
  // the post this browser is rewriting (`{ id, title, body }`), or null: only the author may open it
  const [editing, setEditing] = useState(null);
  const [secrets, setSecrets] = useState(loadSecrets);
  const [maintainer, setMaintainer] = useState(() => {
    const token = loadPref('feedback.token', '');
    return typeof token === 'string' && token ? { token, ready: 'checking' } : { token: '', ready: 'no' };
  });
  const [password, setPassword] = useState('');
  const [asking, setAsking] = useState(false);

  const load = async () => {
    try {
      const data = await call();
      setState({ status: 'ready', posts: data.posts || [], limits: data.limits || null });
      setError('');
    } catch (e) {
      setState((prev) => ({ ...prev, status: 'failed' }));
      setError(message(e.code));
    }
  };

  useEffect(() => { load(); }, []);
  // a stored maintainer token may have expired: ask the board rather than promising a toolbar that will be refused
  useEffect(() => {
    if (maintainer.ready !== 'checking') return;
    let live = true;
    call({ action: 'session', token: maintainer.token })
      .then((data) => { if (live) setMaintainer((m) => ({ ...m, ready: data.maintainer ? 'yes' : 'no' })); })
      .catch(() => { if (live) setMaintainer((m) => ({ ...m, ready: 'no' })); });
    return () => { live = false; };
  }, [maintainer.ready]);

  /** Run one write, then refresh the board; refusals land in the panel's error line. @param {() => Promise<any>} run */
  const write = async (run) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      await run();
      await load();
      return true;
    } catch (e) {
      if (e.code === 'NOT_MAINTAINER') { setMaintainer({ token: '', ready: 'no' }); savePref('feedback.token', ''); }
      setError(message(e.code));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    const title = draft.title.trim(), body = draft.body.trim();
    if (!title || !body) { setError(message('EMPTY')); return; }
    let created = null;
    const done = await write(async () => {
      created = await call({ action: 'create', title, body });
    });
    if (!done || !created) return;
    setDraft({ title: '', body: '' });
    if (created.secret && created.post?.id) {
      const next = { ...secrets, [created.post.id]: created.secret };
      setSecrets(next);
      saveSecrets(next);
    }
  };

  const reply = async (id) => {
    const text = replyDraft.trim();
    if (!text) return;
    const done = await write(() => call({ action: 'reply', id, body: text, token: maintainer.token }));
    if (done) setReplyDraft('');
  };

  const setStatus = (id, status) => write(() => call({ action: 'status', id, status, token: maintainer.token }));

  /** Rewrite one's own post: the same secret that withdraws it proves the edit. */
  const saveEdit = () => {
    if (!editing) return;
    const title = editing.title.trim(), body = editing.body.trim();
    if (!title || !body) { setError(message('EMPTY')); return; }
    return write(async () => {
      await call({ action: 'edit', id: editing.id, title, body, secret: secrets[editing.id] });
      setEditing(null);
    });
  };

  const withdraw = (id) => {
    const secret = secrets[id];
    if (!secret) return;
    return write(async () => {
      await call({ action: 'withdraw', id, secret });
      const next = { ...secrets };
      delete next[id];
      setSecrets(next);
      saveSecrets(next);
    });
  };

  const login = () => write(async () => {
    const data = await call({ action: 'login', password });
    setMaintainer({ token: data.token, ready: 'yes' });
    savePref('feedback.token', data.token);
    setPassword('');
    setAsking(false);
  });

  const logout = () => {
    setMaintainer({ token: '', ready: 'no' });
    savePref('feedback.token', '');
  };

  const columns = FEEDBACK_STATUSES.map((status) => ({ status, posts: state.posts.filter((p) => p.status === status) }));
  const total = state.posts.length;
  const mine = (p) => !!secrets[p.id];

  const card = (p) => {
    const open = openId === p.id;
    const isEditing = editing?.id === p.id;
    return html`<article key=${p.id} class=${`fb-card${open ? ' is-open' : ''}`}>
      <button type="button" class="fb-card__head" aria-expanded=${open} onClick=${() => setOpenId(open ? null : p.id)}>
        <span class="fb-card__title">${p.title}</span>
        <span class="fb-card__meta num">${stamp(p.u)}${p.replies.length ? ` · ${p.replies.length}` : ''}</span>
      </button>
      ${isEditing ? html`<div class="fb-compose fb-compose--edit">
        <input class="fb-input" type="text" maxlength=${state.limits?.title || 80} value=${editing.title}
          aria-label=${t('反馈标题')} onInput=${(e) => setEditing((d) => ({ ...d, title: e.currentTarget.value }))} />
        <textarea class="fb-input" rows="3" maxlength=${state.limits?.body || 2000} value=${editing.body}
          aria-label=${t('反馈内容')} onInput=${(e) => setEditing((d) => ({ ...d, body: e.currentTarget.value }))} />
        <div class="fb-manage">
          <${Button} size="sm" disabled=${busy || !editing.title.trim() || !editing.body.trim()} onClick=${saveEdit}>${t('保存修改')}<//>
          <${Button} size="sm" variant="ghost" disabled=${busy} onClick=${() => setEditing(null)}>${t('取消')}<//>
        </div>
      </div>` : html`<p class="fb-card__body">${p.body}</p>`}
      ${open ? html`<div class="fb-card__thread">
        ${p.replies.map((r, i) => html`<div key=${i} class=${`fb-reply${r.maintainer ? ' is-maintainer' : ''}`}>
          <span class="fb-reply__who">${r.maintainer ? t('维护者') : t('玩家')}</span>
          <span class="fb-reply__body">${r.body}</span>
          <span class="fb-reply__t num">${stamp(r.t)}</span>
        </div>`)}
        <div class="fb-compose">
          <textarea class="fb-input" rows="2" maxlength=${state.limits?.reply || 1000} value=${replyDraft}
            placeholder=${t('补充说明或讨论…')} onInput=${(e) => setReplyDraft(e.currentTarget.value)} />
          <${Button} size="sm" disabled=${busy || !replyDraft.trim()} onClick=${() => reply(p.id)}>${t('发送')}<//>
        </div>
        ${maintainer.ready === 'yes' ? html`<div class="fb-manage">
          ${FEEDBACK_STATUSES.map((status) => html`<${Button} key=${status} size="sm" variant=${p.status === status ? 'primary' : 'ghost'}
            disabled=${busy || p.status === status} onClick=${() => setStatus(p.id, status)}>${t(FEEDBACK_STATUS_LABEL[status])}<//>`)}
        </div>` : null}
        ${mine(p) ? html`<div class="fb-manage">
          <${Button} size="sm" variant="ghost" icon="edit" disabled=${busy}
            onClick=${() => { setOpenId(p.id); setEditing({ id: p.id, title: p.title, body: p.body }); }}>${t('编辑')}<//>
          <${Button} size="sm" variant="ghost" icon="minus" disabled=${busy} onClick=${() => withdraw(p.id)}>${t('撤回这条反馈')}<//>
        </div>` : null}
      </div>` : null}
    </article>`;
  };

  return html`<${Modal} open=${true} title=${t('反馈板')} micro="FEEDBACK BOARD" ariaLabel=${t('大厅反馈板')} trapFocus=${true}
      class="feedback-board lobby-dialog" width="min(1180px, 96vw)" onClose=${onClose}
      actions=${html`<${Button} icon="close" onClick=${onClose} data-autofocus>${t('关闭反馈板')}<//>`}>
    <div class="fb-top">
      <p class="fb-hint">${t('这里不需要登录：发帖不记录任何身份。维护者会在这里回复，并把采纳的反馈移到对应分栏。')}</p>
      ${maintainer.ready === 'yes'
        ? html`<span class="fb-badge"><${Icon} name="check" />${t('维护者模式')}<button type="button" class="fb-link" onClick=${logout}>${t('退出')}</button></span>`
        : asking
          ? html`<div class="fb-login">
            <input class="fb-input" type="password" value=${password} placeholder=${t('维护者密码')} aria-label=${t('维护者密码')}
              onInput=${(e) => setPassword(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') login(); }} />
            <${Button} size="sm" disabled=${busy || !password} onClick=${login}>${t('确认')}<//>
            <${Button} size="sm" variant="ghost" onClick=${() => { setAsking(false); setPassword(''); }}>${t('取消')}<//>
          </div>`
          : html`<button type="button" class="fb-link" onClick=${() => setAsking(true)}>${t('维护者入口')}</button>`}
    </div>
    ${error ? html`<p class="fb-error" role="alert">${error}</p>` : null}
    <div class="fb-compose fb-compose--new">
      <input class="fb-input" type="text" maxlength=${state.limits?.title || 80} value=${draft.title}
        placeholder=${t('一句话标题')} aria-label=${t('反馈标题')}
        onInput=${(e) => setDraft((d) => ({ ...d, title: e.currentTarget.value }))} />
      <textarea class="fb-input" rows="3" maxlength=${state.limits?.body || 2000} value=${draft.body}
        placeholder=${t('发生了什么？希望怎么改？（不必填写联系方式）')} aria-label=${t('反馈内容')}
        onInput=${(e) => setDraft((d) => ({ ...d, body: e.currentTarget.value }))} />
      <${Button} disabled=${busy || !draft.title.trim() || !draft.body.trim()} onClick=${post}>${t('发布反馈')}<//>
    </div>
    ${state.status === 'loading' ? html`<div class="fb-state" role="status"><${Spinner} label="LOADING" /><p>${t('正在读取反馈…')}</p></div>`
      : state.status === 'failed' ? html`<div class="fb-state" role="status">
        <${Icon} name="warn" /><h3>${t('反馈板暂时打不开')}</h3><p>${t('大厅的其他功能不受影响。')}</p>
        <${Button} icon="refresh" onClick=${load}>${t('重试')}<//>
      </div>`
        : !total ? html`<div class="fb-state" role="status"><${Icon} name="info" /><h3>${t('还没有人发反馈')}</h3><p>${t('第一条反馈会显示在这里。')}</p></div>`
          : html`<div class="fb-columns">${columns.map((col) => html`<section key=${col.status} class="fb-column">
            <h3 class="fb-column__title">${t(FEEDBACK_STATUS_LABEL[col.status])}<span class="num">${col.posts.length}</span></h3>
            <div class="fb-column__list">${col.posts.map(card)}</div>
          </section>`)}</div>`}
  <//>`;
}
