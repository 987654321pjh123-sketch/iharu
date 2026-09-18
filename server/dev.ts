import { serve } from '@hono/node-server';
import { createApp } from './app.js';
serve({ fetch:createApp().fetch, hostname:'127.0.0.1', port:8787 }, () => console.log('아이하루 API http://127.0.0.1:8787'));
