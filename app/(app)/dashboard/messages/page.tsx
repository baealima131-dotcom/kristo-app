export default function MessagesPage() {
  return (
    <div>
      <h1 style={{ fontSize: 44, fontWeight: 900, marginBottom: 6 }}>Messages</h1>
      <div style={{ opacity: 0.8, marginBottom: 18 }}>Inbox & Conversations</div>

      <div style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", borderRadius: 16, padding: 16, maxWidth: 900 }}>
        <div style={{ fontWeight: 900 }}>Chat placeholder</div>
        <div style={{ opacity: 0.75, marginTop: 6 }}>
          Hapa tunaweza kuunganisha Live Chat (Firestore) au DM.
        </div>
      </div>
    </div>
  );
}
