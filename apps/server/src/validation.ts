import { z } from 'zod';

export const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const title = z.string().trim().min(1).max(200);
export const createTask = z.object({
  title,
  assignedToId: id,
  plantId: id.optional(),
  candidateSiteId: id.optional()
}).strict().refine(body => Number(!!body.plantId) + Number(!!body.candidateSiteId) === 1, {
  message: 'Provide exactly one of plantId or candidateSiteId'
});
export const patchTask = z.object({
  version: z.number().int().positive(),
  title: title.optional(),
  assignedToId: id.optional(),
  status: z.enum(['pending', 'in_progress', 'cancelled']).optional()
}).strict().refine(body => body.title !== undefined || body.assignedToId !== undefined || body.status !== undefined, {
  message: 'Provide a change in addition to version'
});
export const createReport = z.object({
  taskId: id,
  version: z.number().int().positive(),
  notes: z.string().trim().min(1).max(4000)
}).strict();
export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
}).strict();
export const plantQuery = listQuery.extend({ condition: z.enum(['good', 'needs_care', 'unknown']).optional() });
export const taskQuery = listQuery.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
