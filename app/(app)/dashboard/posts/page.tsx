export default function PostsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 44, fontWeight: 900, marginBottom: 6 }}>Latest Posts</h1>
      <div style={{ opacity: 0.8, marginBottom: 18 }}>Sermon • Worship • Testimony</div>

      <div style={{ display: "grid", gap: 12, maxWidth: 900 }}>
        <PostCard title="Ushuhuda: Mungu Amenitoa Mbali" meta="Testimony • 3 min" />
        <PostCard title="Worship: Roho Mtakatifu Njoo" meta="Worship • 5 min" />
        <PostCard title="Sermon: Imani Inayoishi" meta="Sermon • 12 min" />
      </div>

      <div style={{ opacity: 0.6, marginTop: 14, fontSize: 12 }}>
        Next: connect database ya posts (Firestore / Mongo) + uploader.
      </div>
    </div>
  );
}

function PostCard({ title, meta }: { title: string; meta: string }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", borderRadius: 16, padding: 16 }}>
      <div style={{ fontWeight: 900 }}>{title}</div>
      <div style={{ opacity: 0.75, marginTop: 4 }}>{meta}</div>
    </div>
  );
}
