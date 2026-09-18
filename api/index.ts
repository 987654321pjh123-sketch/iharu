import { createApp } from '../server/app.js';
const app = createApp();
export default { fetch: app.fetch };
