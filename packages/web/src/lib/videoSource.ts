/**
 * Which video source to request from the server.
 *
 * The rule fits on one line, precisely why it lives here: while incorrect,
 * nothing reveals it — the video plays or does not without saying which source
 * caused it. Tested beside `preview.ts` for the same reason.
 */

/** The original as stored in Drive, or the server-prepared version. */
export type VideoSource = 'original' | 'transcoded';

/**
 * Chooses the source from the codec actually contained in the file.
 *
 * `canPlayType` receives the codec, never `video/mp4` alone: every browser answers
 * `maybe` to the latter, revealing nothing (D98). With the codec, the answer is
 * explicit — an empty string means "I cannot play it".
 *
 * The original remains the default even when the codec is unknown: it is the
 * full-quality file, and doubt does not justify serving a degraded — or unready
 * — version. This also ensures Safari and iPhones, which decode HEVC, never see
 * the transcode.
 */
export function chooseVideoSource(
  codec: string | null,
  canPlayType: (type: string) => string,
): VideoSource {
  if (!codec) return 'original';
  return canPlayType(`video/mp4; codecs="${codec}"`) === '' ? 'transcoded' : 'original';
}

/**
 * Probe for the current browser using one detached, reused element: creating a
 * `<video>` for every viewer photo would discard an element on each media change.
 */
let probe: HTMLVideoElement | null = null;

export function canPlayVideoType(type: string): string {
  probe ??= document.createElement('video');
  return probe.canPlayType(type);
}
