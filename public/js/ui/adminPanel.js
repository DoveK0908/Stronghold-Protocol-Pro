// Server administration is deliberately separate from player login and browser-local preferences.
import { html, Button, Modal, Spinner, confirmDialog } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { t, N_ } from '../../../shared/i18n.js';
import { FEEDBACK_STATUSES, FEEDBACK_STATUS_LABEL } from '../../../shared/feedback.js';
import { createAdminClient } from './adminApi.js';

const TABS = [ ['players', N_('玩家数据')], ['claims', N_('编号独占')], ['avatars', N_('上传头像')],
  ['namecards', N_('上传名片')], ['feedback', N_('反馈管理')], ['audit', N_('操作记录')] ];
// One sentence per tab, in the same slot: the tab bar, the note, the search row, the action row and the operation row
// keep their height on every tab, so the list always starts and ends in the same place.
const NOTES = {
  players: N_('重置会清空该玩家在服务器上的编号独占与独占上传；共享图片与浏览器本地战绩不受影响。'),
  claims: N_('重新分配会替换目标玩家原有的编号独占；受影响玩家重新连接后生效。'),
  avatars: N_('删除会移除图片文件与全部引用；被其他玩家共享的图片请在玩家数据里按玩家处理。'),
  namecards: N_('删除会移除图片文件与全部引用；被其他玩家共享的图片请在玩家数据里按玩家处理。'),
  feedback: N_('反馈作者保持匿名；改状态、回复与删除都会立刻体现在玩家的反馈板上。'),
  audit: N_('只读：最近的管理操作，最多保留 500 条。'),
};
const rowId = (row, resource) => resource === 'claims' ? `${row.name}#${row.tag}` : row.id || row.owner;
const short = (value) => String(value || '').slice(0, 12);

function failure(code) {
  switch (code) {
    case 'DISABLED': case 'ADMIN_DISABLED': return t('后台尚未配置服主密钥。');
    case 'UNAUTHORIZED': case 'BAD_KEY': case 'AUTH_REQUIRED': case 'FORBIDDEN': case 'CSRF': return t('管理身份无效或已过期，请重新登录。');
    case 'RATE_LIMIT': return t('操作太频繁，请稍后重试。');
    case 'CONFLICT': case 'STALE': return t('数据已变化，请刷新后重新选择。');
    case 'PLAYER_IN_ROOM': return t('玩家仍在房间中，请离开房间后重试。');
    case 'SHARED_MEDIA': return t('图片由多个玩家共享，请单独审核图片，不能随玩家重置删除。');
    case 'UNKNOWN_OWNER': return t('目标玩家不存在，请从玩家列表复制完整标识。');
    case 'NOT_FOUND': return t('项目已不存在，请刷新列表。');
    case 'UNSAFE_PATH': case 'DELETE_FAILED': return t('图片文件无法安全删除，未执行该项操作。');
    default: return t('操作失败，请刷新后重试。');
  }
}

export function AdminPanel({ onClose }) {
  const [client] = useState(createAdminClient);
  const [key, setKey] = useState('');
  const [logged, setLogged] = useState(false);
  const [tab, setTab] = useState('players');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'idle', items: [], total: 0 });
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [target, setTarget] = useState('');
  const [status, setStatus] = useState(FEEDBACK_STATUSES[0]);
  const [reply, setReply] = useState('');
  const generation = useRef(0);

  useEffect(() => () => { generation.current++; client.logout().catch(() => {}); }, [client]);
  useEffect(() => {
    const seq = ++generation.current;
    setSelected([]); setResult(null); setError('');
    if (!logged) return;
    setState({ status: 'loading', items: [], total: 0 });
    client.read(tab, { offset, q: search }).then((data) => {
      if (seq === generation.current) setState({ status: 'ready', items: data.items || [], total: data.total || 0 });
    }).catch((e) => {
      if (seq !== generation.current) return;
      if (e.code === 'UNAUTHORIZED' || e.code === 'CSRF') setLogged(false);
      setState({ status: 'failed', items: [], total: 0 }); setError(failure(e.code));
    });
  }, [logged, tab, offset, search, revision]);

  const login = async () => {
    if (busy || !key) return;
    setBusy(true); setError('');
    try { await client.login(key); setLogged(true); }
    catch (e) { setError(failure(e.code)); }
    finally { setKey(''); setBusy(false); }
  };
  const close = () => { if (!busy) onClose(); };
  const logout = async () => {
    setBusy(true);
    try { await client.logout(); setLogged(false); setState({ status: 'idle', items: [], total: 0 }); setSelected([]); }
    catch (e) { setLogged(false); setState({ status: 'idle', items: [], total: 0 }); setSelected([]); setError(failure(e.code)); }
    finally { setBusy(false); }
  };
  const toggle = (id) => setSelected((ids) => ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id]);
  const rows = state.items.filter((row) => selected.includes(rowId(row, tab)));
  const act = async (action) => {
    if (busy || !rows.length) return;
    const ok = await confirmDialog({ title: t('确认管理操作'), danger: true,
      text: t('将对所选 {n} 项执行操作。删除或重置无法撤销；共享图片删除会影响全部引用者。', { n: rows.length }),
      okText: t('确认执行'), cancelText: t('取消') });
    if (!ok) return;
    setBusy(true); setError(''); setResult(null);
    const items = rows.map((row) => tab === 'claims'
      ? { name: row.name, tag: row.tag, expectedOwner: row.owner, expectedAt: row.at, ...(action === 'claims.reassign' ? { targetOwner: target.trim() } : {}) }
      : tab === 'players' ? { owner: row.owner }
        : { id: row.id, ...(action === 'feedback.status' ? { status } : {}), ...(action === 'feedback.reply' ? { body: reply.trim() } : {}) });
    try {
      const data = await client.write(action, items);
      setResult((data.results || []).map((item) => ({ ...item, label: rowId(rows[item.index] || {}, tab) || '' }))); setSelected([]);
      // Keep per-item results visible while reloading, so partial failures are never shown as all-success.
      const next = await client.read(tab, { offset, q: search });
      setState({ status: 'ready', items: next.items || [], total: next.total || 0 });
    } catch (e) {
      if (e.code === 'UNAUTHORIZED' || e.code === 'CSRF') setLogged(false);
      setError(failure(e.code));
    } finally { setBusy(false); }
  };
  const switchTab = (value) => { setTab(value); setOffset(0); setQuery(''); setSearch(''); setSelected([]); };

  return html`<${Modal} open=${true} title=${t('后台管理')} micro="SERVER ADMINISTRATION" ariaLabel=${t('后台管理')}
      trapFocus=${true} class="admin-panel lobby-dialog" width="min(1240px, 96vw)" closeOnBackdrop=${false} onClose=${close}
      actions=${html`${logged ? html`<${Button} variant="ghost" disabled=${busy} onClick=${logout}>${t('退出管理')}<//>` : null}
        <${Button} disabled=${busy} onClick=${close}>${t('关闭')}<//>`}>
    <p class="fb-hint">${t('仅管理本服务器保存的编号、上传图片与反馈；战绩和设置仍在玩家浏览器内。反馈作者保持匿名。')}</p>
    ${error ? html`<p class="fb-error" role="alert">${error}</p>` : null}
    ${!logged ? html`<form class="admin-login" onSubmit=${(e) => { e.preventDefault(); login(); }}>
      <label>${t('服主密钥')}<input class="fb-input" type="password" autocomplete="off" value=${key} data-autofocus
        onInput=${(e) => setKey(e.currentTarget.value)} /></label>
      <p class="fb-hint">${t('普通玩家通行密码不能用于管理。密钥不会保存到浏览器。')}</p>
      <${Button} type="submit" disabled=${busy || !key}>${t('进入管理')}<//>
    </form>` : html`
      <nav class="admin-tabs" aria-label=${t('管理分类')}>${TABS.map(([id, label]) => html`<${Button} key=${id} size="sm"
        variant=${tab === id ? 'primary' : 'ghost'} disabled=${busy} onClick=${() => switchTab(id)} aria-pressed=${tab === id}>${t(label)}<//>`)}</nav>
      <div class="admin-shell">
      <form class="admin-search" onSubmit=${(e) => { e.preventDefault(); if (busy) return; setOffset(0); setSearch(query.trim()); setRevision((v) => v + 1); }}>
        <input class="fb-input" type="search" aria-label=${t('搜索管理数据')} placeholder=${t('搜索管理数据')} value=${query}
          onInput=${(e) => setQuery(e.currentTarget.value)} />
        <${Button} type="submit" disabled=${busy}>${t('搜索')}<//>
        <${Button} variant="ghost" disabled=${busy} onClick=${() => setRevision((v) => v + 1)}>${t('刷新')}<//>
      </form>
      <p class="admin-note">${t(NOTES[tab])}</p>
      <div class="admin-bar">
        ${tab !== 'audit' ? html`<label class="admin-check"><input type="checkbox" disabled=${busy || !state.items.length}
          checked=${!!state.items.length && selected.length === state.items.length}
          onChange=${(e) => setSelected(e.currentTarget.checked ? state.items.map((row) => rowId(row, tab)) : [])} />${t('选择本页')}</label>
          <span class="admin-count num">${selected.length} / ${state.total}</span>` : html`<span class="admin-count num">${state.total}</span>`}
        ${tab === 'claims' ? html`<${Button} size="sm" disabled=${busy || !rows.length} onClick=${() => act('claims.release')}>${t('释放独占')}<//>`
          : tab === 'players' ? html`<${Button} size="sm" variant="danger" disabled=${busy || !rows.length} onClick=${() => act('players.reset')}>${t('重置所选服务器数据')}<//>`
            : tab === 'feedback' ? html`<select class="fb-input admin-status" aria-label=${t('反馈状态')} value=${status} onChange=${(e) => setStatus(e.currentTarget.value)}>
              ${FEEDBACK_STATUSES.map((value) => html`<option value=${value}>${t(FEEDBACK_STATUS_LABEL[value])}</option>`)}</select>
              <${Button} size="sm" disabled=${busy || !rows.length} onClick=${() => act('feedback.status')}>${t('修改状态')}<//>
              <${Button} size="sm" variant="danger" disabled=${busy || !rows.length} onClick=${() => act('feedback.delete')}>${t('删除反馈')}<//>`
              : tab === 'audit' ? null
                : html`<${Button} size="sm" variant="danger" disabled=${busy || !rows.length} onClick=${() => act(`${tab}.delete`)}>${t('删除图片')}<//>`}
      </div>
      <div class="admin-op">
        ${tab === 'claims' ? html`<input class="fb-input admin-target" aria-label=${t('目标玩家标识')} placeholder=${t('目标玩家标识')}
            value=${target} onInput=${(e) => setTarget(e.currentTarget.value)} />
          <${Button} size="sm" disabled=${busy || !rows.length || !/^[a-f0-9]{32}$/.test(target.trim())} onClick=${() => act('claims.reassign')}>${t('重新分配')}<//>`
          : tab === 'feedback' ? html`<input class="fb-input admin-reply" maxlength="1000" aria-label=${t('维护者回复')} placeholder=${t('维护者回复')}
            value=${reply} onInput=${(e) => setReply(e.currentTarget.value)} />
          <${Button} size="sm" disabled=${busy || !rows.length || !reply.trim()} onClick=${() => act('feedback.reply')}>${t('回复所选反馈')}<//>`
            : html`<span class="admin-op__note">${selected.length
              ? t('已选 {n} 项：上面的操作会作用到这些项目。', { n: selected.length })
              : t('在本页勾选项目后，上面的操作才会作用到它们。')}</span>`}
      </div>
      <div class="admin-list">
        ${result ? html`<div class="admin-results" role="status">${result.map((r, i) => html`<p key=${i}>${i + 1} · ${r.label} · ${r.partial ? t('部分操作已完成，请检查刷新后的数据。') : ''}${r.ok ? t('操作完成') : failure(r.error)}</p>`)}</div>` : null}
        ${state.status === 'loading' ? html`<div class="admin-state" role="status"><${Spinner} label="LOADING" /></div>`
          : state.status === 'failed' ? html`<div class="admin-state" role="status"><${Button} onClick=${() => setRevision((v) => v + 1)}>${t('重试')}<//></div>`
            : html`${!state.items.length ? html`<p class="fb-hint">${t('暂无数据')}</p>` : null}
            ${state.items.map((row, i) => html`<article class="admin-row" key=${rowId(row, tab) || i}>
              ${tab !== 'audit' ? html`<input type="checkbox" aria-label=${t('选择此项')} checked=${selected.includes(rowId(row, tab))}
                disabled=${busy} onChange=${() => toggle(rowId(row, tab))} />` : null}
              <div class="admin-row__content">
                ${tab === 'claims' ? html`<strong>${row.name}#${row.tag}</strong><code title=${row.owner}>${row.owner}</code>`
                  : tab === 'avatars' || tab === 'namecards' ? html`<img class=${`admin-preview admin-preview--${tab}`} loading="lazy" alt=${t('上传图片预览')}
                    src=${`/${tab === 'avatars' ? 'avatar' : 'namecard'}/${row.id}`} /><code>${row.id}</code><small>${row.bytes || 0} B · ${(row.owners || []).map(short).join(', ')}</small>`
                    : tab === 'feedback' ? html`<strong>${row.title}</strong><small>${t(FEEDBACK_STATUS_LABEL[row.status] || '')}</small><p>${row.body}</p>
                      ${(row.replies || []).map((r, j) => html`<p key=${j}>${r.maintainer ? t('维护者') : t('玩家')} · ${r.body}</p>`)}`
                      : tab === 'players' ? html`<code title=${row.owner}>${row.owner}</code>
                          <p>${(row.claims || []).map((claim) => `${claim.name}#${claim.tag}`).join(' · ')}</p>
                          ${(row.sessions || []).map((session) => html`<p key=${session.playerId}>${session.name}#${session.tag} · ${session.inRoom ? t('房间内') : session.connected ? t('在线') : t('离线')}</p>`)}
                          <small>${t('头像')} · ${row.avatar || '—'} / ${t('名片')} · ${row.namecard || '—'}</small>`
                        : html`<strong>${row.action}</strong><small>${row.at ? new Date(row.at).toLocaleString() : ''}</small><p>${row.count || 0}</p>`}
              </div>
            </article>`)}`}
      </div>
      <div class="admin-pagination"><${Button} disabled=${busy || offset === 0} onClick=${() => setOffset(Math.max(0, offset - 50))}>${t('上一页')}<//>
        <span class="num">${state.total ? offset + 1 : 0}–${Math.min(offset + 50, state.total)} / ${state.total}</span>
        <${Button} disabled=${busy || offset + 50 >= state.total} onClick=${() => setOffset(offset + 50)}>${t('下一页')}<//></div>
      </div>
    `}
  <//>`;
}
