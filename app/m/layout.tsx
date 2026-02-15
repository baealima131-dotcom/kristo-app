export const runtime = "nodejs";

export default function MLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
      </head>
      <body style={{ margin: 0, background: "#0b0f17", color: "white" }}>{children}</body>
    </html>
  );
}
