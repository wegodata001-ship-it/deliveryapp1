import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "var(--adm-bg)",
      }}
    >
      <div
        style={{
          textAlign: "center",
          maxWidth: "420px",
          background: "#fff",
          padding: "2rem",
          borderRadius: "16px",
          border: "1px solid var(--adm-border)",
          boxShadow: "var(--adm-shadow)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>וויגו פרו</h1>
        <p style={{ color: "var(--adm-muted)", lineHeight: 1.6 }}>מערכת ניהול משלוחים ותשלומים</p>
        <Link
          href="/admin-login"
          style={{
            display: "inline-block",
            marginTop: "1rem",
            padding: "0.65rem 1.25rem",
            background: "var(--adm-primary)",
            color: "#fff",
            borderRadius: "10px",
            fontWeight: 600,
          }}
        >
          כניסה למערכת
        </Link>
      </div>
    </main>
  );
}
