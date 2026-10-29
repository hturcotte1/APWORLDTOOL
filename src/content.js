// Bundles the game content (the JSON files in /content) into the Worker.
// To add an empire: create content/empires/<id>.json, import it here, and add
// its id to "empireOrder" in content/rules.json. `npm run validate` checks this.
import rules from '../content/rules.json' with { type: 'json' };
import glossary from '../content/glossary.json' with { type: 'json' };
import mughal from '../content/empires/mughal.json' with { type: 'json' };
import mingqing from '../content/empires/mingqing.json' with { type: 'json' };
import tokugawa from '../content/empires/tokugawa.json' with { type: 'json' };
import ottoman from '../content/empires/ottoman.json' with { type: 'json' };
import russia from '../content/empires/russia.json' with { type: 'json' };
import spain from '../content/empires/spain.json' with { type: 'json' };
import safavid from '../content/empires/safavid.json' with { type: 'json' };
import songhai from '../content/empires/songhai.json' with { type: 'json' };

const all = { mughal, mingqing, tokugawa, ottoman, russia, spain, safavid, songhai };
export const empires = Object.fromEntries(rules.empireOrder.map((id) => [id, all[id]]));
export { rules, glossary };
