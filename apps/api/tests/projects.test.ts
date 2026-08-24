/**
 * Projects: the wants with no date on them, and the one thing that ties them back to the story —
 * finishing one can turn it into a memory.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureDatabase } from './support/database.js';

let server: Server;
let base = '';

type Session = { cookies: Map<string, string> };
const newSession = (): Session => ({ cookies: new Map() });

async function call(session: Session, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const csrf = session.cookies.get('tl_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;
  if (session.cookies.size) headers.cookie = [...session.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const [name, value] = (pair ?? '').split('=');
    if (name && value) session.cookies.set(name, value);
  }
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function signup(name: string): Promise<Session> {
  const session = newSession();
  const result = await call(session, 'POST', '/api/auth/signup', {
    email: `${name}-${randomUUID()}@test.local`,
    password: 'a-long-enough-password',
    displayName: name,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return session;
}

before(async () => {
  await ensureDatabase();
  await migrate();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

after(async () => {
  server?.close();
  await pool.end();
});

describe('projects', () => {
  it('keeps a want with no date, remembers whose idea it was, and orders by state', async () => {
    const user = await signup('Dreamer');
    await call(user, 'POST', '/api/couples', {});

    const someday = await call(user, 'POST', '/api/projects', {
      title: 'Go to Japan',
      type: 'trip',
      targetYear: 2028,
    });
    assert.equal(someday.status, 201);
    assert.equal(someday.body.project.type, 'trip', 'a project knows what kind of thing it is');
    assert.equal(someday.body.project.status, 'idea', 'a new project is a want until it is started');
    assert.equal(someday.body.project.targetYear, 2028);
    assert.equal(someday.body.project.author.displayName, 'Dreamer', 'whose idea it was');
    assert.equal(someday.body.project.eventId, null);
    assert.deepEqual(someday.body.project.steps, []);

    // No year at all is a real answer, not a missing one.
    const vague = await call(user, 'POST', '/api/projects', { title: 'Grow tomatoes' });
    assert.equal(vague.body.project.targetYear, null);
    assert.equal(vague.body.project.type, 'milestone', 'and a kind is not compulsory either');

    await call(user, 'POST', '/api/projects', { title: 'Repaint the kitchen', status: 'doing' });

    const listed = await call(user, 'GET', '/api/projects');
    // Underway first: the list is opened to see what is happening.
    assert.equal(listed.body.projects[0].title, 'Repaint the kitchen');
    // Then wants, soonest hope before 'someday'.
    assert.deepEqual(
      listed.body.projects.slice(1).map((p: { title: string }) => p.title),
      ['Go to Japan', 'Grow tomatoes'],
    );
  });

  it('ticks steps one at a time, and the first tick starts the project', async () => {
    const user = await signup('Ticker');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/projects', {
      title: 'Go to Japan',
      steps: ['Renew passports', 'Pick the dates', 'Book flights'],
    });
    const project = created.body.project;
    assert.equal(project.status, 'idea');
    assert.deepEqual(project.steps.map((s: { title: string }) => s.title), [
      'Renew passports',
      'Pick the dates',
      'Book flights',
    ]);
    assert.equal(project.steps.every((s: { done: boolean }) => !s.done), true);

    const first = await call(user, 'PATCH', `/api/projects/${project.id}/steps/${project.steps[0].id}`, {
      done: true,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.project.steps[0].done, true);
    // Ticking a step on a want is plainly starting it.
    assert.equal(first.body.project.status, 'doing');

    // Ticking every step must NOT finish it: finishing is a decision, and it is the decision that
    // can mint a memory.
    for (const step of project.steps.slice(1)) {
      await call(user, 'PATCH', `/api/projects/${project.id}/steps/${step.id}`, { done: true });
    }
    const all = await call(user, 'GET', '/api/projects');
    assert.equal(all.body.projects[0].status, 'doing');
    assert.equal(all.body.projects[0].steps.every((s: { done: boolean }) => s.done), true);

    // And unticking works, without demoting it back to a want.
    const untick = await call(user, 'PATCH', `/api/projects/${project.id}/steps/${project.steps[0].id}`, {
      done: false,
    });
    assert.equal(untick.body.project.steps[0].done, false);
    assert.equal(untick.body.project.status, 'doing');
  });

  it('keeps the ticks that survive an edit of the checklist', async () => {
    const user = await signup('Editor');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/projects', {
      title: 'Move house',
      steps: ['Find a place', 'Give notice', 'Hire a van'],
    });
    const project = created.body.project;
    await call(user, 'PATCH', `/api/projects/${project.id}/steps/${project.steps[0].id}`, { done: true });

    // One kept, one dropped, one added, one renamed — a single edit of the list.
    const edited = await call(user, 'PATCH', `/api/projects/${project.id}`, {
      steps: ['Find a place', 'Hire a big van', 'Pack the kitchen'],
    });
    assert.equal(edited.status, 200);
    const steps = edited.body.project.steps as { title: string; done: boolean }[];
    assert.deepEqual(steps.map((s) => s.title), ['Find a place', 'Hire a big van', 'Pack the kitchen']);
    // Matched by wording, which is the only identity a list of strings carries.
    assert.equal(steps[0]!.done, true, 'a step that survived keeps its tick');
    assert.equal(steps[1]!.done, false, 'a renamed step is a new step');
    assert.equal(steps[2]!.done, false);

    // Duplicates and blanks are not steps.
    const cleaned = await call(user, 'PATCH', `/api/projects/${project.id}`, {
      steps: ['One', '  ', 'One', 'Two'],
    });
    assert.deepEqual((cleaned.body.project.steps as { title: string }[]).map((s) => s.title), ['One', 'Two']);
  });

  it('turns a finished project into a memory on the timeline, in one go', async () => {
    const user = await signup('Finisher');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/projects', {
      title: 'Learn to dive',
      type: 'celebration',
      notes: 'Both of us, properly certified.',
      status: 'doing',
    });
    const id = created.body.project.id;

    const done = await call(user, 'POST', `/api/projects/${id}/complete`, { eventDate: '2026-05-05' });
    assert.equal(done.status, 200);
    assert.equal(done.body.project.status, 'done');
    // The date they gave, not the moment they tapped: saying "we did it in May" means it was
    // finished in May.
    assert.ok(done.body.project.completedAt, 'a finished project records when');
    assert.equal(String(done.body.project.completedAt).slice(0, 10), '2026-05-05');
    assert.ok(done.body.project.eventId, 'and which memory it became');

    // A real event like any other: on the timeline, in search, in the export.
    const event = await call(user, 'GET', `/api/events/${done.body.project.eventId}`);
    assert.equal(event.status, 200);
    assert.equal(event.body.event.title, 'Learn to dive');
    assert.equal(event.body.event.description, 'Both of us, properly certified.');
    assert.equal(event.body.event.eventDate, '2026-05-05');
    // The memory takes the project's kind rather than a hardcoded one — the whole reason a project
    // carries a type at all.
    assert.equal(event.body.event.type, 'celebration');
    assert.equal((await call(user, 'GET', '/api/search?q=dive')).body.total, 1);

    // Finishing twice — a re-tap, or finished, reopened and finished again — must not put a second
    // copy on the story.
    const again = await call(user, 'POST', `/api/projects/${id}/complete`, {});
    assert.equal(again.status, 200);
    assert.equal(again.body.project.eventId, done.body.project.eventId);
    assert.equal((await call(user, 'GET', '/api/events?scope=all')).body.total, 1);
  });

  it('always makes a memory, because that is what done means here', async () => {
    const user = await signup('Milestone');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/projects', { title: 'Fix the tap', status: 'doing' });

    // No flag, no choice: a project marked done happened, and a thing that happened is a memory.
    const done = await call(user, 'POST', `/api/projects/${created.body.project.id}/complete`, {});
    assert.equal(done.body.project.status, 'done');
    assert.ok(done.body.project.eventId);
    assert.equal((await call(user, 'GET', '/api/events?scope=all')).body.total, 1);
  });

  it('carries a changed kind through to the memory', async () => {
    const user = await signup('Reclassifier');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/projects', { title: 'Nosy Be', type: 'milestone' });
    const id = created.body.project.id;

    const retyped = await call(user, 'PATCH', `/api/projects/${id}`, { type: 'trip' });
    assert.equal(retyped.body.project.type, 'trip');

    const done = await call(user, 'POST', `/api/projects/${id}/complete`, {});
    const event = await call(user, 'GET', `/api/events/${done.body.project.eventId}`);
    assert.equal(event.body.event.type, 'trip');
  });

  it('stamps a closing date even when it is written down already closed', async () => {
    const user = await signup('Retrospective');
    await call(user, 'POST', '/api/couples', {});

    // A want they had and settled before this list existed. Closed always means a closing date,
    // however the row got there.
    const gone = await call(user, 'POST', '/api/projects', { title: 'Move to Paris', status: 'cancelled' });
    assert.equal(gone.status, 201);
    assert.ok(gone.body.project.completedAt);

    const open = await call(user, 'POST', '/api/projects', { title: 'Still wanted' });
    assert.equal(open.body.project.completedAt, null, 'and an open one has none');
  });

  it('lets a project be let go, and wanted again', async () => {
    const user = await signup('Realist');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/projects', { title: 'Move to Paris', targetYear: 2027 });
    const id = created.body.project.id;

    // Letting go is not removing: deciding against something is part of the story.
    const gone = await call(user, 'PATCH', `/api/projects/${id}`, { status: 'cancelled' });
    assert.equal(gone.status, 200);
    assert.equal(gone.body.project.status, 'cancelled');
    assert.ok(gone.body.project.completedAt, 'closing stamps the moment, whichever way it closed');
    assert.equal(gone.body.project.eventId, null, 'and never puts it on the timeline');
    assert.equal((await call(user, 'GET', '/api/events?scope=all')).body.total, 0);

    // It is still on the list, last.
    const listed = await call(user, 'GET', '/api/projects');
    assert.equal(listed.body.projects.length, 1);
    assert.equal(listed.body.projects[0].status, 'cancelled');

    // Wanting it again reopens it, and clears the closing date.
    const back = await call(user, 'PATCH', `/api/projects/${id}`, { status: 'idea' });
    assert.equal(back.body.project.status, 'idea');
    assert.equal(back.body.project.completedAt, null);
  });

  it('pushes a project back a year, from what is stored', async () => {
    const user = await signup('Postponer');
    await call(user, 'POST', '/api/couples', {});
    const next = new Date().getFullYear() + 1;
    const created = await call(user, 'POST', '/api/projects', { title: 'Go to Japan', targetYear: next });
    const id = created.body.project.id;

    const moved = await call(user, 'POST', `/api/projects/${id}/postpone`, {});
    assert.equal(moved.status, 200);
    assert.equal(moved.body.project.targetYear, next + 1);

    // Computed server-side from the stored year, so two taps are two years and not a lost update.
    await call(user, 'POST', `/api/projects/${id}/postpone`, {});
    assert.equal((await call(user, 'GET', '/api/projects')).body.projects[0].targetYear, next + 2);

    // Pushing back something closed wants it again: you cannot postpone what you already finished.
    await call(user, 'PATCH', `/api/projects/${id}`, { status: 'cancelled' });
    const revived = await call(user, 'POST', `/api/projects/${id}/postpone`, {});
    assert.equal(revived.body.project.status, 'idea');
    assert.equal(revived.body.project.completedAt, null);

    // A project with no year is already "someday" and has nothing to push.
    const vague = await call(user, 'POST', '/api/projects', { title: 'Grow tomatoes' });
    assert.equal(
      (await call(user, 'POST', `/api/projects/${vague.body.project.id}/postpone`, {})).status,
      400,
    );

    // A stale year is dragged to this one rather than staying in the past.
    const old = await call(user, 'POST', '/api/projects', { title: 'Old hope', targetYear: 2001 });
    const dragged = await call(user, 'POST', `/api/projects/${old.body.project.id}/postpone`, {});
    assert.equal(dragged.body.project.targetYear, new Date().getFullYear());
  });

  it('is one couple\'s list and never another\'s', async () => {
    const owner = await signup('Owner');
    await call(owner, 'POST', '/api/couples', {});
    const created = await call(owner, 'POST', '/api/projects', {
      title: 'A private plan',
      steps: ['Only ours'],
    });
    const id = created.body.project.id;
    const stepId = created.body.project.steps[0].id;

    const outsider = await signup('Outsider');
    await call(outsider, 'POST', '/api/couples', {});

    assert.equal((await call(outsider, 'GET', '/api/projects')).body.projects.length, 0);
    assert.equal((await call(outsider, 'PATCH', `/api/projects/${id}`, { title: 'Mine now' })).status, 404);
    assert.equal((await call(outsider, 'DELETE', `/api/projects/${id}`)).status, 404);
    assert.equal((await call(outsider, 'POST', `/api/projects/${id}/complete`, {})).status, 404);
    assert.equal((await call(outsider, 'POST', `/api/projects/${id}/postpone`, {})).status, 404);
    assert.equal(
      (await call(outsider, 'PATCH', `/api/projects/${id}/steps/${stepId}`, { done: true })).status,
      404,
    );

    // Untouched by all of that.
    const mine = await call(owner, 'GET', '/api/projects');
    assert.equal(mine.body.projects[0].title, 'A private plan');
    assert.equal(mine.body.projects[0].steps[0].done, false);
  });

  it('removes a project without touching the memory it became', async () => {
    const user = await signup('Remover');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/projects', { title: 'Plant a tree', status: 'doing' });
    const done = await call(user, 'POST', `/api/projects/${created.body.project.id}/complete`, {});
    const eventId = done.body.project.eventId;

    const removed = await call(user, 'DELETE', `/api/projects/${created.body.project.id}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.projects, [], 'the remaining list comes back');

    // The memory is a memory now. Deleting the plan that led to it must not delete the thing that
    // happened.
    assert.equal((await call(user, 'GET', `/api/events/${eventId}`)).status, 200);
  });

  it('needs a session and a relationship', async () => {
    assert.equal((await fetch(`${base}/api/projects`)).status, 401);
    const alone = await signup('Alone');
    assert.equal((await call(alone, 'GET', '/api/projects')).status, 403);
  });

  it('refuses a project with no name, and a target that is not a year', async () => {
    const user = await signup('Sloppy');
    await call(user, 'POST', '/api/couples', {});
    assert.equal((await call(user, 'POST', '/api/projects', { title: '   ' })).status, 400);
    assert.equal((await call(user, 'POST', '/api/projects', { title: 'x', targetYear: 20260 })).status, 400);
    assert.equal((await call(user, 'POST', '/api/projects', { title: 'x', status: 'maybe' })).status, 400);
    assert.equal((await call(user, 'POST', '/api/projects', { title: 'x', type: 'wedding' })).status, 400);
  });
});
