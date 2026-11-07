// The AIEdu sprout "A" and wordmark, drawn directly so it stays sharp at any size.
export function Mark({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  const green = onDark ? '#19B984' : '#0E7C5F';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden focusable="false">
      <path d="M10 89L41 12H59L90 89H74L50 33L26 89Z" fill={green} stroke={green} strokeWidth="7" strokeLinejoin="round" />
      <path d="M41 80C41 66 49 58 61 57C61 71 53 79 41 80Z" fill="#F5B700" />
    </svg>
  );
}

export function Logo({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <span className="logo" style={{ fontSize: size * 0.82 }} aria-label="AIEdu">
      <Mark size={size} onDark={onDark} />
      <span aria-hidden>
        <span style={{ color: onDark ? '#19B984' : '#0E7C5F' }}>AI</span>
        <span style={{ color: onDark ? '#FFFFFF' : '#0B2A22' }}>Edu</span>
      </span>
    </span>
  );
}
