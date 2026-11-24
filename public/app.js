/* TaskFlow front-end — a small dependency-free single-page app. */
(() => {
  const STATUS = { todo: 'To do', in_progress: 'In progress', review: 'In review', done: 'Done' };
  const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
  const state = { token: localStorage.getItem('tf_token'), user: null, users: [] };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const main = $('#main');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (d) => (d ? new Date(d.replace(' ', 'T') + (d.length > 10 ? 'Z' : '')).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const fmtTime = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const isOverdue = (t) => t.due_date && t.due_date < today() && t.status !== 'done';

  // ---------- API ----------
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && state.token) { logout(); throw new Error('Session expired — please sign in again'); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(msg, isError = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast${isError ? ' error' : ''}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
  }
  const guard = (fn) => async (...args) => { try { await fn(...args); } catch (e) { toast(e.message, true); } };

  // ---------- Modal ----------
  function openModal(html) { $('#modal-body').innerHTML = html; $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal-body').innerHTML = ''; }
  $('#modal-close').onclick = closeModal;
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // ---------- Auth ----------
  $$('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-auth-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $('#login-form').classList.toggle('hidden', b.dataset.authTab !== 'login');
    $('#register-form').classList.toggle('hidden', b.dataset.authTab !== 'register');
  }));
  const formData = (form) => Object.fromEntries(new FormData(form).entries());

  $('#login-form').addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    await signIn(await api('/auth/login', { method: 'POST', body: formData(e.target) }));
  }));
  $('#register-form').addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    await signIn(await api('/auth/register', { method: 'POST', body: formData(e.target) }));
    toast('Account created');
  }));
  $('#logout').onclick = logout;

  async function signIn({ token, user }) {
    state.token = token; state.user = user;
    localStorage.setItem('tf_token', token);
    await showApp();
  }
  function logout() {
    state.token = null; state.user = null;
    localStorage.removeItem('tf_token');
    $('#app-view').classList.add('hidden');
    $('#auth-view').classList.remove('hidden');
  }
  async function showApp() {
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('#me-name').textContent = state.user.name;
    $('#me-role').textContent = state.user.role;
    $('#me-role').className = `badge ${state.user.role}`;
    $$('.admin-only').forEach((el) => el.classList.toggle('hidden', state.user.role !== 'admin'));
    state.users = (await api('/users')).users;
    if (!location.hash) location.hash = '#/dashboard'; else route();
  }

  // ---------- Router ----------
  window.addEventListener('hashchange', () => state.user && route());
  function route() {
    const [, page, id] = location.hash.split('/');
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
    const views = { dashboard: renderDashboard, projects: id ? () => renderBoard(Number(id)) : renderProjects, 'my-tasks': renderMyTasks, users: renderUsers };
    guard(views[page] || renderDashboard)();
  }

  // ---------- Shared bits ----------
  const statusBadge = (s) => `<span class="badge status ${s}">${STATUS[s]}</span>`;
  const prioBadge = (p) => `<span class="badge prio ${p}">${p}</span>`;
  const canCreateProjects = () => ['admin', 'manager'].includes(state.user.role);
  const canManage = (members) => state.user.role === 'admin' || (state.user.role === 'manager' && members.some((m) => m.id === state.user.id));

  function taskTable(tasks, showProject = true) {
    if (!tasks.length) return '<div class="empty">No tasks here yet.</div>';
    return `<table><thead><tr><th>Task</th>${showProject ? '<th>Project</th>' : ''}<th>Status</th><th>Priority</th><th>Assignee</th><th>Due</th></tr></thead><tbody>
      ${tasks.map((t) => `<tr class="clickable" data-task="${t.id}">
        <td><strong>${esc(t.title)}</strong></td>${showProject ? `<td>${esc(t.project_name)}</td>` : ''}
        <td>${statusBadge(t.status)}</td><td>${prioBadge(t.priority)}</td><td>${esc(t.assignee_name || 'Unassigned')}</td>
        <td class="${isOverdue(t) ? 'overdue' : ''}">${fmtDate(t.due_date)}</td></tr>`).join('')}
      </tbody></table>`;
  }
  function bindTaskClicks(root, onChange) {
    $$('[data-task]', root).forEach((el) => el.addEventListener('click', () => openTask(Number(el.dataset.task), onChange)));
  }

  // ---------- Dashboard ----------
  async function renderDashboard() {
    const [stats, mine] = await Promise.all([api('/stats'), api('/tasks?mine=1')]);
    const open = mine.tasks.filter((t) => t.status !== 'done');
    const seg = (s) => (stats.total ? (stats.byStatus[s] / stats.total) * 100 : 0);
    main.innerHTML = `
      <div class="page-head"><div><h1>Welcome back, ${esc(state.user.name.split(' ')[0])}</h1><div class="muted">Here’s where your work stands today.</div></div></div>
      <div class="stats">
        <div class="card stat"><div class="value">${stats.projects}</div><div class="label">Projects</div></div>
        <div class="card stat"><div class="value">${stats.total}</div><div class="label">Total tasks</div></div>
        <div class="card stat"><div class="value">${stats.assignedToMe}</div><div class="label">Open tasks assigned to me</div></div>
        <div class="card stat"><div class="value ${stats.overdue ? 'overdue' : ''}">${stats.overdue}</div><div class="label">Overdue</div></div>
        <div class="card stat"><div class="value">${stats.completionRate}%</div><div class="label">Completion rate</div></div>
      </div>
      <div class="card" style="margin-bottom:22px">
        <h2>Workflow overview</h2>
        <div class="bar">${Object.keys(STATUS).map((s) => `<span style="width:${seg(s)}%;background:var(--${s})" title="${STATUS[s]}"></span>`).join('')}</div>
        <div class="row small" style="margin-top:10px">${Object.keys(STATUS).map((s) => `${statusBadge(s)} ${stats.byStatus[s]}`).join(' &nbsp; ')}</div>
      </div>
      <div class="card"><h2>My open tasks</h2><div id="mine">${taskTable(open)}</div></div>`;
    bindTaskClicks(main, renderDashboard);
  }

  // ---------- Projects ----------
  async function renderProjects() {
    const { projects } = await api('/projects');
    main.innerHTML = `
      <div class="page-head"><div><h1>Projects</h1><div class="muted">${projects.length} project${projects.length === 1 ? '' : 's'}</div></div>
        ${canCreateProjects() ? '<button class="btn primary" id="new-project">+ New project</button>' : ''}</div>
      ${projects.length ? `<div class="projects">${projects.map((p) => {
        const pct = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
        return `<div class="card project" data-project="${p.id}">
          <h2>${esc(p.name)}</h2><p class="muted small">${esc(p.description || 'No description')}</p>
          <div class="bar"><span style="width:${pct}%;background:var(--done)"></span></div>
          <div class="row small muted" style="margin-top:8px;justify-content:space-between"><span>${p.done_count}/${p.task_count} done</span><span>Owner: ${esc(p.owner_name)}</span></div>
        </div>`; }).join('')}</div>` : `<div class="card empty">No projects yet.${canCreateProjects() ? ' Create your first one.' : ' Ask a manager to add you to a project.'}</div>`}`;
    $$('[data-project]').forEach((el) => (el.onclick = () => (location.hash = `#/projects/${el.dataset.project}`)));
    if ($('#new-project')) $('#new-project').onclick = () => projectForm();
  }

  function projectForm(project) {
    const others = state.users.filter((u) => u.id !== state.user.id);
    openModal(`<h2>${project ? 'Edit project' : 'New project'}</h2>
      <form id="pf" class="stack">
        <label>Name <input name="name" required value="${esc(project?.name)}" /></label>
        <label>Description <textarea name="description">${esc(project?.description)}</textarea></label>
        ${project ? '' : `<label>Members</label><div class="stack small">${others.map((u) => `<label class="row" style="color:var(--text)"><input type="checkbox" name="m" value="${u.id}" style="width:auto"/> ${esc(u.name)} <span class="badge ${u.role}">${u.role}</span></label>`).join('') || '<span class="muted">No other users yet.</span>'}</div>`}
        <button class="btn primary">${project ? 'Save changes' : 'Create project'}</button>
      </form>`);
    $('#pf').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = { name: f.name.value, description: f.description.value };
      if (project) {
        await api(`/projects/${project.id}`, { method: 'PUT', body });
        closeModal(); toast('Project updated'); renderBoard(project.id);
      } else {
        body.memberIds = $$('input[name=m]:checked', f).map((c) => Number(c.value));
        const { project: p } = await api('/projects', { method: 'POST', body });
        closeModal(); toast('Project created'); location.hash = `#/projects/${p.id}`;
      }
    }));
  }

  // ---------- Board ----------
  async function renderBoard(id, filters = {}) {
    const qs = new URLSearchParams({ project_id: id, ...filters });
    const [{ project, members }, { tasks }] = await Promise.all([api(`/projects/${id}`), api(`/tasks?${qs}`)]);
    const manage = canManage(members);
    const isOwner = state.user.role === 'admin' || project.owner_id === state.user.id;
    main.innerHTML = `
      <div class="page-head">
        <div><a href="#/projects" class="muted small">← Projects</a><h1>${esc(project.name)}</h1><div class="muted">${esc(project.description)}</div>
          <div class="row small" style="margin-top:8px">${members.map((m) => `<span class="badge ${m.role}">${esc(m.name)}</span>`).join('')}</div></div>
        <div class="row">
          ${manage ? '<button class="btn primary" id="new-task">+ New task</button><button class="btn" id="members">Members</button><button class="btn" id="edit-project">Edit</button>' : ''}
          ${isOwner ? '<button class="btn danger" id="del-project">Delete</button>' : ''}
        </div>
      </div>
      <div class="row" style="margin-bottom:16px">
        <input id="f-q" placeholder="Search tasks…" value="${esc(filters.q)}" style="max-width:260px" />
        <select id="f-prio" style="max-width:160px"><option value="">All priorities</option>${PRIORITIES.map((p) => `<option ${filters.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
        <select id="f-assignee" style="max-width:200px"><option value="">Anyone</option>${members.map((m) => `<option value="${m.id}" ${String(filters.assignee_id) === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        <span class="muted small">Drag cards between columns to move them through the workflow.</span>
      </div>
      <div class="board">${Object.keys(STATUS).map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return `<div class="column" data-status="${s}"><h3><span>${STATUS[s]}</span><span>${col.length}</span></h3>
          ${col.map((t) => `<div class="tcard" data-task="${t.id}" draggable="${manage || t.assignee_id === state.user.id}" style="border-left-color:var(--${s})">
            <div class="title">${esc(t.title)}</div>
            <div class="meta"><span>${prioBadge(t.priority)}</span><span>${esc(t.assignee_name || 'Unassigned')}</span></div>
            ${t.due_date ? `<div class="meta" style="margin-top:4px"><span class="${isOverdue(t) ? 'overdue' : ''}">Due ${fmtDate(t.due_date)}</span></div>` : ''}
          </div>`).join('')}</div>`; }).join('')}</div>`;

    const refresh = () => renderBoard(id, currentFilters());
    const currentFilters = () => Object.fromEntries(Object.entries({ q: $('#f-q').value, priority: $('#f-prio').value, assignee_id: $('#f-assignee').value }).filter(([, v]) => v));
    let debounce;
    $('#f-q').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(guard(refresh), 300); });
    $('#f-prio').onchange = guard(refresh);
    $('#f-assignee').onchange = guard(refresh);
    bindTaskClicks(main, refresh);

    // Drag & drop status changes (server enforces workflow rules)
    $$('.tcard[draggable=true]').forEach((c) => c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', c.dataset.task)));
    $$('.column').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', guard(async (e) => {
        e.preventDefault(); col.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const task = tasks.find((t) => String(t.id) === taskId);
        if (!task || task.status === col.dataset.status) return;
        await api(`/tasks/${taskId}/status`, { method: 'PATCH', body: { status: col.dataset.status } });
        toast(`Moved to ${STATUS[col.dataset.status]}`);
        refresh();
      }));
    });

    if ($('#new-task')) $('#new-task').onclick = () => taskForm({ project_id: id }, members, refresh);
    if ($('#edit-project')) $('#edit-project').onclick = () => projectForm(project);
    if ($('#members')) $('#members').onclick = () => membersModal(project, members);
    if ($('#del-project')) $('#del-project').onclick = guard(async () => {
      if (!confirm(`Delete "${project.name}" and all its tasks?`)) return;
      await api(`/projects/${id}`, { method: 'DELETE' });
      toast('Project deleted'); location.hash = '#/projects';
    });
  }

  function membersModal(project, members) {
    const nonMembers = state.users.filter((u) => !members.some((m) => m.id === u.id));
    openModal(`<h2>Project members</h2>
      <table><tbody>${members.map((m) => `<tr><td>${esc(m.name)}<div class="muted small">${esc(m.email)}</div></td><td><span class="badge ${m.role}">${m.role}</span></td>
        <td style="text-align:right">${m.id === project.owner_id ? '<span class="muted small">Owner</span>' : `<button class="btn small danger" data-remove="${m.id}">Remove</button>`}</td></tr>`).join('')}</tbody></table>
      ${nonMembers.length ? `<form id="add-member" class="row section"><select name="userId" class="grow">${nonMembers.map((u) => `<option value="${u.id}">${esc(u.name)} (${u.role})</option>`).join('')}</select><button class="btn primary">Add</button></form>` : ''}`);
    const reload = async () => { closeModal(); await renderBoard(project.id); const r = await api(`/projects/${project.id}`); membersModal(r.project, r.members); };
    $$('[data-remove]').forEach((b) => (b.onclick = guard(async () => { await api(`/projects/${project.id}/members/${b.dataset.remove}`, { method: 'DELETE' }); toast('Member removed'); await reload(); })));
    if ($('#add-member')) $('#add-member').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      await api(`/projects/${project.id}/members`, { method: 'POST', body: { userId: Number(e.target.userId.value) } });
      toast('Member added'); await reload();
    }));
  }

  function taskForm(task, members, onDone) {
    const editing = !!task.id;
    openModal(`<h2>${editing ? 'Edit task' : 'New task'}</h2>
      <form id="tf" class="stack">
        <label>Title <input name="title" required value="${esc(task.title)}" /></label>
        <label>Description <textarea name="description">${esc(task.description)}</textarea></label>
        <div class="grid2">
          <label>Priority <select name="priority">${PRIORITIES.map((p) => `<option ${(task.priority || 'medium') === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          <label>Due date <input type="date" name="due_date" value="${esc(task.due_date)}" /></label>
        </div>
        <label>Assignee <select name="assignee_id"><option value="">Unassigned</option>${members.map((m) => `<option value="${m.id}" ${task.assignee_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
        <button class="btn primary">${editing ? 'Save changes' : 'Create task'}</button>
      </form>`);
    $('#tf').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      body.assignee_id = body.assignee_id ? Number(body.assignee_id) : null;
      if (editing) await api(`/tasks/${task.id}`, { method: 'PUT', body });
      else await api('/tasks', { method: 'POST', body: { ...body, project_id: task.project_id } });
      closeModal(); toast(editing ? 'Task updated' : 'Task created'); onDone && onDone();
    }));
  }

  // ---------- Task detail ----------
  async function openTask(id, onChange) {
    const [{ task, history, comments, allowed_transitions }] = await Promise.all([api(`/tasks/${id}`)]);
    const { members } = await api(`/projects/${task.project_id}`);
    const manage = canManage(members);
    const label = { in_progress: task.status === 'todo' ? 'Start work' : task.status === 'review' ? 'Request changes' : task.status === 'done' ? 'Reopen' : 'In progress', review: 'Submit for review', done: 'Approve & complete', todo: 'Move back to To do' };
    openModal(`
      <div class="row small muted">${esc(task.project_name)} · #${task.id}</div>
      <h2 style="font-size:1.35rem;margin-top:4px">${esc(task.title)}</h2>
      <div class="row">${statusBadge(task.status)} ${prioBadge(task.priority)} <span class="small muted">Assignee: <strong>${esc(task.assignee_name || 'Unassigned')}</strong></span>
        <span class="small ${isOverdue(task) ? 'overdue' : 'muted'}">Due: ${fmtDate(task.due_date)}</span></div>
      <p style="white-space:pre-wrap">${esc(task.description) || '<span class="muted">No description.</span>'}</p>
      ${allowed_transitions.length ? `<div class="card section"><h2>Move task</h2>
        <input id="note" placeholder="Optional note (e.g. what needs changing)" />
        <div class="row" style="margin-top:10px">${allowed_transitions.map((s) => `<button class="btn ${s === 'done' ? 'primary' : ''}" data-move="${s}">${label[s]}</button>`).join('')}</div></div>` : ''}
      ${manage ? '<div class="row section"><button class="btn" id="edit-task">Edit details</button><button class="btn danger" id="del-task">Delete task</button></div>' : ''}
      <div class="section"><h2>Comments (${comments.length})</h2>
        ${comments.map((c) => `<div class="comment"><div class="small"><strong>${esc(c.user_name)}</strong> <span class="muted">${fmtTime(c.created_at)}</span></div>${esc(c.body)}</div>`).join('') || '<p class="muted small">No comments yet.</p>'}
        <form id="cf" class="row"><input name="body" class="grow" placeholder="Write a comment…" required /><button class="btn primary">Post</button></form></div>
      <div class="section"><h2>Activity</h2><ul class="timeline">${history.map((h) => `<li><strong>${esc(h.user_name)}</strong> ${h.from_status ? `moved ${STATUS[h.from_status]} → <strong>${STATUS[h.to_status]}</strong>` : 'created the task'}
        ${h.note && h.from_status ? `— “${esc(h.note)}”` : ''} <span class="muted">· ${fmtTime(h.created_at)}</span></li>`).join('')}</ul></div>`);

    const after = async () => { await openTask(id, onChange); onChange && onChange(); };
    $$('[data-move]').forEach((b) => (b.onclick = guard(async () => {
      await api(`/tasks/${id}/status`, { method: 'PATCH', body: { status: b.dataset.move, note: $('#note').value } });
      toast(`Task moved to ${STATUS[b.dataset.move]}`); await after();
    })));
    $('#cf').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      await api(`/tasks/${id}/comments`, { method: 'POST', body: { body: e.target.body.value } });
      await openTask(id, onChange);
    }));
    if ($('#edit-task')) $('#edit-task').onclick = () => taskForm(task, members, onChange);
    if ($('#del-task')) $('#del-task').onclick = guard(async () => {
      if (!confirm('Delete this task?')) return;
      await api(`/tasks/${id}`, { method: 'DELETE' });
      closeModal(); toast('Task deleted'); onChange && onChange();
    });
  }

  // ---------- My tasks ----------
  async function renderMyTasks(status = '') {
    const { tasks } = await api(`/tasks?mine=1${status ? `&status=${status}` : ''}`);
    main.innerHTML = `<div class="page-head"><div><h1>My tasks</h1><div class="muted">Everything assigned to you across projects.</div></div>
      <select id="ms" style="max-width:200px"><option value="">All statuses</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="card">${taskTable(tasks)}</div>`;
    $('#ms').onchange = guard(() => renderMyTasks($('#ms').value));
    bindTaskClicks(main, () => renderMyTasks(status));
  }

  // ---------- Users (admin) ----------
  async function renderUsers() {
    if (state.user.role !== 'admin') { main.innerHTML = '<div class="card empty">Only administrators can manage users.</div>'; return; }
    state.users = (await api('/users')).users;
    main.innerHTML = `<div class="page-head"><div><h1>Users</h1><div class="muted">Manage roles. Admins manage everything, managers run projects, members work on assigned tasks.</div></div></div>
      <div class="card"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead><tbody>
      ${state.users.map((u) => `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td>
        <td><select data-role="${u.id}" style="max-width:140px">${['admin', 'manager', 'member'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
        <td>${fmtDate(u.created_at)}</td><td style="text-align:right">${u.id === state.user.id ? '<span class="muted small">You</span>' : `<button class="btn small danger" data-del="${u.id}">Delete</button>`}</td></tr>`).join('')}
      </tbody></table></div>`;
    $$('[data-role]').forEach((s) => (s.onchange = guard(async () => {
      try { await api(`/users/${s.dataset.role}/role`, { method: 'PATCH', body: { role: s.value } }); toast('Role updated'); }
      finally { renderUsers(); }
    })));
    $$('[data-del]').forEach((b) => (b.onclick = guard(async () => {
      if (!confirm('Delete this user?')) return;
      await api(`/users/${b.dataset.del}`, { method: 'DELETE' }); toast('User deleted'); renderUsers();
    })));
  }

  // ---------- Boot ----------
  (async () => {
    if (!state.token) return logout();
    try { state.user = (await api('/auth/me')).user; showApp(); } catch { logout(); }
  })();
})();
