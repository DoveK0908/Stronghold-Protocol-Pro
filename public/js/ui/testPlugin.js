// Native opt-in test tools, separate from the host-only local test console. No speed controls (its one clock tool
// only holds a phase deadline; it never shortens or speeds up a clock).
import { useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { useStore } from '../store.js';
import { data, useData } from '../data.js';
import { net } from '../net.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';
import { testRefusalText } from './testAudit.js';
import { testPluginAvailable, testPluginInput } from './testPluginModel.js';

export function TestPlugin() {
  const pub = useStore((s) => s.match.public);
  const mine = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  // No child hooks, content loads, listeners or requests in disabled rooms / other seats' views.
  if (!testPluginAvailable(pub, mine, myId)) return null;
  return html`<${TestPluginDock} key=${pub.id || myId} mine=${mine} />`;
}

function TestPluginDock({ mine }) {
  const [open, setOpen] = useState(false);
  return html`<aside class="testplugin" aria-label=${t('测试插件')}>
    <button type="button" class="btn" aria-expanded=${open} aria-controls="testplugin-body" onClick=${() => setOpen(!open)}>${open ? t('收起') : t('测试插件')}</button>
    ${open ? html`<${TestPluginForm} mine=${mine} />` : null}
  </aside>`;
}

function TestPluginForm({ mine }) {
  useData('chess', 'items', 'bonds', 'bands', 'stages');
  const [cmd, setCmd] = useState('funds');
  const [fields, setFields] = useState({ amount: '', id: '', layers: '', count: '', round: '', shop: '', slot: '', level: '', bonds: '', mode: 'any', cap: '', potential: '', cultivation: '', timerMode: 'hold' });
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const set = (key, value) => setFields((old) => ({ ...old, [key]: value }));
  // a `pick` targets the slot's own side of the layout, so its id list follows the slot
  const pickKind = Number(fields.slot) < (mine.shop?.layout?.chess ?? 0) ? 'chess' : 'items';
  const table = cmd === 'pick' ? pickKind : { chess: 'chess', item: 'items', bond: 'bonds', strategy: 'bands', map: 'stages', bounty: 'enemies' }[cmd];
  const choices = Object.entries(table ? data.get(table) || {} : {});
  const numeric = (key, label, min, max) => html`<label>${label}<input type="number" min=${min} max=${max} step="1" required value=${fields[key]} onInput=${(e) => set(key, e.target.value)} /></label>`;
  const run = async (e) => {
    e.preventDefault();
    if (busy || (cmd === 'round' && !confirmed)) return;
    const parsed = testPluginInput(cmd, fields);
    if ('error' in parsed) return toast(t('无效的目标'), 'error');
    setBusy(true);
    try {
      await net.request('g.testPlugin', { cmd, args: parsed.args });
      toast(t('成功'));
      setConfirmed(false);
    } catch (err) { toast(testRefusalText(err), 'error'); }
    finally { setBusy(false); }
  };
  const receipt = mine.testPlugin;
  return html`<section id="testplugin-body" class="testplugin__body">
    <header><b>${t('测试插件')}</b><small>${t('已执行 {n} 次', { n: receipt.actions || 0 })}</small></header>
    <p class="testplugin__note">${t('仅修改自己的席位；跳回合影响全局。战斗与救援期间不可操作，倍速请用原生二倍速。')}</p>
    <div class="testplugin__status"><span>${t('资金')} <b>${mine.funds}</b></span><span>${t('目标生命')} <b>${mine.lp}</b></span><span>${t('调度中心')} <b>${mine.shop?.level}</b></span><span>${t('部署上限')} <b>${mine.deployCap}</b></span><span>${t('免费刷新次数')} <b>${mine.shop?.freeRefreshes ?? 0}</b></span></div>
    <form onSubmit=${run}>
      <fieldset disabled=${busy}>
        <label>${t('测试指令')}<select value=${cmd} onChange=${(e) => { setCmd(e.target.value); setConfirmed(false); }}>
          <optgroup label=${t('资源与商店')}>
            <option value="funds">${t('资金')}</option><option value="lp">${t('目标生命')}</option>
            <option value="chess">${t('干员')}</option><option value="item">${t('装备')}</option>
            <option value="shop">${t('下一轮商店')}</option><option value="pick">${t('自选商店槽位')}</option>
            <option value="shopLevel">${t('设置调度中心等级')}</option><option value="level">${t('升级调度中心')}</option>
            <option value="refreshFree">${t('免费刷新次数')}</option>
            <option value="diyRefresh">${t('补充自选库存')}</option>
            <option value="ops">${t('干员潜能与练度')}</option>
          </optgroup>
          <optgroup label=${t('盟约与策略')}><option value="bond">${t('盟约')}</option><option value="strategy">${t('策略')}</option><option value="filter">${t('商店盟约过滤')}</option><option value="bounty">${t('悬赏')}</option></optgroup>
          <optgroup label=${t('对局控制')}><option value="round">${t('回合')}</option><option value="map">${t('地图')}</option><option value="wave">${t('敌方波次')}</option><option value="deployCap">${t('部署上限')}</option><option value="timers">${t('倒计时冻结')}</option></optgroup>
        </select></label>
        ${cmd === 'funds' || cmd === 'lp' ? html`${numeric('amount', cmd === 'funds' ? t('资金') : t('目标生命'), cmd === 'lp' ? 1 : 0, 99999)}
          <button type="button" class="btn" onClick=${() => set('amount', String(cmd === 'lp' ? mine.lp : mine.funds))}>${t('读取当前值')}</button>` : null}
        ${cmd === 'pick' ? html`${numeric('slot', t('槽位'), 0, 11)}
          <small>${t('把选中的卡直接放进该槽位，不购买、不扣资金；已出售的槽位不能替换。')}</small>` : null}
        ${table ? html`<label>${t('内容 ID')}<input list="testplugin-ids" required maxlength="64" value=${fields.id} onInput=${(e) => set('id', e.target.value)} /></label>
          <datalist id="testplugin-ids">${choices.map(([id, rec]) => html`<option key=${id} value=${id}>${data.localeName(rec.name || id)}</option>`)}</datalist>` : null}
        ${cmd === 'bond' ? html`${numeric('layers', t('层数'), 0, 999)}<label>${t('额外盟约人数（留空保持）')}<input type="number" min="0" max="99" step="1" value=${fields.count} onInput=${(e) => set('count', e.target.value)} /></label><small>${t('层数只能增加，不能降低。')}</small>` : null}
        ${cmd === 'shop' ? html`<label>${t('下一轮商店')}<textarea required value=${fields.shop} placeholder="chess:id,item:id" onInput=${(e) => set('shop', e.target.value)} /></label>
          <button type="button" class="btn" onClick=${() => set('shop', (mine.shop?.slots || []).map((s) => s ? `${s.kind}:${s.id}` : '').join(','))}>${t('使用当前商店')}</button>
          <small>${t('按当前槽位数量填写 chess:id,item:id；下次刷新生效，仍需正常购买，队列消耗前不能升级。')}</small>` : null}
        ${cmd === 'level' ? html`<p>${t('按原价升级一级，沿用正常休整期、资金与等级限制。')}</p>` : null}
        ${cmd === 'shopLevel' ? html`${numeric('level', t('等级'), 1, 20)}
          <small>${t('设置等级不消耗资金；之后升级仍按原价。升高的等级会开启空槽位，降低等级会关闭超出等级的槽位。')}</small>` : null}
        ${cmd === 'filter' ? html`<label>${t('盟约 ID')}<input value=${fields.bonds} placeholder="bond_a,bond_b" onInput=${(e) => set('bonds', e.target.value)} /></label>
          <label>${t('匹配方式')}<select value=${fields.mode} onChange=${(e) => set('mode', e.target.value)}><option value="any">${t('任一盟约')}</option><option value="all">${t('全部盟约')}</option></select></label>
          <small>${t('只影响自己的随机商店；已上架的商品不变，清空后恢复。')}</small>` : null}
        ${cmd === 'strategy' ? html`<p>${t('替换自己的策略，保留当前生命；不叠加多策略。')}</p>` : null}
        ${cmd === 'round' ? html`${numeric('round', t('回合'), 1, 99)}<label class="testplugin__confirm"><input type="checkbox" required checked=${confirmed} onChange=${(e) => setConfirmed(e.target.checked)} />${t('确认跳回合影响所有玩家')}</label>` : null}
        ${cmd === 'map' ? html`<small>${t('切换地图会改变所有玩家脚下的地形，不能站在新地形上的棋子会收回整备区。')}</small>` : null}
        ${cmd === 'deployCap' ? html`${numeric('cap', t('部署上限'), 1, 12)}
          <small>${t('只提高自己的部署上限（最多 12），不会自动放置或撤回棋子；原生部署规则仍然生效。')}</small>` : null}
        ${cmd === 'refreshFree' ? html`${numeric('count', t('免费刷新次数'), 0, 99)}
          <small>${t('设置自己的免费刷新次数，刷新时按原生规则先消耗免费次数。')}</small>` : null}
        ${cmd === 'bounty' ? html`<small>${t('给自己添加一个悬赏目标，击杀后按原生悬赏规则结算。')}</small>` : null}
        ${cmd === 'wave' ? html`<small>${t('把本回合战斗的敌人模板换成该 ID（数据 waves.json 的普通波次模板），只影响当前房间的这一场；首领回合不能替换。')}</small>` : null}
        ${cmd === 'ops' ? html`<label>${t('干员 ID')}<input required maxlength="64" value=${fields.id} onInput=${(e) => set('id', e.target.value)} /></label>
          <label>${t('潜能')}<input type="number" min="1" max="6" step="1" value=${fields.potential} onInput=${(e) => set('potential', e.target.value)} /></label>
          <label>${t('练度')}<input type="number" min="0" max="3" step="1" value=${fields.cultivation} onInput=${(e) => set('cultivation', e.target.value)} /></label>
          <small>${t('只改自己这一席对该干员的潜能（1–6）与练度（0–3，3 为精英2-60级），下一场战斗按新数值结算；留空的项保持原值。')}</small>` : null}
        ${cmd === 'diyRefresh' ? html`<small>${t('把自己已选的自选干员库存补回上限；抽取规则、等级门槛与商店价格不变。没有自选干员时不可用。')}</small>` : null}
        ${cmd === 'timers' ? html`<label>${t('倒计时')}<select value=${fields.timerMode} onChange=${(e) => set('timerMode', e.target.value)}><option value="hold">${t('冻结')}</option><option value="resume">${t('恢复')}</option></select></label>
          <small>${t('冻结后本房间不再显示阶段倒计时，恢复时按原时长重新计时；战斗阶段不能冻结。')}</small>` : null}
        <button type="submit" class="btn testplugin__run">${busy ? t('等待中') : t('执行')}</button>
      </fieldset>
    </form>
    ${receipt.shopNext ? html`<small>${t('已排队的商店')}<code>${receipt.shopNext.map((s) => `${s.kind}:${s.id}`).join(', ')}</code></small>` : null}
    ${receipt.filter ? html`<small>${t('当前商店过滤')}<code>${receipt.filter.mode}:${receipt.filter.bonds.join(', ')}</code></small>` : null}
    ${receipt.timersHeld ? html`<small>${t('倒计时已冻结')}</small>` : null}
    ${receipt.diy && receipt.diy.length ? html`<small>${t('自选库存')}<code>${receipt.diy.map((d) => `${d.id}:${d.left}/${d.cap}`).join(', ')}</code></small>` : null}
    <p class="testplugin__receipt" role="status">${receipt.last ? (receipt.last.ok ? t('成功') : testRefusalText({ code: receipt.last.code })) : t('尚无测试指令')}</p>
  </section>`;
}
