/**
 * STORIES scene: the vertical renderer in its "stories" skin (thin bars,
 * the platform's ring). See vertical.js.
 */

import { play as vertical } from './vertical.js';

export function play(stage, options) {

  return vertical(stage, options, 'stories');

}
