const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createDb } = require('../src/db');

describe('Task Management API', () => {
  const app = createApp({ db: createDb(':memory:') });
  const tokens = {};
  const ids = {};
  const as = (who) => ({ Authorization: `Bearer ${tokens[who]}` });

  before(async () => {
    for (const who of ['admin', 'manager', 'member', 'outsider']) {
      const res = await request(app).post('/api/auth/register')
        .send({ name: who, email: `${who}@test.dev`, password: 'Password123!' });
      assert.equal(res.status, 201);
      tokens[who] = res.body.token;
      ids[who] = res.body.user.id;
    }
    await request(app).patch(`/api/users/${ids.manager}/role`).set(as('admin')).send({ role: 'manager' }).expect(200);
  });

  test('first registered user is admin, later users are members', async () => {
    const me = await request(app).get('/api/auth/me').set(as('admin')).expect(200);
    assert.equal(me.body.user.role, 'admin');
    const m = await request(app).get('/api/auth/me').set(as('member')).expect(200);
    assert.equal(m.body.user.role, 'member');
  });

  test('rejects bad credentials, duplicate emails and missing tokens', async () => {
    await request(app).post('/api/auth/login').send({ email: 'admin@test.dev', password: 'wrong' }).expect(401);
    await request(app).post('/api/auth/login').send({ email: 'ADMIN@TEST.DEV', password: 'Password123!' }).expect(200);
    await request(app).post('/api/auth/register').send({ name: 'x', email: 'admin@test.dev', password: 'Password123!' }).expect(409);
    await request(app).post('/api/auth/register').send({ name: 'x', email: 'bad', password: 'Password123!' }).expect(400);
    await request(app).get('/api/projects').expect(401);
    await request(app).get('/api/projects').set({ Authorization: 'Bearer nonsense' }).expect(401);
  });

  test('only admins can change roles', async () => {
    await request(app).patch(`/api/users/${ids.member}/role`).set(as('manager')).send({ role: 'admin' }).expect(403);
    await request(app).patch(`/api/users/${ids.admin}/role`).set(as('admin')).send({ role: 'member' }).expect(400);
  });

  test('members cannot create projects; managers can', async () => {
    await request(app).post('/api/projects').set(as('member')).send({ name: 'Nope' }).expect(403);
    const res = await request(app).post('/api/projects').set(as('manager'))
      .send({ name: 'Launch', description: 'v1', memberIds: [ids.member] }).expect(201);
    ids.project = res.body.project.id;
    assert.equal(res.body.members.length, 2);
  });

  test('project visibility is limited to participants', async () => {
    const outsider = await request(app).get('/api/projects').set(as('outsider')).expect(200);
    assert.equal(outsider.body.projects.length, 0);
    await request(app).get(`/api/projects/${ids.project}`).set(as('outsider')).expect(403);
    const admin = await request(app).get('/api/projects').set(as('admin')).expect(200);
    assert.equal(admin.body.projects.length, 1);
  });

  test('full task CRUD with validation', async () => {
    await request(app).post('/api/tasks').set(as('manager')).send({ project_id: ids.project }).expect(400);
    await request(app).post('/api/tasks').set(as('manager'))
      .send({ project_id: ids.project, title: 'Invalid date', due_date: '2030-02-30' }).expect(400);
    await request(app).post('/api/tasks').set(as('manager'))
      .send({ project_id: ids.project, title: 'X', assignee_id: ids.outsider }).expect(400);
    await request(app).post('/api/tasks').set(as('member')).send({ project_id: ids.project, title: 'X' }).expect(403);

    const created = await request(app).post('/api/tasks').set(as('manager')).send({
      project_id: ids.project, title: 'Write docs', priority: 'high', assignee_id: ids.member, due_date: '2030-01-01',
    }).expect(201);
    ids.task = created.body.task.id;
    assert.equal(created.body.task.status, 'todo');
    assert.equal(created.body.task.assignee_name, 'member');

    const updated = await request(app).put(`/api/tasks/${ids.task}`).set(as('manager')).send({ title: 'Write API docs' }).expect(200);
    assert.equal(updated.body.task.title, 'Write API docs');
    await request(app).put(`/api/tasks/${ids.task}`).set(as('member')).send({ title: 'hack' }).expect(403);

    const list = await request(app).get(`/api/tasks?project_id=${ids.project}&q=API`).set(as('member')).expect(200);
    assert.equal(list.body.tasks.length, 1);
    await request(app).get(`/api/tasks/${ids.task}`).set(as('outsider')).expect(403);
  });

  test('workflow: member moves own task to review but cannot approve it', async () => {
    await request(app).patch(`/api/tasks/${ids.task}/status`).set(as('member')).send({ status: 'review' }).expect(422);
    await request(app).patch(`/api/tasks/${ids.task}/status`).set(as('member')).send({ status: 'in_progress' }).expect(200);
    await request(app).patch(`/api/tasks/${ids.task}/status`).set(as('member')).send({ status: 'review' }).expect(200);
    const denied = await request(app).patch(`/api/tasks/${ids.task}/status`).set(as('member')).send({ status: 'done' }).expect(422);
    assert.match(denied.body.error, /role \(member\)/);
  });

  test('workflow: manager rejects, then approves; history is recorded', async () => {
    await request(app).patch(`/api/tasks/${ids.task}/status`).set(as('manager')).send({ status: 'in_progress', note: 'Needs examples' }).expect(200);
    await request(app).patch(`/api/tasks/${ids.task}/status`).set(as('member')).send({ status: 'review' }).expect(200);
    await request(app).patch(`/api/tasks/${ids.task}/status`).set(as('manager')).send({ status: 'done' }).expect(200);
    const detail = await request(app).get(`/api/tasks/${ids.task}`).set(as('manager')).expect(200);
    assert.equal(detail.body.task.status, 'done');
    assert.deepEqual(detail.body.history.map((h) => h.to_status), ['todo', 'in_progress', 'review', 'in_progress', 'review', 'done']);
    assert.deepEqual(detail.body.allowed_transitions, ['in_progress']);
  });

  test('comments and dashboard stats', async () => {
    await request(app).post(`/api/tasks/${ids.task}/comments`).set(as('member')).send({ body: '' }).expect(400);
    const c = await request(app).post(`/api/tasks/${ids.task}/comments`).set(as('member')).send({ body: 'Done!' }).expect(201);
    assert.equal(c.body.comment.user_name, 'member');
    const stats = await request(app).get('/api/stats').set(as('manager')).expect(200);
    assert.equal(stats.body.total, 1);
    assert.equal(stats.body.byStatus.done, 1);
    assert.equal(stats.body.completionRate, 100);
  });

  test('delete task and project', async () => {
    await request(app).delete(`/api/tasks/${ids.task}`).set(as('member')).expect(403);
    await request(app).delete(`/api/tasks/${ids.task}`).set(as('manager')).expect(204);
    await request(app).get(`/api/tasks/${ids.task}`).set(as('manager')).expect(404);
    await request(app).delete(`/api/projects/${ids.project}`).set(as('member')).expect(403);
    await request(app).delete(`/api/projects/${ids.project}`).set(as('manager')).expect(204);
  });

  test('serves the web UI', async () => {
    const res = await request(app).get('/').expect(200);
    assert.match(res.text, /<title>TaskFlow/);
  });
});
