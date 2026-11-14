/**
 * Pages that host the platforms' official players inside Watch's WebView, driven only through
 * each platform's public player API (no reaching into the player's iframe):
 * - YouTube: IFrame Player API (playVideo, seekTo, onStateChange).
 * - Facebook: Embedded Video Player API of the Facebook JS SDK (play, seek, unmute, events).
 * Each page posts small JSON messages to the app: {type: "playing" | "ended" | "error"}.
 * window.kristoReplay() restarts the video from the beginning (used by Watch's end cover).
 */

/** Sent to YouTube as the embedding client's identity (YouTube requires one for app WebViews). */
export const YOUTUBE_CLIENT_ORIGIN = "https://com.princefariji.kristoapp.free";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** YT.PlayerState values sent by onStateChange. */
const YOUTUBE_ENDED = 0;
const YOUTUBE_PLAYING = 1;

export type ExternalPlayerMessage = { type: "playing" | "ended" | "error"; code?: number };

/** The YouTube video id of a public YouTube link, or null. */
export function youtubeVideoIdFromUrl(raw: unknown): string | null {
  try {
    const parsed = new URL(String(raw || "").trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) return null;
    const videoId = host === "youtu.be"
      ? parsed.pathname.split("/").filter(Boolean)[0] || ""
      : parsed.pathname === "/watch"
        ? parsed.searchParams.get("v") || ""
        : parsed.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] || "";
    return YOUTUBE_ID.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}

const POST_MESSAGE_JS =
  "function post(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}}";

const PAGE_HEAD =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">' +
  "<style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}" +
  "#player{position:absolute;top:0;left:0;width:100%;height:100%}" +
  ".wrap{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center}" +
  "</style></head>";

/**
 * YouTube IFrame Player API page: starts playing on load, reports playing/ended/error.
 * Controls are YouTube's own (they hide while playing and come back on a tap); related videos
 * are limited to the same channel (rel=0) and Watch covers the end screen with the post cover.
 */
export function buildYouTubePlayerHtml(videoId: string): string | null {
  if (!YOUTUBE_ID.test(videoId)) return null;
  const options = {
    host: "https://www.youtube-nocookie.com",
    width: "100%",
    height: "100%",
    videoId,
    playerVars: { playsinline: 1, autoplay: 1, controls: 1, rel: 0, fs: 1, origin: YOUTUBE_CLIENT_ORIGIN },
  };
  return (
    PAGE_HEAD +
    '<body><div id="player"></div><script>' +
    POST_MESSAGE_JS +
    "var player;" +
    "function onYouTubeIframeAPIReady(){var o=" + JSON.stringify(options) + ";" +
    "o.events={" +
    "onReady:function(e){e.target.playVideo()}," +
    "onStateChange:function(e){" +
    "if(e.data===" + YOUTUBE_PLAYING + ")post({type:'playing'});" +
    "if(e.data===" + YOUTUBE_ENDED + ")post({type:'ended'})}," +
    "onError:function(e){post({type:'error',code:e.data})}};" +
    "player=new YT.Player('player',o)}" +
    "window.kristoReplay=function(){if(player){player.seekTo(0,true);player.playVideo()}};" +
    '</script><script src="https://www.youtube.com/iframe_api"></script></body></html>'
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Facebook Embedded Video Player (JS SDK) page for a confirmed public Facebook video/Reel link.
 * Starts playing with sound through the player API (play, unmute), reports playing/ended/error.
 * Controls are Facebook's own (hidden while playing, shown on a tap).
 */
export function buildFacebookSdkPlayerHtml(href: string, width: number): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch")) {
    return null;
  }
  const playerWidth = Math.max(220, Math.round(width));
  return (
    PAGE_HEAD +
    '<body><div id="fb-root"></div><div class="wrap">' +
    '<div class="fb-video" data-href="' + escapeAttribute(url.toString()) + '" data-width="' + playerWidth + '"' +
    ' data-autoplay="true" data-allowfullscreen="true" data-show-text="false" data-show-captions="false"></div>' +
    "</div><script>" +
    POST_MESSAGE_JS +
    "var player;" +
    "window.fbAsyncInit=function(){FB.init({xfbml:true,version:'v21.0'});" +
    "FB.Event.subscribe('xfbml.ready',function(msg){if(msg.type!=='video')return;player=msg.instance;" +
    "player.subscribe('startedPlaying',function(){post({type:'playing'})});" +
    "player.subscribe('finishedPlaying',function(){post({type:'ended'})});" +
    "player.subscribe('error',function(){post({type:'error'})});" +
    "try{player.unmute()}catch(e){}try{player.play()}catch(e){}})};" +
    "window.kristoReplay=function(){if(player){try{player.seek(0)}catch(e){}player.play()}};" +
    '</script><script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script>' +
    "</body></html>"
  );
}

/** Parses a message from a player page; anything unexpected is ignored. */
export function parseExternalPlayerMessage(data: unknown): ExternalPlayerMessage | null {
  try {
    const value = JSON.parse(String(data || ""));
    if (value && (value.type === "playing" || value.type === "ended" || value.type === "error")) {
      return { type: value.type, code: Number.isFinite(Number(value.code)) ? Number(value.code) : undefined };
    }
  } catch {}
  return null;
}
