import "./globals.css";

export const metadata = {
  title: "Yetvix AI",
  description: "Yetvix AI: coding, study aur writing ke liye aapka smart AI saathi",
};
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#050816" };

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
