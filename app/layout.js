export const metadata = {
  title: "Polymarket Whale Monitor",
  description: "Real-time whale trade alerts for Polymarket prediction markets",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fff" }}>{children}</body>
    </html>
  );
}
