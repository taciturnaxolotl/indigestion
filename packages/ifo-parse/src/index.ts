import { parseDisc } from "./ffi"
import { parseShimOutput } from "./parse"
import { classifyTitles, isMenuTitle, isEpisodeDisc, mainFeature, episodes, extras } from "./classify"
import { DiscInfo, Title, TitleType, ClassificationConfidence, Stream, VideoStream, AudioStream, SubtitleStream, Chapter, IFOTitleType } from "./types"

export function analyzeDisc(source: string): DiscInfo {
  const json = parseDisc(source)
  
  if (!json) {
    throw new Error(`Failed to parse disc at ${source}`)
  }

  const disc = parseShimOutput(json, source)
  return classifyTitles(disc)
}

export {
  // Types
  type DiscInfo,
  type Title,
  type TitleType,
  type ClassificationConfidence,
  type Stream,
  type VideoStream,
  type AudioStream,
  type SubtitleStream,
  type Chapter,
  type IFOTitleType,
  
  // Classification utilities
  classifyTitles,
  isMenuTitle,
  isEpisodeDisc,
  mainFeature,
  episodes,
  extras,
}
