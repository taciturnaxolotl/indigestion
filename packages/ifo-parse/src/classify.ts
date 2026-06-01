import { DiscInfo, Title, TitleType, ClassificationConfidence } from "./types"

export function classifyTitles(disc: DiscInfo): DiscInfo {
  const titles = disc.titles.map(title => ({
    ...title,
    classification: classifyTitle(title, disc.titles),
    classificationConfidence: getConfidence(title),
  }))

  return {
    ...disc,
    titles,
  }
}

function classifyTitle(
  title: Title,
  allTitles: Title[]
): TitleType {
  // Menu/utility titles — never rip
  if (title.ifoTitleType === 0) {
    return "menu"
  }

  // Multi-angle — alternate angle feature (usually main content)
  if (title.ifoTitleType === 3) {
    return "main_feature"
  }

  // Non-sequential — extras, bonus content
  if (title.ifoTitleType === 2) {
    return "featurette"
  }

  // One sequential PGC — main feature or episode
  if (title.ifoTitleType === 1) {
    const sequentialTitles = allTitles.filter(t => t.ifoTitleType === 1)
    
    // If only one sequential title on disc → main feature
    if (sequentialTitles.length === 1) {
      return "main_feature"
    }
    
    // Many sequential titles (>10) → TV disc, all episodes
    if (sequentialTitles.length > 10) {
      return "episode"
    }
    
    // Multiple sequential titles (2-10) — use chapter count and duration to distinguish
    // Main features typically have many chapters (>8) and are significantly longer
    const chapterCount = title.nrOfPttSearchPointers ?? 0
    const hasManyChapters = chapterCount > 8
    const lengths = sequentialTitles.map(t => t.length)
    const maxLength = Math.max(...lengths)
    const isLongest = title.length >= maxLength * 0.95 // within 5% of longest
    const isLong = title.length > 3600 // over 1 hour
    
    // If this title is the longest (or close to it), has many chapters, and is over an hour → main feature
    if (isLongest && hasManyChapters && isLong) {
      return "main_feature"
    }
    
    // Fallback: if chapter data is missing, use duration alone
    // If this title is by far the longest, treat it as the main feature
    if (chapterCount === 0 && isLongest && title.length > 7200) {
      return "main_feature"
    }
    
    // Otherwise treat as TV disc with episodes
    return "episode"
  }

  throw new Error(`Unhandled IFO title type: ${title.ifoTitleType}`)
}

function getConfidence(title: Title): ClassificationConfidence {
  // title_type 0, 1, 3 are directly grounded in IFO
  if (title.ifoTitleType === 0 || title.ifoTitleType === 1 || title.ifoTitleType === 3) {
    return "ifo"
  }

  // title_type 2 sub-classification is inferred
  return "inferred"
}

export function isMenuTitle(title: Title): boolean {
  return title.ifoTitleType === 0
}

export function isEpisodeDisc(disc: DiscInfo): boolean {
  const sequentialTitles = disc.titles.filter(t => t.ifoTitleType === 1)
  return sequentialTitles.length > 1
}

export function mainFeature(disc: DiscInfo): Title | undefined {
  return disc.titles.find(t => t.classification === "main_feature")
}

export function episodes(disc: DiscInfo): Title[] {
  return disc.titles.filter(t => t.classification === "episode")
}

export function extras(disc: DiscInfo): Title[] {
  return disc.titles.filter(t => t.classification === "featurette")
}
