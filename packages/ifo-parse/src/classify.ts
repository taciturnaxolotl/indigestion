import { DiscInfo, Title, TitleType, ClassificationConfidence } from "./types"

export function classifyTitles(disc: DiscInfo): DiscInfo {
  const sequentialTitles = disc.titles.filter(t => t.ifoTitleType === 1)
  const lengths = sequentialTitles.map(t => t.length)
  const maxLength = lengths.length > 0 ? Math.max(...lengths) : 0
  const avgLength = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0
  
  const titles = disc.titles.map(title => ({
    ...title,
    classification: classifyTitle(title, sequentialTitles, maxLength, avgLength),
    classificationConfidence: getConfidence(title),
  }))

  return {
    ...disc,
    titles,
  }
}

function classifyTitle(
  title: Title,
  sequentialTitles: Title[],
  maxLength: number,
  avgLength: number
): TitleType {
  // Menu/utility titles — never rip
  if (title.ifoTitleType === 0) {
    return "menu"
  }

  // One sequential PGC — main feature or episode
  if (title.ifoTitleType === 1) {
    // If only one sequential title on disc → main feature
    if (sequentialTitles.length === 1) {
      return "main_feature"
    }
    
    // Multiple sequential titles — check if one is significantly longer
    // If this title is the longest and much longer than average, it's the main feature
    if (title.length === maxLength && maxLength > avgLength * 5 && maxLength > 3600) {
      return "main_feature"
    }
    
    // Otherwise treat as TV disc with episodes
    return "episode"
  }

  // Multi-angle — alternate angle feature
  if (title.ifoTitleType === 3) {
    return "main_feature"
  }

  // Non-sequential — extras, bonus content
  if (title.ifoTitleType === 2) {
    return "featurette"
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
  return disc.titles.filter(t => 
    t.classification === "featurette" ||
    t.classification === "behind_the_scenes" ||
    t.classification === "deleted_scenes" ||
    t.classification === "interview" ||
    t.classification === "trailer"
  )
}
