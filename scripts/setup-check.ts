import {inspectSetup} from './lib/setup-config.js';
const result=inspectSetup(process.env);
console.log(JSON.stringify(result,null,2));
if(!result.ready)process.exitCode=1;
