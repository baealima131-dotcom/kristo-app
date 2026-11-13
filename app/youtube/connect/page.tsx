export const dynamic = "force-dynamic";

export default async function YoutubeConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const invite = String((await searchParams)?.invite || "");
  const validInvite = /^[A-Za-z0-9_-]{40,60}$/.test(invite);
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "radial-gradient(ellipse at top, #2c1748 0%, #11121d 52%, #080b12 100%)", color: "white", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ width: "100%", maxWidth: 480, padding: 28, border: "1px solid rgba(244,208,111,.35)", borderRadius: 24, background: "rgba(23,25,39,.92)", boxShadow: "0 24px 80px rgba(0,0,0,.38)" }}>
        <div style={{ color: "#f4d06f", fontSize: 12, fontWeight: 800, letterSpacing: 2 }}>KRISTO MEDIA STUDIO</div>
        <h1 style={{ margin: "12px 0 8px", fontSize: 30 }}>Unganisha YouTube channel</h1>
        <p style={{ color: "#c6c6d1", lineHeight: 1.65 }}>Huhitaji kusakinisha Kristo App wala kutengeneza akaunti ya Kristo. Ingia kwa Google account inayomiliki channel iliyoalikwa, kisha uruhusu Kristo App kusoma takwimu za YouTube Analytics.</p>
        <div style={{ margin: "20px 0", padding: 14, borderRadius: 14, background: "rgba(255,255,255,.055)", color: "#dddde6", fontSize: 13, lineHeight: 1.6 }}>
          Kristo App itaweza kusoma takwimu kama views, likes, comments, shares na video zilizoongezwa kwenye playlists kwa channel hii. Haitaweza kubadilisha au kupakia video.
        </div>
        {validInvite ? (
          <a href={`/api/youtube-analytics/start?invite=${encodeURIComponent(invite)}`} style={{ display: "block", padding: "14px 18px", borderRadius: 14, textAlign: "center", textDecoration: "none", color: "#15131b", background: "linear-gradient(110deg,#f8dd84,#e9bc4c)", fontWeight: 900 }}>Endelea kwa Google</a>
        ) : (
          <p style={{ color: "#fb7185", fontWeight: 700 }}>Link ya mwaliko si sahihi au haipo. Omba System Admin akutumie link mpya.</p>
        )}
        <p style={{ marginTop: 18, color: "#9698a5", fontSize: 11, lineHeight: 1.5 }}>Ruhusa hii ni ya hiari. Ukifunga ukurasa kabla ya kukubali, Kristo App haitapata takwimu za channel.</p>
      </section>
    </main>
  );
}
