// Pre-written wishes — used when the AI is down, slow, or times out.
// One pool per tone. The birthday spec requires: "Use pre-written wishes
// if the AI fails or times out." No invented memories here — these are
// deliberately generic enough to be true for anyone.

const FALLBACKS = {
  warm: [
    "Wishing you a day that feels as warm as the people who love you. You deserve every good thing coming your way.",
    "Happy birthday to someone who makes ordinary days feel special. I'm so glad you exist.",
    "Here's to more laughter, more little adventures, and more of those moments you replay years later. Happy birthday.",
    "You make the world a little kinder just by being in it. I hope today gives you back a fraction of that warmth.",
    "Another trip around the sun, and you somehow keep getting better at being you. Happy birthday.",
    "May this year bring you the kind of quiet joy that doesn't need a highlight reel. You've earned it.",
    "Happy birthday to my favorite person to share silence and snacks with. This year, more of both.",
    "I hope today is gentle with you, and tomorrow even gentler. Wishing you so much happiness.",
  ],
  funny: [
    "Happy birthday! You're not getting older — you're just increasing in version number.",
    "Another year wiser. Which is impressive, considering the baseline we're working with.",
    "Congrats on surviving another full orbit with excellent hair and questionable decisions. Keep going.",
    "Happy birthday! Officially old enough to know better, young enough to do it anyway.",
    "Here's to aging like fine wine — or at worst, like cheese with good marketing.",
    "Happy birthday! May your day be as sweet as you pretend your coffee is.",
    "I'd say you're one in a million, but that implies there are 999,999 others. Scary thought. Happy birthday.",
    "Happy birthday! If anyone asks, you're 29. Again. Forever.",
    "Another year of you. The world remains unconvinced but I'm a fan. Happy birthday!",
  ],
  poetic: [
    "Some people are a season, some are a whole sky. You are the one I check the weather of first. Happy birthday.",
    "A year folds into another like light into a window. Whatever the room holds, you make it brighter. Happy birthday.",
    "Happy birthday. May your year be a long exhale after a long swim — and may you always find the shore.",
    "The world keeps its seasons; you keep your own. I hope this one blooms slow and lingers. Happy birthday.",
    "You are proof that time can add rather than subtract. Happy birthday — may the coming pages be kind.",
    "Wishing you a year measured not in days but in moments you'd keep if you could. There will be many. Happy birthday.",
    "Happy birthday. May you be as gentle with yourself as you are with everyone else. That's the real wish.",
    "Some days are bookmarks; some are chapters. I hope this one opens something worth keeping. Happy birthday.",
  ],
};

function get(tone, count = 1) {
  const list = FALLBACKS[tone] || FALLBACKS.warm;
  const n = Math.max(1, Math.min(5, count));
  const out = [];
  let seed = Math.abs(Date.now() ^ (tone ? tone.length : 0));
  while (out.length < n && out.length < list.length) {
    const idx = seed % list.length;
    const wish = list[idx];
    if (!out.includes(wish)) out.push(wish);
    seed = Math.abs(seed + 1);
  }
  // If pool has fewer than n, pad with generic wishes.
  const generic = [
    "Happy birthday! May this year bring you moments that make you smile all year long.",
    "Happy birthday! Here's to another beautiful year of being wonderfully you.",
    "Happy birthday! May your special day be filled with joy, laughter, and love.",
  ];
  while (out.length < n) out.push(generic[out.length % generic.length]);
  return out;
}

module.exports = { get, FALLBACKS };