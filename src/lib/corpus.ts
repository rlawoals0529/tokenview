/**
 * A fixed reference corpus for the map.
 *
 * Fixed on purpose: the point is to see where YOUR sentence lands relative to a stable
 * backdrop. A corpus that changed between runs would make every position meaningless.
 *
 * Grouped so the map has visible structure to check against - if related words do not
 * cluster, the projection is lying.
 */
export const CORPUS: { word: string; group: string }[] = [
  ...["cat", "dog", "horse", "rabbit", "mouse", "bird", "fish", "bear", "wolf", "fox"].map((w) => ({ word: w, group: "animals" })),
  ...["red", "blue", "green", "yellow", "purple", "orange", "black", "white", "grey", "pink"].map((w) => ({ word: w, group: "colours" })),
  ...["monday", "tuesday", "friday", "sunday", "january", "june", "december", "morning", "evening", "tomorrow"].map((w) => ({ word: w, group: "time" })),
  ...["python", "javascript", "compiler", "database", "server", "function", "variable", "algorithm", "debug", "deploy"].map((w) => ({ word: w, group: "computing" })),
  ...["happy", "sad", "angry", "afraid", "calm", "excited", "lonely", "proud", "anxious", "grateful"].map((w) => ({ word: w, group: "feelings" })),
  ...["bread", "cheese", "apple", "coffee", "rice", "soup", "chocolate", "pasta", "sugar", "salt"].map((w) => ({ word: w, group: "food" })),
  ...["run", "walk", "swim", "jump", "climb", "throw", "carry", "build", "write", "read"].map((w) => ({ word: w, group: "actions" })),
  ...["london", "paris", "tokyo", "berlin", "cairo", "sydney", "toronto", "mumbai", "lima", "oslo"].map((w) => ({ word: w, group: "cities" })),
];

export const GROUPS = [...new Set(CORPUS.map((c) => c.group))];

/** One hue per group, evenly spaced, so a legend is unnecessary to read the shape. */
export function groupColour(group: string): string {
  const i = GROUPS.indexOf(group);
  return `hsl(${Math.round((i / GROUPS.length) * 360)} 72% 62%)`;
}
