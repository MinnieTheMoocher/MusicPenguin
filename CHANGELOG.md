# MusicPenguin Changelog

## musicpenguin 0.0.3

* feature: provided rpm installation package
* change:  restructured source tree
* change:  updated Electron to 43.4.1
* bugfix:  removed unused binaries from installation packages
* bugfix:  added missing dependency to Google Noto Color Emoji font, use Emoji glyphs properly

## musicpenguin 0.0.2

* feature: media servers on local network (DLNA/UPnP) can be used in addition to local files or files from mounted file systems like from NAS
* feature: new app language: Spanish
* feature: new context menus "Go to Artist", "Go to Composer" in addition to already existing "Go to Album" and "Go to Folder"
* feature: main playback bar can be placed either at top or bottom
* feature: automatic play can skip tracks with too bad rating
* feature: theater mode: in addition to front covers shows also rear cover images (if present) and additional artwork in same folder (if present)
* feature: media keys on keyboards (play/pause/previous/next) are supported (MPRIS)
* feature: specific workaround for malformed files from ancient mp3 encoders (mp3 data inside wav container)
* feature: external player can be configured freely in settings (e.g. vlc)
* feature: added "clear MusicPenguin library" button
* change:  shuffle/repeat buttons relocated to the top
* bugfix:  GNOME task switcher now shows correct app icon
* bugfix:  repaired playlist coverart thumbnail loading
* bugfix:  search function now can handle Unicode and accented characters
* bugfix:  sorting by duration was broken
* bugfix:  various ui improvements

## musicpenguin 0.0.1

* feature: app languages: English, German, French
* feature: light/dark app ui mode
* feature: folder selection and scanning for audio/video files
* feature: tag reading
* feature: top "now playing" bar with play/pause, seek, time display, track rating and volume control
* feature: main list ui showing all found files, supports deletion from just MusicPenguin database or the file system.
* feature: columns showing track details of main list are resizable and configurable
* feature: details ui showing tag details of selected file and cover art, supporting file renaming
* feature: internet search for track details on Discogs, Amazon, Google, Musicbrainz, DNB
* feature: track rating and play count (not yet written to files, just the internal db)
* feature: search ui featuring case-insensitive substring or regex search
* feature: playlist ui featuring shuffle and repeat modes, drag+drop, save and load
* feature: fullscreen theater mode
