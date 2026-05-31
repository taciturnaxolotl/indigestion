#ifndef IFO_SHIM_H
#define IFO_SHIM_H

// Returns heap-allocated JSON string describing the full disc.
// Returns NULL on error (path not found, not a DVD, etc.)
char *ifo_parse_disc(const char *path);

// Must be called to free the returned string.
void ifo_parse_free(char *ptr);

#endif // IFO_SHIM_H
