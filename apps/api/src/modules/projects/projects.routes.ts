/**
 * Projects, and the checklists inside them.
 *
 * Everything is couple-scoped from the session like the rest of the API, so an id from another
 * relationship is a 404 rather than a check anyone had to remember to write.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireCouple } from '../../middleware/coupleContext.js';
import { requireUser, verifyCsrf } from '../../middleware/session.js';
import { valid, validate } from '../../middleware/validate.js';
import { notify } from '../realtime/notify.js';
import * as service from './projects.service.js';

export const projectsRouter = Router();
projectsRouter.use(requireUser, requireCouple);

const idParam = z.object({ id: z.string().uuid() });
const stepParams = z.object({ id: z.string().uuid(), stepId: z.string().uuid() });

const bodySchema = z.object({
  title: z.string().trim().min(1, 'Give it a name').max(140),
  notes: z.string().trim().max(2000).nullish(),
  status: z.enum(['idea', 'doing', 'done']).optional(),
  /**
   * A year, or null for "someday". Bounded rather than open: a target of 20260 is a typo, and a
   * target in the past is a hope that has already gone by, which the list is allowed to show.
   */
  targetYear: z.coerce.number().int().min(1900).max(2200).nullish(),
  /**
   * The whole checklist, in the order it should read. Sent as a list because that is how it is
   * edited — two renamed, one gone, one added, in a single go.
   *
   * Blanks are permitted here and dropped by the service, rather than rejected. The list is typed
   * one-per-line in a textarea, so a trailing newline is the normal case, and answering a blank line
   * with a 400 would be refusing input the server already knows exactly what to do with.
   */
  steps: z.array(z.string().trim().max(200)).max(40).optional(),
});

const patchSchema = bodySchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

projectsRouter.get('/projects', async (req, res) => {
  res.json({ projects: await service.listProjects(req.couple!.id) });
});

projectsRouter.post('/projects', verifyCsrf, validate(bodySchema), async (req, res) => {
  const project = await service.createProject(req.couple!.id, req.user!.id, req.body);
  await notify(req, 'project.changed', project.id);
  res.status(201).json({ project });
});

projectsRouter.patch(
  '/projects/:id',
  verifyCsrf,
  validate(idParam, 'params'),
  validate(patchSchema),
  async (req, res) => {
    const project = await service.updateProject(
      req.couple!.id,
      valid<{ id: string }>(req, 'params').id,
      req.body,
    );
    await notify(req, 'project.changed', project.id);
    res.json({ project });
  },
);

projectsRouter.delete('/projects/:id', verifyCsrf, validate(idParam, 'params'), async (req, res) => {
  const { id } = valid<{ id: string }>(req, 'params');
  await service.deleteProject(req.couple!.id, id);
  await notify(req, 'project.changed', id);
  // The remaining list, so the screen that called this does not have to ask again — the same reason
  // deleting a yearly date answers with one.
  res.json({ projects: await service.listProjects(req.couple!.id) });
});

/**
 * Ticking a step. Narrow on purpose: this is the action that happens constantly, and sending the
 * whole checklist back to record one tick would be both slower and a chance to lose a concurrent
 * edit the other person just made.
 */
projectsRouter.patch(
  '/projects/:id/steps/:stepId',
  verifyCsrf,
  validate(stepParams, 'params'),
  validate(z.object({ done: z.boolean() })),
  async (req, res) => {
    const { id, stepId } = valid<{ id: string; stepId: string }>(req, 'params');
    const project = await service.setStepDone(
      req.couple!.id,
      id,
      stepId,
      valid<{ done: boolean }>(req, 'body').done,
    );
    await notify(req, 'project.changed', project.id);
    res.json({ project });
  },
);

/**
 * Finishing, which can put it on the timeline in the same commit.
 *
 * The date is optional and defaults to today: most projects are marked done when they are done. A
 * date is accepted because the "we finally did it" moment is often remembered a week later.
 */
projectsRouter.post(
  '/projects/:id/complete',
  verifyCsrf,
  validate(idParam, 'params'),
  validate(
    z.object({
      becomeMemory: z.boolean().optional(),
      eventDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
        .optional(),
    }),
  ),
  async (req, res) => {
    const { id } = valid<{ id: string }>(req, 'params');
    const body = valid<{ becomeMemory?: boolean; eventDate?: string }>(req, 'body');
    const { project, eventId } = await service.completeProject(req.couple!.id, req.user!.id, id, body);

    await notify(req, 'project.changed', project.id);
    // A new memory is a change to the story too, and the other screen has to place it.
    if (eventId) await notify(req, 'event.created', eventId);

    res.json({ project });
  },
);
