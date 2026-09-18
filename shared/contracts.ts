import { z } from 'zod';

export const childIdSchema = z.enum(['all', 'demo-seoyun', 'demo-doyun']);
export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const dashboardQuerySchema = z.object({
  child: childIdSchema.default('all'), month: monthSchema.default('2026-09'),
});
const childSchema = z.object({ id: z.enum(['demo-seoyun', 'demo-doyun']), name: z.string(), grade: z.string(), color: z.enum(['mint', 'peach']) });
const eventSchema = z.object({
  id: z.string(), childId: z.string(), date: z.string(), start: z.string(), end: z.string(),
  title: z.string(), place: z.string(), kind: z.enum(['school', 'academy']),
  status: z.enum(['completed', 'upcoming', 'check']),
});
const tuitionSchema = z.object({ childId: z.string(), title: z.string(), amount: z.number().int().nonnegative(), paid: z.boolean() });
export const dashboardSchema = z.object({
  sampleDate: z.literal('2026-09-17'), children: z.array(childSchema), events: z.array(eventSchema),
  holidays: z.array(z.object({ date: z.string(), title: z.string() })), tuition: z.array(tuitionSchema),
});
export const healthSchema = z.object({
  status: z.literal('ok'), phase: z.literal('P03'), demoEnabled: z.boolean(),
  environment: z.enum(['local', 'preview', 'production']),
});
export const envelope = <T extends z.ZodType>(data: T) => z.object({
  data, meta: z.object({ requestId: z.string(), serverNow: z.iso.datetime(), source: z.enum(['system', 'demo']) }),
});
export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }), requestId: z.string() });
export type Dashboard = z.infer<typeof dashboardSchema>;
export type Child = Dashboard['children'][number];
export type ScheduleEvent = Dashboard['events'][number];
export type ChildFilter = z.infer<typeof childIdSchema>;
export type Health = z.infer<typeof healthSchema>;
