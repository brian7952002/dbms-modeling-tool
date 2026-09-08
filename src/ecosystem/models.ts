import { registerModel } from './registry';
import { eerModel } from '../models/eer';
import { instanceModel } from '../models/instance';

/**
 * The ecosystem's contents. Adding the logical or physical model means writing
 * a ModelTool and adding one line here — nothing in the platform changes.
 */
registerModel(eerModel);
registerModel(instanceModel);

export {};
