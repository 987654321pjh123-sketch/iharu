import postgres from 'postgres';
import { databaseConnectionOptions } from './database-tls.js';
let client: ReturnType<typeof postgres> | undefined;
export function openDatabase(url: string) {
  const options = databaseConnectionOptions(url);
  return postgres(options.connectionString, { max:1, prepare:false, connect_timeout:8, idle_timeout:20,
    ssl:options.ssl, onnotice:() => undefined });
}
export function getAppDatabase() {
  if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL_NOT_CONFIGURED');
  client ??= openDatabase(process.env.APP_DATABASE_URL);
  return client;
}
