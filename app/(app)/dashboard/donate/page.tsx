export default function DonatePage() {
  return (
    <div>
      <h1 style={{ fontSize: 44, fontWeight: 900, marginBottom: 6 }}>Donate</h1>
      <div style={{ opacity: 0.8, marginBottom: 18 }}>Toa Sadaka & Michango</div>

      <div style={{ border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)", borderRadius: 16, padding: 16, maxWidth: 900 }}>
        <div style={{ fontWeight: 900 }}>Stripe / Payments</div>
        <div style={{ opacity: 0.75, marginTop: 6 }}>
          Next step: tutaunganisha Stripe checkout (one-time + recurring) na donation reasons.
        </div>
      </div>
    </div>
  );
}
