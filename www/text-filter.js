// Basic filter for objectionable words in captions and comments (Apple App
// Review Guideline 1.2). Matching words are masked when shown, e.g. "f**k".
// It's deliberately simple: reports and blocking handle what a word list can't.
// Add words (lowercase) to extend it.
const WORDS = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bitches', 'cunt',
  'asshole', 'dick', 'dickhead', 'pussy', 'cock', 'whore', 'slut', 'bastard', 'twat', 'wanker',
  'fag', 'faggot', 'retard', 'retarded', 'nigger', 'nigga', 'chink', 'spic', 'kike', 'tranny',
];

const pattern = new RegExp(`\\b(${WORDS.join('|')})\\b`, 'gi');

export function filterText(text) {
  return String(text).replace(pattern, w => w[0] + '*'.repeat(Math.max(1, w.length - 2)) + w[w.length - 1]);
}
