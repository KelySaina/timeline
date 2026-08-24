/**
 * Projects: the things they mean to do, which have no date yet.
 *
 * Three decisions worth writing down.
 *
 * **Status is stored, not derived from the steps.** A project with no steps still has a state, and
 * one with two of five steps ticked might be paused rather than underway. Ticking the first step
 * does promote an idea to `doing`, because that is plainly what has happened — but nothing ever
 * auto-completes: finishing is a deliberate act, and it is the act that can mint a memory.
 *
 * **Finishing can create the memory, here, in one transaction.** The alternative — mark it done,
 * then open the composer, then link them — leaves a window where the project is finished and the
 * story does not know. Doing both under one commit means `event_id` is never a promise.
 *
 * **Steps are replaced wholesale, not patched individually.** A checklist is edited as a list: two
 * renamed, one deleted, one added, all in one go. Per-step endpoints would turn that into five
 * round trips that can half-fail, and the ticking — the thing that happens constantly — gets its
 * own narrow endpoint precisely because it must be instant and cannot afford the whole list.
 */
import type { PoolClient } from 'pg';
import { query, queryOne, transaction } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { todayIso } from '../../lib/dates.js';
import type { EventType } from '../events/events.types.js';

export type ProjectStatus = 'idea' | 'doing' | 'done' | 'cancelled';

export type ProjectStep = { id: string; title: string; done: boolean };

export type Project = {
  id: string;
  /** The same nine kinds a memory has: this is what the finished project becomes. */
  type: EventType;
  title: string;
  notes: string | null;
  status: ProjectStatus;
  /** A hope, never a deadline. Null is "someday", which is a real answer. */
  targetYear: number | null;
  author: { id: string; displayName: string };
  /** When it closed, finished or let go. Null while it is still open. */
  completedAt: string | null;
  /** The memory this became, when it was finished into one. */
  eventId: string | null;
  steps: ProjectStep[];
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  type: EventType;
  title: string;
  notes: string | null;
  status: ProjectStatus;
  target_year: number | null;
  author_id: string;
  author_name: string;
  completed_at: string | null;
  event_id: string | null;
  steps: ProjectStep[] | null;
  created_at: string;
  updated_at: string;
};

const SELECT = `
  select p.id, p.type, p.title, p.notes, p.status, p.target_year, p.completed_at, p.event_id,
         p.created_at, p.updated_at,
         u.id as author_id, u.display_name as author_name,
         coalesce((
           select json_agg(json_build_object('id', s.id, 'title', s.title,
                                             'done', s.done_at is not null)
                           order by s.position, s.created_at)
             from project_steps s where s.project_id = p.id
         ), '[]'::json) as steps
    from projects p
    join users u on u.id = p.created_by`;

const toProject = (row: Row): Project => ({
  id: row.id,
  type: row.type,
  title: row.title,
  notes: row.notes,
  status: row.status,
  targetYear: row.target_year,
  author: { id: row.author_id, displayName: row.author_name },
  completedAt: row.completed_at,
  eventId: row.event_id,
  steps: row.steps ?? [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listProjects(coupleId: string): Promise<Project[]> {
  const rows = await query<Row>(
    `${SELECT}
      where p.couple_id = $1
      order by
        -- Underway first, then wants, then what is behind them. Reading order, not creation order:
        -- the list is opened to see what is happening, and finished projects are a record.
        case p.status
          when 'doing' then 0
          when 'idea' then 1
          when 'done' then 2
          else 3
        end,
        -- Within a status, the soonest hope first and 'someday' last.
        p.target_year nulls last,
        p.created_at desc`,
    [coupleId],
  );
  return rows.map(toProject);
}

export async function getProject(coupleId: string, id: string): Promise<Project> {
  const row = await queryOne<Row>(`${SELECT} where p.id = $2 and p.couple_id = $1`, [coupleId, id]);
  if (!row) throw notFound('That project is not on your list');
  return toProject(row);
}

export type ProjectInput = {
  type?: EventType;
  title: string;
  notes?: string | null;
  status?: ProjectStatus;
  targetYear?: number | null;
  steps?: string[];
};

/** Rewrite one project's checklist. Positions come from the order given, which is what the UI shows. */
async function replaceSteps(
  client: PoolClient,
  coupleId: string,
  projectId: string,
  titles: string[],
): Promise<void> {
  /*
   * Which steps were already ticked has to survive an edit of the list. Matched by title, because
   * that is the only identity a plain list of strings carries — so renaming a step loses its tick,
   * which is the right trade: a renamed step is usually a different step.
   */
  const done = new Set(
    (
      await client.query<{ title: string }>(
        'select title from project_steps where project_id = $1 and done_at is not null',
        [projectId],
      )
    ).rows.map((row) => row.title),
  );

  await client.query('delete from project_steps where project_id = $1', [projectId]);

  const clean = [...new Set(titles.map((t) => t.trim()).filter(Boolean))].slice(0, 40);
  for (const [index, title] of clean.entries()) {
    await client.query(
      `insert into project_steps (project_id, couple_id, title, position, done_at)
       values ($1, $2, $3, $4, $5)`,
      [projectId, coupleId, title, index, done.has(title) ? new Date().toISOString() : null],
    );
  }
}

export async function createProject(
  coupleId: string,
  userId: string,
  input: ProjectInput,
): Promise<Project> {
  const id = await transaction(async (client) => {
    const created = await client.query<{ id: string }>(
      `insert into projects (couple_id, created_by, type, title, notes, status, target_year,
                             completed_at)
       values ($1, $2, coalesce($7, 'milestone'), $3, $4, coalesce($5, 'idea'), $6,
               -- Written down already closed — a want they had and settled before the list existed.
               -- Closed always means a closing date, however the row got there, or the record has a
               -- state with no moment attached to it.
               case when $5 in ('done', 'cancelled') then now() end) returning id`,
      [
        coupleId,
        userId,
        input.title.trim(),
        input.notes?.trim() || null,
        input.status ?? null,
        input.targetYear ?? null,
        input.type ?? null,
      ],
    );
    const projectId = created.rows[0]!.id;
    if (input.steps?.length) await replaceSteps(client, coupleId, projectId, input.steps);
    return projectId;
  });
  return getProject(coupleId, id);
}

export async function updateProject(
  coupleId: string,
  id: string,
  patch: Partial<ProjectInput>,
): Promise<Project> {
  await getProject(coupleId, id);
  await transaction(async (client) => {
    await client.query(
      `update projects
          set type        = coalesce($9, type),
              title       = coalesce($3, title),
              notes       = case when $4::boolean then $5::text else notes end,
              status      = coalesce($6, status),
              target_year = case when $7::boolean then $8::integer else target_year end,
              -- Closing it either way stamps the moment; reopening clears it, so the record never
              -- claims a closing date for something that is open again. The memory a finished
              -- project made is left alone: that happened.
              completed_at = case
                when $6 is null then completed_at
                when $6 in ('done', 'cancelled') then coalesce(completed_at, now())
                else null
              end,
              updated_at  = now()
        where id = $2 and couple_id = $1`,
      [
        coupleId,
        id,
        patch.title?.trim() ?? null,
        patch.notes !== undefined,
        patch.notes?.trim() ?? null,
        patch.status ?? null,
        patch.targetYear !== undefined,
        patch.targetYear ?? null,
        patch.type ?? null,
      ],
    );
    if (patch.steps !== undefined) await replaceSteps(client, coupleId, id, patch.steps);
  });
  return getProject(coupleId, id);
}

export async function deleteProject(coupleId: string, id: string): Promise<void> {
  const rows = await query<{ id: string }>(
    'delete from projects where id = $1 and couple_id = $2 returning id',
    [id, coupleId],
  );
  // Hard delete, unlike a memory. A project is a plan rather than a record of something that
  // happened, and there is nothing to recover — the memory it may have become is untouched.
  if (rows.length === 0) throw notFound('That project is not on your list');
}

/**
 * Push a project back a year.
 *
 * A one-tap action rather than a trip through the form, because this is the commonest edit a
 * dateless list ever gets: the year arrives, the thing did not happen, and it is still wanted. A
 * project with no target year has nothing to push back — it is already "someday" — so the caller is
 * told rather than silently given one.
 */
export async function postponeProject(coupleId: string, id: string): Promise<Project> {
  const project = await getProject(coupleId, id);
  if (project.targetYear === null) {
    throw badRequest('That one has no year on it — it is already someday');
  }
  await query(
    `update projects
        set target_year = greatest(target_year + 1, extract(year from now())::integer),
            -- Pushed back means still wanted, so a closed project comes back open. Nothing else
            -- would make sense: you cannot postpone something you already finished.
            status = case when status in ('done', 'cancelled') then 'idea' else status end,
            completed_at = case when status in ('done', 'cancelled') then null else completed_at end,
            updated_at = now()
      where id = $2 and couple_id = $1`,
    [coupleId, id],
  );
  return getProject(coupleId, id);
}

/**
 * Tick or untick one step.
 *
 * Its own endpoint because this is the action that happens constantly, and it must not require
 * sending the whole checklist back. Ticking the first step of an idea promotes it to `doing` — that
 * is plainly what has happened — but nothing here ever completes a project, however many steps are
 * ticked: finishing is a decision, and it is the decision that can mint a memory.
 */
export async function setStepDone(
  coupleId: string,
  projectId: string,
  stepId: string,
  done: boolean,
): Promise<Project> {
  const rows = await query<{ id: string }>(
    `update project_steps set done_at = case when $4::boolean then now() else null end
      where id = $3 and project_id = $2 and couple_id = $1 returning id`,
    [coupleId, projectId, stepId, done],
  );
  if (rows.length === 0) throw notFound('That step is not on this project');

  if (done) {
    await query(
      "update projects set status = 'doing', updated_at = now() where id = $2 and couple_id = $1 and status = 'idea'",
      [coupleId, projectId],
    );
  }
  return getProject(coupleId, projectId);
}

/**
 * Finish a project, which puts it on the timeline.
 *
 * Not a choice. Marking a project done is saying it happened, and a thing that happened to the two
 * of them is a memory — that is the whole premise of the app. Offering "or not" would be offering
 * to record a milestone nowhere.
 *
 * Done in one transaction so `event_id` is never a promise, and idempotent: finishing something
 * already finished returns what is there rather than minting a second memory for one event.
 */
export async function completeProject(
  coupleId: string,
  userId: string,
  id: string,
  options: { eventDate?: string } = {},
): Promise<Project> {
  const project = await getProject(coupleId, id);

  await transaction(async (client) => {
    // Already a memory: this is a re-tap, or a project finished, reopened and finished again. The
    // event it made stands, and a second one would be a duplicate on the story.
    let eventId = project.eventId;

    if (!eventId) {
      const row = await client.query<{ id: string }>(
        `insert into events (couple_id, created_by, type, title, description, event_date)
         values ($1, $2, $6, $3, $4, $5) returning id`,
        [coupleId, userId, project.title, project.notes, options.eventDate ?? todayIso(), project.type],
      );
      eventId = row.rows[0]!.id;
    }

    await client.query(
      `update projects
          set status = 'done',
              -- The date given for the memory, when one was given: if they say they did it in
              -- January, the project was finished in January. Falling back to now() covers the
              -- ordinary case of marking something done the day it happened.
              completed_at = coalesce(completed_at, $4::date::timestamptz, now()),
              event_id = $3, updated_at = now()
        where id = $2 and couple_id = $1`,
      [coupleId, id, eventId, options.eventDate ?? null],
    );
  });

  return getProject(coupleId, id);
}
