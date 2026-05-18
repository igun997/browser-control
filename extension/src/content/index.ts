import { registerInspectHandler } from './domInspect.js';
import { registerActionsHandler } from './domActions.js';
import { registerPickerHandler } from './inspectPicker.js';

console.log('browser-controls content loaded');

registerInspectHandler();
registerActionsHandler();
registerPickerHandler();