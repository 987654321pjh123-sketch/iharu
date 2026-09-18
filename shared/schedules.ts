import {z} from 'zod';
import {id,version} from './family.js';

export const localDate=z.iso.date();
export const localTime=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const holidayPolicy=z.enum(['KEEP','SKIP','ASK']);
const days=z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v=>new Set(v).size===v.length);
const fields={title:z.string().trim().min(1).max(80),place:z.string().trim().max(120),startTime:localTime,endTime:localTime,holidayPolicy};
export const scheduleInput=z.object({...fields,date:localDate,untilDate:localDate,frequency:z.enum(['ONCE','WEEKLY']),weekdays:days,makeupForOccurrenceId:id.optional()}).strict().refine(v=>v.endTime>v.startTime,'종료 시각은 시작 시각보다 늦어야 해요.');
export const changesSchema=z.object({...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.optional()])) as {[K in keyof typeof fields]:z.ZodOptional<(typeof fields)[K]>},date:localDate.optional(),untilDate:localDate.optional(),weekdays:days.optional(),cancelled:z.boolean().optional(),reason:z.string().trim().min(1).max(160).optional()}).strict().refine(v=>Object.keys(v).length>0);
export const changeInput=z.object({scope:z.enum(['ONE','FUTURE']),changes:changesSchema,effectiveDate:localDate,expectedVersion:version,laterVersions:z.enum(['KEEP','REPLACE']).optional()}).strict();
export const applyChangeInput=changeInput.extend({previewToken:id});
export const decisionInput=z.object({decision:z.enum(['KEEP','SKIP']),expectedVersion:version}).strict();
export const closureInput=z.object({from:localDate,to:localDate,kind:z.enum(['BREAK','VACATION']),reason:z.string().trim().min(1).max(80),expectedVersion:version}).strict();
export const rangeInput=z.object({from:localDate,to:localDate,childId:id.optional(),cursor:id.optional(),limit:z.coerce.number().int().min(1).max(50).default(50)}).strict().refine(v=>v.to>=v.from&&(Date.parse(v.to)-Date.parse(v.from))/86400000<56,'조회 기간은 최대 56일이에요.');
export const occurrenceSchema=z.object({id,seriesId:id,childId:id,childName:z.string(),date:localDate,anchorDate:localDate,title:z.string(),place:z.string(),startTime:localTime,endTime:localTime,startsAt:z.string(),endsAt:z.string(),status:z.enum(['SCHEDULED','NEEDS_CONFIRMATION','SKIPPED','CANCELLED']),reason:z.string().nullable(),holidayNames:z.array(z.string()),holidayState:z.enum(['READY','UNKNOWN','STALE']),override:z.boolean(),locked:z.boolean(),makeupForOccurrenceId:id.nullable(),version,resourceVersion:version,allowedActions:z.array(z.string()),missingAttendanceSuppressed:z.boolean()});
export const holidayYearSchema=z.object({year:z.number(),state:z.enum(['READY','UNKNOWN','STALE']),version,lastSuccessAt:z.string().nullable()});
export const calendarResponse=z.object({occurrences:z.array(occurrenceSchema),nextCursor:id.nullable(),dayCounts:z.array(z.object({date:localDate,count:z.number(),active:z.number()})),holidays:z.array(z.object({date:localDate,name:z.string()})),holidayYears:z.array(holidayYearSchema),serverToday:localDate,horizonEnd:localDate,serverNow:z.string()});
export const scheduleChildrenResponse=z.object({children:z.array(z.object({id,nickname:z.string()})),serverToday:localDate});
export const seriesSchema=z.object({id,childId:id,childName:z.string(),resourceVersion:version,fromDate:localDate,untilDate:localDate,versions:z.array(z.object({fromDate:localDate,untilDate:localDate,...fields,frequency:z.enum(['ONCE','WEEKLY']),weekdays:days})),closures:z.array(z.object({id,from:localDate,to:localDate,kind:z.enum(['BREAK','VACATION']),reason:z.string()}))});
export const seriesResponse=z.object({series:z.array(seriesSchema),nextCursor:id.nullable()});
export const previewResponse=z.object({previewToken:id,expiresAt:z.string(),affected:z.number(),preservedExceptions:z.number(),protectedOccurrences:z.number(),laterVersions:z.number(),overlaps:z.number(),requiresLaterChoice:z.boolean(),resourceVersion:version});
export type ScheduleInput=z.infer<typeof scheduleInput>;
export type ChangeInput=z.infer<typeof changeInput>;
export type Occurrence=z.infer<typeof occurrenceSchema>;
export type CalendarData=z.infer<typeof calendarResponse>;
export type ScheduleSeries=z.infer<typeof seriesSchema>;
export type ChangePreview=z.infer<typeof previewResponse>;
export function koreaToday(now=new Date()){return new Date(now.getTime()+9*3600000).toISOString().slice(0,10);}
export function addDays(date:string,days:number){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
