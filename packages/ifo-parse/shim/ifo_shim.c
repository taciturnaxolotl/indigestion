#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dvdread/ifo_read.h>
#include <dvdread/dvd_reader.h>
#include "cJSON.h"

// Safely extract language code (2 lowercase letters or "un")
static void safe_lang(char *out, uint16_t lang_code) {
  out[0] = 'u';
  out[1] = 'n';
  out[2] = '\0';
  
  if (lang_code) {
    char c1 = (lang_code >> 8) & 0xFF;
    char c2 = lang_code & 0xFF;
    if (c1 >= 'a' && c1 <= 'z' && c2 >= 'a' && c2 <= 'z') {
      out[0] = c1;
      out[1] = c2;
    }
  }
}

char *ifo_parse_disc(const char *path) {
  dvd_reader_t *dvd = DVDOpen(path);
  if (!dvd) return NULL;

  ifo_handle_t *vmg = ifoOpen(dvd, 0);
  if (!vmg) {
    DVDClose(dvd);
    return NULL;
  }

  cJSON *root = cJSON_CreateObject();
  
  // Disc-level metadata
  char disc_title[13] = {0};
  if (vmg->txtdt_mgi) {
    strncpy(disc_title, vmg->txtdt_mgi->disc_name, 12);
    disc_title[12] = '\0';
  }
  if (strlen(disc_title) == 0 && vmg->vmgi_mat) {
    strncpy(disc_title, vmg->vmgi_mat->provider_identifier, 12);
    disc_title[12] = '\0';
  }
  if (strlen(disc_title) == 0) {
    strcpy(disc_title, "DVD");
  }
  cJSON_AddStringToObject(root, "discTitle", disc_title);
  
  if (vmg->vmgi_mat) {
    char provider[33] = {0};
    strncpy(provider, vmg->vmgi_mat->provider_identifier, 32);
    provider[32] = '\0';
    cJSON_AddStringToObject(root, "providerId", provider);
    
    cJSON_AddNumberToObject(root, "nrOfVolumes", vmg->vmgi_mat->vmg_nr_of_volumes);
    cJSON_AddNumberToObject(root, "thisVolumeNr", vmg->vmgi_mat->vmg_this_volume_nr);
    cJSON_AddNumberToObject(root, "discSide", vmg->vmgi_mat->disc_side);
    cJSON_AddNumberToObject(root, "nrOfTitleSets", vmg->vmgi_mat->vmg_nr_of_title_sets);
    
    // Region code (bits in vmg_category)
    uint32_t region_mask = (vmg->vmgi_mat->vmg_category >> 16) & 0xFF;
    cJSON_AddNumberToObject(root, "regionCode", region_mask);
  }
  
  // Parental management
  if (vmg->ptl_mait && vmg->ptl_mait->nr_of_countries > 0) {
    cJSON *parental = cJSON_AddArrayToObject(root, "parentalRatings");
    for (int c = 0; c < vmg->ptl_mait->nr_of_countries; c++) {
      ptl_mait_country_t *country = &vmg->ptl_mait->countries[c];
      cJSON *cobj = cJSON_CreateObject();
      
      char cc[3] = {0};
      safe_lang(cc, country->country_code);
      cJSON_AddStringToObject(cobj, "country", cc);
      
      // Get parental level for video_ts (first entry)
      if (country->pf_ptl_mai) {
        uint16_t level = country->pf_ptl_mai[0][0];
        cJSON_AddNumberToObject(cobj, "level", level);
      }
      
      cJSON_AddItemToArray(parental, cobj);
    }
  }
  
  // Text data manager - extract full titles
  if (vmg->txtdt_mgi && vmg->txtdt_mgi->nr_of_language_units > 0) {
    cJSON *textData = cJSON_AddObjectToObject(root, "textData");
    
    // Disc name from text data (already used above, but include here for completeness)
    char disc_name[13] = {0};
    strncpy(disc_name, vmg->txtdt_mgi->disc_name, 12);
    disc_name[12] = '\0';
    cJSON_AddStringToObject(textData, "discName", disc_name);
    
    // Language units with title strings
    cJSON *langUnits = cJSON_AddArrayToObject(textData, "languageUnits");
    for (int lu = 0; lu < vmg->txtdt_mgi->nr_of_language_units; lu++) {
      txtdt_lu_t *lu_ptr = &vmg->txtdt_mgi->lu[lu];
      cJSON *luobj = cJSON_CreateObject();
      
      char lang[3] = {0};
      safe_lang(lang, lu_ptr->lang_code);
      cJSON_AddStringToObject(luobj, "language", lang);
      cJSON_AddNumberToObject(luobj, "charSet", lu_ptr->char_set);
      
      // Extract text strings if available
      if (lu_ptr->txtdt) {
        cJSON *texts = cJSON_AddArrayToObject(luobj, "texts");
        
        // First offset is disc title, rest are VTS titles
        int nr_texts = lu_ptr->txtdt->offsets[0]; // number of entries
        if (nr_texts > 100) nr_texts = 100; // safety limit
        
        for (int t = 0; t < nr_texts; t++) {
          uint16_t offset = lu_ptr->txtdt->offsets[t];
          if (offset == 0) continue;
          
          // The actual text parsing is complex and depends on char_set
          // For now, just note that text data exists at this offset
          cJSON *tobj = cJSON_CreateObject();
          cJSON_AddNumberToObject(tobj, "index", t);
          cJSON_AddNumberToObject(tobj, "offset", offset);
          
          // Try to read raw bytes (may not be valid UTF-8)
          // Text format varies by charset - skip actual decoding for now
          cJSON_AddStringToObject(tobj, "note", "Text data present but not decoded");
          
          cJSON_AddItemToArray(texts, tobj);
        }
      }
      
      cJSON_AddItemToArray(langUnits, luobj);
    }
  }

  tt_srpt_t *tt_srpt = vmg->tt_srpt;
  if (!tt_srpt) {
    ifoClose(vmg);
    DVDClose(dvd);
    cJSON_Delete(root);
    return NULL;
  }

  cJSON *titles_array = cJSON_AddArrayToObject(root, "titles");
  int n_titles = tt_srpt->nr_of_srpts;

  for (int i = 0; i < n_titles; i++) {
    title_info_t *title = &tt_srpt->title[i];
    int vts_ix = title->title_set_nr;
    int pgc_ix = title->vts_ttn;

    ifo_handle_t *vts = ifoOpen(dvd, vts_ix);
    if (!vts) continue;

    cJSON *tobj = cJSON_CreateObject();
    cJSON_AddNumberToObject(tobj, "ix", i + 1);
    cJSON_AddNumberToObject(tobj, "vtsIx", vts_ix);
    cJSON_AddNumberToObject(tobj, "pgcIx", pgc_ix);

    // Title type from pb_ty
    int title_type = title->pb_ty.multi_or_random_pgc_title ? 2 : 1;
    cJSON_AddNumberToObject(tobj, "ifoTitleType", title_type);
    cJSON_AddNumberToObject(tobj, "angleCount", title->nr_of_angles);
    cJSON_AddNumberToObject(tobj, "parentalId", title->parental_id);
    cJSON_AddNumberToObject(tobj, "nrOfPttSearchPointers", title->nr_of_ptts);

    // Duration and chapters
    pgcit_t *pgcit = vts->vts_pgcit;
    if (pgcit && pgc_ix > 0 && pgc_ix <= pgcit->nr_of_pgci_srp) {
      pgc_t *pgc = pgcit->pgci_srp[pgc_ix - 1].pgc;

      double duration = (double)pgc->playback_time.hour * 3600.0 +
                        (double)pgc->playback_time.minute * 60.0 +
                        (double)pgc->playback_time.second;
      cJSON_AddNumberToObject(tobj, "length", duration);
      
      // PGC navigation
      cJSON_AddNumberToObject(tobj, "nextPgc", pgc->next_pgc_nr);
      cJSON_AddNumberToObject(tobj, "prevPgc", pgc->prev_pgc_nr);
      cJSON_AddNumberToObject(tobj, "goupPgc", pgc->goup_pgc_nr);
      cJSON_AddNumberToObject(tobj, "stillTime", pgc->still_time);
      
      // Prohibited operations
      cJSON *prohibited = cJSON_CreateObject();
      cJSON_AddBoolToObject(prohibited, "stop", pgc->prohibited_ops.stop);
      cJSON_AddBoolToObject(prohibited, "pauseOn", pgc->prohibited_ops.pause_on);
      cJSON_AddBoolToObject(prohibited, "titlePlay", pgc->prohibited_ops.title_play);
      cJSON_AddBoolToObject(prohibited, "chapterSearch", pgc->prohibited_ops.chapter_search_or_play);
      cJSON_AddBoolToObject(prohibited, "timeSearch", pgc->prohibited_ops.time_or_chapter_search);
      cJSON_AddBoolToObject(prohibited, "forwardScan", pgc->prohibited_ops.forward_scan);
      cJSON_AddBoolToObject(prohibited, "backwardScan", pgc->prohibited_ops.backward_scan);
      cJSON_AddBoolToObject(prohibited, "nextPgSearch", pgc->prohibited_ops.next_pg_search);
      cJSON_AddBoolToObject(prohibited, "prevPgSearch", pgc->prohibited_ops.prev_or_top_pg_search);
      cJSON_AddBoolToObject(prohibited, "rootMenuCall", pgc->prohibited_ops.root_menu_call);
      cJSON_AddBoolToObject(prohibited, "titleMenuCall", pgc->prohibited_ops.title_menu_call);
      cJSON_AddBoolToObject(prohibited, "chapterMenuCall", pgc->prohibited_ops.chapter_menu_call);
      cJSON_AddBoolToObject(prohibited, "audioChange", pgc->prohibited_ops.audio_stream_change);
      cJSON_AddBoolToObject(prohibited, "subpicChange", pgc->prohibited_ops.subpic_stream_change);
      cJSON_AddBoolToObject(prohibited, "angleChange", pgc->prohibited_ops.angle_change);
      cJSON_AddItemToObject(tobj, "prohibitedOps", prohibited);

      cJSON *chapters = cJSON_AddArrayToObject(tobj, "chapters");
      if (pgc->program_map) {
        for (int c = 0; c < pgc->nr_of_programs; c++) {
          cJSON *chap = cJSON_CreateObject();
          cJSON_AddNumberToObject(chap, "ix", c + 1);

          double start_time = 0.0;
          int start_cell = pgc->program_map[c];
          for (int cell = 0; cell < start_cell - 1 && cell < pgc->nr_of_cells; cell++) {
            cell_playback_t *cp = &pgc->cell_playback[cell];
            start_time += (double)cp->playback_time.hour * 3600.0 +
                          (double)cp->playback_time.minute * 60.0 +
                          (double)cp->playback_time.second;
          }
          cJSON_AddNumberToObject(chap, "startTime", start_time);
          cJSON_AddItemToArray(chapters, chap);
        }
      }
      
      // Cell-level details
      cJSON *cells = cJSON_AddArrayToObject(tobj, "cells");
      if (pgc->cell_playback) {
        for (int c = 0; c < pgc->nr_of_cells; c++) {
          cell_playback_t *cp = &pgc->cell_playback[c];
          cJSON *cellobj = cJSON_CreateObject();
          cJSON_AddNumberToObject(cellobj, "ix", c + 1);
          
          double cell_duration = (double)cp->playback_time.hour * 3600.0 +
                                (double)cp->playback_time.minute * 60.0 +
                                (double)cp->playback_time.second;
          cJSON_AddNumberToObject(cellobj, "duration", cell_duration);
          
          cJSON_AddNumberToObject(cellobj, "startSector", cp->first_sector);
          cJSON_AddNumberToObject(cellobj, "endSector", cp->last_sector);
          cJSON_AddNumberToObject(cellobj, "blockMode", cp->block_mode);
          cJSON_AddNumberToObject(cellobj, "blockType", cp->block_type);
          cJSON_AddNumberToObject(cellobj, "seamlessAngle", cp->seamless_angle);
          cJSON_AddNumberToObject(cellobj, "stillTime", cp->still_time);
          cJSON_AddBoolToObject(cellobj, "seamlessPlay", cp->seamless_play);
          cJSON_AddBoolToObject(cellobj, "interleaved", cp->interleaved);
          cJSON_AddBoolToObject(cellobj, "stcDiscontinuity", cp->stc_discontinuity);
          cJSON_AddBoolToObject(cellobj, "playbackMode", cp->playback_mode);
          cJSON_AddBoolToObject(cellobj, "restricted", cp->restricted);
          cJSON_AddNumberToObject(cellobj, "cellType", cp->cell_type);
          cJSON_AddNumberToObject(cellobj, "cellCmdNr", cp->cell_cmd_nr);
          cJSON_AddNumberToObject(cellobj, "firstIlvuEndSector", cp->first_ilvu_end_sector);
          cJSON_AddNumberToObject(cellobj, "lastVobuStartSector", cp->last_vobu_start_sector);
          
          cJSON_AddItemToArray(cells, cellobj);
        }
      }
    } else {
      cJSON_AddNumberToObject(tobj, "length", 0.0);
      cJSON_AddArrayToObject(tobj, "chapters");
      cJSON_AddArrayToObject(tobj, "cells");
    }

    // Video
    cJSON *video = cJSON_CreateObject();
    cJSON_AddStringToObject(video, "type", "video");
    if (vts->vtsi_mat) {
      video_attr_t *vattr = &vts->vtsi_mat->vts_video_attr;
      const char *codec = (vattr->mpeg_version == 0) ? "MPEG1" : "MPEG2";
      cJSON_AddStringToObject(video, "format", codec);
      
      int width = 720;
      if (vattr->picture_size == 1) width = 704;
      else if (vattr->picture_size >= 2) width = 352;
      cJSON_AddNumberToObject(video, "width", width);

      int height = (vattr->video_format == 1) ? 576 : 480;
      cJSON_AddNumberToObject(video, "height", height);

      double fps = (vattr->video_format == 1) ? 25.0 : 29.97;
      cJSON_AddNumberToObject(video, "fps", fps);

      const char *aspect = (vattr->display_aspect_ratio == 3) ? "16:9" : "4:3";
      cJSON_AddStringToObject(video, "aspectRatio", aspect);
      
      cJSON_AddBoolToObject(video, "line21CC1", vattr->line21_cc_1);
      cJSON_AddBoolToObject(video, "line21CC2", vattr->line21_cc_2);
      cJSON_AddBoolToObject(video, "constantBitrate", vattr->bit_rate);
      cJSON_AddBoolToObject(video, "letterboxed", vattr->letterboxed);
      cJSON_AddBoolToObject(video, "filmMode", vattr->film_mode);
    } else {
      cJSON_AddStringToObject(video, "format", "unknown");
      cJSON_AddNumberToObject(video, "width", 0);
      cJSON_AddNumberToObject(video, "height", 0);
      cJSON_AddNumberToObject(video, "fps", 0.0);
      cJSON_AddStringToObject(video, "aspectRatio", "unknown");
    }
    cJSON_AddItemToObject(tobj, "video", video);

    // Audio
    cJSON *audio_array = cJSON_AddArrayToObject(tobj, "audio");
    if (vts->vtsi_mat) {
      int n_audio = vts->vtsi_mat->nr_of_vts_audio_streams;
      for (int a = 0; a < n_audio; a++) {
        audio_attr_t *aattr = &vts->vtsi_mat->vts_audio_attr[a];
        
        char lang[3];
        safe_lang(lang, aattr->lang_code);
        
        const char *fmt = "AC3";
        if (aattr->audio_format == 2) fmt = "MPEG";
        else if (aattr->audio_format == 3) fmt = "LPCM";
        else if (aattr->audio_format == 4) fmt = "DTS";

        int sample_rate = (aattr->sample_frequency == 1) ? 96000 : 48000;
        int quant = 16;
        if (aattr->quantization == 1) quant = 20;
        else if (aattr->quantization == 2) quant = 24;

        cJSON *aobj = cJSON_CreateObject();
        cJSON_AddStringToObject(aobj, "type", "audio");
        cJSON_AddNumberToObject(aobj, "ix", a);
        cJSON_AddStringToObject(aobj, "langCode", lang);
        cJSON_AddStringToObject(aobj, "language", lang);
        cJSON_AddStringToObject(aobj, "format", fmt);
        cJSON_AddNumberToObject(aobj, "channels", aattr->channels + 1);
        cJSON_AddNumberToObject(aobj, "sampleRate", sample_rate);
        cJSON_AddNumberToObject(aobj, "quantization", quant);
        cJSON_AddBoolToObject(aobj, "multichannelExtension", aattr->multichannel_extension);
        cJSON_AddNumberToObject(aobj, "langType", aattr->lang_type);
        cJSON_AddNumberToObject(aobj, "applicationMode", aattr->application_mode);
        cJSON_AddNumberToObject(aobj, "langExtension", aattr->lang_extension);
        cJSON_AddNumberToObject(aobj, "codeExtension", aattr->code_extension);
        cJSON_AddItemToArray(audio_array, aobj);
      }
    }

    // Subtitles
    cJSON *sub_array = cJSON_AddArrayToObject(tobj, "subtitles");
    if (vts->vtsi_mat) {
      int n_sub = vts->vtsi_mat->nr_of_vts_subp_streams;
      for (int s = 0; s < n_sub; s++) {
        subp_attr_t *sattr = &vts->vtsi_mat->vts_subp_attr[s];
        
        char lang[3];
        safe_lang(lang, sattr->lang_code);

        cJSON *sobj = cJSON_CreateObject();
        cJSON_AddStringToObject(sobj, "type", "subtitle");
        cJSON_AddNumberToObject(sobj, "ix", s);
        cJSON_AddStringToObject(sobj, "langCode", lang);
        cJSON_AddStringToObject(sobj, "language", lang);
        cJSON_AddStringToObject(sobj, "format", "VobSub");
        cJSON_AddNumberToObject(sobj, "codeMode", sattr->code_mode);
        cJSON_AddNumberToObject(sobj, "subpType", sattr->type);
        cJSON_AddNumberToObject(sobj, "langExtension", sattr->lang_extension);
        cJSON_AddNumberToObject(sobj, "codeExtension", sattr->code_extension);
        cJSON_AddItemToArray(sub_array, sobj);
      }
    }

    cJSON_AddItemToArray(titles_array, tobj);
    ifoClose(vts);
  }

  ifoClose(vmg);
  DVDClose(dvd);

  char *json_str = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  return json_str;
}

void ifo_parse_free(char *ptr) {
  free(ptr);
}
