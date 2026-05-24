import { stemmer } from "stemmer";

const STOP_WORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "aren't",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can't",
  "cannot",
  "could",
  "couldn't",
  "did",
  "didn't",
  "do",
  "does",
  "doesn't",
  "doing",
  "don't",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "hadn't",
  "has",
  "hasn't",
  "have",
  "haven't",
  "having",
  "he",
  "he'd",
  "he'll",
  "he's",
  "her",
  "here",
  "here's",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "how's",
  "i",
  "i'd",
  "i'll",
  "i'm",
  "i've",
  "if",
  "in",
  "into",
  "is",
  "isn't",
  "it",
  "it's",
  "its",
  "itself",
  "let's",
  "me",
  "more",
  "most",
  "mustn't",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "ought",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "shan't",
  "she",
  "she'd",
  "she'll",
  "she's",
  "should",
  "shouldn't",
  "so",
  "some",
  "such",
  "than",
  "that",
  "that's",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "there's",
  "these",
  "they",
  "they'd",
  "they'll",
  "they're",
  "they've",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "wasn't",
  "we",
  "we'd",
  "we'll",
  "we're",
  "we've",
  "were",
  "weren't",
  "what",
  "what's",
  "when",
  "when's",
  "where",
  "where's",
  "which",
  "while",
  "who",
  "who's",
  "whom",
  "why",
  "why's",
  "with",
  "won't",
  "would",
  "wouldn't",
  "you",
  "you'd",
  "you'll",
  "you're",
  "you've",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "will",
  "just",
  "like",
]);

/**
 * Extracts key topics (keywords/hashtags) from a text content using NLP stemming.
 */
export function extractTopics(content: string): { concept: string; displayName: string }[] {
  if (!content) return [];

  // Extract hashtags explicitly
  const hashtagMatches = content.match(/#[\w]+/g) || [];
  const hashtags = hashtagMatches.map((tag) => {
    const raw = tag.slice(1);
    return {
      concept: raw.toLowerCase(),
      displayName: raw,
    };
  });

  // Extract standard words
  const words = content.replace(/[^\w\s]/g, " ").split(/\s+/);

  const keywords = words
    .filter((word) => word.length > 3) // Ignore very short words
    .map((word) => {
      const lower = word.toLowerCase();
      // Stem the word to its root for concept grouping
      const concept = stemmer(lower);
      return { concept, displayName: word };
    })
    .filter(
      (w) =>
        !STOP_WORDS.has(w.concept) &&
        !STOP_WORDS.has(w.displayName.toLowerCase()) &&
        !Number.isFinite(Number(w.concept)),
    ); // Remove stop words and raw numbers

  // Combine and deduplicate
  const allTopics = [...hashtags, ...keywords];
  const uniqueTopics = new Map<string, { concept: string; displayName: string }>();

  for (const topic of allTopics) {
    if (!uniqueTopics.has(topic.concept)) {
      uniqueTopics.set(topic.concept, topic);
    }
  }

  return Array.from(uniqueTopics.values());
}
