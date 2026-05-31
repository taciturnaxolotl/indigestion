export type StreamType = "video" | "audio" | "subtitle"

export interface VideoStream {
  type: "video"
  format: string          // "MPEG2" | "MPEG4" | "H264"
  width: number
  height: number
  fps: number             // 25 | 29.97
  aspectRatio: string     // "4:3" | "16:9"
}

export interface AudioStream {
  type: "audio"
  ix: number              // 0-based stream index
  langCode: string        // ISO 639-1, e.g. "en"
  language: string        // "English"
  format: string          // "AC3" | "DTS" | "LPCM" | "MPEG"
  channels: number        // 2 | 6 | 8
  sampleRate: number      // Hz, typically 48000
  quantization: number    // bits, typically 16 | 20 | 24
}

export interface SubtitleStream {
  type: "subtitle"
  ix: number
  langCode: string
  language: string
  format: string          // "VobSub"
}

export type Stream = VideoStream | AudioStream | SubtitleStream

export interface Chapter {
  ix: number              // 1-based
  startTime: number       // seconds (float)
}

// Raw IFO title_type values from tt_srpt
export type IFOTitleType =
  | 0   // menu / utility — never rip
  | 1   // one_sequential_pgc — main feature or episode
  | 2   // non_sequential — extras, bonus content
  | 3   // multi_angle — alternate angle feature

export type TitleType =
  | "main_feature"
  | "episode"
  | "featurette"
  | "behind_the_scenes"
  | "deleted_scenes"
  | "interview"
  | "trailer"
  | "menu"
  | "unknown"

export type ClassificationConfidence =
  | "ifo"        // grounded directly in IFO title_type field
  | "inferred"   // sub-classification of non_sequential titles

export interface Title {
  ix: number              // 1-based, matches makemkvcon title index
  vtsIx: number           // VTS number (1..n)
  pgcIx: number           // PGC index within VTS (0-based)
  ifoTitleType: IFOTitleType
  angleCount: number      // number of angles (usually 1)
  length: number          // seconds (float)
  chapters: Chapter[]
  video: VideoStream
  audio: AudioStream[]
  subtitles: SubtitleStream[]
  // set by classifyTitles()
  classification: TitleType
  classificationConfidence: ClassificationConfidence
}

export interface DiscInfo {
  source: string          // device path or VIDEO_TS folder path
  discTitle: string       // e.g. "THE_MATRIX" from disc label
  titles: Title[]
}
