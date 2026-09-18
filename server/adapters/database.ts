import postgres from 'postgres';
let client: ReturnType<typeof postgres> | undefined;
export function openDatabase(url: string) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('INVALID_DATABASE_PROTOCOL');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  return postgres(url, { max:1, prepare:false, connect_timeout:8, idle_timeout:20,
    ssl:local ? false : { rejectUnauthorized:true }, onnotice:() => undefined });
}
export function getAppDatabase() {
  if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL_NOT_CONFIGURED');
  client ??= openDatabase(process.env.APP_DATABASE_URL);
  return client;
}
