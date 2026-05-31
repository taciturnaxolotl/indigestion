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
  cJSON_AddStringToObject(root, "discTitle", vmg->vts_atrt ? "DVD" : "Unknown");

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

    // Duration and chapters
    pgcit_t *pgcit = vts->vts_pgcit;
    if (pgcit && pgc_ix > 0 && pgc_ix <= pgcit->nr_of_pgci_srp) {
      pgc_t *pgc = pgcit->pgci_srp[pgc_ix - 1].pgc;

      double duration = (double)pgc->playback_time.hour * 3600.0 +
                        (double)pgc->playback_time.minute * 60.0 +
                        (double)pgc->playback_time.second;
      cJSON_AddNumberToObject(tobj, "length", duration);

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
    } else {
      cJSON_AddNumberToObject(tobj, "length", 0.0);
      cJSON_AddArrayToObject(tobj, "chapters");
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
