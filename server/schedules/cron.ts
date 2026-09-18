import {Hono} from 'hono';
import {timingSafeEqual} from 'node:crypto';
import {getScheduleWorker,runScheduleMaintenance} from './worker.js';
export function scheduleCron(){
 const app=new Hono();
 app.get('/api/internal/schedule-maintenance',async c=>{
  const secret=process.env.CRON_SECRET,provided=c.req.header('Authorization')||'';
  const expected=Buffer.from(`Bearer ${secret||''}`),actual=Buffer.from(provided);
  if(!secret||secret.length<32||actual.length!==expected.length||!timingSafeEqual(actual,expected))return c.json({error:{code:'AUTH_REQUIRED'}},401);
  const db=await getScheduleWorker();if(!db)return c.json({error:{code:'WORKER_NOT_CONFIGURED'}},503);
  try{return c.json(await runScheduleMaintenance(db,process.env.HOLIDAY_API_KEY));}
  catch{console.error('SCHEDULE_MAINTENANCE_FAILED');return c.json({error:{code:'MAINTENANCE_FAILED'}},503);}
 });return app;
}
