const posts = [
  { id: "1", name: "Pastor John", type: "Sermon", text: "Today we learned about walking by faith. Be encouraged to step out." },
  { id: "2", name: "Media Team", type: "Worship", text: "Highlights from last night’s worship service." },
  { id: "3", name: "Grace", type: "Testimony", text: "God answered my prayer this week and I want to share." },
];

export default function PostsPage() {
  return (
    <div>
      <h1 className="pageTitle">Latest Posts</h1>
      <p className="pageSub">VIP feed — Sermons, Worship, Testimonies</p>

      <div className="postStack">
        {posts.map((p) => (
          <div key={p.id} className="postCard">
            <div className="postHead">
              <div className="avatar" />
              <div>
                <div className="postName">{p.name}</div>
                <div className="postType">{p.type}</div>
              </div>
            </div>

            <div className="postBody">{p.text}</div>

            <div className="postActions">
              <span>👍 Like</span>
              <span>💬 Comment</span>
              <span>↗️ Share</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
