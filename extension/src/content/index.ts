import { registerInspectHandler } from './domInspect.js';
import { registerActionsHandler } from './domActions.js';

console.log('browser-controls content loaded');

registerInspectHandler();
registerActionsHandler();