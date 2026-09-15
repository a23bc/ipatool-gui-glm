// Boot splash shown while we're probing ipatool on startup. Rendered by
// Gate when `ipatool` is still null in the store. We keep the visual style
// consistent with the static `#boot` splash in index.html so the user
// doesn't see a flash of different content.
export function BootSplash() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0b0d11",
        color: "#e6e9ef",
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "3px solid #1f2430",
            borderTopColor: "#5b8def",
            animation: "boot-rot 0.8s linear infinite",
          }}
        />
        <div style={{ fontSize: 13, opacity: 0.6 }}>Loading ipatool-gui…</div>
      </div>
    </div>
  );
}
