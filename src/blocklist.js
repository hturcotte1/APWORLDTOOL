// Words that are not allowed in leaderboard names.
// They are stored in ROT13 (each letter shifted 13 places) so this file isn't a
// wall of offensive words. Use decode() in a Node console to read them.
//
// SUBSTRINGS are blocked anywhere in the name (after removing spaces/punctuation).
// WHOLE_WORDS are blocked only as a whole word, so names like "Cassandra" or
// "Hellen" still work.
export const decode = (w) => w.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

export const SUBSTRINGS = [
  'shpx', 'sipx', 'cuhpx', 'spx', 'ohyyfuvg', 'fuvgurnq', 'fuvgsnpr', 'fuvggl', 'ovgpu', 'ovngpu',
  'phag', 'avtt', 'snttbg', 'sntbg', 'juber', 'fyhg', 'cravf', 'intvan', 'qvyqb', 'cbeab',
  'cbeauho', 'chffl', 'obbo', 'gvggvrf', 'gvggl', 'nffubyr', 'qhzonff', 'wnpxnff', 'ergneq',
  'encvfg', 'zbyrfg', 'crqb', 'uvgyre', 'xxx', 'jnax', 'gjng', 'wvmm', 'ubeal', 'frkl', 'ahqr',
  'anxrq', 'cbbc', 'ohggubyr', 'cvff', 'rerpgvba', 'travgny', 'genaal', 'jrgonpx', 'enturnq',
  'gbjryurnq', 'qrrmahgf', 'yvtzn', 'fhtzn', 'zvxruhag', 'uhtuwnff', 'oraqbire', 'uhtuzhathf',
  'zvxrbkybat', 'zvxrunjx', 'frlzbheohggf', 'zbryrfgre', 'nznaqnuhttvaxvff', 'uhtuterpgvba',
  'unvelonyyf', 'uneelonyyf', 'onyyfnpx', 'ahgfnpx', 'fpebghz', 'grfgvpyr', 'znfgheong', 'betnfz',
  'obare', 'zvys', 'xvyylbhefrys',
].map(decode);

export const WHOLE_WORDS = [
  'fuvg', 'fuvgf', 'fug', 'shx', 'sneg', 'snegf', 'cbea', 'xlf', 'nff', 'nffrf', 'ohgg', 'ohggf',
  'qvpx', 'qvpxf', 'pbpx', 'gvgf', 'gvg', 'nany', 'nahf', 'frk', 'phz', 'penc', 'qnza', 'uryy',
  'jrrq', 'fgbare', 'qlxr', 'pbba', 'puvax', 'fcvp', 'xvxr', 'tbbx', 'ornare', 'anmv', 'anmvf',
  'penpxre', 'ubr', 'ubrf', 'gubg', 'onyyf', 'ahgf', 'fhpxf', 'yby', 'yznb', 'obsn', 'gheq',
  'qvqql',
].map(decode);
