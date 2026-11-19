// 규정 새로고침 로고: 키보드 F5 키(윗면·아랫면 두께가 있는 키캡)
export function Logo({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect x="2" y="4" width="36" height="34" rx="8" fill="currentColor" opacity="0.35" />
      <rect x="2" y="2" width="36" height="31" rx="8" fill="currentColor" />
      <rect x="6" y="5" width="28" height="24" rx="5" fill="none" stroke="var(--color-background, #fff)" strokeOpacity="0.25" />
      <text x="20" y="22.5" textAnchor="middle" fontFamily="Geist Variable, system-ui, sans-serif" fontWeight="700" fontSize="14" fill="var(--color-background, #fff)">F5</text>
    </svg>
  )
}
