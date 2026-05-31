import { DiscInfo, Title, IFOTitleType } from "./types"

export function parseShimOutput(json: string, source: string): DiscInfo {
  const raw = JSON.parse(json) as Omit<DiscInfo, 'source'>

  const titles: Title[] = raw.titles.map((t): Title => ({
    ...t,
    ifoTitleType: t.ifoTitleType as IFOTitleType,
    classification: "unknown",
    classificationConfidence: "inferred",
  }))

  return {
    source,
    discTitle: raw.discTitle,
    titles,
  }
}
