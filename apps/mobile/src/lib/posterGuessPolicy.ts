// ANDROID_NO_INFERRED_POSTER_GUESS_V1
// Posters are stored under upload-specific names, so a poster path guessed from the
// video URL (church-videos/X/Y.mp4 -> church-video-posters/X/Y.jpg) returned 404 for
// every audited post. Android requests only saved, cached or locally generated posters.
// iOS keeps its existing behavior.
export function shouldRequestInferredPosterGuess(platformOS: string): boolean {
  return platformOS !== "android";
}
