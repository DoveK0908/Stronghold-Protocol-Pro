import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import htm from 'htm';
import { FEEDBACK_STATUSES, FEEDBACK_STATUS_LABEL, FEEDBACK_LIMITS } from '../../shared/feedback.js';

const source = fs.readFileSync(new URL('../../public/js/ui/adminPanel.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
const feedback = [
  { id: 'feedback-a', title: 'First feedback', body: '<b>plain text</b>', status: 'planned', replies: [] },
  { id: 'feedback-b', title: 'Second feedback', body: 'Another issue', status: 'open', replies: [] },
];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function* nodes(tree) {
  if (Array.isArray(tree)) { for (const child of tree) yield* nodes(child); }
  else if (tree && typeof tree === 'object') { yield tree; yield* nodes(tree.props?.children); }
}
const text = (tree) => Array.isArray(tree) ? tree.map(text).join('')
  : tree && typeof tree === 'object' ? text(tree.props?.children) : String(tree ?? '');
const button = (tree, label) => [...nodes(tree)].find(n => n.type === 'Button' && text(n) === label);
const find = (tree, type) => [...nodes(tree)].find(n => n.type === type);

// Exercise the actual template/handlers without DOM, network, services or browser startup.
async function fixture({ write, read } = {}) {
  const slots = [], effects = [], writes = [], reads = [], confirmations = [];
  let cursor = 0, dirty = true, tree;
  const client = {
    login: async () => {}, logout: async () => {},
    read: async (resource) => {
      reads.push(resource);
      if (read) await read(resource, reads.length);
      return { items: resource === 'feedback' ? feedback : [], total: resource === 'feedback' ? feedback.length : 0 };
    },
    write: async (action, items) => {
      writes.push(JSON.parse(JSON.stringify({ action, items })));
      return write ? write(action, items) : { results: items.map((_, index) => ({ index, ok: true })) };
    },
  };
  const context = vm.createContext({
    html: htm.bind((type, props, ...children) => ({ type, props: { ...props, children } })),
    Button: 'Button', Modal: 'Modal', Spinner: 'Spinner', t: s => s, N_: s => s,
    FEEDBACK_STATUSES, FEEDBACK_STATUS_LABEL, FEEDBACK_LIMITS, createAdminClient: () => client,
    confirmDialog: async opts => { confirmations.push(opts); return true; },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => {
        const next = typeof value === 'function' ? value(slots[i]) : value;
        if (next !== slots[i]) { slots[i] = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((value, n) => value !== old[n])) { slots[i] = deps; effects.push(fn); }
    },
  });
  vm.runInContext(source + '\nglobalThis.panel = AdminPanel;', context);
  function render() {
    do {
      dirty = false; cursor = 0;
      tree = context.panel({ onClose() {} });
      while (effects.length) effects.shift()();
    } while (dirty);
    return tree;
  }
  async function invoke(node, event = 'onClick', value) {
    assert.ok(node, 'target control exists');
    assert.ok(!node.props.disabled, 'target control is enabled');
    const pending = node.props[event]({ preventDefault() {}, currentTarget: { value } });
    render(); await pending; await flush(); render();
  }
  render();
  await invoke(find(tree, 'input'), 'onInput', 'fixture-key');
  await invoke(find(tree, 'form'), 'onSubmit');
  await invoke(button(tree, '反馈管理'));
  return {
    writes, reads, confirmations, render, invoke,
    get tree() { return tree; },
    get rows() { return [...nodes(tree)].filter(n => n.type === 'article'); },
    get dialog() { return [...nodes(tree)].find(n => n.type === 'Modal' && n.props.class.includes('admin-feedback-dialog')); },
    get toolbar() { return [...nodes(tree)].find(n => n.props.class === 'admin-bar'); },
  };
}

test('each feedback opens its own reply/status dialog; selection only enables bulk deletion', async () => {
  const f = await fixture();
  assert.equal(f.rows.length, 2);
  assert.deepEqual([...nodes(f.toolbar)].filter(n => n.type === 'Button').map(text), ['删除反馈']);
  assert.equal(button(f.toolbar, '删除反馈').props.disabled, true);
  assert.equal(find(f.tree, 'select'), undefined);
  assert.equal(find(f.tree, 'textarea'), undefined);
  assert.ok(!text(f.tree).includes('回复所选反馈'));
  await f.invoke(find(f.rows[0], 'input'), 'onChange');
  assert.equal(button(f.toolbar, '删除反馈').props.disabled, false);
  // Editing the unselected second feedback must not use the selected first row.
  await f.invoke(button(f.rows[1], '维护者回复'));
  assert.ok(text(f.dialog).includes('Second feedback'));
  assert.equal(f.dialog.props.trapFocus, true);
  assert.equal(f.dialog.props.closeOnBackdrop, false);
  assert.equal(button(f.dialog.props.actions, '确认执行').props.disabled, true);
  await f.invoke(find(f.dialog, 'textarea'), 'onInput', '   \n  ');
  assert.equal(button(f.dialog.props.actions, '确认执行').props.disabled, true);
  await f.invoke(find(f.dialog, 'textarea'), 'onInput', 'x'.repeat(FEEDBACK_LIMITS.reply + 1));
  assert.equal(button(f.dialog.props.actions, '确认执行').props.disabled, true);
  await button(f.dialog.props.actions, '确认执行').props.onClick();
  assert.equal(f.writes.length, 0, 'invalid replies cannot bypass the disabled button');
  await f.invoke(find(f.dialog, 'textarea'), 'onInput', '  First line\nSecond line  ');
  assert.equal(find(f.dialog, 'textarea').props.maxlength, FEEDBACK_LIMITS.reply);
  await f.invoke(button(f.dialog.props.actions, '确认执行'));
  assert.deepEqual(f.writes, [{ action: 'feedback.reply', items: [{ id: 'feedback-b', body: 'First line\nSecond line' }] }]);
  assert.equal(f.dialog, undefined);
  assert.equal(f.confirmations.length, 0, 'the row dialog is the explicit confirmation');

  await f.invoke(button(f.rows[0], '修改状态'));
  assert.equal(find(f.dialog, 'select').props.value, 'planned');
  assert.equal(button(f.dialog.props.actions, '确认执行').props.disabled, true, 'unchanged state is not submitted');
  assert.deepEqual([...nodes(f.dialog)].filter(n => n.type === 'option').map(n => n.props.value), [...FEEDBACK_STATUSES]);
  await f.invoke(find(f.dialog, 'select'), 'onChange', 'invalid');
  assert.equal(button(f.dialog.props.actions, '确认执行').props.disabled, true);
  await button(f.dialog.props.actions, '确认执行').props.onClick();
  assert.equal(f.writes.length, 1, 'invalid status cannot bypass the disabled button');
  await f.invoke(find(f.dialog, 'select'), 'onChange', 'done');
  await f.invoke(button(f.dialog.props.actions, '确认执行'));
  assert.deepEqual(f.writes[1], { action: 'feedback.status', items: [{ id: 'feedback-a', status: 'done' }] });
  await f.invoke(button(f.toolbar, '删除反馈'));
  assert.deepEqual(f.writes[2], { action: 'feedback.delete', items: [{ id: 'feedback-a' }] });
  assert.equal(f.confirmations.length, 1, 'bulk deletion still requires confirmation');
});

test('bulk feedback deletion still sends all selected rows in one confirmed request', async () => {
  const f = await fixture();
  const selectAll = find(f.toolbar, 'input');
  selectAll.props.onChange({ currentTarget: { checked: true } }); f.render();
  await f.invoke(button(f.toolbar, '删除反馈'));
  assert.deepEqual(f.writes, [{ action: 'feedback.delete', items: [{ id: 'feedback-a' }, { id: 'feedback-b' }] }]);
  assert.equal(f.confirmations.length, 1);
});

test('cancel does not write and a fresh dialog never reuses another feedback reply', async () => {
  const f = await fixture();
  await f.invoke(button(f.rows[0], '维护者回复'));
  await f.invoke(find(f.dialog, 'textarea'), 'onInput', 'Unsent draft');
  await f.invoke(button(f.dialog.props.actions, '取消'));
  assert.equal(f.dialog, undefined); assert.equal(f.writes.length, 0);
  await f.invoke(button(f.rows[1], '维护者回复'));
  assert.equal(find(f.dialog, 'textarea').props.value, '');
});

for (const mode of ['item failure', 'request failure']) test(`reply ${mode} keeps the target, draft and error visible`, async () => {
  const f = await fixture({ write: async () => {
    if (mode === 'request failure') throw Object.assign(new Error('fixture'), { code: 'RATE_LIMIT' });
    return { results: [{ index: 0, ok: false, error: 'NOT_FOUND' }] };
  } });
  await f.invoke(button(f.rows[1], '维护者回复'));
  await f.invoke(find(f.dialog, 'textarea'), 'onInput', 'Keep this draft');
  await f.invoke(button(f.dialog.props.actions, '确认执行'));
  assert.equal(find(f.dialog, 'textarea').props.value, 'Keep this draft');
  assert.ok([...nodes(f.dialog)].some(n => n.props.role === 'alert'));
  assert.ok(text(f.dialog).includes('Second feedback'));
  assert.equal(f.writes.length, 1);
});

test('pending reply locks submission/cancel; successful write closes even if list refresh fails', async () => {
  let finish, failRefresh = false;
  const f = await fixture({
    write: () => new Promise(resolve => { finish = resolve; }),
    read: async resource => { if (resource === 'feedback' && failRefresh) throw new Error('read fixture'); },
  });
  await f.invoke(button(f.rows[0], '维护者回复'));
  await f.invoke(find(f.dialog, 'textarea'), 'onInput', 'Only send once');
  const submit = button(f.dialog.props.actions, '确认执行');
  const pending = submit.props.onClick(); f.render();
  assert.equal(button(f.dialog.props.actions, '确认执行').props.disabled, true);
  assert.equal(button(f.dialog.props.actions, '取消').props.disabled, true);
  assert.equal(find(f.dialog, 'textarea').props.disabled, true);
  f.dialog.props.onClose(); f.render(); assert.ok(f.dialog, 'Escape cannot close during the write');
  await button(f.dialog.props.actions, '确认执行').props.onClick();
  assert.equal(f.writes.length, 1);
  failRefresh = true; finish({ results: [{ index: 0, ok: true }] });
  await pending; f.render();
  assert.equal(f.dialog, undefined, 'refresh failure must not offer a duplicate reply submission');
  assert.ok([...nodes(f.tree)].some(n => n.props.role === 'alert'));
});

test('expired administrative session closes the feedback editor and returns to login', async () => {
  const f = await fixture({ write: async () => { throw Object.assign(new Error('fixture'), { code: 'UNAUTHORIZED' }); } });
  await f.invoke(button(f.rows[0], '维护者回复'));
  await f.invoke(find(f.dialog, 'textarea'), 'onInput', 'Draft');
  await f.invoke(button(f.dialog.props.actions, '确认执行'));
  assert.equal(f.dialog, undefined);
  assert.ok(button(f.tree, '进入管理'));
  assert.equal(f.rows.length, 0);
});
