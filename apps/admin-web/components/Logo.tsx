// The Arscio mark (the A with a new leaf) and wordmark, drawn directly so it stays sharp at any size.
export function Mark({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  const blue = onDark ? '#7FD3EE' : '#0B7FA6';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden focusable="false">
      <g fill={blue} stroke={blue} strokeWidth="7" strokeLinejoin="round">
        <path d="M10 89L41 12H59L90 89H74L50 33L26 89Z" />
        </g>
      <path d="M41 80C41 66 49 58 61 57C61 71 53 79 41 80Z" fill="#F2A33A" />
    </svg>
  );
}

export function Logo({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <span className="logo" style={{ fontSize: size * 0.82 }} aria-label="Arscio">
      <Mark size={size} onDark={onDark} />
      <span aria-hidden>
        <span style={{ color: onDark ? '#7FD3EE' : '#0B7FA6' }}>Ar</span>
        <span style={{ color: onDark ? '#FFFFFF' : '#0B3B4C' }}>scio</span>
      </span>
    </span>
  );
}
