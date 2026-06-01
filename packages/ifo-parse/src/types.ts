export type StreamType = "video" | "audio" | "subtitle"

export interface VideoStream {
  type: "video"
  format: string          // "MPEG1" | "MPEG2"
  width: number
  height: number
  fps: number             // 25 | 29.97
  aspectRatio: string     // "4:3" | "16:9"
  line21CC1?: boolean     // closed captioning channel 1
  line21CC2?: boolean     // closed captioning channel 2
  constantBitrate?: boolean // true = CBR, false = VBR
  letterboxed?: boolean   // whether video is letterboxed
  filmMode?: boolean      // true = film mode, false = video mode
}

export interface AudioStream {
  type: "audio"
  ix: number              // 0-based stream index
  langCode: string        // ISO 639-1, e.g. "en"
  format: string          // "AC3" | "DTS" | "LPCM" | "MPEG"
  channels: number        // 2 | 6 | 8
  sampleRate: number      // Hz, typically 48000
  quantization: number    // bits, typically 16 | 20 | 24
  multichannelExtension?: boolean // whether multichannel extension block exists
  langType?: number       // 0=unspecified, 1=audio, 2=visual impaired, etc.
  applicationMode?: number // application-specific mode
  langExtension?: number  // extended language code
  codeExtension?: number  // additional coding info
}

export interface SubtitleStream {
  type: "subtitle"
  ix: number
  langCode: string
  format: string          // "VobSub"
  codeMode?: number       // 0=run-length, 1=extended, 2=other
  subpType?: number       // 0=not specified, 1=language, 2=other
  langExtension?: number  // extended language code
  codeExtension?: number  // additional coding info
}

export type Stream = VideoStream | AudioStream | SubtitleStream

export interface Chapter {
  ix: number              // 1-based
  startTime: number       // seconds (float)
}

export interface Cell {
  ix: number              // 1-based cell index
  duration: number        // seconds
  startSector: number     // first sector of cell
  endSector: number       // last sector of cell
  blockMode: number       // 0=single, 1=first, 2=middle, 3=last
  blockType: number       // 0=normal, 1=angle block
  seamlessAngle: number   // 1 if angle change is seamless
  stillTime: number       // pause time in seconds (for menus)
  seamlessPlay?: boolean  // seamless playback flag
  interleaved?: boolean   // interleaved cell flag
  stcDiscontinuity?: boolean // system time clock discontinuity
  playbackMode?: boolean  // still mode after each VOBU
  restricted?: boolean    // restricted fast-forward
  cellType?: number       // karaoke cell type (reserved otherwise)
  cellCmdNr?: number      // cell command number
  firstIlvuEndSector?: number // first interleaved unit end sector
  lastVobuStartSector?: number // last VOBU start sector
}

export interface ProhibitedOps {
  stop: boolean
  pauseOn: boolean
  titlePlay: boolean
  chapterSearch: boolean
  timeSearch: boolean
  forwardScan: boolean
  backwardScan: boolean
  nextPgSearch: boolean
  prevPgSearch: boolean
  rootMenuCall: boolean
  titleMenuCall: boolean
  chapterMenuCall: boolean
  audioChange: boolean
  subpicChange: boolean
  angleChange: boolean
}

export interface ParentalRating {
  country: string         // ISO 3166-1 alpha-2 code
  level: number           // parental level (1-8, or 0 for unrestricted)
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
  parentalId: number      // parental management ID for this title
  nrOfPttSearchPointers: number // number of part-of-title search pointers
  length: number          // seconds (float)
  nextPgc: number         // next PGC number (0 if none)
  prevPgc: number         // previous PGC number (0 if none)
  goupPgc: number         // "go up" PGC number (0 if none)
  stillTime: number       // PGC-level still time (seconds)
  prohibitedOps: ProhibitedOps
  chapters: Chapter[]
  cells: Cell[]           // cell-level details
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
  providerId?: string     // studio/distributor identifier (32 chars max)
  nrOfVolumes?: number    // number of volumes in set
  thisVolumeNr?: number   // which volume this is
  discSide?: number       // disc side (1 or 2)
  nrOfTitleSets?: number  // number of VTSs on disc
  regionCode?: number     // region code bitmask (0xFF = all regions)
  parentalRatings?: ParentalRating[]  // per-country parental levels
  titles: Title[]
}
