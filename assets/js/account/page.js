/** The /account/ page: the account module, on its own (docs/PHASE5-PLAN.md P5-2). */

import { mountAccount } from './app.js';
import { mountNav } from '../nav.js';

mountAccount(document.getElementById('acct-main'));
mountNav();
