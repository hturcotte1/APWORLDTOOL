// Bundles the Class Battle content (content/battle) into the Worker.
import { empires, rules } from './content.js';
import { makeBattle } from './battle.js';
import battleRules from '../content/battle/rules.json' with { type: 'json' };
import clashes from '../content/battle/clashes.json' with { type: 'json' };
import mughal from '../content/battle/campaigns/mughal.json' with { type: 'json' };
import mingqing from '../content/battle/campaigns/mingqing.json' with { type: 'json' };
import tokugawa from '../content/battle/campaigns/tokugawa.json' with { type: 'json' };
import ottoman from '../content/battle/campaigns/ottoman.json' with { type: 'json' };
import russia from '../content/battle/campaigns/russia.json' with { type: 'json' };
import spain from '../content/battle/campaigns/spain.json' with { type: 'json' };
import safavid from '../content/battle/campaigns/safavid.json' with { type: 'json' };
import songhai from '../content/battle/campaigns/songhai.json' with { type: 'json' };

const campaigns = { mughal, mingqing, tokugawa, ottoman, russia, spain, safavid, songhai };
export const battle = makeBattle({ soloRules: rules, empires, battleRules, campaigns, clashes });

// What every screen may know up front: names, regions, round titles, and the
// clash scenes (history), but never options or points.
export const battleInfo = {
  rounds: battle.rules.rounds,
  roles: battle.rules.roles,
  adviser: battle.rules.adviser,
  timer: battle.rules.timer,
  exileFactor: battle.rules.exileFactor,
  sharedRegions: Object.values(battle.shared),
  empires: Object.fromEntries(battle.order.map((id) => [id, {
    titles: campaigns[id].titles,
    regions: campaigns[id].regions,
    rounds: campaigns[id].rounds.map((r) => ({ years: r.years, title: r.title })),
  }])),
  clashes: Object.fromEntries(Object.entries(battle.clashes).map(([id, c]) => [id, {
    round: c.round, year: c.year, title: c.title, prize: c.prize, ai: c.ai || null,
    sides: Object.keys(c.sides), prep: Object.fromEntries(Object.entries(c.sides).map(([e, side]) => [e, side.prep])),
    scene: c.scene || null,
  }])),
};
