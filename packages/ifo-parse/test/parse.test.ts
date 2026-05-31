import { describe, test, expect } from "bun:test"
import { parseShimOutput } from "../src/parse"
import { classifyTitles, isMenuTitle, isEpisodeDisc, mainFeature, episodes, extras } from "../src/classify"
import movieFixture from "./fixtures/movie.json"
import tvSeasonFixture from "./fixtures/tv_season.json"
import realMovieFixture from "./fixtures/real_movie.json"
import tvShowRawFixture from "./fixtures/tv_show_raw.json"
import tvShowFullFixture from "./fixtures/tv_show_full.json"
import movieFullFixture from "./fixtures/movie_full.json"

describe("parse", () => {
  test("parses movie disc fixture", () => {
    const disc = parseShimOutput(JSON.stringify(movieFixture), "/dev/sr0")
    
    expect(disc.source).toBe("/dev/sr0")
    expect(disc.discTitle).toBe("THE_MATRIX")
    expect(disc.titles.length).toBe(2)
    
    const title1 = disc.titles[0]
    expect(title1.ix).toBe(1)
    expect(title1.ifoTitleType).toBe(1)
    expect(title1.length).toBe(8160.5)
    expect(title1.chapters.length).toBe(5)
    expect(title1.audio.length).toBe(2)
    expect(title1.subtitles.length).toBe(2)
  })

  test("parses TV season fixture", () => {
    const disc = parseShimOutput(JSON.stringify(tvSeasonFixture), "/dev/sr0")
    
    expect(disc.discTitle).toBe("FRIENDS_SEASON_1")
    expect(disc.titles.length).toBe(3)
    
    // All titles should be type 1 (sequential)
    for (const title of disc.titles) {
      expect(title.ifoTitleType).toBe(1)
    }
  })
})

describe("classify", () => {
  test("classifies movie disc with main feature and extra", () => {
    const disc = parseShimOutput(JSON.stringify(movieFixture), "/dev/sr0")
    const classified = classifyTitles(disc)
    
    const title1 = classified.titles[0]
    expect(title1.classification).toBe("main_feature")
    expect(title1.classificationConfidence).toBe("ifo")
    
    const title2 = classified.titles[1]
    expect(title2.classification).toBe("featurette")
    expect(title2.classificationConfidence).toBe("inferred")
  })

  test("classifies TV season disc with episodes", () => {
    const disc = parseShimOutput(JSON.stringify(tvSeasonFixture), "/dev/sr0")
    const classified = classifyTitles(disc)
    
    // All three titles should be classified as episodes
    for (const title of classified.titles) {
      expect(title.classification).toBe("episode")
      expect(title.classificationConfidence).toBe("ifo")
    }
    
    expect(isEpisodeDisc(classified)).toBe(true)
  })

  test("identifies menu titles", () => {
    const disc = parseShimOutput(JSON.stringify(movieFixture), "/dev/sr0")
    
    // Title 1 is type 1 (not menu)
    expect(isMenuTitle(disc.titles[0])).toBe(false)
  })

  test("convenience accessors work correctly", () => {
    const disc = parseShimOutput(JSON.stringify(movieFixture), "/dev/sr0")
    const classified = classifyTitles(disc)
    
    const feature = mainFeature(classified)
    expect(feature).toBeDefined()
    expect(feature?.ix).toBe(1)
    
    const eps = episodes(classified)
    expect(eps.length).toBe(0)
    
    const ext = extras(classified)
    expect(ext.length).toBe(1)
    expect(ext[0].ix).toBe(2)
  })

  test("TV disc convenience accessors", () => {
    const disc = parseShimOutput(JSON.stringify(tvSeasonFixture), "/dev/sr0")
    const classified = classifyTitles(disc)
    
    const feature = mainFeature(classified)
    expect(feature).toBeUndefined()
    
    const eps = episodes(classified)
    expect(eps.length).toBe(3)
    
    const ext = extras(classified)
    expect(ext.length).toBe(0)
  })

  test("parses and classifies real movie disc", () => {
    const disc = parseShimOutput(JSON.stringify(realMovieFixture), "/dev/sr0")
    const classified = classifyTitles(disc)
    
    expect(classified.titles.length).toBe(6)
    
    // First title should be main feature (longest, type 1)
    const feature = mainFeature(classified)
    expect(feature).toBeDefined()
    expect(feature?.ix).toBe(1)
    expect(feature?.length).toBeGreaterThan(10000) // ~3 hours
    
    // Check video attributes
    expect(feature?.video.format).toBe("MPEG2")
    expect(feature?.video.width).toBe(720)
    expect(feature?.video.height).toBe(480) // NTSC
    expect(feature?.video.fps).toBeCloseTo(29.97)
    
    // Should have multiple audio tracks
    expect(feature?.audio.length).toBeGreaterThan(0)
    
    // Classification confidence should be "ifo" for type 1
    expect(feature?.classificationConfidence).toBe("ifo")
  })

  test("parses and classifies real TV show disc", () => {
    const disc = parseShimOutput(JSON.stringify(tvShowRawFixture), "/dev/sr0")
    const classified = classifyTitles(disc)
    
    expect(classified.titles.length).toBe(83)
    
    // Should be detected as episode disc
    expect(isEpisodeDisc(classified)).toBe(true)
    
    // No main feature
    const feature = mainFeature(classified)
    expect(feature).toBeUndefined()
    
    // Many episodes
    const eps = episodes(classified)
    expect(eps.length).toBe(82)
    
    // Episodes should be ~82 minutes each (~4900 seconds)
    const typicalEpisodes = eps.filter(e => e.length > 4000 && e.length < 6000)
    expect(typicalEpisodes.length).toBeGreaterThan(50)
    
    // All sequential titles should be classified as episodes
    const sequentialTitles = classified.titles.filter(t => t.ifoTitleType === 1)
    for (const title of sequentialTitles) {
      expect(title.classification).toBe("episode")
      expect(title.classificationConfidence).toBe("ifo")
    }
  })

  test("extracts full metadata from TV show disc", () => {
    const disc = parseShimOutput(JSON.stringify(tvShowFullFixture), "/dev/sr0")
    
    // Disc-level metadata
    expect(disc.nrOfVolumes).toBe(1)
    expect(disc.thisVolumeNr).toBe(1)
    expect(disc.discSide).toBe(1)
    expect(disc.nrOfTitleSets).toBe(21)
    expect(disc.regionCode).toBeDefined()
    
    // Title-level metadata
    const title1 = disc.titles[0]
    expect(title1.nextPgc).toBeDefined()
    expect(title1.prevPgc).toBeDefined()
    expect(title1.goupPgc).toBeDefined()
    expect(title1.stillTime).toBeDefined()
    
    // Prohibited operations
    expect(title1.prohibitedOps).toBeDefined()
    expect(typeof title1.prohibitedOps.stop).toBe("boolean")
    expect(typeof title1.prohibitedOps.pauseOn).toBe("boolean")
    expect(typeof title1.prohibitedOps.audioChange).toBe("boolean")
    
    // Cell-level details
    expect(title1.cells).toBeDefined()
    expect(title1.cells.length).toBeGreaterThan(0)
    
    const cell1 = title1.cells[0]
    expect(cell1.ix).toBe(1)
    expect(cell1.duration).toBeDefined()
    expect(cell1.startSector).toBeDefined()
    expect(cell1.endSector).toBeDefined()
    expect(cell1.blockMode).toBeDefined()
    expect(cell1.seamlessAngle).toBeDefined()
    expect(cell1.stillTime).toBeDefined()
    
    // Verify cells have reasonable sector ranges
    for (const cell of title1.cells) {
      expect(cell.endSector).toBeGreaterThanOrEqual(cell.startSector)
    }
  })

  test("extracts full metadata from movie disc", () => {
    const disc = parseShimOutput(JSON.stringify(movieFullFixture), "/dev/sr0")
    
    // Disc-level metadata
    expect(disc.discTitle).toBe("WARNER_HOME_")
    expect(disc.providerId).toBe("WARNER_HOME_VIDEO")
    expect(disc.nrOfVolumes).toBe(1)
    expect(disc.thisVolumeNr).toBe(1)
    expect(disc.discSide).toBe(1)
    expect(disc.nrOfTitleSets).toBe(3)
    expect(disc.regionCode).toBe(246) // Region 1, 3, 4
    
    const classified = classifyTitles(disc)
    
    // Should have main feature
    const feature = mainFeature(classified)
    expect(feature).toBeDefined()
    expect(feature?.ix).toBe(1)
    expect(feature?.length).toBe(11107) // ~3 hours
    
    // Check full metadata on main feature
    expect(feature?.nextPgc).toBe(0)
    expect(feature?.prevPgc).toBe(0)
    expect(feature?.goupPgc).toBe(0)
    expect(feature?.stillTime).toBe(0)
    
    // Prohibited ops should all be false for a movie
    expect(feature?.prohibitedOps.stop).toBe(false)
    expect(feature?.prohibitedOps.pauseOn).toBe(false)
    expect(feature?.prohibitedOps.titlePlay).toBe(false)
    expect(feature?.prohibitedOps.audioChange).toBe(false)
    expect(feature?.prohibitedOps.subpicChange).toBe(false)
    
    // Cells should exist and have valid data
    expect(feature?.cells).toBeDefined()
    expect(feature?.cells.length).toBeGreaterThan(0)
    
    for (const cell of feature!.cells) {
      expect(cell.endSector).toBeGreaterThanOrEqual(cell.startSector)
      expect(cell.blockMode).toBeGreaterThanOrEqual(0)
      expect(cell.blockMode).toBeLessThanOrEqual(3)
    }
  })
})
