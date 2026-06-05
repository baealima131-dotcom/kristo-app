let posterClientUnavailableLogged = false;

function logPosterClientUnavailableOnce() {
  if (posterClientUnavailableLogged) return;
  posterClientUnavailableLogged = true;
  console.warn("KRISTO_VIDEO_POSTER_CLIENT_UNAVAILABLE", {
    reason: "disabled-for-v1",
  });
}

/** V1: client-side video posters disabled. */
export async function generateLocalVideoPosterUri(_videoUri: string): Promise<string | null> {
  logPosterClientUnavailableOnce();
  return null;
}
