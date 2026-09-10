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

/**
 * One colour per group, picked rather than generated.
 *
 * This used to walk the hue wheel in even steps at a fixed saturation and lightness. Two
 * problems with that. It produces the full rainbow, which is the signature of a palette
 * nobody chose. And evenly spaced hues are not evenly distinguishable: eight steps put
 * green, lime and cyan within sixty degrees of each other, and on this map those three
 * groups sat in the same region and could not be told apart.
 *
 * These are spaced by how different they look rather than by angle: the closest pair is
 * 22 dE apart in Lab, where about 10 is the point two colours stop being confusable.
 * Lightness varies too, but only over a range of 15, so this helps in greyscale rather
 * than being sufficient on its own. The legend is what carries it, and the legend is
 * why the map has one.
 *
 * An unknown group falls back to the foreground rather than to a colour that belongs to
 * some other category, so a corpus change shows up as grey instead of as a wrong label.
 */
const GROUP_COLOURS: Record<string, string> = {
  animals: "#e8734a",
  colours: "#e0b23c",
  time: "#8fbf5a",
  computing: "#4fae8a",
  feelings: "#5ec8d1",
  food: "#6f9fe0",
  actions: "#a98fd1",
  cities: "#d96f9e",
};

export function groupColour(group: string): string {
  return GROUP_COLOURS[group] ?? "var(--dim)";
}
