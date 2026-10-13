export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" className="logo-mark">
      <circle cx="20" cy="20" r="19" fill="var(--palm)" />
      <circle cx="20" cy="20" r="15" fill="none" stroke="var(--sand)" strokeWidth="1" strokeDasharray="1.5 2.5" opacity=".7" />
      <path d="M8 27 Q20 21 32 27 L32 32 Q20 36 8 32Z" fill="var(--sea)" />
      <path d="M12.5 15.5 L19 25 L28 11" stroke="var(--sand)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span>
        Vera<em>pass</em>
      </span>
    </span>
  )
}
